#!/usr/bin/env python3
"""P9-03 (#80): the per-session context re-send list the collector emits.

Runs the real collector against a temporary agent home built from the REAL
agent schema (tests/fixtures/state_schema.sql), never the developer's
~/.hermes. Checks the SQL, the minimum-calls rule, and that re-sent cost
reconciles with pricing.price_row() -- the same function behind the Cost view.
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
sys.path.insert(0, os.path.join(ROOT, "src"))

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{('  ' + str(extra)) if extra is not None else ''}")
    if ok:
        p += 1
    else:
        f += 1


NOW = int(time.time())
# (session, title, model, provider, url, calls, input, cache_write, cache_read, age_days)
SESSIONS = [
    ("big",   "Refactor the parser", "claude-opus-5", "anthropic", "https://api.anthropic.com", 400, 20000, 300000, 60000000, 1),
    ("mid",   "Write docs",          "claude-opus-5", "anthropic", "https://api.anthropic.com", 50,  5000,  40000,  2000000,  2),
    ("local", "Local run",           "qwen3-coder:30b", "custom", "http://127.0.0.1:11434/v1", 80,  900000, 0,      0,        1),
    ("tiny",  "Quick question",      "claude-opus-5", "anthropic", "https://api.anthropic.com", 3,   900,   9000,   9000000,  1),
    ("old",   "Last quarter",        "claude-opus-5", "anthropic", "https://api.anthropic.com", 500, 9000,  90000,  90000000, 45),
]


def make_home(root):
    d = os.path.join(root, "agent")
    os.makedirs(d, exist_ok=True)
    con = sqlite3.connect(os.path.join(d, "state.db"))
    con.executescript(open(os.path.join(ROOT, "tests", "fixtures", "state_schema.sql")).read())
    for sid, title, model, prov, url, calls, inp, cw, cr, age in SESSIONS:
        ts = NOW - age * 86400
        con.execute("insert into sessions(id, source, started_at, title) values(?, 'cli', ?, ?)", (sid, ts, title))
        con.execute("""insert into session_model_usage(session_id, model, billing_provider,
            billing_base_url, task, api_call_count, input_tokens, output_tokens,
            cache_read_tokens, cache_write_tokens, reasoning_tokens,
            estimated_cost_usd, actual_cost_usd, first_seen, last_seen)
            values(?,?,?,?,'main',?,?,100,?,?,0,0,0,?,?)""",
                    (sid, model, prov, url, calls, inp, cr, cw, ts, ts))
    con.commit()
    con.close()
    return d


with tempfile.TemporaryDirectory() as t:
    home = make_home(t)
    cfg = os.path.join(t, "cfg.json")
    json.dump({"reports_dir": t, "agent_home": home, "profiles": [{"name": "p", "home": home}]}, open(cfg, "w"))
    env = {**os.environ, "LLM_TELEMETRY_CONFIG": cfg, "LLM_TELEMETRY_OFFLINE": "1"}
    env.pop("LLM_TELEMETRY_AGENT_HOME", None)
    out = os.path.join(t, "a.json")
    r = subprocess.run([PY, "-m", "llm_telemetry.collect_analytics", "-o", out],
                       cwd=ROOT, env=env, capture_output=True, text=True, timeout=240)
    chk(r.returncode == 0, "collector runs on the real schema", r.stderr[-400:] if r.returncode else None)
    d = json.load(open(out))
    prof = next(iter(d["profiles"].values()))
    rs = prof.get("resend")
    chk(isinstance(rs, list), "payload carries a resend list")
    by = {x["id"]: x for x in rs or []}

    chk("tiny" not in by, "a session under the minimum calls is left out")
    chk("old" not in by, "a session older than 30 days is left out")
    chk({"big", "mid", "local"} <= set(by), "qualifying sessions are present", sorted(by))

    b = by.get("big", {})
    prompt = 20000 + 300000 + 60000000
    chk(b.get("ctx_per_call") == round(prompt / 400), "avg context = (input + cache write + cache read) / calls",
        b.get("ctx_per_call"))
    chk(b.get("cread_pct") == round(100.0 * 60000000 / prompt, 1), "cached share = cache read / prompt",
        b.get("cread_pct"))
    chk(b.get("title") == "Refactor the parser", "session title carried through")

    from llm_telemetry import pricing
    cat = pricing.fetch_catalog()[0]
    want = pricing.price_row({"provider": "anthropic", "model": "claude-opus-5",
                              "base_url": "https://api.anthropic.com",
                              "input_tokens": 0, "output_tokens": 0, "cache_read": 60000000}, cat)
    chk(abs(b.get("resend_usd", -1) - want["market_value_usd"]) < 1e-9,
        "re-sent cost reconciles with price_row() on the cache-read tokens",
        (b.get("resend_usd"), want["market_value_usd"]))

    loc = by.get("local", {})
    chk(loc.get("cost_class") == "local" and loc.get("cread_pct") == 0.0,
        "a local session is classed local with no cache share", (loc.get("cost_class"), loc.get("cread_pct")))

    costs = [x["resend_usd"] for x in rs]
    chk(costs == sorted(costs, reverse=True), "sorted by re-sent cost, worst first")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
