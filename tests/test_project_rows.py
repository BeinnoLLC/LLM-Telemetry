#!/usr/bin/env python3
"""collect_analytics: `project` dimension on the ROWS payload (P4-02, #39).

Exercises the actual ROWS SQL against a temp sqlite fixture (same pattern
as test_lifecycle_sql.py), then resolves project_of() over the fetched
rows exactly as build() does, confirming the fragmentation problem the
ticket names is solved end-to-end: many session_model_usage rows across
differently-titled sessions collapse into few project buckets.
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
        id text primary key, title text, cwd text, started_at real
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


def sess(sid, title=None, cwd=None):
    con.execute("insert into sessions(id,title,cwd,started_at) values (?,?,?,?)",
                (sid, title, cwd, NOW - 3600))


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

# An unattributed session — no title, denylisted cwd.
sess("s_unattr", title=None, cwd="/opt")
usage("s_unattr", model="gpt-x", provider="openai")

con.commit()

rows = fetch_rows(con)

chk(len(rows) >= 25, f"got at least the 25 cron rows plus 2 more, got {len(rows)}")
chk("title" not in rows[0] and "cwd" not in rows[0],
    "raw title/cwd are removed from the emitted row — only the resolved key ships")

cron_projects = {r["project"] for r in rows if r["project"] == "ahwa-health-gate"}
chk(cron_projects == {"ahwa-health-gate"},
    "all 25 timestamped cron rows resolve to the single 'ahwa-health-gate' project")
cron_row_count = sum(1 for r in rows if r["project"] == "ahwa-health-gate")
chk(cron_row_count == 25,
    f"exactly the 25 cron rows carry that project key, got {cron_row_count}")

nowinv_rows = [r for r in rows if r["project"] == "nowinv"]
chk(len(nowinv_rows) == 1 and nowinv_rows[0]["sessions"] == 1,
    "a cwd-only session resolves to its directory basename as project")

unattr_rows = [r for r in rows if r["project"] is None]
chk(len(unattr_rows) == 1,
    f"a session with no title and a denylisted cwd resolves to project=None (unattributed), got {len(unattr_rows)}")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
