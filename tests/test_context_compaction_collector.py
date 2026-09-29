#!/usr/bin/env python3
"""P10-09 (#97): context_compaction wired into collect_analytics.build(),
against a real fixture DB. Verification per the ticket's own criteria,
run against the REAL collector end-to-end:
- fixture with two compactions -> two markers, yield = before - after,
  ineffective flag set on the < 10% one
- negative control: a session with no compactions -> markers absent
"""
import json
import os
import sqlite3
import subprocess
import sys
import tempfile

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


def msg(con, sid, role, ts, content, compacted=0):
    con.execute("insert into messages(session_id, role, content, timestamp, compacted, active) "
                "values(?,?,?,?,?,1)", (sid, role, content, ts, compacted))


with tempfile.TemporaryDirectory() as root:
    home = os.path.join(root, "agent")
    os.makedirs(home, exist_ok=True)
    con = sqlite3.connect(os.path.join(home, "state.db"))
    con.executescript(open(os.path.join(ROOT, "tests", "fixtures", "state_schema.sql")).read())

    con.execute("insert into sessions(id, source, started_at, title) values('cxsess', 'desktop', 1790000000, 'Context growth demo')")
    con.execute("insert into sessions(id, source, started_at, title) values('lonely', 'desktop', 1790000000, 'No compaction here')")

    # cxsess: grows, compacts (effective), grows again, compacts (barely -- ineffective).
    msg(con, "cxsess", "user", 1790000000, "short prompt")
    msg(con, "cxsess", "assistant", 1790000010, "x" * 2000)
    msg(con, "cxsess", "assistant", 1790000020, "x" * 20000)          # big context before compaction 1
    msg(con, "cxsess", "assistant", 1790000021, "compaction summary", compacted=1)
    msg(con, "cxsess", "assistant", 1790000022, "x" * 300)            # after compaction 1: small
    msg(con, "cxsess", "assistant", 1790000030, "x" * 30000)          # grows again
    msg(con, "cxsess", "assistant", 1790000031, "barely-effective summary", compacted=1)
    msg(con, "cxsess", "assistant", 1790000032, "x" * 29700)          # after compaction 2: barely smaller

    # lonely: grows but never compacts -- the ticket's own negative control.
    msg(con, "lonely", "assistant", 1790000000, "x" * 500)
    msg(con, "lonely", "assistant", 1790000010, "x" * 800)

    con.execute("update sessions set compression_failure_cooldown_until=?, compression_failure_error=? where id='cxsess'",
                (9999999999, "RateLimitError: exceeded quota\nfull traceback\nmore lines"))
    con.commit()
    con.close()

    cfg = os.path.join(root, "cfg.json")
    with open(cfg, "w") as fh:
        json.dump({"agent_home": home, "reports_dir": os.path.join(root, "r")}, fh)
    out = os.path.join(root, "a.json")

    env = {**os.environ, "LLM_TELEMETRY_CONFIG": cfg, "LLM_TELEMETRY_OFFLINE": "1"}
    env.pop("LLM_TELEMETRY_AGENT_HOME", None)
    r = subprocess.run([PY, "-m", "llm_telemetry.collect_analytics", "-o", out],
                       cwd=ROOT, env=env, capture_output=True, text=True, timeout=240)
    if r.returncode:
        print(r.stderr[-2000:])
    chk(r.returncode == 0, "the real collector runs end-to-end against the fixture DB")
    doc = json.load(open(out))
    prof = doc["profiles"]["default"]
    chk("context" in prof, "the payload carries the new context key")
    ctx = prof["context"]

    cx = next((s for s in ctx["sessions"] if s["id"] == "cxsess"), None)
    chk(cx is not None, "cxsess appears in the context payload")
    chk(cx is not None and len(cx["compactions"]) == 2,
        f"cxsess has exactly 2 compactions (2 contiguous compacted=1 runs)", cx["compactions"] if cx else None)
    if cx and len(cx["compactions"]) == 2:
        c1, c2 = cx["compactions"]
        chk(c1["yield_tok"] == c1["before"] - c1["after"], "compaction 1's yield = before - after on the real payload")
        chk(c1["ineffective"] is False, "compaction 1 (huge drop) is NOT flagged ineffective")
        chk(c2["ineffective"] is True, "compaction 2 (barely any drop) IS flagged ineffective, real end-to-end")

    lonely = next((s for s in ctx["sessions"] if s["id"] == "lonely"), None)
    chk(lonely is not None and lonely["compactions"] == [],
        "lonely (never compacted) has an EMPTY compactions list — the ticket's own negative control, end-to-end")

    cooldown_ids = {c["id"] for c in ctx["cooldowns"]}
    chk("cxsess" in cooldown_ids, "cxsess's real cooldown row appears in the payload")
    cxc = next(c for c in ctx["cooldowns"] if c["id"] == "cxsess")
    chk(cxc["error_head"] == "RateLimitError: exceeded quota",
        "the real cooldown error is truncated to its first line")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
