#!/usr/bin/env python3
"""agent-worker sessions under per-login homes (~/.hermes/agent-logins/<login>/claude)
are discovered; the default home alone missed them (Home feedback audit)."""
import json, os, sys, tempfile, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
os.environ.setdefault("LLM_TELEMETRY_CONFIG",
                      os.path.join(os.path.dirname(__file__), "..", "examples", "sample-config.json"))
from pathlib import Path
from llm_telemetry import collect_agent_worker_live as W

p = f = 0
def chk(ok, msg):
    global p, f
    print(("  OK   " if ok else "  FAIL ") + msg); p, f = (p + 1, f) if ok else (p, f + 1)

with tempfile.TemporaryDirectory() as td:
    root = Path(td) / "logins"
    sess = root / "acme" / "claude" / "projects" / "-w-proj" / "11111111-1111-1111-1111-111111111111.jsonl"
    sess.parent.mkdir(parents=True)
    now = time.time()
    sess.write_text(json.dumps({"type": "assistant", "sessionId": "s1", "cwd": "/w/proj",
                                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
                                "message": {"model": "claude-x", "content": [{"type": "text", "text": "hi"}]}}) + "\n")
    empty_default = Path(td) / "none"
    os.environ["LLM_TELEMETRY_CLAUDE_HOME"] = str(empty_default)
    os.environ["LLM_TELEMETRY_CODEX_HOME"] = str(empty_default)
    os.environ["LLM_TELEMETRY_AGENT_LOGINS"] = str(root)
    chk([h.name for h in W.login_homes("claude")] == ["claude"], "login_homes finds <login>/claude")
    rows = W.build_agent_live(now=now)
    chk(len(rows) == 1 and rows[0]["engine"] == "claude", "a session under a login home is reported live")
    chk(W.build_agent_live(claude_home=empty_default, codex_home=empty_default, now=now) == [],
        "negative control: explicit homes are authoritative (login homes not scanned)")
    os.environ["LLM_TELEMETRY_AGENT_LOGINS"] = ""
    chk(W.build_agent_live(now=now) == [], "negative control: empty LLM_TELEMETRY_AGENT_LOGINS disables login-home scanning")
print(f"\n{p} passed, {f} failed"); sys.exit(1 if f else 0)
