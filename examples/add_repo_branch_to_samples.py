#!/usr/bin/env python3
"""Add a synthetic `repo_branch` payload to the sample analytics-data.json
(#101 part 2). Sanitized fixture data only, in the shape
collect_repo_branch.build_repo_branch() emits.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "reports", "analytics-data.json")

REPO_BRANCH = {
    "repos": [
        {"repo": "sample-app", "sessions": 18, "calls": 640, "tokens": 480000, "cost": 12.40,
         "branches": [
             {"branch": "main", "sessions": 11, "calls": 420, "tokens": 310000, "cost": 8.10},
             {"branch": "feature/checkout", "sessions": 5, "calls": 160, "tokens": 120000, "cost": 3.20},
             {"branch": "Unattributed", "sessions": 2, "calls": 60, "tokens": 50000, "cost": 1.10},
         ]},
        {"repo": "docs-site", "sessions": 6, "calls": 90, "tokens": 40000, "cost": 1.85,
         "branches": [
             {"branch": "main", "sessions": 6, "calls": 90, "tokens": 40000, "cost": 1.85},
         ]},
        {"repo": "Unattributed", "sessions": 4, "calls": 22, "tokens": 9000, "cost": 0.30,
         "branches": [
             {"branch": "Unattributed", "sessions": 4, "calls": 22, "tokens": 9000, "cost": 0.30},
         ]},
    ]
}


def main():
    with open(DATA) as f:
        doc = json.load(f)
    for name, prof in doc["profiles"].items():
        prof["repo_branch"] = REPO_BRANCH
    with open(DATA, "w") as f:
        json.dump(doc, f, separators=(",", ":"), default=str)
    print(f"{DATA}: repo_branch added to {len(doc['profiles'])} profiles")


if __name__ == "__main__":
    main()
