#!/usr/bin/env python3
"""P10-06 (#94): session_timeline unit tests — 6-event fixture -> 6 spans
in correct lanes, ordered by time, failure span carries the failure class;
negative control: ended_at=None -> axis extends to "now" and running=True.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))
from llm_telemetry.session_timeline import build_spans, build_timeline  # noqa: E402

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{('  ' + str(extra)) if extra is not None else ''}")
    if ok:
        p += 1
    else:
        f += 1


# 6-event fixture: 1 user turn, 1 model call (opus), 1 tool call (fail),
# 1 delegation (completed), 1 compaction, 1 more user turn = 6 spans.
messages = [
    {"role": "user", "timestamp": 100},
    {"role": "assistant", "timestamp": 101, "model": "claude-opus"},
    {"role": "tool", "timestamp": 105, "tool_name": "terminal", "outcome": "fail"},
    {"role": "user", "timestamp": 110},
]
delegations = [{"dispatched_at": 102, "completed_at": 108, "status": "completed",
                "child_id": "child-1", "model": "haiku"}]
compactions = [{"start": 103, "end": 104}]

spans = build_spans(messages, delegations, compactions)
chk(len(spans) == 6, f"6 spans produced from the 6-event fixture (got {len(spans)})", len(spans))

lanes_seen = {s["lane"] for s in spans}
chk(lanes_seen == {"model", "tool", "delegation", "compaction", "user"},
    "all 5 lanes are represented", lanes_seen)

order = [s["start"] for s in spans]
chk(order == sorted(order), "spans are ordered by start time", order)

tool_span = next(s for s in spans if s["lane"] == "tool")
chk(tool_span["failed"] is True, "the failing tool span carries failed=True")
chk(tool_span["meta"].get("outcome") == "fail", "the failure span carries the failure class in meta.outcome", tool_span["meta"])

model_span = next(s for s in spans if s["lane"] == "model")
chk(model_span["color_key"] == "claude-opus", "the model span's color_key is the model name")

deleg_span = next(s for s in spans if s["lane"] == "delegation")
chk(deleg_span["start"] == 102 and deleg_span["end"] == 108,
    "the delegation span spans dispatch to completion", (deleg_span["start"], deleg_span["end"]))
chk(deleg_span["failed"] is False, "a completed delegation is not marked failed")

user_spans = [s for s in spans if s["lane"] == "user"]
chk(len(user_spans) == 2, "both user turns produce their own tick span", len(user_spans))
chk(all(s["start"] == s["end"] for s in user_spans), "user-turn spans are instantaneous (start == end)")

# Consecutive same-model runs collapse into ONE span, not one per message.
messages_run = [
    {"role": "assistant", "timestamp": 200, "model": "opus"},
    {"role": "assistant", "timestamp": 205, "model": "opus"},
    {"role": "assistant", "timestamp": 210, "model": "opus"},
]
spans_run = build_spans(messages_run)
chk(len(spans_run) == 1, "3 consecutive same-model assistant turns collapse into 1 model span", len(spans_run))
chk(spans_run[0]["start"] == 200 and spans_run[0]["end"] == 210,
    "the collapsed run spans first to last timestamp", (spans_run[0]["start"], spans_run[0]["end"]))

# A model SWITCH starts a new span.
messages_switch = [
    {"role": "assistant", "timestamp": 300, "model": "opus"},
    {"role": "assistant", "timestamp": 305, "model": "haiku"},
]
spans_switch = build_spans(messages_switch)
chk(len(spans_switch) == 2, "a model switch produces 2 separate spans, not a merged one", len(spans_switch))

# ---- build_timeline: header + axis ----
session_running = {"id": "sR", "title": "Refactor the parser", "source": "cli",
                    "started_at": 1000, "ended_at": None, "end_reason": None,
                    "models": ["opus"]}
tl_running = build_timeline(session_running, [], now=5000)
chk(tl_running["running"] is True, "a session with ended_at=None reports running=True")
chk(tl_running["axis_end"] == 5000, "the axis extends to the injected 'now' when the session is still running", tl_running["axis_end"])

session_ended = {"id": "sE", "title": "Done", "source": "cli", "started_at": 1000,
                  "ended_at": 1200, "end_reason": "agent_close", "models": ["opus"]}
tl_ended = build_timeline(session_ended, [], now=5000)
chk(tl_ended["running"] is False, "a session with a real ended_at reports running=False")
chk(tl_ended["axis_end"] == 1200, "the axis end is the real ended_at, NOT the injected 'now', for a finished session", tl_ended["axis_end"])

# now=None (no injected clock) still produces a sane axis for a running
# session — falls back to started_at rather than crashing.
tl_no_now = build_timeline(session_running, [])
chk(tl_no_now["axis_end"] == 1000, "with no injected now, a running session's axis falls back to started_at, not a crash")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
