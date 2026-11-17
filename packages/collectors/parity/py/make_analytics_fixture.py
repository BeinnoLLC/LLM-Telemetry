#!/usr/bin/env python3
"""Generate the deterministic analytics parity fixture (T-15, LLMTELEMET-286).

Usage: make_analytics_fixture.py OUT_DIR

Writes, under OUT_DIR:
  config.json                       LLM_TELEMETRY_CONFIG for the Python producer
  catalog.json                      pinned price catalogue (LLM_TELEMETRY_CATALOG)
  agent/profiles/<name>/state.db    one state.db per fixture profile
  home/.local/share/llm-telemetry/analytics.db   orchestration store

Every timestamp is `now - offset` (never a fixed epoch), so the windows the
collector applies (3 days, 7 days, 30 days ...) always contain the fixture.
The content is a pure function of the offsets, so two runs a few seconds apart
differ only by the clock.
"""
import json
import os
import shutil
import sqlite3
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
SCHEMA = os.path.join(REPO, "tests", "fixtures", "state_schema.sql")
SAMPLE_CATALOG = os.path.join(REPO, "examples", "reports", "sample-catalog.json")

H = 3600
D = 86400

# (id, parent, source, title, model, started_off, ended_off, end_reason, msgs, tools,
#  tokens(in,out,cr,cw), actual_cost, est_cost, cwd, branch, last_activity_off)
SESSIONS = [
    ("s-root", None, "cli", "Fix the parser", "gpt-4o", 5 * H, 4 * H, "completed", 12, 5,
     (1000, 500, 200, 100), None, 0.12, "/home/u/repos/demo", "main", None),
    ("s-child", "s-root", "subagent", "Parser subtask", "gpt-4o", 4.5 * H, 4.2 * H, "error: boom", 4, 2,
     (300, 100, 0, 0), 0.03, 0.03, "/home/u/repos/demo", "main", None),
    ("s-cron", None, "cron", "", "qwen/qwen3-coder", 3 * H, 2.9 * H, None, 6, 1,
     (400, 200, 50, 0), None, 0.01, "/home/u/repos/other", "dev", None),
    ("s-reaped", None, "tui", "Reaped one", "gpt-4o", 26 * H, 25 * H, "startup_orphan_reap", 2, 0,
     (50, 10, 0, 0), None, 0.0, "/opt", None, None),
    ("s-live", None, "desktop", "Live session", "qwen/qwen3-coder", 1 * H, None, None, 8, 3,
     (700, 300, 100, 50), None, 0.05, "/home/u/repos/demo", "feat/x", 60),
    ("s-old", None, "cli", "Ancient", "gpt-4o", 40 * D, 40 * D - H, "completed", 3, 1,
     (80, 20, 0, 0), None, 0.01, "/home/u/repos/old", "main", None),
]

# (session, model, provider, base_url, task, calls, in, out, cr, cw, rtok, est, act, first_off, last_off)
USAGE = [
    ("s-root", "gpt-4o", "openai", "https://api.openai.com/v1", "", 6, 1000, 500, 200, 100, 0, 0.12, 0.0, 5 * H, 4 * H),
    ("s-root", "gpt-4o", "openai", "https://api.openai.com/v1", "compression", 1, 80, 20, 0, 0, 5, 0.01, 0.0, 4.6 * H, 4.5 * H),
    ("s-child", "gpt-4o", "openai", "https://api.openai.com/v1", "", 3, 300, 100, 0, 0, 0, 0.03, 0.03, 4.5 * H, 4.2 * H),
    ("s-cron", "qwen/qwen3-coder", "openrouter", "https://openrouter.ai/api/v1", "", 12, 400, 200, 50, 0, 10, 0.01, 0.0, 3 * H, 2.9 * H),
    ("s-reaped", "gpt-4o", "openai", "https://api.openai.com/v1", "", 2, 50, 10, 0, 0, 0, 0.0, 0.0, 26 * H, 25 * H),
    ("s-live", "qwen/qwen3-coder", "openrouter", "https://openrouter.ai/api/v1", "", 14, 700, 300, 100, 50, 20, 0.05, 0.0, 1 * H, 120),
    ("s-live", "llama3", "ollama", "http://192.168.1.11:11434/v1", "", 4, 90, 40, 0, 0, 0, 0.0, 0.0, 50 * 60, 90),
    ("s-old", "gpt-4o", "openai", "https://api.openai.com/v1", "", 3, 80, 20, 0, 0, 0, 0.01, 0.0, 40 * D, 40 * D - H),
]

# (session, role, content, tool_name, disposition, finish_reason, off, token_count)
MESSAGES = [
    ("s-root", "assistant", "plan", None, None, "stop", 5 * H - 60, 40),
    ("s-root", "tool", '{"command":"ls -la","exit_code":0}', "terminal", None, None, 5 * H - 120, 10),
    ("s-root", "tool", '{"command":"make test","exit_code":2,"error":"failed"}', "terminal", "failed", None, 4.9 * H, 60),
    ("s-root", "assistant", "fix", None, None, "stop", 4.8 * H, 55),
    ("s-live", "tool", "file contents", "read_file", None, None, 300, 5),
    ("s-root", "tool", '{"command":"  git   status","exit_code":"1"}', "terminal", None, None, 4.7 * H, 7),
    ("s-root", "tool", '{"output":"no command echoed","exit_code":3}', "terminal", None, None, 4.6 * H, 9),
    ("s-root", "tool", "plain text, not json", "terminal", None, None, 4.5 * H, 3),
    ("s-root", "tool", '{"success":false,"error":"x"}', "patch", None, None, 4.4 * H, 21),
    ("s-root", "tool", '{"not_found":true}', "read_file", None, None, 4.3 * H, 4),
    ("s-root", "tool", '{"error":0}', "read_file", None, "tool_error", 4.2 * H, 4),
    ("s-live", "tool", '{"success":true}', "patch", "applied", None, 200, 2),
    ("s-live", "tool", "x" * 400, "read_file", None, "timeout", 150, 8),
    ("s-root", "tool", '{"exit_code":1}', "terminal", None, None, 35 * D, 6),
    ("s-root", "tool", '{"exit_code":0}', "terminal", None, None, 36 * D, 6),
    ("s-root", "tool", '{"exit_code":0}', "web_search", None, None, 37 * D, 6),
    ("s-live", "assistant", "t1", None, None, "stop", 3000, 100),
    ("s-live", "assistant", "t2", None, None, "stop", 2900, 50),
    ("s-live", "assistant", "t3", None, None, "stop", 2700.5, 0),
    ("s-live", "assistant", "t4", None, None, "stop", 1500, 20),
    ("s-live", "assistant", "t5", None, None, "stop", 1490, None),
    ("s-live", "assistant", "t6", None, None, "stop", 600, 400),
    ("s-root", "assistant", "r2", None, None, "stop", 4.7 * H, 33),
    ("s-root", "assistant", "r3", None, None, "stop", 4.69 * H, 12),
]


def now_ts():
    return int(time.time())


def build_state_db(path, now):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        os.remove(path)
    con = sqlite3.connect(path)
    with open(SCHEMA, encoding="utf-8") as fh:
        con.executescript(fh.read())
    for (sid, parent, source, title, model, so, eo, reason, msgs, tools, tok, act, est,
         cwd, branch, la) in SESSIONS:
        started = now - int(so)
        ended = None if eo is None else now - int(eo)
        last_act = (now - int(la)) if la is not None else None
        con.execute(
            "insert into sessions (id, source, model, parent_session_id, started_at, ended_at,"
            " end_reason, message_count, tool_call_count, input_tokens, output_tokens,"
            " cache_read_tokens, cache_write_tokens, cwd, git_branch, actual_cost_usd,"
            " estimated_cost_usd, title, last_activity_at, last_activity_description)"
            " values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (sid, source, model, parent, started, ended, reason, msgs, tools, *tok, cwd, branch,
             act, est, title or None, last_act, "terminal command running" if la is not None else None))
    # compression pressure: (session, fallback_streak, ineffective_count, error, display_name)
    for sid, fb, ic, err, dn in [("s-root", 2, 1, "ctx too long", None), ("s-cron", 0, 3, None, "Nightly"),
                                 ("s-child", 1, 0, "", None), ("s-live", 0, 0, "", None),
                                 ("s-old", 5, 5, "old", None)]:
        con.execute("update sessions set compression_fallback_streak=?, compression_ineffective_count=?,"
                    " compression_failure_error=?, display_name=? where id=?", (fb, ic, err, dn, sid))
    for (sid, model, prov, url, task, calls, inp, outp, cr, cw, rt, est, act, fo, lo) in USAGE:
        con.execute(
            "insert into session_model_usage (session_id, model, billing_provider, billing_base_url,"
            " task, api_call_count, input_tokens, output_tokens, cache_read_tokens,"
            " cache_write_tokens, reasoning_tokens, estimated_cost_usd, actual_cost_usd,"
            " first_seen, last_seen) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (sid, model, prov, url, task, calls, inp, outp, cr, cw, rt, est, act,
             now - int(fo), now - int(lo)))
    for (sid, role, content, tool, disp, fin, off, tc) in MESSAGES:
        con.execute(
            "insert into messages (session_id, role, content, tool_name, effect_disposition,"
            " finish_reason, timestamp, token_count) values (?,?,?,?,?,?,?,?)",
            (sid, role, content, tool, disp, fin, now - int(off), tc))
    con.commit()
    con.close()


def build_analytics_db(home, now):
    import sys as _sys
    _sys.path.insert(0, os.path.join(REPO, "src"))
    from llm_telemetry.analytics_store import AnalyticsStore
    path = os.path.join(home, ".local", "share", "llm-telemetry", "analytics.db")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        os.remove(path)
    AnalyticsStore(path).close()
    return path


def main(argv):
    if len(argv) != 1:
        sys.stderr.write("usage: make_analytics_fixture.py OUT_DIR\n")
        return 2
    out = os.path.abspath(argv[0])
    now = now_ts()
    agent = os.path.join(out, "agent")
    profiles = []
    for name in ("alpha", "beta-bot"):
        home = os.path.join(agent, "profiles", name)
        build_state_db(os.path.join(home, "state.db"), now)
        profiles.append({"name": name, "home": home})
    home_dir = os.path.join(out, "home")
    build_analytics_db(home_dir, now)
    shutil.copyfile(SAMPLE_CATALOG, os.path.join(out, "catalog.json"))
    cfg = {"agent_home": agent, "profiles": profiles,
           "reports_dir": os.path.join(out, "reports")}
    with open(os.path.join(out, "config.json"), "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, indent=1)
    sys.stdout.write(out + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
