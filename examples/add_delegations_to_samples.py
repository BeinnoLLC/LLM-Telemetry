#!/usr/bin/env python3
"""Add synthetic delegation outcomes to the sample payload (#90).

Sanitized fixture data only — invented ids, invented goals, no hostnames. The
shape mirrors what `delegations.summarize()` emits from a real state.db so the
jsdom tests exercise the same render path the dashboard uses in production.

Deliberately includes a model that finishes ~56% of its runs, because the panel
exists to make exactly that visible.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from llm_telemetry import delegations  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "reports", "analytics-data.json")


def child(status, model, dur, cost=0.0, reason=None, tools=None, tok=120000):
    return {
        "status": status,
        "model": model,
        "duration_seconds": dur,
        "cost_usd": cost,
        "cost_status": "estimated" if cost else None,
        "failure_reason": reason,
        "exit_reason": "completed" if status == "completed" else (reason or "error"),
        "tokens": {"input": tok, "output": tok // 20},
        "api_calls": 9,
        "tool_trace": tools or [],
    }


def trace(ok_terminal=40, bad_terminal=0, ok_patch=12, bad_patch=1):
    t = []
    t += [{"tool": "terminal", "status": "ok"}] * ok_terminal
    t += [{"tool": "terminal", "status": "error"}] * bad_terminal
    t += [{"tool": "patch", "status": "ok"}] * ok_patch
    t += [{"tool": "patch", "status": "error"}] * bad_patch
    t += [{"tool": "read_file", "status": "ok"}] * 20
    return t


# Two fan-outs: one clean on the strong model, one that mostly died on a
# cheap local model — the pattern the panel is meant to surface.
ROWS = [
    ("deleg_sample01", "completed", 1_700_000_000.0, 1_700_000_900.0,
     json.dumps({"results": [
         child("completed", "cloud-large", 420.0, 1.25, tools=trace()),
         child("completed", "cloud-large", 380.0, 0.98, tools=trace(bad_terminal=1)),
     ]}),
     json.dumps({"goal": "Refactor the export pipeline and add tests"})),
    ("deleg_sample02", "error", 1_700_003_000.0, 1_700_009_800.0,
     json.dumps({"results": [
         child("failed", "local-small", 3600.0, 0.0, reason="rate_limit",
               tools=trace(ok_terminal=6, bad_terminal=2, ok_patch=0)),
         child("failed", "local-small", 3300.0, 0.0, reason="rate_limit",
               tools=trace(ok_terminal=4, bad_terminal=3, ok_patch=0)),
         child("interrupted", "local-small", 2400.0, 0.0,
               tools=trace(ok_terminal=3, ok_patch=0)),
         child("completed", "local-small", 900.0, 0.0, tools=trace(ok_terminal=9)),
     ]}),
     json.dumps({"goal": "Port the three remaining collectors to the new schema"})),
]


def main():
    with open(DATA) as f:
        doc = json.load(f)
    payload = delegations.summarize(ROWS)
    assert payload, "fixture produced no delegation payload"
    for name, prof in doc["profiles"].items():
        # Same payload in both profiles: the tests switch profiles and the
        # panel must repaint rather than keep the first profile's numbers.
        prof["delegations"] = payload
    with open(DATA, "w") as f:
        json.dump(doc, f, separators=(",", ":"), default=str)
    print(f"{DATA}: delegations added to {len(doc['profiles'])} profiles "
          f"({payload['children']} children, {payload['rate']}% ok, "
          f"{payload['wasted_hours']}h wasted)")


if __name__ == "__main__":
    main()
