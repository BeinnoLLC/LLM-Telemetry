#!/usr/bin/env python3
"""Add a synthetic `session_index` payload to the sample analytics-data.json
(#100/P10-12). Sanitized fixture data only, in the shape
collect_session_index.build_session_index_payload() emits.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "reports", "analytics-data.json")

SESSION_INDEX = [
    {"id": "sess_finder1", "title": "Refactor the router config loader", "model": "claude-opus-5",
     "source": "desktop", "tools": ["patch", "terminal", "read_file"], "branch": "feature/router",
     "cwd_tail": "workspace/nowinv", "end": "user_close", "cost": 2.45, "dur": 5400},
    {"id": "sess_finder2", "title": "Fix the flaky checkout test", "model": "glm-5.3",
     "source": "subagent", "tools": ["terminal", "patch"], "branch": "main",
     "cwd_tail": "workspace/ahwa", "end": "startup_orphan_reap", "cost": 0.08, "dur": 400},
    {"id": "sess_finder3", "title": "Just chatting about deploy strategy", "model": "claude-opus-5",
     "source": "desktop", "tools": [], "branch": "", "cwd_tail": "", "end": "user_close",
     "cost": 0.01, "dur": 400},
]


def main():
    with open(DATA) as f:
        doc = json.load(f)
    for name, prof in doc["profiles"].items():
        prof["session_index"] = SESSION_INDEX
    with open(DATA, "w") as f:
        json.dump(doc, f, separators=(",", ":"), default=str)
    print(f"{DATA}: session_index added to {len(doc['profiles'])} profiles")


if __name__ == "__main__":
    main()
