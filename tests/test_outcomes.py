#!/usr/bin/env python3
"""P10-03 (#91): session outcomes — end_reason breakdown, orphan reaps, and
the silent-end bucket.

Fixture: one session of each of the five buckets discussed in the ticket
(agent_close, cron_complete, startup_orphan_reap, NULL/(none), plus a
second reap on a different day for the trend), split across two sources.
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


def insert_session(con, sid, source, ended, end_reason, model="claude-opus"):
    con.execute(
        """insert into sessions(id, source, started_at, ended_at, end_reason, model,
           message_count, tool_call_count, input_tokens, output_tokens, title)
           values(?,?,?,?,?,?,?,?,?,?,?)""",
        (sid, source, ended - 100, ended, end_reason, model, 3, 1, 100, 50, f"session {sid}"))


def make_home(home, include_null_row=True):
    os.makedirs(home, exist_ok=True)
    con = sqlite3.connect(os.path.join(home, "state.db"))
    con.executescript(open(os.path.join(ROOT, "tests", "fixtures", "state_schema.sql")).read())

    now = int(time.time())
    day1 = now - 3600
    day2 = now - 90000  # a different calendar day for the reap trend, if TZ allows

    insert_session(con, "s_ok1", "desktop", day1, "agent_close")
    insert_session(con, "s_cron1", "cron", day1, "cron_complete")
    insert_session(con, "s_cron_bad", "cron", day1, "agent_close")  # cron NOT ending cron_complete — the alarm case
    insert_session(con, "s_reap1", "desktop", day1, "startup_orphan_reap")
    insert_session(con, "s_reap2", "desktop", day2, "ws_orphan_reap")
    if include_null_row:
        insert_session(con, "s_silent1", "tui", day1, None)

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


def run_case(include_null_row):
    with tempfile.TemporaryDirectory() as root_dir:
        home = os.path.join(root_dir, "agent")
        make_home(home, include_null_row)
        cfg = os.path.join(root_dir, "cfg.json")
        with open(cfg, "w") as fh:
            json.dump({"agent_home": home, "reports_dir": os.path.join(root_dir, "r")}, fh)
        out = os.path.join(root_dir, "a.json")
        return collect(cfg, out)


data = run_case(include_null_row=True)
chk(data is not None, "build succeeds against the fixture home")
outcomes = ((data or {}).get("profiles", {}).get("default") or {}).get("outcomes")
chk(outcomes is not None, "outcomes key is present in the payload")

by_reason = (outcomes or {}).get("by_reason", {})
chk(by_reason.get("agent_close") == 2, "agent_close count is 2 (s_ok1 + s_cron_bad)", by_reason.get("agent_close"))
chk(by_reason.get("cron_complete") == 1, "cron_complete count is 1", by_reason.get("cron_complete"))
chk(by_reason.get("startup_orphan_reap") == 1, "startup_orphan_reap count is 1", by_reason.get("startup_orphan_reap"))
chk(by_reason.get("ws_orphan_reap") == 1, "ws_orphan_reap count is 1", by_reason.get("ws_orphan_reap"))
chk(by_reason.get("(none)") == 1, "the NULL end_reason row lands under the literal key '(none)'", by_reason.get("(none)"))
chk("ok" not in by_reason, "there is NO 'ok' bucket that absorbs the (none) row", list(by_reason))

by_source = (outcomes or {}).get("by_source_reason", {})
chk(by_source.get("cron", {}).get("cron_complete") == 1 and by_source.get("cron", {}).get("agent_close") == 1,
    "cron is split by reason: 1 cron_complete + 1 agent_close (the alarm case is visible, not averaged away)",
    by_source.get("cron"))

silent = (outcomes or {}).get("silent", [])
chk(len(silent) == 1 and silent[0]["id"] == "s_silent1",
    "the silent bucket lists exactly the one NULL-end_reason session", silent)

reaped = (outcomes or {}).get("reaped", [])
chk({r["id"] for r in reaped} == {"s_reap1", "s_reap2"},
    "the reaped list contains exactly the two orphan-reap sessions", reaped)

reap_trend = (outcomes or {}).get("reap_trend", [])
chk(sum(t["n"] for t in reap_trend) == 2,
    "the reap trend sums to 2 total reaps across whatever day-buckets they fall in", reap_trend)

# Negative-control setup lives in the ticket's own acceptance criterion:
# removing the NULL row must make the silent bucket disappear (empty), not
# secretly move that session into some other bucket.
data2 = run_case(include_null_row=False)
outcomes2 = ((data2 or {}).get("profiles", {}).get("default") or {}).get("outcomes")
chk((outcomes2 or {}).get("silent") == [],
    "removing the NULL-end_reason fixture row empties the silent bucket entirely",
    (outcomes2 or {}).get("silent"))
by_reason2 = (outcomes2 or {}).get("by_reason", {})
chk("(none)" not in by_reason2,
    "removing the NULL row also removes the '(none)' key from by_reason (not zeroed-but-present, not folded elsewhere)",
    by_reason2)

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
