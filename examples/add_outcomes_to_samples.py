#!/usr/bin/env python3
"""Add a synthetic outcomes payload to the sample data (#91/P10-03).

Sanitized fixture data only. Mirrors what collect_analytics.build_outcomes()
emits from a real state.db: a normal desktop close, a healthy cron close, a
cron session that did NOT end cron_complete (the alarm case), two orphan
reaps on different days, and one silent (NULL end_reason) session.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "reports", "analytics-data.json")

OUTCOMES = {
    "by_reason": {
        "agent_close": 12,
        "cron_complete": 4,
        "startup_orphan_reap": 1,
        "ws_orphan_reap": 1,
        "(none)": 1,
    },
    "by_source_reason": {
        "desktop": {"agent_close": 10, "startup_orphan_reap": 1, "ws_orphan_reap": 1},
        "cron": {"cron_complete": 4, "agent_close": 1},
        "tui": {"(none)": 1},
    },
    "silent": [
        {"id": "sess_outcome_silent1", "title": "Untitled TUI session",
         "source": "tui", "model": "claude-haiku", "when": 1727600000},
    ],
    "reaped": [
        {"id": "sess_outcome_reap1", "source": "desktop", "model": "claude-opus", "when": 1727500000},
        {"id": "sess_outcome_reap2", "source": "desktop", "model": "claude-haiku", "when": 1727420000},
    ],
    "reap_trend": [
        {"date": "2026-09-27", "n": 1},
        {"date": "2026-09-28", "n": 1},
    ],
}


def main():
    with open(DATA) as f:
        doc = json.load(f)
    for name, prof in doc["profiles"].items():
        prof["outcomes"] = OUTCOMES
    with open(DATA, "w") as f:
        json.dump(doc, f, separators=(",", ":"), default=str)
    print(f"{DATA}: outcomes added to {len(doc['profiles'])} profiles")


if __name__ == "__main__":
    main()
