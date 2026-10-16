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
        last_ts, phase = _last_event_phase(session.raw_events or [])
        idle_s = round(max(0.0, now - last_ts), 1) if last_ts is not None else None
        cwd = session.cwd or ""
        title = os.path.basename(cwd.rstrip("/")) if cwd else agent
        try:
            mtime = jsonl_path.stat().st_mtime
        except OSError:
            mtime = None
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
        })

    out.sort(key=lambda s: s["idle_s"] if s["idle_s"] is not None else float("inf"))
    return out


if __name__ == "__main__":
    import json
    print(json.dumps(build_pi_live(), indent=2, default=str))
