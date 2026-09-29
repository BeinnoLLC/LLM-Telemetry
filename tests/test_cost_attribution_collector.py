#!/usr/bin/env python3
"""P10-07 (#95): cost_attribution against a real fixture DB, through the
real collect_analytics.build() end-to-end — checks the payload key exists
and sum(by_source) equals the range total on the ACTUAL collector output,
per the ticket's own verification criterion.
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


def usage_row(con, sid, model, prov, url, calls, inp, outp, cost=0.0):
    con.execute("""insert into session_model_usage(session_id, model, billing_provider,
        billing_base_url, task, api_call_count, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, reasoning_tokens,
        estimated_cost_usd, actual_cost_usd, last_seen)
        values(?,?,?,?,'main',?,?,?,0,0,0,?,?,?)""",
        (sid, model, prov, url, calls, inp, outp, cost, cost, 1790000000))


with tempfile.TemporaryDirectory() as root:
    home = os.path.join(root, "agent")
    os.makedirs(home, exist_ok=True)
    con = sqlite3.connect(os.path.join(home, "state.db"))
    con.executescript(open(os.path.join(ROOT, "tests", "fixtures", "state_schema.sql")).read())

    con.execute("insert into sessions(id, source, started_at, title) values('desk1', 'desktop', 1790000000, 'Desktop work')")
    con.execute("insert into sessions(id, source, started_at, display_name) values('cron1', 'cron', 1790000000, 'nightly-backup')")
    con.execute("insert into sessions(id, source, started_at, display_name) values('cron2', 'cron', 1790000000, 'nightly-backup')")
    con.execute("insert into sessions(id, source, started_at, parent_session_id, title) values('sub1', 'subagent', 1790000000, 'desk1', 'sub of desk1')")
    con.execute("insert into messages(session_id, role, tool_name, timestamp, token_count) values('desk1','tool','read_file',1790000010,20000)")

    usage_row(con, "desk1", "qwen3-coder:30b", "ollama", "http://127.0.0.1:11434/v1", 5, 10000, 5000, cost=1.0)
    usage_row(con, "cron1", "qwen3-coder:30b", "ollama", "http://127.0.0.1:11434/v1", 3, 2000, 1000, cost=0.05)
    usage_row(con, "cron2", "qwen3-coder:30b", "ollama", "http://127.0.0.1:11434/v1", 3, 2000, 1000, cost=0.06)
    usage_row(con, "sub1", "qwen3-coder:30b", "ollama", "http://127.0.0.1:11434/v1", 2, 1000, 500, cost=0.02)
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
    chk("attribution" in prof, "the payload carries the new attribution key")
    attrib = prof["attribution"]
    chk(set(attrib.keys()) == {"by_source", "by_root", "by_cron", "by_tool"},
        "attribution has exactly the 4 documented sub-keys", set(attrib.keys()))

    total_range = sum(rr.get("market_value_usd", 0.0) for rr in prof["rows"])
    total_by_source = sum(b["cost"] for b in attrib["by_source"])
    chk(abs(total_range - total_by_source) < 1e-6,
        f"sum(by_source) equals the range total on the REAL collector payload: {total_by_source} == {total_range}")

    sources = {b["source"] for b in attrib["by_source"]}
    chk("desktop" in sources and "cron" in sources and "subagent" in sources,
        "by_source covers desktop/cron/subagent from the real sessions table", sources)

    desk_root = next((b for b in attrib["by_root"] if b["id"] == "desk1"), None)
    chk(desk_root is not None, "desk1 appears as a root in by_root")
    chk(desk_root is not None and desk_root["descendants"] > 0,
        "desk1's descendants include sub1's real cost, walked through the real sessions table")

    nightly = next((b for b in attrib["by_cron"] if b["name"] == "nightly-backup"), None)
    chk(nightly is not None and nightly["runs"] == 2,
        "the two real cron1/cron2 sessions group under one 'nightly-backup' job name")

    read_file_tool = next((b for b in attrib["by_tool"] if b["tool"] == "read_file"), None)
    chk(read_file_tool is not None and read_file_tool["tokens"] == 20000,
        "the real read_file tool-result message's token_count is attributed to by_tool")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
