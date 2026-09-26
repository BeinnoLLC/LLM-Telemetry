#!/usr/bin/env python3
"""Repair ok/fail/total/rate on the sample health rows.

make_sample_data.py jitters every numeric field independently, so on a health
row ok, fail and total each got their own random factor and stopped adding up
(one fixture row read "21,094 of 11,250" and the page showed 150% success).
This recomputes total = ok + fail and rate from them. Fixture-only.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, "reports", "analytics-data.json")


def fix_health(prof):
    n = 0
    for h in prof.get("health", []):
        ok, fail = int(h.get("ok") or 0), int(h.get("fail") or 0)
        tot = ok + fail
        if h.get("total") != tot:
            n += 1
        h["total"] = tot
        h["rate"] = round(100.0 * ok / tot, 1) if tot else None
    prof.get("health", []).sort(key=lambda h: (-h["fail"], -h["total"]))
    return n


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else PATH
    with open(path) as f:
        data = json.load(f)
    if not data.get("sample"):
        sys.exit("refusing: not a sample payload")
    fixed = sum(fix_health(p) for p in data.get("profiles", {}).values())
    with open(path, "w") as f:
        json.dump(data, f)
    print(f"{path}: {fixed} health rows repaired")


if __name__ == "__main__":
    main()
