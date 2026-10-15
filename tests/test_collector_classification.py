#!/usr/bin/env python3
"""P3-02 (#32): the two collector paths #32 names that had no test at all --
inflight() queue depth and the local-vs-hosted classification matrix (bare
IP, localhost, LAN hostname, hosted API URL). Cost maths and date-range
filtering already have their own dedicated tests (test_local_cost.py,
test_project_rows.py's date-window checks); this file is the piece #32
explicitly named that neither of those covers.

Real fixture SQLite DB (tests/fixtures/state_schema.sql), the real
inflight() and price_row() functions -- no reimplementation.
"""
import json
import os
import sqlite3
import subprocess
import sys
import tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
PY = sys.executable
sys.path.insert(0, os.path.join(ROOT, "src"))

from llm_telemetry import pricing as P

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{('  ' + str(extra)) if extra is not None else ''}")
    if ok:
        p += 1
    else:
        f += 1


CATALOG = {}


def classify(base_url):
    row = {"provider": "custom", "base_url": base_url, "model": "qwen3-coder:30b",
           "input_tokens": 1000, "output_tokens": 500, "cache_read_tokens": 0,
           "cache_write_tokens": 0}
    return P.price_row(row, CATALOG)


def classify_model(base_url, model, provider="custom"):
    row = {"provider": provider, "base_url": base_url, "model": model,
           "input_tokens": 1000, "output_tokens": 500, "cache_read_tokens": 0,
           "cache_write_tokens": 0}
    return P.price_row(row, CATALOG)


bare_ip = classify("http://192.168.1.12:11434/v1")
chk(bare_ip["cost_class"] == "local", "a bare LAN IP (192.168.1.12) classifies as local (electricity-costed)", bare_ip["cost_class"])

lh = classify("http://127.0.0.1:11434/v1")
chk(lh["cost_class"] == "local", "127.0.0.1 (localhost by IP) classifies as local", lh["cost_class"])

lh2 = classify("http://localhost:11434/v1")
chk(lh2["cost_class"] == "local", "the literal hostname 'localhost' classifies as local", lh2["cost_class"])

lan_host = classify("http://llmstudio1.hazemhagrass.com:11434/v1")
chk(lan_host["cost_class"] == "local",
    "a named LAN hostname still resolves via the MODEL name being a known local model, "
    "independent of whether the endpoint URL itself matched a LAN pattern", lan_host["cost_class"])

hosted = classify_model("https://api.fireworks.ai/inference/v1", "accounts/fireworks/models/llama-v3-70b")
chk(hosted["cost_class"] == "metered", "a real hosted API URL (fireworks.ai) classifies as metered, never local",
    hosted["cost_class"])

cloud = classify_model("https://ollama.com/v1", "deepseek-v4.1-flash")
chk(cloud["cost_class"] == "metered", "ollama.com (Ollama Cloud) classifies as metered, never local (issue #118)",
    cloud["cost_class"])

unnamed = classify_model("http://llmstudio1.hazemhagrass.com:11434/v1", "some-unlisted-model", provider="")
chk(unnamed["cost_class"] != "local",
    "an UNCONFIGURED named LAN hostname running an UNKNOWN model does NOT silently classify as local -- "
    "local_host_patterns must be configured for it, by design", unnamed["cost_class"])

_orig_patterns = P._local_patterns
try:
    P._local_patterns = lambda: ["127.0.0.1", "localhost", "192.168.", "10.", "172.", "llmstudio1.hazemhagrass.com"]
    configured = classify_model("http://llmstudio1.hazemhagrass.com:11434/v1", "some-unlisted-model", provider="")
    chk(configured["cost_class"] == "local",
        "once the LAN hostname is added to local_host_patterns, that SAME unknown-model host DOES resolve to local",
        configured["cost_class"])
finally:
    P._local_patterns = _orig_patterns

with tempfile.TemporaryDirectory() as root:
    home = os.path.join(root, "agent")
    os.makedirs(home, exist_ok=True)
    con = sqlite3.connect(os.path.join(home, "state.db"))
    con.executescript(open(os.path.join(ROOT, "tests", "fixtures", "state_schema.sql")).read())

    import time
    now = int(time.time())
    rows = [
        ("s_open_recent", None, "http://192.168.1.12:11434/v1", -5),
        ("s_open_recent2", None, "http://192.168.1.12:11434/v1", -10),
        ("s_open_stale", None, "http://192.168.1.12:11434/v1", -600),
        ("s_closed", now - 30, "http://192.168.1.12:11434/v1", -5),
        ("s_other_host", None, "http://192.168.1.30:11434/v1", -3),
    ]
    for sid, ended, url, offset in rows:
        con.execute("insert into sessions(id, source, started_at, ended_at, title) "
                    "values(?, 'desktop', ?, ?, ?)", (sid, now - 3600, ended, f"session {sid}"))
        con.execute("insert into session_model_usage(session_id, model, billing_provider, "
                    "billing_base_url, task, api_call_count, input_tokens, output_tokens, "
                    "cache_read_tokens, cache_write_tokens, reasoning_tokens, "
                    "estimated_cost_usd, actual_cost_usd, last_seen) "
                    "values (?,'qwen3-coder:30b','custom',?,'main',1,100,50,0,0,0,0,0,?)",
                    (sid, url, now + offset))
    con.commit()
    con.close()

    cfg = os.path.join(root, "cfg.json")
    with open(cfg, "w") as fh:
        json.dump({"profiles": [{"name": "default", "home": home}],
                    "reports_dir": os.path.join(root, "r")}, fh)

    script = (
        "import sys; sys.path.insert(0, %r)\n"
        "from llm_telemetry import probe_hosts as PH\n"
        "import json; print(json.dumps(PH.inflight()))\n"
    ) % os.path.join(ROOT, "src")
    env = {**os.environ, "LLM_TELEMETRY_CONFIG": cfg,
           "LLM_TELEMETRY_AGENT_HOME": os.path.join(root, "empty_agent_home")}
    os.makedirs(env["LLM_TELEMETRY_AGENT_HOME"], exist_ok=True)
    r = subprocess.run([PY, "-c", script], cwd=ROOT, env=env, capture_output=True, text=True, timeout=60)
    if r.returncode:
        print(r.stderr[-2000:])
    chk(r.returncode == 0, "the real inflight() runs end-to-end against the fixture DB")
    flying = json.loads(r.stdout) if r.returncode == 0 else {}

    chk(flying.get("http://192.168.1.12:11434") == 2,
        "inflight() counts exactly the 2 OPEN sessions with a recent last_seen on that host "
        "(the stale >90s one and the closed one are both excluded)", flying)
    chk(flying.get("http://192.168.1.30:11434") == 1,
        "a different host gets its own separate bucket, not merged into the first", flying)
    chk(len(flying) == 2, "no phantom hosts appear -- exactly the 2 real hosts with genuine in-flight calls", flying)

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
