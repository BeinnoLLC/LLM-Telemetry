#!/usr/bin/env python3
"""P10-05 (#93): latency payload against a real fixture DB — model
attribution via last-seen session_model_usage, idle exclusion end to end.
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


def insert_asst(con, sid, ts, tok=100):
    con.execute("insert into messages(session_id, role, timestamp, token_count) values(?,?,?,?)",
                (sid, "assistant", ts, tok))


def insert_usage(con, sid, model, base_url, last_seen):
    con.execute(
        """insert into session_model_usage(session_id, model, billing_provider, billing_base_url,
           billing_mode, task, last_seen) values(?,?,?,?,?,?,?)""",
        (sid, model, "", base_url, "", "main", last_seen))


def make_home(home):
    os.makedirs(home, exist_ok=True)
    con = sqlite3.connect(os.path.join(home, "state.db"))
    con.executescript(open(os.path.join(ROOT, "tests", "fixtures", "state_schema.sql")).read())

    now = int(time.time())
    base = now - 3600

    con.execute("insert into sessions(id, source, started_at, model) values('sL', 'cli', ?, 'fallback-model')", (base,))
    insert_usage(con, "sL", "claude-opus", "http://api.anthropic.com/v1", base - 10)
    # 4 assistant turns, 3 real gaps of 2s/4s/6s.
    insert_asst(con, "sL", base, 100)
    insert_asst(con, "sL", base + 2, 100)
    insert_asst(con, "sL", base + 6, 100)
    insert_asst(con, "sL", base + 12, 100)
    # A 5th turn 700s later -> idle (over the 600s default threshold).
    insert_asst(con, "sL", base + 712, 100)

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
    prof = ((data or {}).get("profiles", {}).get("default") or {})
    lat = prof.get("latency")
    chk(lat is not None, "latency key is present in the payload")

    by_model = (lat or {}).get("by_model", {})
    chk("claude-opus" in by_model,
        "the assistant turns are attributed to claude-opus via the last-seen session_model_usage row, not the sessions.model fallback",
        list(by_model))
    chk(by_model.get("claude-opus", {}).get("n") == 3,
        "3 real gaps counted for claude-opus (the 5th turn's 700s gap is idle, excluded)",
        by_model.get("claude-opus"))
    chk(lat.get("idle_n") == 1, "idle_n reports exactly the one excluded 700s gap", lat.get("idle_n"))
    chk(lat.get("idle_threshold_s") == 600, "idle_threshold_s is carried in the payload at its default value", lat.get("idle_threshold_s"))

    by_endpoint = (lat or {}).get("by_endpoint", {})
    chk(any("anthropic" in k for k in by_endpoint),
        "by_endpoint groups by the resolved endpoint (anthropic base_url)", list(by_endpoint))

    slowest = (lat or {}).get("slowest", [])
    chk(len(slowest) == 3, "slowest list contains all 3 real gaps (fewer than slowest_n=10)", len(slowest))
    chk(slowest[0]["s"] == 6, "the slowest real gap (6s) sorts first", slowest[0])

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
