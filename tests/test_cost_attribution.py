#!/usr/bin/env python3
"""P10-07 (#95): cost_attribution unit tests, zero DB.

Verification per the ticket's own criteria:
- sum(by_source) equals the range total, asserted not eyeballed
- negative control: fixture with no cron sessions -> by_cron is empty
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))
from llm_telemetry.cost_attribution import build_attribution, by_cron, by_root, by_source, by_tool  # noqa: E402

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{('  ' + str(extra)) if extra is not None else ''}")
    if ok:
        p += 1
    else:
        f += 1


def row(session_id, source, cost, inp=1000, outp=500, cread=0):
    return {"session_id": session_id, "source": source, "market_value_usd": cost,
            "inp": inp, "outp": outp, "cread": cread}


# --- by_source ---
rows = [
    row("s1", "desktop", 1.50),
    row("s2", "desktop", 2.00),
    row("s3", "cron", 0.10),
    row("s4", "cron", 0.20),
    row("s5", None, 0.05),  # unrecognised/missing source
]
bs = by_source(rows)
total_range = sum(r["market_value_usd"] for r in rows)
total_by_source = sum(b["cost"] for b in bs)
chk(abs(total_by_source - total_range) < 1e-9,
    f"sum(by_source) equals the range total (asserted, not eyeballed): {total_by_source} == {total_range}")
chk(any(b["source"] == "(unknown)" for b in bs),
    "a missing source still gets its own bucket rather than vanishing")
desktop = next(b for b in bs if b["source"] == "desktop")
chk(desktop["sessions"] == 2, "desktop bucket counts 2 distinct sessions", desktop["sessions"])
chk(bs[0]["cost"] >= bs[-1]["cost"], "by_source is sorted by cost descending")

# --- by_root: lonely session is its own root, own==total ---
sessions_by_id = {
    "root1": {"title": "Root task", "parent_session_id": None},
    "child1": {"title": "Root task · sub", "parent_session_id": "root1"},
    "grandchild1": {"title": "Root task · sub · sub", "parent_session_id": "child1"},
    "lonely": {"title": "Standalone", "parent_session_id": None},
}
rows_tree = [
    row("root1", "desktop", 1.00),
    row("child1", "subagent", 0.30),
    row("grandchild1", "subagent", 0.10),
    row("lonely", "cli", 0.50),
]
br = by_root(rows_tree, sessions_by_id)
root_entry = next(b for b in br if b["id"] == "root1")
chk(root_entry["own"] == 1.0, "root1's own cost excludes descendants")
chk(abs(root_entry["descendants"] - 0.40) < 1e-9,
    "root1's descendants sum BOTH the direct child and the two-level-deep grandchild", root_entry["descendants"])
chk(abs(root_entry["total"] - 1.40) < 1e-9, "root1's total is own + all descendants")
lonely_entry = next(b for b in br if b["id"] == "lonely")
chk(lonely_entry["own"] == lonely_entry["total"] == 0.50 and lonely_entry["descendants"] == 0,
    "a lonely session with no relations is its own root: own == total, descendants == 0")

# --- by_cron ---
sessions_cron = {
    "c1": {"title": "nightly-backup"}, "c2": {"title": "nightly-backup"},
    "c3": {"title": "hourly-sync"},
}
rows_cron = [
    row("c1", "cron", 0.05), row("c2", "cron", 0.07), row("c3", "cron", 0.01),
    row("d1", "desktop", 5.0),  # non-cron noise must not leak into by_cron
]
bc = by_cron(rows_cron, sessions_cron)
nightly = next(b for b in bc if b["name"] == "nightly-backup")
chk(nightly["runs"] == 2, "nightly-backup groups its 2 runs under one job name")
chk(abs(nightly["total"] - 0.12) < 1e-9, "nightly-backup's total sums both runs")
chk(abs(nightly["avg"] - 0.06) < 1e-9, "nightly-backup's avg-per-run is total/runs")
chk(abs(nightly["monthly_projection"] - nightly["total"]) < 1e-9,
    "the 30-day-window monthly projection equals the observed total for a window that IS 30 days")
chk(not any("desktop" in str(b) for b in bc), "desktop-source rows never leak into by_cron")

# NEGATIVE CONTROL (ticket's own): no cron sessions in the fixture -> empty.
bc_empty = by_cron([row("d1", "desktop", 1.0), row("d2", "tui", 2.0)], {"d1": {}, "d2": {}})
chk(bc_empty == [], "a fixture with zero cron sessions produces an EMPTY by_cron list (not a zero-row placeholder)")

# --- by_tool ---
rows_for_rate = [row("s1", "desktop", 2.0, inp=1000, outp=1000, cread=0)]  # $2 / 2000 tok = $0.001/tok
tool_rows = [
    {"tool_name": "read_file", "session_id": "s1", "tokens": 30000},
    {"tool_name": "terminal", "session_id": "s1", "tokens": 500},
    {"tool_name": "read_file", "session_id": "s1", "tokens": 1000},
]
bt = by_tool(rows_for_rate, tool_rows)
rf = next(b for b in bt if b["tool"] == "read_file")
chk(rf["tokens"] == 31000, "read_file's token total sums both its calls")
chk(abs(rf["cost"] - 31000 * 0.001) < 1e-6,
    f"a large read_file result is priced at the SESSION's own real $/token rate, not a flat/invented tool price (got {rf['cost']})")
chk(bt[0]["tool"] == "read_file", "by_tool is sorted by cost descending (the expensive 30MB-log tool first)")

# --- build_attribution: whole payload shape ---
full = build_attribution(rows, sessions_by_id, [])
chk(set(full.keys()) == {"by_source", "by_root", "by_cron", "by_tool"},
    "build_attribution returns exactly the 4 documented top-level keys", set(full.keys()))

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
