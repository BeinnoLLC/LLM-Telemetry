#!/usr/bin/env python3
"""Add a synthetic tool-reliability payload to the sample data (#92/P10-04).

Sanitized fixture data only, matching the shape collect_analytics.py's
build_tool_reliability() emits from a real state.db.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "reports", "analytics-data.json")

TOOLS = [
    {"name": "terminal", "calls": 412, "fails": 38, "fail_rate": 0.0922, "prev_fail_rate": 0.061,
     "tok_wasted": 91500, "p50_bytes": 340, "p95_bytes": 6200},
    {"name": "patch", "calls": 156, "fails": 9, "fail_rate": 0.0577, "prev_fail_rate": 0.0812,
     "tok_wasted": 12400, "p50_bytes": 220, "p95_bytes": 1800},
    {"name": "read_file", "calls": 640, "fails": 3, "fail_rate": 0.0047, "prev_fail_rate": 0.0051,
     "tok_wasted": 900, "p50_bytes": 1100, "p95_bytes": 8400},
    {"name": "write_file", "calls": 88, "fails": 1, "fail_rate": 0.0114, "prev_fail_rate": 0.0,
     "tok_wasted": 300, "p50_bytes": 80, "p95_bytes": 400},
    {"name": "memory", "calls": 14, "fails": 0, "fail_rate": None, "prev_fail_rate": None,
     "tok_wasted": 0, "p50_bytes": 40, "p95_bytes": 90},
]

FAIL_SAMPLES = {
    "terminal": [
        {"session": "sess_sample_a", "ts": 1727600000, "head": '{"output": "pnpm: command not found\\n", "exit_code": 127}'},
        {"session": "sess_sample_b", "ts": 1727500000, "head": '{"output": "Build failed with 3 errors\\n", "exit_code": 1}'},
    ],
}

TOP_FAIL_COMMANDS = [
    {"cmd": "pnpm", "n": 14},
    {"cmd": "git", "n": 9},
    {"cmd": "node", "n": 6},
    {"cmd": "(unknown)", "n": 5},
]


def main():
    with open(DATA) as f:
        doc = json.load(f)
    for name, prof in doc["profiles"].items():
        prof["tools"] = TOOLS
        prof["tool_fail_samples"] = FAIL_SAMPLES
        prof["terminal_top_fail_commands"] = TOP_FAIL_COMMANDS
    with open(DATA, "w") as f:
        json.dump(doc, f, separators=(",", ":"), default=str)
    print(f"{DATA}: tool reliability added to {len(doc['profiles'])} profiles")


if __name__ == "__main__":
    main()
