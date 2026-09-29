#!/usr/bin/env python3
"""P10-12 (#100): collect_session_index.py -- real fixture DB + the real
collect_analytics.build() end-to-end, per this project's own pattern.
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


with tempfile.TemporaryDirectory() as root:
    home = os.path.join(root, "agent")
    os.makedirs(home, exist_ok=True)
    con = sqlite3.connect(os.path.join(home, "state.db"))
    con.executescript(open(os.path.join(ROOT, "tests", "fixtures", "state_schema.sql")).read())

    now = 1790000000
    con.execute("""insert into sessions(id, source, started_at, ended_at, title, model,
        git_branch, cwd, end_reason, actual_cost_usd)
        values('s_opus_patch', 'desktop', ?, ?, 'Refactor the router', 'claude-opus-5',
        'feature/router', '/home/user/workspace/nowinv', 'user_close', 2.4500)""",
        (now - 3600, now - 1800))
    con.execute("""insert into sessions(id, source, started_at, ended_at, title, model,
        git_branch, cwd, end_reason, estimated_cost_usd)
        values('s_glm_terminal', 'subagent', ?, ?, 'Fix the flaky test', 'glm-5.3',
        'main', '/home/user/workspace/ahwa', 'startup_orphan_reap', 0.0800)""",
        (now - 7200, now - 6800))
    con.execute("""insert into sessions(id, source, started_at, ended_at, title, model)
        values('s_no_tools', 'desktop', ?, ?, 'Just chatting', 'claude-opus-5')""",
        (now - 900, now - 500))

    def msg(sid, tool, ts):
        con.execute("insert into messages(session_id, role, tool_name, timestamp, active) "
                    "values(?, 'tool', ?, ?, 1)", (sid, tool, ts))

    msg("s_opus_patch", "patch", now - 3500)
    msg("s_opus_patch", "terminal", now - 3400)
    msg("s_opus_patch", "patch", now - 3300)  # duplicate tool name -- must dedupe
    msg("s_glm_terminal", "terminal", now - 7100)
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
    idx = doc["profiles"]["default"]["session_index"]
    chk(len(idx) == 3, "all 3 fixture sessions appear in the real payload", len(idx))

    by_id = {r["id"]: r for r in idx}
    op = by_id.get("s_opus_patch")
    chk(op is not None, "the opus/patch session appears")
    chk(op and op["title"] == "Refactor the router", "its real title comes through unchanged")
    chk(op and op["tools"] == ["patch", "terminal"],
        "its tool list is deduped and sorted (3 tool_name rows -> 2 unique)", op["tools"] if op else None)
    chk(op and op["branch"] == "feature/router", "its real git_branch comes through")
    chk(op and op["cwd_tail"] == "workspace/nowinv",
        "cwd is truncated to its last 2 segments, not the full path", op["cwd_tail"] if op else None)
    chk(op and op["cost"] == 2.45, "actual_cost_usd is preferred over estimated when both could apply")
    chk(op and op["dur"] == 1800, "duration is ended_at - started_at in whole seconds", op["dur"] if op else None)

    glm = by_id.get("s_glm_terminal")
    chk(glm and glm["end"] == "startup_orphan_reap", "the real end_reason comes through unchanged")
    chk(glm and glm["cost"] == 0.08, "estimated_cost_usd is used when actual is NULL")
    chk(glm and glm["source"] == "subagent", "the real source field comes through")

    no_tools = by_id.get("s_no_tools")
    chk(no_tools is not None and no_tools["tools"] == [],
        "a session with zero tool calls gets an EMPTY tools list, not null/crash")
    chk(no_tools is not None and no_tools["branch"] == "" and no_tools["cwd_tail"] == "",
        "missing git_branch/cwd fields degrade to empty strings, never null/None leaking into JSON")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
