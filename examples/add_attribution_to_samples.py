#!/usr/bin/env python3
"""Add a synthetic attribution payload to the sample data (#95/P10-07).

Sanitized fixture data only, matching the shape collect_analytics.py's
cost_attribution.build_attribution() emits.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "reports", "analytics-data.json")

ATTRIBUTION = {
    "by_source": [
        {"source": "tui", "cost": 573.40, "tokens": 12_400_000, "sessions": 88},
        {"source": "desktop", "cost": 409.20, "tokens": 8_120_000, "sessions": 61},
        {"source": "subagent", "cost": 61.15, "tokens": 8_000_000, "sessions": 28},
        {"source": "cron", "cost": 4.02, "tokens": 1_200_000, "sessions": 31},
    ],
    "by_root": [
        {"id": "sess_parent01", "title": "Migrate billing to the new pricing table",
         "own": 4.96, "descendants": 0.61, "total": 5.57},
        {"id": "sess_sample_slow1", "title": "Migrate billing to the new pricing table",
         "own": 3.24, "descendants": 0.0, "total": 3.24},
        {"id": "sess_lonely01", "title": "Fix flaky retry test",
         "own": 1.10, "descendants": 0.0, "total": 1.10},
    ],
    "by_cron": [
        {"name": "nightly-backup", "runs": 30, "total": 3.60, "avg": 0.12, "monthly_projection": 3.60},
        {"name": "hourly-sync", "runs": 1, "total": 0.02, "avg": 0.02, "monthly_projection": 0.02},
    ],
    "by_tool": [
        {"tool": "read_file", "tokens": 640_000, "cost": 0.64},
        {"tool": "terminal", "tokens": 412_000, "cost": 0.41},
        {"tool": "patch", "tokens": 156_000, "cost": 0.16},
        {"tool": "memory", "tokens": 14_000, "cost": 0.01},
    ],
}


def main():
    with open(DATA) as f:
        doc = json.load(f)
    for name, prof in doc["profiles"].items():
        prof["attribution"] = ATTRIBUTION
    with open(DATA, "w") as f:
        json.dump(doc, f, separators=(",", ":"), default=str)
    print(f"{DATA}: attribution added to {len(doc['profiles'])} profiles")


if __name__ == "__main__":
    main()
