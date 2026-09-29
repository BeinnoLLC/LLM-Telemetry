#!/usr/bin/env python3
"""collect_analytics: session-lifecycle SQL (end_reason breakdown +
compression pressure) for the Health view (#81/P9-04)."""
import os
import sqlite3
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
os.environ.setdefault(
    "LLM_TELEMETRY_CONFIG",
    os.path.join(os.path.dirname(__file__), "..", "examples", "sample-config.json"))

from llm_telemetry.collect_analytics import END_REASONS, COMPRESSION_PRESSURE

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
        id text primary key, title text, display_name text,
        started_at real, ended_at real, end_reason text,
        compression_fallback_streak integer not null default 0,
        compression_ineffective_count integer not null default 0,
        compression_failure_error text
    )
""")
NOW = time.time()
DAY = 86400


def add(sid, started_ago, ended_ago=None, end_reason=None, title="",
        fallback=0, ineffective=0, error=None):
    con.execute(
        "insert into sessions(id,title,started_at,ended_at,end_reason,"
        "compression_fallback_streak,compression_ineffective_count,compression_failure_error) "
        "values (?,?,?,?,?,?,?,?)",
        (sid, title, NOW - started_ago,
         (NOW - ended_ago) if ended_ago is not None else None,
         end_reason, fallback, ineffective, error))


# Clean closes, mixed reasons, within the 30-day window.
add("s1", 2 * DAY, 1 * DAY, "agent_close")
add("s2", 2 * DAY, 1 * DAY, "agent_close")
add("s3", 3 * DAY, 2 * DAY, "cron_complete")
# Abnormal: crashed without a clean close.
add("s4", 5 * DAY, 4 * DAY, "startup_orphan_reap")
add("s5", 5 * DAY, 4 * DAY, None)  # ended, but no end_reason recorded
# Still running (ended_at is null) — must NOT appear in the end_reasons
# breakdown, which is specifically about how sessions ENDED.
add("s6", 1 * DAY, None, None)
# Outside the 30-day window entirely — must not count.
add("s7", 40 * DAY, 35 * DAY, "agent_close")

# Compression pressure candidates.
add("p1", 3 * DAY, 1 * DAY, "agent_close", title="Refactor the billing parser",
    fallback=4, ineffective=12)
add("p2", 3 * DAY, None, None, title="Long-running import", ineffective=2)
add("p3", 3 * DAY, 1 * DAY, "agent_close", title="", error="context window exceeded")
# Zero on every compression column — must NOT appear.
add("p4", 3 * DAY, 1 * DAY, "agent_close", title="Clean session")
# Outside the 30-day window — must not appear even with real pressure.
add("p5", 40 * DAY, 35 * DAY, "agent_close", fallback=9, ineffective=9)

con.commit()

reasons = {r: n for r, n in con.execute(END_REASONS)}
chk(reasons.get("agent_close") == 5, f"agent_close counted correctly, got {reasons.get('agent_close')}")
chk(reasons.get("cron_complete") == 1, "cron_complete counted")
chk(reasons.get("startup_orphan_reap") == 1, "startup_orphan_reap (abnormal) counted")
chk(reasons.get("(none)") == 1, "a session that ended with a null end_reason is bucketed as '(none)', not dropped")
chk(sum(reasons.values()) == 8,
    f"a still-running session (ended_at is null) never appears in the breakdown, got total {sum(reasons.values())}")
chk(reasons.get("agent_close") == 5,
    "a session outside the 30-day window is excluded even with a normal reason (p5 not counted here)")

pressure = list(con.execute(COMPRESSION_PRESSURE))
ids = [row[0] for row in pressure]
chk("p1" in ids, "a session with real fallback+ineffective pressure appears")
chk("p2" in ids, "a session with only ineffective_count > 0 (no fallback) still appears")
chk("p3" in ids, "a session with only a compression_failure_error (zero counts) still appears")
chk("p4" not in ids, "a session with zero on every compression column is excluded")
chk("p5" not in ids, "a session outside the 30-day window is excluded even under real pressure")
p3row = next(row for row in pressure if row[0] == "p3")
chk(p3row[4] == "context window exceeded", "the compression_failure_error string comes through verbatim")
chk(next(row for row in pressure if row[0] == "p1")[1] == "Refactor the billing parser",
    "title comes through for a titled session")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
