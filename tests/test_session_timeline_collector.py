#!/usr/bin/env python3
"""P10-06 (#94): collect_session_timeline against a real fixture DB —
per-session file export, static-file architecture, capped at N most
recent sessions.
"""
import json
import os
import sqlite3
import sys
import tempfile
import time

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "src"))

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{('  ' + str(extra)) if extra is not None else ''}")
    if ok:
        p += 1
    else:
        f += 1


with tempfile.TemporaryDirectory() as root_dir:
    home = os.path.join(root_dir, "agent")
    os.makedirs(home, exist_ok=True)
    db_path = os.path.join(home, "state.db")
    con = sqlite3.connect(db_path)
    con.executescript(open(os.path.join(ROOT, "tests", "fixtures", "state_schema.sql")).read())

    now = int(time.time())
    base = now - 3600

    con.execute("insert into sessions(id, source, started_at, ended_at, end_reason) "
                "values('sX', 'cli', ?, ?, 'agent_close')", (base, base + 20))
    con.execute("insert into session_model_usage(session_id, model, billing_provider, billing_base_url, "
                "billing_mode, task, last_seen, input_tokens, output_tokens, estimated_cost_usd) "
                "values('sX','claude-opus','','','','main',?,500,300,0.02)", (base,))
    con.execute("insert into messages(session_id, role, timestamp) values('sX','user',?)", (base,))
    con.execute("insert into messages(session_id, role, timestamp) values('sX','assistant',?)", (base + 1,))
    con.execute("insert into messages(session_id, role, timestamp, tool_name, effect_disposition) "
                "values('sX','tool',?,'terminal','failed')", (base + 2,))
    con.execute("insert into async_delegations(delegation_id, origin_session, state, dispatched_at, "
                "completed_at, updated_at) values('d1','sX','completed',?,?,?)", (base + 3, base + 10, base + 10))
    # A session outside the 30-day window must NOT be exported.
    con.execute("insert into sessions(id, source, started_at, ended_at) values('sOld', 'cli', ?, ?)",
                (now - 3000000, now - 2999990))
    con.commit()
    con.close()

    import importlib
    # Point config at this fixture home via env, same pattern the other
    # fixture-DB tests use.
    cfg = os.path.join(root_dir, "cfg.json")
    with open(cfg, "w") as fh:
        json.dump({"agent_home": home, "reports_dir": os.path.join(root_dir, "r")}, fh)
    os.environ["LLM_TELEMETRY_CONFIG"] = cfg
    os.environ["LLM_TELEMETRY_OFFLINE"] = "1"
    os.environ.pop("LLM_TELEMETRY_AGENT_HOME", None)
    for mod in list(sys.modules):
        if mod.startswith("llm_telemetry"):
            del sys.modules[mod]
    from llm_telemetry import collect_session_timeline as CST  # noqa: E402

    out_dir = os.path.join(root_dir, "sessions_out")
    n = CST.write_session_files(out_dir, max_sessions=100)
    chk(n == 1, f"exactly 1 session file written (the old one is out of the 30-day scope) (got {n})", n)

    # Find the profile subdir (name comes from config resolution).
    profile_dirs = [d for d in os.listdir(out_dir) if os.path.isdir(os.path.join(out_dir, d))]
    chk(len(profile_dirs) == 1, "one profile directory created", profile_dirs)
    session_file = os.path.join(out_dir, profile_dirs[0], "sX.json")
    chk(os.path.exists(session_file), "the in-scope session's file exists at <profile>/<id>.json", session_file)

    doc = json.load(open(session_file))
    chk(doc["id"] == "sX", "the exported timeline carries the right session id")
    chk(doc["running"] is False, "a session with a real ended_at exports running=False")
    chk("claude-opus" in doc["models"], "the models list includes the session's real model", doc["models"])
    chk(doc["input_tokens"] == 500 and doc["output_tokens"] == 300, "token totals are pulled from session_model_usage")

    lanes = {s["lane"] for s in doc["spans"]}
    chk("model" in lanes and "tool" in lanes and "delegation" in lanes and "user" in lanes,
        "the exported spans cover model/tool/delegation/user lanes", lanes)
    tool_span = next(s for s in doc["spans"] if s["lane"] == "tool")
    chk(tool_span["failed"] is True, "the failing tool result exports as a failed span end-to-end")

    old_file = os.path.join(out_dir, profile_dirs[0], "sOld.json")
    chk(not os.path.exists(old_file), "the out-of-scope session was never written")

    for var in ("LLM_TELEMETRY_CONFIG", "LLM_TELEMETRY_OFFLINE"):
        os.environ.pop(var, None)

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
