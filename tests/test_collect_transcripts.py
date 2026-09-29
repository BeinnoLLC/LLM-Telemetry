#!/usr/bin/env python3
"""collect_transcripts: windowed per-session transcript export (#79/P9-02)."""
import json
import os
import sqlite3
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
os.environ.setdefault(
    "LLM_TELEMETRY_CONFIG",
    os.path.join(os.path.dirname(__file__), "..", "examples", "sample-config.json"))

from llm_telemetry import collect_transcripts as CT

p = f = 0


def chk(ok, msg):
    global p, f
    print(("  OK   " if ok else "  FAIL ") + msg)
    p, f = (p + 1, f) if ok else (p, f + 1)


def make_db(path):
    con = sqlite3.connect(path)
    con.execute("""
        create table sessions(id text primary key, started_at real,
            ended_at real, last_activity_at real)
    """)
    con.execute("""
        create table messages(id integer primary key autoincrement,
            session_id text, role text, content text, tool_call_id text,
            tool_calls text, tool_name text, timestamp real, active integer default 1)
    """)
    con.commit()
    return con


tmpdir = tempfile.mkdtemp()
db_path = os.path.join(tmpdir, "state.db")
con = make_db(db_path)

# One live session (no ended_at, recent activity) with 5 messages, one of
# them carrying tool_calls JSON.
NOW = time.time()
con.execute("insert into sessions values ('live1', ?, NULL, ?)", (NOW - 300, NOW - 10))
for i in range(5):
    con.execute(
        "insert into messages(session_id,role,content,tool_calls,timestamp,active) values (?,?,?,?,?,1)",
        ("live1", "user" if i % 2 == 0 else "assistant", f"msg {i}",
         json.dumps([{"name": "grep"}]) if i == 3 else None, NOW - 200 + i))

# A second session that ended — must NOT appear, no matter how recent.
con.execute("insert into sessions values ('done1', ?, ?, ?)", (NOW - 300, NOW - 5, NOW - 5))
con.execute(
    "insert into messages(session_id,role,content,timestamp,active) values ('done1','user','ended session',?,1)",
    (NOW - 200,))

# A third session that's "live" by ended_at but stale (last activity too
# long ago) — must NOT appear either; #79 only wants sessions actually
# running right now, not every never-closed session in the DB.
con.execute("insert into sessions values ('stale1', ?, NULL, ?)", (NOW - 5000, NOW - 5000))
con.execute(
    "insert into messages(session_id,role,content,timestamp,active) values ('stale1','user','stale session',?,1)",
    (NOW - 5000,))

# A soft-deleted (active=0) message in the live session — must be excluded.
con.execute(
    "insert into messages(session_id,role,content,timestamp,active) values ('live1','user','deleted',?,0)",
    (NOW - 195,))

con.commit()
con.close()

CT.EA.PROFILES = {"test": db_path}

out = CT.build_transcripts(window=200)
prof = out["profiles"].get("test", {})

chk("live1" in prof, "the currently-live session appears in the export")
chk("done1" not in prof, "a session with ended_at set is excluded even if recently ended")
chk("stale1" not in prof, "a never-closed but long-idle session is excluded (last_activity_at cutoff)")

msgs = prof.get("live1", [])
chk(len(msgs) == 5, f"all 5 active messages for the live session are present, got {len(msgs)}")
chk([m["content"] for m in msgs] == [f"msg {i}" for i in range(5)],
    "messages come back in chronological order (oldest first), not DB insert/newest-first order")
chk(all(m["content"] != "deleted" for m in msgs), "soft-deleted (active=0) messages never appear")
chk(msgs[3].get("tool_calls") == [{"name": "grep"}],
    "tool_calls JSON is parsed into a real object, not left as a raw string")
chk("tool_calls" not in msgs[0], "a message with no tool_calls doesn't get a spurious empty field")

# Malformed tool_calls JSON must degrade to the raw string, not crash the
# whole export — a single corrupt row should never blank out a live session.
con = sqlite3.connect(db_path)
con.execute(
    "insert into messages(session_id,role,content,tool_calls,timestamp,active) values ('live1','assistant','x','{not json',?,1)",
    (NOW - 1,))
con.commit()
con.close()
out2 = CT.build_transcripts(window=200)
last = out2["profiles"]["test"]["live1"][-1]
chk(last.get("tool_calls") == "{not json", "malformed tool_calls JSON degrades to the raw string instead of raising")

# The window cap: WINDOW messages inserted, then WINDOW+50 more — only the
# last WINDOW must survive (the ticket's whole reason for this file to
# exist: a 30MB session must not appear whole).
con = sqlite3.connect(db_path)
con.execute("delete from messages where session_id='live1'")
for i in range(CT.WINDOW + 50):
    con.execute(
        "insert into messages(session_id,role,content,timestamp,active) values ('live1','user',?,?,1)",
        (f"m{i}", NOW - 1000 + i))
con.commit()
con.close()
out3 = CT.build_transcripts(window=CT.WINDOW)
windowed = out3["profiles"]["test"]["live1"]
chk(len(windowed) == CT.WINDOW, f"exactly WINDOW={CT.WINDOW} messages survive out of {CT.WINDOW+50} inserted, got {len(windowed)}")
chk(windowed[0]["content"] == "m50" and windowed[-1]["content"] == f"m{CT.WINDOW+49}",
    "the window keeps the NEWEST messages (the tail), not the oldest")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
