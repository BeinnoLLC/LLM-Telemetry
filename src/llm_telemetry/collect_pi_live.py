#!/usr/bin/env python3
"""Live PI agent sessions, for the Live view (LST-245).

PI coding agents (launched via pi-worker) write one growing JSONL file per
session under ``~/.pi/agent-*/sessions/<cwd-slug>/<timestamp>_<id>.jsonl``.
Unlike Hermes, PI keeps no sqlite state collect_live.py can query — the JSONL
file itself IS the session's live state, and a file an agent is still turning
on keeps getting new lines appended (and its mtime bumped) every few seconds.
A session is therefore "live" exactly when its file's mtime is recent; once an
agent finishes or is killed, the file goes quiet and ages out of this list on
its own, with no separate "ended" event to watch for.

This module deliberately does NOT re-implement the JSONL event parsing:
collect_pi_agents.py already walks this exact format for historical ingestion
into the analytics store, so parse_pi_session_jsonl() is reused here for the
shared bits (session id, cwd, model/provider). What's added on top is specific
to "what is this bot doing right now": idle time since the last event, and a
short human-readable phase.
"""
from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any, Optional

from .collect_pi_agents import _iso_to_unix, parse_pi_session_jsonl

# A PI agent writes to its active session file roughly every turn; a few
# minutes of silence beyond typical tool/model latency means the run ended
# (or crashed) rather than being merely slow mid-call.
STALE_WINDOW_S = 180
PHASE_TEXT_MAX = 80

# Same window/cap Hermes' own LIVE sql uses for L.tools (collect_analytics.LIVE):
# "what has this session touched recently" -- not its whole lifetime history,
# which would make a long-running agent's gauge permanently pinned to Heavy
# even after it settled into light reading/thinking work.
TOOLS_WINDOW_S = 900
TOOLS_LIMIT = 12

# loeIcon (web/js/charts.js) scores load off two Hermes-shaped name sets --
# heavy = {delegate_task, execute_code, terminal, mcp__browser_exec}, light =
# {read_file, search_files, web_search} -- because that's what Hermes'
# collect_analytics.LIVE actually writes into L.tools. PI's own builtin tool
# names (bash, subagent, read, ...) don't match either set by spelling, so
# without translation almost every PI tool call falls into loeIcon's
# default/medium bucket regardless of how heavy it really was. This table
# maps each PI tool name to the Hermes-named category it's equivalent to, so
# _recent_tools' gauge-facing output lands in the same heavy/light buckets a
# Hermes session's matching behaviour would -- without touching loeIcon
# itself, which stays the one scoring function both row types share.
PI_TOOL_HERMES_ALIAS = {
    "bash": "terminal",            # shell/process execution -> heavy
    "subagent": "delegate_task",   # spawns a subagent -> heavy
    "dispatch_relay": "delegate_task",  # hands off a whole Relay leg -> heavy
    "read": "read_file",           # file read -> light
    "fetch_content": "web_search",      # fetches a URL -> light
    "source_check": "web_search",       # web research pass -> light
    "get_search_content": "search_files",  # pages stored search/fetch results -> light
}


def _agent_name_from_path(jsonl_path: Path, pi_home: Path) -> str:
    """The agent-* directory name (e.g. "agent-sp"), read from the path.

    collect_pi_agents.parse_pi_session_jsonl sets PISession.agent_name from
    ``jsonl_path.parent.parent.name``, which assumes the session file sits one
    directory below its agent. Real PI session files nest one level deeper,
    under a cwd-slug directory (``agent-sp/sessions/<slug>/<file>.jsonl``), so
    that shortcut actually returns "sessions". Reading it from the path
    relative to ``pi_home`` instead gets the real agent name regardless of how
    deep collect_pi_agents happens to look.
    """
    try:
        rel = jsonl_path.relative_to(pi_home)
    except ValueError:
        rel = None
    if rel is not None and rel.parts:
        return rel.parts[0]
    return jsonl_path.parent.parent.parent.name


def _last_event_phase(events: list[dict[str, Any]]) -> tuple[Optional[float], str]:
    """(unix ts of the last event, short phase string) from a session's raw
    events. The phase favours the most concrete signal available: an in-flight
    tool call beats assistant prose, which beats a bare "thinking" blurb."""
    last_ts: Optional[float] = None
    phase = "idle"
    for event in events:
        ts = event.get("timestamp")
        if ts:
            t = _iso_to_unix(ts)
            if last_ts is None or t >= last_ts:
                last_ts = t
        if event.get("type") != "message":
            continue
        msg = event.get("message") or {}
        if msg.get("role") != "assistant":
            continue
        content = msg.get("content")
        if not isinstance(content, list):
            continue
        tool_name = None
        text = None
        thinking = False
        for item in content:
            if not isinstance(item, dict):
                continue
            kind = item.get("type")
            if kind == "toolCall":
                tool_name = item.get("name")
            elif kind == "text" and item.get("text"):
                text = item.get("text")
            elif kind == "thinking":
                thinking = True
        if tool_name:
            phase = f"running {tool_name}"
        elif text:
            phase = text.strip().splitlines()[0][:PHASE_TEXT_MAX]
        elif thinking:
            phase = "thinking"
    return last_ts, phase


def _recent_tools(events: list[dict[str, Any]], now: float,
                   window_s: int = TOOLS_WINDOW_S, limit: int = TOOLS_LIMIT) -> list[str]:
    """Distinct tool names called in the last ``window_s`` seconds, newest
    first, same recency window as Hermes' own L.tools (collect_analytics.LIVE)
    and used as-is for the tool-chip display. These are PI's own builtin tool
    names (bash, read, ...), not Hermes' -- see gauge_tools() for the
    Hermes-named view loeIcon's load gauge actually scores against."""
    seen: list[str] = []
    for event in events:
        if event.get("type") != "message":
            continue
        ts = event.get("timestamp")
        if ts and now - _iso_to_unix(ts) > window_s:
            continue
        msg = event.get("message") or {}
        if msg.get("role") != "assistant":
            continue
        content = msg.get("content")
        if not isinstance(content, list):
            continue
        for item in content:
            if isinstance(item, dict) and item.get("type") == "toolCall":
                name = item.get("name")
                if name and name not in seen:
                    seen.append(name)
    recent = seen[:limit]
    recent.reverse()  # most-recently-seen tool first, matching the chip UI's slice(0,5)
    return recent


def gauge_tools(tools: list[str]) -> list[str]:
    """``tools`` translated through PI_TOOL_HERMES_ALIAS for loeIcon's gauge --
    the raw ``tools`` list stays PI-named for the chip display, this is the
    separate view the load gauge actually scores so a PI session's heavy/light
    split lands in the same buckets a Hermes session's equivalent work would."""
    return [PI_TOOL_HERMES_ALIAS.get(t, t) for t in tools]


def _model_timeline(events: list[dict[str, Any]]) -> tuple[Optional[str], bool]:
    """(init_model, switched) -- the model the session STARTED with vs whether
    it later changed, mirroring Hermes' L.switched (sessions.model is only the
    initial pick there too; the router falls back mid-session). A PI agent can
    switch model via model_change events the same way."""
    models = [e.get("modelId") for e in events if e.get("type") == "model_change" and e.get("modelId")]
    if not models:
        return None, False
    return models[0], len(set(models)) > 1 and models[0] != models[-1]


def _started_at(session: Any) -> Optional[float]:
    """Unix ts the session itself began, from its own "session" event -- the
    one piece of "how long has this been running" the JSONL carries, parallel
    to Hermes' sessions.started_at."""
    return _iso_to_unix(session.timestamp) if session.timestamp else None


def discover_live_jsonl(pi_home: Path, now: float, stale_window_s: int) -> list[Path]:
    """Every session JSONL file under ``pi_home`` whose mtime is within
    ``stale_window_s`` seconds of ``now`` -- the file-is-the-state convention
    this module relies on to mean "an agent touched this recently"."""
    if not pi_home.exists():
        return []
    out = []
    for jsonl_path in pi_home.glob("agent*/sessions/*/*.jsonl"):
        try:
            mtime = jsonl_path.stat().st_mtime
        except OSError:
            continue
        if now - mtime <= stale_window_s:
            out.append(jsonl_path)
    return out


def build_pi_live(pi_home: Optional[os.PathLike] = None, now: Optional[float] = None,
                   stale_window_s: int = STALE_WINDOW_S) -> list[dict[str, Any]]:
    """Currently-live PI agent sessions, most-idle last.

    ``pi_home`` defaults to ``$LLM_TELEMETRY_PI_HOME`` then ``~/.pi``, same
    override convention as collect_analytics' agent-home resolution, so a test
    can point this at a fixture directory without touching a real PI install.
    """
    now = now if now is not None else time.time()
    home = Path(pi_home) if pi_home is not None else Path(
        os.environ.get("LLM_TELEMETRY_PI_HOME") or (Path.home() / ".pi"))

    out = []
    for jsonl_path in discover_live_jsonl(home, now, stale_window_s):
        session = parse_pi_session_jsonl(jsonl_path)
        if session is None:
            continue
        agent = _agent_name_from_path(jsonl_path, home)
        events = session.raw_events or []
        last_ts, phase = _last_event_phase(events)
        idle_s = round(max(0.0, now - last_ts), 1) if last_ts is not None else None
        cwd = session.cwd or ""
        title = os.path.basename(cwd.rstrip("/")) if cwd else agent
        try:
            mtime = jsonl_path.stat().st_mtime
        except OSError:
            mtime = None
        init_model, switched = _model_timeline(events)
        started_at = _started_at(session)
        uptime_s = round(max(0.0, now - started_at), 1) if started_at else None
        out.append({
            "agent": agent,
            "session_id": session.session_id,
            "cwd": cwd,
            "title": title or agent,
            "model": session.model,
            "provider": session.provider,
            "idle_s": idle_s,
            "phase": phase,
            "mtime": mtime,
            # Below: LST-251 -- the same "what is this bot doing / how heavy is
            # it / how long has it run" detail Hermes rows get from sqlite,
            # read off the JSONL instead so PI cards get the same gauge and
            # level of ride-along detail rather than a bare status line.
            "tools": (tools := _recent_tools(events, now)),
            "tools_gauge": gauge_tools(tools),
            "init_model": init_model,
            "switched": switched,
            "started_at": started_at,
            "uptime_s": uptime_s,
            "in_tok": session.input_tokens,
            "out_tok": session.output_tokens,
            "cache_read_tok": session.cache_read_tokens,
            "cache_write_tok": session.cache_write_tokens,
            "cost_usd": round(session.total_cost, 4),
        })

    out.sort(key=lambda s: s["idle_s"] if s["idle_s"] is not None else float("inf"))
    return out


if __name__ == "__main__":
    import json
    print(json.dumps(build_pi_live(), indent=2, default=str))
