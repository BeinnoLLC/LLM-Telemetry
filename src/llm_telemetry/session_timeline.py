#!/usr/bin/env python3
"""P10-06 (#94): session timeline — one session's shape over time.

Pure functions only: build_spans() takes already-fetched rows and a
session header dict and produces the payload the dashboard renders. No DB
access here — collect_session_timeline.py owns the SQL and file-export
side (ADR 0001: per-session files, not embedded in the main payload).

Lanes (fixed set, in render order): model, tool, delegation, compaction,
user. Each span:
  {lane, start, end, label, color_key, failed, meta}
`start`/`end` are absolute unix seconds; `end` may equal `start` for an
instantaneous event (a user turn tick). `color_key` is the value the UI
palette function keys off (model name for the model lane, tool name for
the tool lane) so the SAME model/tool always gets the SAME chip colour
it already gets everywhere else in the dashboard.
"""
from __future__ import annotations


def _span(lane, start, end, label, color_key, failed=False, meta=None):
    return {"lane": lane, "start": start, "end": max(end, start), "label": label,
            "color_key": color_key, "failed": bool(failed), "meta": meta or {}}


def build_spans(messages, delegations=None, compactions=None):
    """messages: list of dicts with at least role/timestamp, plus optional
    model/tool_name/tool_calls/outcome/compacted for the relevant roles.
    delegations: list of {dispatched_at, completed_at, status, child_id}.
    compactions: list of {start, end} (a compacted message RUN's bounds).

    Returns a flat list of spans across all lanes, sorted by start time —
    NOT grouped by lane, so a caller can render "what happened at time T"
    without re-sorting across lanes itself.
    """
    spans = []

    # Model-call lane: one span per assistant message that names a model,
    # collapsing a run of CONSECUTIVE same-model assistant turns into one
    # span so a 40-turn conversation on one model isn't 40 tiny slivers —
    # only a model SWITCH starts a new span.
    run = None
    for m in messages:
        if m.get("role") != "assistant" or not m.get("model"):
            continue
        ts = m["timestamp"]
        if run and run["color_key"] == m["model"]:
            run["end"] = ts
        else:
            if run:
                spans.append(run)
            run = _span("model", ts, ts, m["model"], m["model"])
    if run:
        spans.append(run)

    # Tool-call lane: one span per tool RESULT message (the result carries
    # the outcome; the call itself has no duration data available here).
    for m in messages:
        if m.get("role") != "tool" or not m.get("tool_name"):
            continue
        ts = m["timestamp"]
        spans.append(_span("tool", ts, ts, m["tool_name"], m["tool_name"],
                            failed=(m.get("outcome") == "fail"),
                            meta={"outcome": m.get("outcome")}))

    # User-turn lane: instantaneous ticks.
    for m in messages:
        if m.get("role") != "user":
            continue
        ts = m["timestamp"]
        spans.append(_span("user", ts, ts, "user turn", "user"))

    # Delegation lane: dispatch -> completion, still-running delegations
    # get end=None here and are resolved to "now" by the caller (this
    # module has no notion of wall-clock "now" — a pure function must not
    # silently read the clock, or a test run at a different time produces
    # a different span for the same fixture).
    for d in (delegations or []):
        spans.append(_span("delegation", d["dispatched_at"], d.get("completed_at") or d["dispatched_at"],
                            d.get("child_id") or "(delegation)", d.get("model") or "(unknown)",
                            failed=(d.get("status") not in (None, "completed")),
                            meta={"status": d.get("status")}))

    # Compaction lane: the message-run bounds already computed by the
    # caller (a run of `compacted=1` messages) — this module just wraps
    # them into spans, it does not detect runs itself.
    for c in (compactions or []):
        spans.append(_span("compaction", c["start"], c["end"], "compaction", "compaction"))

    spans.sort(key=lambda s: (s["start"], s["lane"]))
    return spans


def build_timeline(session, messages, delegations=None, compactions=None, now=None):
    """session: dict with id/title/source/started_at/ended_at/end_reason/
    models (list)/input_tokens/output_tokens/cache_read_tokens/
    estimated_cost_usd/actual_cost_usd/bytes_up/bytes_down.
    now: injected wall-clock seconds (never read internally — keeps this
    testable without mocking time.time()).

    Returns the full per-session payload: header + spans + axis bounds.
    A still-running session (ended_at is None) extends the axis to `now`
    and the header reports running=True, PER THE TICKET'S OWN NEGATIVE
    CONTROL.
    """
    started = session["started_at"]
    ended = session.get("ended_at")
    running = ended is None
    axis_end = ended if not running else (now if now is not None else started)

    spans = build_spans(messages, delegations, compactions)
    return {
        "id": session["id"],
        "title": session.get("title") or "(untitled)",
        "source": session.get("source"),
        "models": session.get("models") or [],
        "started_at": started,
        "ended_at": ended,
        "running": running,
        "end_reason": session.get("end_reason"),
        "axis_start": started,
        "axis_end": axis_end,
        "input_tokens": session.get("input_tokens", 0),
        "output_tokens": session.get("output_tokens", 0),
        "cache_read_tokens": session.get("cache_read_tokens", 0),
        "estimated_cost_usd": session.get("estimated_cost_usd", 0),
        "actual_cost_usd": session.get("actual_cost_usd", 0),
        "bytes_up": session.get("bytes_up", 0),
        "bytes_down": session.get("bytes_down", 0),
        "spans": spans,
    }
