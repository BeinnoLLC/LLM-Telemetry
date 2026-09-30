#!/usr/bin/env python3
"""collect_analytics: HOUR_ROWS / fetch_hour_rows (#129), the hour-grain
twin of ROWS/fetch_rows that backs the dashboard's sub-day range presets
(1h/6h/12h).

Exercises the actual HOUR_ROWS + SESSION_IDENTITY SQL against a temp sqlite
fixture (same pattern as test_project_rows.py) through the real
fetch_hour_rows() production function.
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

from llm_telemetry.collect_analytics import fetch_hour_rows, HOUR_WINDOW_S

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
        parent_session_id text, source text, display_name text, git_branch text
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


def sess(sid):
    con.execute(
        "insert into sessions(id,title,cwd,started_at,parent_session_id) values (?,?,?,?,?)",
        (sid, None, None, NOW - 3600, None))


def usage(sid, last_seen, calls=1):
    con.execute(
        "insert into session_model_usage(session_id,model,billing_provider,"
        "billing_base_url,task,api_call_count,input_tokens,output_tokens,"
        "cache_read_tokens,cache_write_tokens,reasoning_tokens,"
        "estimated_cost_usd,actual_cost_usd,last_seen) "
        "values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (sid, "gpt-x", "openai", "", "main", calls, 100, 50, 0, 0, 0, 0.01, 0.01, last_seen))


# A call from 30 minutes ago must be in the window.
sess("recent")
usage("recent", NOW - 1800, calls=3)

# A call from well inside the 72h window but a different hour bucket.
sess("six_hours_ago")
usage("six_hours_ago", NOW - 6 * 3600, calls=5)

# Negative control: a call from BEFORE the HOUR_WINDOW_S cutoff must be
# excluded — this is the query's whole reason to exist (bounded payload),
# so a broken WHERE clause that dropped the bound must fail this check.
sess("stale")
usage("stale", NOW - HOUR_WINDOW_S - 3600, calls=99)

con.commit()

rows = fetch_hour_rows(con)
by_sid = {r["session_id"]: r for r in rows}

chk("recent" in by_sid, "a call inside the hour window is present")
chk("six_hours_ago" in by_sid, "a call 6h back (still inside the 72h window) is present")
chk("stale" not in by_sid,
    "a call older than HOUR_WINDOW_S is excluded (negative control: this must "
    "fail if the where-clause bound is removed)")

r = by_sid["recent"]
chk("hour" in r and isinstance(r["hour"], int),
    "each row carries an integer 'hour' column (the grain HOUR_ROWS adds over ROWS)")
chk(0 <= r["hour"] <= 23, f"hour is a real 0-23 bucket, got {r['hour']}")
chk(r["calls"] == 3, f"call count aggregates correctly per hour bucket, got {r['calls']}")

# project_of_session resolution runs on hour rows too (same as fetch_rows) —
# with no title/cwd/parent these all resolve to unattributed (None), just
# confirming the field exists and the resolver was actually invoked, not
# skipped for the hour-grain path.
chk("project" in r, "hour rows carry the same 'project' resolution field as day rows")
chk("source" in r, "hour rows carry the same 'source' field as day rows")

# Pricing/bandwidth enrichment happens in build(), not fetch_hour_rows() —
# confirm the raw fetch does NOT fabricate those fields, so a caller can't
# accidentally rely on un-enriched hour rows looking already-priced.
chk("billed_usd" not in r,
    "fetch_hour_rows() does not itself add pricing fields — that's build()'s "
    "_enrich_rows() step, kept as a separate stage")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
