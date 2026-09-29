#!/usr/bin/env python3
"""Add a synthetic sessions_tree to the sample payload (#89/P10-01).

Sanitized fixture data only — invented ids, invented titles. Shape matches
exactly what collect_analytics.build_sessions_tree() emits from a real
state.db (own cost/tok rolled up through descendants), so the jsdom tests
and the rendered sample exercise the same shape production does.

Includes: one root with two children (one failed), one two-level fan-out
(root -> subagent -> nested subagent) since the collector explicitly does
not assume max depth of 1, and one lonely session with no relation at all
(must not appear in the tree card, which only shows nodes with children).
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "reports", "analytics-data.json")


def node(id_, title, source, model, started, ended, end_reason, msgs, tools,
         tok, cost, cost_is_actual, children=None, child_count=0, failed_child_count=0):
    return {
        "id": id_, "parent": None, "source": source, "title": title, "model": model,
        "started": started, "ended": ended, "end_reason": end_reason,
        "msgs": msgs, "tools": tools, "tok": tok, "cost": cost,
        "cost_is_actual": cost_is_actual,
        "children": children or [], "child_count": child_count,
        "failed_child_count": failed_child_count,
    }


BASE = 1_700_000_000

TREE = [
    node("sess_parent01", "Migrate billing to the new pricing table", "desktop",
         "claude-opus", BASE, BASE + 5400, "completed", 42, 18, 812_000, 4.9600, True,
         children=[
             node("sess_child01a", "sess_parent01 \u00b7 apply schema migration", "subagent",
                  "claude-haiku", BASE + 60, BASE + 900, "completed", 9, 6, 61_000, 0.1800, True),
             node("sess_child01b", "sess_parent01 \u00b7 backfill historical rows", "subagent",
                  "claude-haiku", BASE + 900, BASE + 2100, "error: tool_timeout", 5, 9, 88_000, 0.2600, False),
         ],
         child_count=2, failed_child_count=1),
    node("sess_parent02", "Investigate the nightly export failure", "cli",
         "gpt-5", BASE + 10_000, BASE + 16_000, "completed", 20, 11, 240_000, 1.1200, True,
         children=[
             node("sess_child02a", "sess_parent02 \u00b7 tail the failing job's logs", "subagent",
                  "gpt-5-mini", BASE + 10_100, BASE + 12_000, "completed", 6, 4, 30_000, 0.0400, True,
                  children=[
                      node("sess_grandchild02a1", "sess_child02a \u00b7 grep archived logs", "subagent",
                           "gpt-5-mini", BASE + 10_200, BASE + 11_000, "completed", 3, 2, 9_000, 0.0100, True),
                  ], child_count=1, failed_child_count=0),
         ],
         child_count=2, failed_child_count=0),
    node("sess_lonely01", "Quick one-off: check disk usage", "oneshot",
         "claude-haiku", BASE + 30_000, BASE + 30_060, "completed", 2, 1, 4_000, 0.0020, True),
]


def main():
    with open(DATA) as f:
        doc = json.load(f)
    for name, prof in doc["profiles"].items():
        prof["sessions_tree"] = TREE
    with open(DATA, "w") as f:
        json.dump(doc, f, separators=(",", ":"), default=str)
    with_kids = sum(1 for n in TREE if n["children"])
    print(f"{DATA}: sessions_tree added to {len(doc['profiles'])} profiles "
          f"({len(TREE)} roots, {with_kids} with children)")


if __name__ == "__main__":
    main()
