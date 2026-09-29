#!/usr/bin/env python3
"""collect_analytics: `project` dimension on the ROWS payload,
including subagent/cron parent-chain inheritance (P4-02 #39, P4-03 #40).

Exercises the actual ROWS + SESSION_IDENTITY SQL against a temp sqlite
fixture (same pattern as test_lifecycle_sql.py) through the real
fetch_rows() production function — not a reimplementation of it — so a
negative control against the shipped code is meaningful.
"""
import os
import sqlite3
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
os.environ.setdefault(
    "LLM_TELEMETRY_CONFIG",
    os.path.join(os.path.dirname(__file__), "..", "examples", "sample-config.json"))

from llm_telemetry.collect_analytics import fetch_rows
from llm_telemetry.projects import project_of_session, MAX_PARENT_DEPTH

p = f = 0


def chk(ok, msg):
    global p, f
    print(("  OK   " if ok else "  FAIL ") + msg)
    p, f = (p + 1, f) if ok else (p, f + 1)


tmpdir = tempfile.mkdtemp()
db_path = os.path.join(tmpdir, "state.db")
con = sqlite3.connect(db_path)
con.execute("""
    create table sessions(
        id text primary key, title text, cwd text, started_at real,
        parent_session_id text, source text, display_name text
    )
""")
con.execute("""
    create table session_model_usage(
        session_id text, model text, billing_provider text,
        billing_base_url text, task text,
        api_call_count integer, input_tokens integer, output_tokens integer,
        cache_read_tokens integer, cache_write_tokens integer,
        reasoning_tokens integer, estimated_cost_usd real, actual_cost_usd real,
        last_seen real
    )
""")
NOW = time.time()


def sess(sid, title=None, cwd=None, parent=None):
    con.execute(
        "insert into sessions(id,title,cwd,started_at,parent_session_id) values (?,?,?,?,?)",
        (sid, title, cwd, NOW - 3600, parent))


def usage(sid, model="gpt-x", provider="openai", calls=1):
    con.execute(
        "insert into session_model_usage(session_id,model,billing_provider,"
        "billing_base_url,task,api_call_count,input_tokens,output_tokens,"
        "cache_read_tokens,cache_write_tokens,reasoning_tokens,"
        "estimated_cost_usd,actual_cost_usd,last_seen) "
        "values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (sid, model, provider, "", "main", calls, 100, 50, 0, 0, 0, 0.01, 0.01, NOW))


# The ticket's own scenario: 25 cron-job sessions with timestamped titles
# all doing the same model/provider work — must collapse to one project.
for i in range(25):
    sid = f"cron{i}"
    sess(sid, title=f"ahwa-health-gate · run {i}")
    usage(sid, model="gpt-x", provider="openai")

# A real project session, resolved by cwd (no title).
sess("s_nowinv", title=None, cwd="/srv/workspace/nowinv")
usage("s_nowinv", model="gpt-x", provider="openai")

# An unattributed session — no title, denylisted cwd, no parent.
sess("s_unattr", title=None, cwd="/opt")
usage("s_unattr", model="gpt-x", provider="openai")

# P4-03: a direct subagent (no title/cwd of its own) inherits its parent's
# project via parent_session_id.
sess("s_root", title="Nowinv", cwd=None)
sess("s_sub1", title=None, cwd=None, parent="s_root")
usage("s_sub1", model="gpt-x", provider="openai")

# P4-03 acceptance: a 3-deep subagent chain resolves to the root project.
sess("chain_root", title="ahwa", cwd=None)
sess("chain_mid", title=None, cwd=None, parent="chain_root")
sess("chain_leaf", title=None, cwd=None, parent="chain_mid")
usage("chain_leaf", model="gpt-x", provider="openai")

# P4-03 acceptance: a cyclic parent link terminates and returns None
# instead of recursing forever.
sess("cyc_a", title=None, cwd=None, parent="cyc_b")
sess("cyc_b", title=None, cwd=None, parent="cyc_a")
usage("cyc_a", model="gpt-x", provider="openai")

# A subagent whose parent is itself unattributed stays unattributed — no
# fallback invention.
sess("orphan_parent", title=None, cwd="/tmp")
sess("orphan_child", title=None, cwd=None, parent="orphan_parent")
usage("orphan_child", model="gpt-x", provider="openai")

con.commit()

rows = fetch_rows(con)
by_sid = {r["session_id"]: r for r in rows}

chk(len(rows) >= 25, f"got at least the 25 cron rows plus the rest, got {len(rows)}")

cron_projects = {r["project"] for r in rows if r["session_id"].startswith("cron")}
chk(cron_projects == {"ahwa-health-gate"},
    "all 25 timestamped cron rows still resolve to the single 'ahwa-health-gate' "
    "project after adding parent-chain resolution (cron sessions need no special "
    "handling — confirming that still holds, per the ticket's own note)")

chk(by_sid["s_nowinv"]["project"] == "nowinv",
    "a cwd-only session resolves to its directory basename as project")

chk(by_sid["s_unattr"]["project"] is None,
    "a session with no title, a denylisted cwd, and no parent resolves to "
    "project=None (unattributed)")

chk(by_sid["s_sub1"]["project"] == "Nowinv",
    "a direct subagent with no title/cwd of its own inherits its parent's project")

chk(by_sid["chain_leaf"]["project"] == "ahwa",
    "a 3-deep subagent chain resolves to the root project")

chk(by_sid["cyc_a"]["project"] is None,
    "a cyclic parent_session_id terminates (does not hang) and resolves to None")

chk(by_sid["orphan_child"]["project"] is None,
    "a subagent whose parent is itself unattributed stays unattributed, no invented fallback")

# Direct project_of_session() checks (depth cap / missing-row edge cases
# the row-grain test above can't easily stage).
sessions_by_id = {
    "a": {"title": None, "cwd": None, "parent_session_id": "missing"},
}
chk(project_of_session("a", sessions_by_id) is None,
    "a parent_session_id pointing at a row that doesn't exist in the loaded "
    "map resolves to None instead of raising a KeyError")

deep = {}
for i in range(MAX_PARENT_DEPTH + 10):
    deep[f"n{i}"] = {"title": None, "cwd": None,
                      "parent_session_id": f"n{i+1}" if i < MAX_PARENT_DEPTH + 9 else None}
deep[f"n{MAX_PARENT_DEPTH + 9}"] = {"title": "TooDeep", "cwd": None, "parent_session_id": None}
chk(project_of_session("n0", deep) is None,
    f"a chain longer than MAX_PARENT_DEPTH ({MAX_PARENT_DEPTH}) gives up and "
    "returns None rather than resolving an out-of-bound ancestor's project")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
