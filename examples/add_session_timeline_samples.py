#!/usr/bin/env python3
"""Write sample sessions/<profile>/<id>.json timeline files (#94/P10-06).

These are separate static files, not part of analytics-data.json — same
per-session-file architecture #79's transcripts.json export established.
Uses the real build_timeline() from session_timeline.py so the sample
exercises the exact production shape, not a hand-rolled lookalike.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))

from llm_telemetry.session_timeline import build_timeline  # noqa: E402

OUT = os.path.join(HERE, "reports", "sessions")
BASE = 1_700_002_000


def main():
    session = {
        "id": "sess_sample_slow1", "title": "Migrate billing to the new pricing table",
        "source": "desktop", "started_at": BASE, "ended_at": BASE + 900,
        "end_reason": "agent_close", "models": ["claude-opus", "claude-haiku"],
        "input_tokens": 42000, "output_tokens": 18500, "cache_read_tokens": 91000,
        "estimated_cost_usd": 3.1, "actual_cost_usd": 3.24,
    }
    messages = [
        {"role": "user", "timestamp": BASE},
        {"role": "assistant", "timestamp": BASE + 2, "model": "claude-opus"},
        {"role": "assistant", "timestamp": BASE + 8, "model": "claude-opus"},
        {"role": "tool", "timestamp": BASE + 9, "tool_name": "terminal", "outcome": "ok"},
        {"role": "assistant", "timestamp": BASE + 40, "model": "claude-opus"},
        {"role": "tool", "timestamp": BASE + 41, "tool_name": "patch", "outcome": "fail"},
        {"role": "user", "timestamp": BASE + 190},
        {"role": "assistant", "timestamp": BASE + 192, "model": "claude-haiku"},
        {"role": "tool", "timestamp": BASE + 193, "tool_name": "terminal", "outcome": "ok"},
        {"role": "assistant", "timestamp": BASE + 850, "model": "claude-haiku"},
        {"role": "user", "timestamp": BASE + 900},
    ]
    delegations = [
        {"dispatched_at": BASE + 200, "completed_at": BASE + 700,
         "status": "completed", "child_id": "sess_child01a", "model": "claude-haiku"},
    ]
    compactions = [{"start": BASE + 300, "end": BASE + 320}]

    tl = build_timeline(session, messages, delegations, compactions, now=BASE + 900)
    tl["sample"] = True

    pdir = os.path.join(OUT, "work")
    os.makedirs(pdir, exist_ok=True)
    path = os.path.join(pdir, f"{session['id']}.json")
    with open(path, "w") as f:
        json.dump(tl, f, separators=(",", ":"))
    print(f"{path}: {len(tl['spans'])} spans")


if __name__ == "__main__":
    main()
