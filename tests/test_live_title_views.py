#!/usr/bin/env python3
"""A generic 'Bot Chat' title resolves to the same text in the live rows, the log
drawer feed (LIVE_LOGS) and the just-ended list (RECENT_ENDED); secrets in the
first message never reach any of them. Real fixture DB, read-only collector."""
import json, os, sqlite3, sys, tempfile, time

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "src"))
p = f = 0
def chk(ok, msg, extra=None):
    global p, f
    print(("  OK   " if ok else "  FAIL ") + msg + (f"  {extra}" if extra is not None else ""))
    p, f = (p + 1, f) if ok else (p, f + 1)

with tempfile.TemporaryDirectory() as td:
    home = os.path.join(td, "agent"); os.makedirs(home)
    con = sqlite3.connect(os.path.join(home, "state.db"))
    con.executescript(open(os.path.join(ROOT, "tests", "fixtures", "state_schema.sql")).read())
    now = int(time.time())
    for sid, ended, first in (("live1", None, "Deploy with GH_TOKEN=ghp_abcdefghijklmnop1234567890 now"),
                              ("end1", now - 5, "Summarise the weekly report")):
        con.execute("insert into sessions(id, source, title, started_at, last_activity_at, ended_at) values(?,?,?,?,?,?)",
                    (sid, "cli", "Bot Chat" if sid == "live1" else "bot chat", now - 100, now - 2, ended))
        con.execute("insert into messages(session_id, role, content, timestamp) values(?,?,?,?)",
                    (sid, "user", first, now - 50))
    con.commit(); con.close()
    cfg = os.path.join(td, "cfg.json")
    json.dump({"agent_home": home, "reports_dir": os.path.join(td, "r")}, open(cfg, "w"))
    os.environ["LLM_TELEMETRY_CONFIG"] = cfg
    os.environ["LLM_TELEMETRY_OFFLINE"] = "1"
    os.environ["LLM_TELEMETRY_AGENT_LOGINS"] = ""
    os.environ.pop("LLM_TELEMETRY_AGENT_HOME", None)
    from llm_telemetry import collect_live as CL
    prof = next(iter(CL.build_live()["profiles"].values()))
    live = {L["id"]: L["title"] for L in prof["live"]}
    chk(live.get("live1") == "Deploy with GH TOKEN=[REDACTED] now",
        "live row title is redacted", live)
    logs = [lg for lg in prof["logs"] if lg["sid"] == "live1"]
    chk(logs and all(lg["title"] == live["live1"] for lg in logs), "LIVE_LOGS carries the same resolved title", logs and logs[0]["title"])
    ended = {e["id"]: e["title"] for e in prof["recent_ended"]}
    chk(ended.get("end1") == "Summarise the weekly report", "RECENT_ENDED resolves the first message, not 'Bot Chat'", ended)
    chk("Bot Chat" not in json.dumps([live, ended, [lg["title"] for lg in prof["logs"]]]), "negative control: no view still says 'Bot Chat'")
print(f"\n{p} passed, {f} failed"); sys.exit(1 if f else 0)
