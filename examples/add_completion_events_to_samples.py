#!/usr/bin/env python3
"""Add synthetic recent completions to the sample live payload (#105).

Sanitized fixture data only — invented session/delegation ids, invented
titles. Shape mirrors what collect_live.build_live() emits from a real
state.db (recent_ended / recent_delegations, added for the completion-sound
feature), so the jsdom test exercises the same diff path the dashboard uses
in production.
"""
import json
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "reports", "live-data.json")

NOW = int(time.time())


def main():
    with open(DATA) as f:
        doc = json.load(f)
    names = list(doc["profiles"].keys())
    if not names:
        raise SystemExit("no profiles in fixture")

    # One clean session close, one crash-reap, in the first profile; one
    # successful and one failed delegation completion in the second (or the
    # same profile if there is only one) — enough variety for the jsdom test
    # to exercise both the success and failure tone paths.
    first, second = names[0], names[-1]
    doc["profiles"][first]["recent_ended"] = [
        {"id": "sample_ended_ok", "title": "Sample session A",
         "ended_at": NOW - 10, "end_reason": "agent_close"},
        {"id": "sample_ended_bad", "title": "Sample session B",
         "ended_at": NOW - 40, "end_reason": "startup_orphan_reap"},
    ]
    doc["profiles"][second].setdefault("recent_delegations", [])
    doc["profiles"][second]["recent_delegations"] = [
        {"id": "sample_deleg_ok", "state": "completed", "completed_at": NOW - 20},
        {"id": "sample_deleg_bad", "state": "error", "completed_at": NOW - 5},
    ]
    for n in names:
        doc["profiles"][n].setdefault("recent_ended", [])
        doc["profiles"][n].setdefault("recent_delegations", [])

    with open(DATA, "w") as f:
        json.dump(doc, f, separators=(",", ":"), default=str)
    print(f"{DATA}: completion-sound fixtures added "
          f"(2 recent_ended in {first}, 2 recent_delegations in {second})")


if __name__ == "__main__":
    main()
