#!/usr/bin/env python3
"""Add a synthetic live fan-out to the sample payload (#89/P10-01).

Sanitized fixture data only. Adds one parent-with-2-live-children pattern
to analytics-data.json's `live` array (used both by the initial render and
the jsdom tests) so the Live view's fan-out strip has something real to
show in the shipped sample.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "reports", "analytics-data.json")


def live_session(id_, title, model, parent="", phase="working", idle_s=5,
                  tools=None, category="Working", kind="top-level"):
    return {
        "id": id_, "title": title, "init_model": model, "phase": phase,
        "idle_s": idle_s, "parent": parent, "tools": tools or [],
        "model": model, "nmodels": 1, "base_url": "https://api.anthropic.com",
        "category": category, "kind": kind, "switched": False,
        "up_bytes": 10000, "down_bytes": 5000, "lan_up_bytes": 0, "lan_down_bytes": 0,
    }


def main():
    with open(DATA) as f:
        doc = json.load(f)
    for name, prof in doc["profiles"].items():
        live = prof.setdefault("live", [])
        if any(L["id"] == "sess_fanout_parent" for L in live):
            continue  # idempotent re-run
        live.append(live_session("sess_fanout_parent", "Bulk-rename the export columns",
                                  "claude-opus", category="Working"))
        live.append(live_session("sess_fanout_child_a", "sess_fanout_parent \u00b7 rename batch 1",
                                  "claude-haiku", parent="sess_fanout_parent",
                                  category="Working", kind="subagent"))
        live.append(live_session("sess_fanout_child_b", "sess_fanout_parent \u00b7 rename batch 2",
                                  "claude-haiku", parent="sess_fanout_parent",
                                  category="Working", kind="subagent"))
        prof["active"] = len(live)
    with open(DATA, "w") as f:
        json.dump(doc, f, separators=(",", ":"), default=str)
    print(f"{DATA}: fan-out live sessions added to {len(doc['profiles'])} profiles")


if __name__ == "__main__":
    main()
