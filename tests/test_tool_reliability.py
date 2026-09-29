#!/usr/bin/env python3
"""P10-04 (#92): tool reliability aggregation from a real fixture DB.

Fixture: `terminal` gets 3 ok + 2 fail (one with a real command, one
unstructured but with effect_disposition='failed'), `read_file` gets 2 ok
+ 1 unknown (unstructured text result), `memory` gets 1 unknown only (no
fail_rate should be computed for it at all since confident=0). A previous-
period `terminal` row set establishes a trend baseline.
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


def insert_msg(con, sid, tool_name, ts, content, effect_disposition=None,
               finish_reason=None, token_count=0):
    con.execute(
        """insert into messages(session_id, role, tool_name, timestamp, content,
           effect_disposition, finish_reason, token_count)
           values(?,?,?,?,?,?,?,?)""",
        (sid, "tool", tool_name, ts, content, effect_disposition, finish_reason, token_count))


def make_home(home):
    os.makedirs(home, exist_ok=True)
    con = sqlite3.connect(os.path.join(home, "state.db"))
    con.executescript(open(os.path.join(ROOT, "tests", "fixtures", "state_schema.sql")).read())

    con.execute("insert into sessions(id, source, started_at) values('sx', 'cli', ?)", (int(time.time()),))

    now = int(time.time())
    recent = now - 3600
    prev = now - (45 * 86400)  # inside the 30-60 day-ago previous window

    # terminal: 3 ok, 2 fail (one with a command, one via effect_disposition).
    insert_msg(con, "sx", "terminal", recent, json.dumps({"output": "ok\n", "exit_code": 0}), token_count=50)
    insert_msg(con, "sx", "terminal", recent, json.dumps({"output": "done\n", "exit_code": 0, "command": "pnpm test"}), token_count=200)
    insert_msg(con, "sx", "terminal", recent, json.dumps({"output": "ok\n", "exit_code": 0}), token_count=30)
    insert_msg(con, "sx", "terminal", recent, json.dumps({"output": "fail\n", "exit_code": 1, "command": "pnpm build"}), token_count=1000)
    insert_msg(con, "sx", "terminal", recent, "unstructured but flagged bad", effect_disposition="failed", token_count=500)

    # read_file: 2 ok, 1 unknown (unstructured plain text with no signal).
    insert_msg(con, "sx", "read_file", recent, json.dumps({"content": "hi", "not_found": False}))
    insert_msg(con, "sx", "read_file", recent, json.dumps({"content": "hi2", "not_found": False}))
    insert_msg(con, "sx", "read_file", recent, "plain content dump with no structure")
    # Pad read_file with MORE calls than terminal (8 extra oks) so a sort by
    # raw call count would rank read_file above terminal — only a sort by
    # cost-of-failures correctly keeps terminal on top despite fewer calls.
    for _ in range(8):
        insert_msg(con, "sx", "read_file", recent, json.dumps({"content": "hi3", "not_found": False}))

    # memory: 1 unknown only — confident=0, so fail_rate must be None, not 0.
    insert_msg(con, "sx", "memory", recent, "Saved 1 entry to memory.")

    # Previous-period terminal: 1 ok, 1 fail (50% baseline vs this period's
    # higher rate — sets up a real trend to assert against).
    insert_msg(con, "sx", "terminal", prev, json.dumps({"output": "ok\n", "exit_code": 0}))
    insert_msg(con, "sx", "terminal", prev, json.dumps({"output": "bad\n", "exit_code": 1}))

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

    tools = {t["name"]: t for t in prof.get("tools", [])}
    chk("terminal" in tools, "terminal appears in the tools payload")
    chk("read_file" in tools, "read_file appears in the tools payload")
    chk("memory" in tools, "memory appears in the tools payload")

    term = tools.get("terminal", {})
    chk(term.get("calls") == 5, "terminal calls is 5 (all rows count, including the effect_disposition-only one)", term.get("calls"))
    chk(term.get("fails") == 2, "terminal fails is 2", term.get("fails"))
    chk(abs((term.get("fail_rate") or -1) - 0.4) < 1e-6, "terminal fail_rate is 2/5 = 0.4", term.get("fail_rate"))
    chk(term.get("tok_wasted") == 1500, "terminal tok_wasted sums the token_count of ONLY the failing rows (1000+500)", term.get("tok_wasted"))
    chk(abs((term.get("prev_fail_rate") or -1) - 0.5) < 1e-6, "terminal prev_fail_rate is 1/2 = 0.5 from the previous-period fixture", term.get("prev_fail_rate"))

    read = tools.get("read_file", {})
    chk(read.get("calls") == 11, "read_file calls is 11 (2 ok + 1 unknown + 8 padding oks)", read.get("calls"))
    chk(read.get("fails") == 0, "read_file fails is 0", read.get("fails"))
    chk(read.get("fail_rate") == 0.0, "read_file fail_rate is 0.0 (2 confident ok, 0 fail)", read.get("fail_rate"))

    mem = tools.get("memory", {})
    chk(mem.get("calls") == 1, "memory calls is 1", mem.get("calls"))
    chk(mem.get("fail_rate") is None,
        "memory fail_rate is None (zero CONFIDENT predictions — an all-unknown tool must not silently read as 0% failure)",
        mem.get("fail_rate"))

    # Sort order: cost of failures (tok_wasted), not fail count or fail rate.
    tools_list = prof.get("tools", [])
    chk(tools_list[0]["name"] == "terminal",
        "the tools list is sorted by cost-of-failures (tok_wasted) — terminal (1500) ranks above read_file/memory (0)",
        [t["name"] for t in tools_list])

    # Terminal command breakdown: only the command-carrying failure counts,
    # and the effect_disposition-only failure (no command field) falls back
    # to '(unknown)' rather than a guessed command.
    cmds = {c["cmd"]: c["n"] for c in prof.get("terminal_top_fail_commands", [])}
    chk(cmds.get("pnpm") == 1, "the 'pnpm build' failure is attributed to the 'pnpm' command", cmds)
    chk(cmds.get("(unknown)") == 1,
        "the unstructured failing terminal row (no command field) falls back to '(unknown)', not a guess", cmds)

    # Fail samples: heads captured, real session id, never innerHTML-shaped
    # (this is a payload assertion — the UI's own escaping is tested in the
    # jsdom suite, not here).
    samples = prof.get("tool_fail_samples", {}).get("terminal", [])
    chk(len(samples) == 2, "exactly 2 terminal fail samples are recorded", len(samples))
    chk(all(s["session"] == "sx" for s in samples), "each fail sample carries the real session id")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
