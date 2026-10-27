#!/usr/bin/env python3
"""Live Claude Code / Codex CLI sessions (agent-worker), for the Live view.

Same "file is the state" convention as collect_pi_live.py: each CLI appends to
one JSONL transcript per session, so a session is live exactly when its file's
mtime is recent. Discovery globs, per engine:

  claude  $LLM_TELEMETRY_CLAUDE_HOME (default ~/.claude)/projects/<slug>/<uuid>.jsonl
  codex   $LLM_TELEMETRY_CODEX_HOME  (default ~/.codex)/sessions/Y/M/D/rollout-*.jsonl

Privacy: transcripts hold prompts, replies and tool arguments. Only metadata
is extracted -- session id, model name, last-event time, token counts and a coarse phase (a
tool NAME, "thinking", "responding", "idle"). Message text and tool
input/arguments are never copied into the result; the cwd is read only to
derive the title (its basename) and the absolute path is never emitted. Models are reported only when the transcript names one (never
guessed).
"""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any, Iterable, Optional

from . import pricing
from .collect_pi_agents import _iso_to_unix

STALE_WINDOW_S = 180
# Only the head (session metadata) and tail (latest activity) of a transcript
# are read; a long-running session's file can be tens of MB.
TAIL_BYTES = 256 * 1024
HEAD_BYTES = 64 * 1024
_SAFE_NAME = re.compile(r"[^A-Za-z0-9_.:\-]")
NAME_MAX = 40


def _safe_name(name: Any) -> str:
    """A tool name reduced to a conservative charset/length, so even a
    pathological name cannot smuggle free text into the phase."""
    return _SAFE_NAME.sub("", str(name))[:NAME_MAX]


def _read_events(path: Path, head: bool = False) -> list[dict[str, Any]]:
    """Parsed JSON objects from the head or tail of ``path``. A partial first
    line of a tail window (cut mid-record) and unparseable lines are skipped."""
    try:
        size = path.stat().st_size
        with open(path, "rb") as fh:
            if head:
                data = fh.read(HEAD_BYTES)
            else:
                start = max(0, size - TAIL_BYTES)
                fh.seek(start)
                data = fh.read()
                if start > 0:
                    data = data.split(b"\n", 1)[-1]
    except OSError:
        return []
    out = []
    for line in data.splitlines():
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if isinstance(obj, dict):
            out.append(obj)
    return out


def _ts(event: dict[str, Any]) -> Optional[float]:
    raw = event.get("timestamp")
    if not raw:
        return None
    try:
        return _iso_to_unix(raw)
    except Exception:
        return None


def _model_str(value: Any) -> Optional[str]:
    return value.strip()[:80] if isinstance(value, str) and value.strip() else None


# ---- tokens + subscription-covered API-equivalent cost ----------------------
#
# Claude Code and Codex are paid by flat subscription (Claude / ChatGPT plan),
# so the cost here is the API-PRICE EQUIVALENT of the tokens, marked
# cost_class "subscription" for the UI to label as covered, never as spend.
ENGINE_PROVIDER = {"claude": "anthropic", "codex": "openai-codex"}
_CLAUDE_SCAN: dict[str, dict[str, Any]] = {}


def _usage_n(usage: dict[str, Any], key: str) -> int:
    v = usage.get(key)
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else 0


def claude_tokens(path: Path) -> Optional[dict[str, dict[str, int]]]:
    """Per-model token totals of a Claude Code transcript, {model: {input,
    output, cache_read, cache_write}}. A message streams as several records
    sharing message.id, each repeating its usage: the last one per id wins.
    The file is read incrementally (offset kept per path) as it can be tens
    of MB and is polled every few seconds."""
    key = str(path)
    try:
        size = path.stat().st_size
    except OSError:
        return None
    st = _CLAUDE_SCAN.get(key)
    if st is None or size < st["off"]:
        st = _CLAUDE_SCAN[key] = {"off": 0, "msgs": {}}
    if size > st["off"]:
        try:
            with open(path, "rb") as fh:
                fh.seek(st["off"])
                data = fh.read(size - st["off"])
        except OSError:
            return None
        cut = data.rfind(b"\n") + 1
        st["off"] += cut
        for line in data[:cut].splitlines():
            if b'"usage"' not in line:
                continue
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            msg = ev.get("message") if isinstance(ev, dict) else None
            usage = msg.get("usage") if isinstance(msg, dict) else None
            if msg is None or ev.get("type") != "assistant" or not isinstance(usage, dict):
                continue
            model = _model_str(msg.get("model"))
            if not model or model.startswith("<"):
                continue
            mid = msg.get("id") or ev.get("uuid") or f"@{st['off']}:{len(st['msgs'])}"
            st["msgs"][mid] = (model, _usage_n(usage, "input_tokens"),
                               _usage_n(usage, "output_tokens"),
                               _usage_n(usage, "cache_read_input_tokens"),
                               _usage_n(usage, "cache_creation_input_tokens"))
    out: dict[str, dict[str, int]] = {}
    for model, i, o, cr, cw in st["msgs"].values():
        t = out.setdefault(model, {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0})
        t["input"] += i
        t["output"] += o
        t["cache_read"] += cr
        t["cache_write"] += cw
    return out or None


def codex_tokens(tail: list[dict[str, Any]], model: Optional[str]) -> Optional[dict[str, dict[str, int]]]:
    """Codex logs a cumulative total_token_usage in each token_count event, so
    the newest one in the tail is the session total. Its input_tokens include
    the cached ones, which are split out here."""
    for ev in reversed(tail):
        payload = ev.get("payload")
        if ev.get("type") != "event_msg" or not isinstance(payload, dict) or payload.get("type") != "token_count":
            continue
        info = payload.get("info")
        u = info.get("total_token_usage") if isinstance(info, dict) else None
        if isinstance(u, dict):
            cached = _usage_n(u, "cached_input_tokens")
            return {model or "": {"input": max(0, _usage_n(u, "input_tokens") - cached),
                                  "output": _usage_n(u, "output_tokens"),
                                  "cache_read": cached, "cache_write": 0}}
    return None


def price_tokens(engine: str, by_model: Optional[dict[str, dict[str, int]]]) -> dict[str, Any]:
    """Row fields for a session: token counts (always when known) and the
    API-price equivalent from the pricing table (null when a model has no
    rate, so it never reads as a real $0)."""
    if not by_model:
        return {}
    tot = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}
    cost, priced = 0.0, True
    catalog = pricing.cached_catalog()
    for model, t in by_model.items():
        for k in tot:
            tot[k] += t[k]
        r = pricing.price_row({"provider": ENGINE_PROVIDER[engine], "model": model,
                               "input_tokens": t["input"], "output_tokens": t["output"],
                               "cache_read": t["cache_read"], "cache_write": t["cache_write"]}, catalog)
        cost += r["market_value_usd"]
        priced = priced and r["priced"]
    return {"in_tok": tot["input"], "out_tok": tot["output"],
            "cache_read_tok": tot["cache_read"], "cache_write_tok": tot["cache_write"],
            "cost_usd": round(cost, 4) if priced else None,
            "cost_class": "subscription"}


# ---- Claude Code -----------------------------------------------------------

def _claude_phase(event: dict[str, Any]) -> Optional[str]:
    typ = event.get("type")
    msg = event.get("message")
    if not isinstance(msg, dict):
        return None
    content = msg.get("content")
    if typ == "assistant":
        if not isinstance(content, list):
            return "responding"
        tool = None
        thinking = False
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "tool_use" and item.get("name"):
                tool = _safe_name(item["name"])
            elif item.get("type") == "thinking":
                thinking = True
        if tool:
            return f"running {tool}"
        return "thinking" if thinking and len(content) == 1 else "responding"
    if typ == "user":
        # A prompt or a tool result just arrived: the model is working on it.
        return "thinking"
    return None


def parse_claude_session(path: Path) -> Optional[dict[str, Any]]:
    tail = _read_events(path)
    head = _read_events(path, head=True)
    if not head and not tail:
        return None
    cwd = model = None
    last_ts: Optional[float] = None
    phase = "idle"
    for ev in head:
        if cwd is None and isinstance(ev.get("cwd"), str):
            cwd = ev["cwd"]
    for ev in tail:
        t = _ts(ev)
        if t is not None and (last_ts is None or t >= last_ts):
            last_ts = t
        if isinstance(ev.get("cwd"), str):
            cwd = ev["cwd"]
        msg = ev.get("message")
        if ev.get("type") == "assistant" and isinstance(msg, dict):
            m = _model_str(msg.get("model")) or _model_str(ev.get("requestedModel"))
            # "<synthetic>" marks client-generated placeholder messages.
            if m and not m.startswith("<"):
                model = m
        p = _claude_phase(ev)
        if p:
            phase = p
        # A finished turn: the last assistant record ended with end_turn. Any
        # later user/tool record overwrites this via _claude_phase above.
        if (ev.get("type") == "assistant" and isinstance(msg, dict)
                and msg.get("stop_reason") == "end_turn"):
            phase = "idle"
    sid = path.stem
    return {"session_id": sid, "cwd": cwd or "", "model": model,
            "last_ts": last_ts, "phase": phase}


# ---- Codex CLI ------------------------------------------------------------

def _codex_phase(event: dict[str, Any]) -> Optional[str]:
    payload = event.get("payload")
    if not isinstance(payload, dict):
        return None
    ptype = payload.get("type")
    if event.get("type") == "response_item":
        if ptype in ("function_call", "custom_tool_call", "local_shell_call"):
            name = payload.get("name") or ("shell" if ptype == "local_shell_call" else None)
            return f"running {_safe_name(name)}" if name else "running tool"
        if ptype in ("function_call_output", "custom_tool_call_output"):
            return "thinking"
        if ptype == "reasoning":
            return "thinking"
        if ptype == "message":
            return "thinking" if payload.get("role") == "user" else "responding"
    elif event.get("type") == "event_msg":
        if ptype in ("task_complete", "turn_aborted", "shutdown_complete"):
            return "idle"
        if ptype in ("task_started", "user_message"):
            return "thinking"
    return None


def parse_codex_session(path: Path) -> Optional[dict[str, Any]]:
    head = _read_events(path, head=True)
    tail = _read_events(path)
    if not head and not tail:
        return None
    sid = cwd = model = None
    for ev in head:
        payload = ev.get("payload")
        if ev.get("type") == "session_meta" and isinstance(payload, dict):
            sid = sid or (payload.get("id") if isinstance(payload.get("id"), str) else None)
            cwd = cwd or (payload.get("cwd") if isinstance(payload.get("cwd"), str) else None)
            model = model or _model_str(payload.get("model"))
    last_ts: Optional[float] = None
    phase = "idle"
    for ev in tail:
        t = _ts(ev)
        if t is not None and (last_ts is None or t >= last_ts):
            last_ts = t
        payload = ev.get("payload")
        if ev.get("type") == "turn_context" and isinstance(payload, dict):
            model = _model_str(payload.get("model")) or model
            if isinstance(payload.get("cwd"), str):
                cwd = payload["cwd"]
        p = _codex_phase(ev)
        if p:
            phase = p
    if not sid:
        m = re.search(r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$", path.stem)
        sid = m.group(1) if m else path.stem
    return {"session_id": sid, "cwd": cwd or "", "model": model,
            "last_ts": last_ts, "phase": phase, "tokens": codex_tokens(tail, model)}


# ---- discovery + assembly -------------------------------------------------

def _recent(paths: Iterable[Path], now: float, stale_window_s: int) -> list[tuple[Path, float]]:
    out = []
    for p in paths:
        try:
            mtime = p.stat().st_mtime
        except OSError:
            continue
        if now - mtime <= stale_window_s:
            out.append((p, mtime))
    return out


def discover_claude(home: Path, now: float, stale_window_s: int) -> list[tuple[Path, float]]:
    return _recent(home.glob("projects/*/*.jsonl"), now, stale_window_s)


def discover_codex(home: Path, now: float, stale_window_s: int) -> list[tuple[Path, float]]:
    return _recent(home.glob("sessions/*/*/*/rollout-*.jsonl"), now, stale_window_s)


def build_agent_live(claude_home: Optional[os.PathLike] = None,
                     codex_home: Optional[os.PathLike] = None,
                     now: Optional[float] = None,
                     stale_window_s: int = STALE_WINDOW_S) -> list[dict[str, Any]]:
    """Currently-live Claude Code and Codex sessions in ONE list, each tagged
    ``engine`` ('claude' | 'codex'), most recently active first."""
    now = now if now is not None else time.time()
    chome = Path(claude_home) if claude_home is not None else Path(
        os.environ.get("LLM_TELEMETRY_CLAUDE_HOME") or (Path.home() / ".claude"))
    xhome = Path(codex_home) if codex_home is not None else Path(
        os.environ.get("LLM_TELEMETRY_CODEX_HOME") or (Path.home() / ".codex"))

    best: dict[tuple[str, str], dict[str, Any]] = {}
    for engine, found, parse in (
            ("claude", discover_claude(chome, now, stale_window_s), parse_claude_session),
            ("codex", discover_codex(xhome, now, stale_window_s), parse_codex_session)):
        for path, mtime in found:
            s = parse(path)
            if s is None:
                continue
            tokens = s.get("tokens") if engine == "codex" else claude_tokens(path)
            last = s["last_ts"] if s["last_ts"] is not None else mtime
            cwd = s["cwd"]
            title = os.path.basename(cwd.rstrip("/")) if cwd else ""
            row = {
                "engine": engine,
                "session_id": s["session_id"],
                "title": title or engine,
                "model": s["model"],
                "idle_s": round(max(0.0, now - last), 1),
                "phase": s["phase"],
                "mtime": mtime,
                **price_tokens(engine, tokens),
            }
            # One row per engine:session_id (a resumed/forked transcript can
            # repeat an id across files): keep the most recently written.
            key = (engine, str(s["session_id"]))
            if key not in best or mtime > best[key]["mtime"]:
                best[key] = row
    out = list(best.values())
    out.sort(key=lambda s: s["idle_s"])
    return out


if __name__ == "__main__":
    print(json.dumps(build_agent_live(), indent=2, default=str))
