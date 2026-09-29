#!/usr/bin/env python3
"""Add a synthetic `agents` list to the sample live-data.json (#96/P10-08).

Sanitized fixture data only, matching the shape collect_live.build_live()
emits via agents_alive.build_agents(): one alive backend with leases, one
confirmed-dead backend with a kill hint, one stale (age-only, unconfirmed)
backend on a different profile.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "reports", "live-data.json")

AGENTS_WORK = [
    {"backend": "default@workbox:6049:a1b2", "profile": "work", "host": "workbox", "pid": 6049,
     "last_heartbeat": 1790690000.0, "age_s": 8.0, "state": "alive", "leases": 2, "kill_hint": None},
    {"backend": "default@buildbox:19342:c3d4", "profile": "work", "host": "buildbox", "pid": 19342,
     "last_heartbeat": 1790430000.0, "age_s": 259200.0, "state": "dead", "leases": 0, "kill_hint": "kill 19342"},
]
AGENTS_PERSONAL = [
    {"backend": "default@laptop:842:e5f6", "profile": "personal", "host": "laptop", "pid": 842,
     "last_heartbeat": 1790689900.0, "age_s": 140.0, "state": "stale", "leases": 0, "kill_hint": None},
]


def main():
    with open(DATA) as f:
        doc = json.load(f)
    doc["profiles"]["work"]["agents"] = AGENTS_WORK
    doc["profiles"]["personal"]["agents"] = AGENTS_PERSONAL
    with open(DATA, "w") as f:
        json.dump(doc, f, separators=(",", ":"), default=str)
    print(f"{DATA}: agents added to 2 profiles")


if __name__ == "__main__":
    main()
