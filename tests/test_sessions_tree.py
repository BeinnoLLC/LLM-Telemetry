#!/usr/bin/env python3
"""P10-01 (#89): sessions_tree — parent/child sessions with cost roll-up.

Builds a fixture with a real DB timestamp that recedes correctly to a
parent-with-two-children tree (one child failed), plus an out-of-window
grandparent whose recent child must still surface it, plus a session with
NO relation at all (must appear as its own root with no children). Uses
the real state_schema.sql and the real collector subprocess, exactly as
test_new_profile_appears.py does.
"""
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
PY = sys.executable

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{('  ' + str(extra)) if extra is not None else ''}")
    if ok:
        p += 1
    else:
        f += 1


def insert_session(con, sid, parent, started, ended, end_reason, model,
                    act_cost, est_cost, msgs=3, tools=1, inp=100, outp=50):
    con.execute(
        """insert into sessions(id, source, parent_session_id, started_at, ended_at,
           end_reason, model, message_count, tool_call_count,
           input_tokens, output_tokens, estimated_cost_usd, actual_cost_usd, title)
           values(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (sid, "cli", parent, started, ended, end_reason, model, msgs, tools,
         inp, outp, est_cost, act_cost, f"session {sid}"))


def make_home(home):
    os.makedirs(home, exist_ok=True)
    con = sqlite3.connect(os.path.join(home, "state.db"))
    con.executescript(open(os.path.join(ROOT, "tests", "fixtures", "state_schema.sql")).read())

    now = int(time.time())
    recent = now - 3600           # 1 hour ago — well inside the 30-day window
    old = now - (60 * 86400)      # 60 days ago — outside the window on its own

    # Root with two children, one of which failed. Actual cost known on the
    # root and one child; the other child only has an estimate (cost_is_actual
    # must reflect that per-node, not get smeared across the tree).
    insert_session(con, "root1", None, recent - 100, recent + 500, "completed",
                    "claude-opus", act_cost=1.00, est_cost=1.10)
    insert_session(con, "child1", "root1", recent, recent + 200, "completed",
                    "claude-haiku", act_cost=0.20, est_cost=0.25)
    insert_session(con, "child2", "root1", recent + 50, recent + 300, "error: rate_limited",
                    "claude-haiku", act_cost=None, est_cost=0.05)

    # A session with NO relation at all — own root, zero children.
    insert_session(con, "lonely1", None, recent - 10, recent + 10, "completed",
                    "gpt-5", act_cost=0.02, est_cost=0.02)

    # Grandparent OUTSIDE the 30-day window, but its child is recent — the
    # parent must still surface (the whole point of the OR-parent clause).
    insert_session(con, "oldparent1", None, old, old + 60, "completed",
                    "claude-opus", act_cost=5.00, est_cost=5.00)
    insert_session(con, "recentchild1", "oldparent1", recent, recent + 60, "completed",
                    "claude-haiku", act_cost=0.10, est_cost=0.10)

    # A currently-running session (ended_at NULL) must not be dropped and
    # must report "(running)", not "(none)".
    insert_session(con, "running1", None, recent, None, None, "claude-opus",
                    act_cost=None, est_cost=0.50)

    con.commit()
    con.close()


def collect(cfg, out):
    env = {**os.environ, "LLM_TELEMETRY_CONFIG": cfg, "LLM_TELEMETRY_OFFLINE": "1"}
    env.pop("LLM_TELEMETRY_AGENT_HOME", None)
    r = subprocess.run([PY, "-m", "llm_telemetry.collect_analytics", "-o", out],
                       cwd=ROOT, env=env, capture_output=True, text=True, timeout=240)
    if r.returncode:
        print(r.stderr[-1500:])
    return json.load(open(out)) if r.returncode == 0 else None


with tempfile.TemporaryDirectory() as root_dir:
    home = os.path.join(root_dir, "agent")
    make_home(home)
    cfg = os.path.join(root_dir, "cfg.json")
    with open(cfg, "w") as fh:
        json.dump({"agent_home": home, "reports_dir": os.path.join(root_dir, "r")}, fh)
    out = os.path.join(root_dir, "a.json")

    data = collect(cfg, out)
    chk(data is not None, "build succeeds against the fixture home")

    tree = ((data or {}).get("profiles", {}).get("default") or {}).get("sessions_tree")
    chk(tree is not None, "sessions_tree key is present in the payload")
    by_id = {n["id"]: n for n in (tree or [])}

    chk("root1" in by_id, "the parent session appears as a root node", sorted(by_id))
    chk("lonely1" in by_id, "a session with no relation appears as its own root")
    chk("child1" not in by_id and "child2" not in by_id,
        "children do NOT also appear as top-level roots (nested only)")

    root = by_id.get("root1") or {}
    kids = {c["id"]: c for c in root.get("children", [])}
    chk(set(kids) == {"child1", "child2"}, "root1 has exactly its two real children", set(kids))
    chk(root.get("child_count") == 2, "root1's child_count is 2", root.get("child_count"))
    chk(root.get("failed_child_count") == 1,
        "root1's failed_child_count is 1 (child2's end_reason contains 'error')",
        root.get("failed_child_count"))

    # Cost roll-up: root's OWN actual cost (1.00) + child1's actual (0.20) +
    # child2's cost falls back to its ESTIMATE (0.05) since it has no actual.
    expected_cost = round(1.00 + 0.20 + 0.05, 6)
    chk(abs(root.get("cost", -1) - expected_cost) < 1e-6,
        f"root1's rolled-up cost sums itself + every descendant ({expected_cost})",
        root.get("cost"))

    chk(kids.get("child2", {}).get("cost_is_actual") is False,
        "child2's cost_is_actual is False (it only had an estimate)")
    chk(kids.get("child1", {}).get("cost_is_actual") is True,
        "child1's cost_is_actual is True (it had a real actual_cost_usd)")

    # The out-of-window grandparent must still surface because its child is
    # recent — this is the actual "OR parent in range" behaviour under test.
    chk("oldparent1" in by_id,
        "a 60-day-old parent still appears because its child is recent")
    old_node = by_id.get("oldparent1") or {}
    chk(any(c["id"] == "recentchild1" for c in old_node.get("children", [])),
        "the old parent's recent child is nested under it, not orphaned")

    running = by_id.get("running1") or {}
    chk(running.get("end_reason") == "(running)",
        "a session with no ended_at reports '(running)', not '(none)'",
        running.get("end_reason"))

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
