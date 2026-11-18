#!/usr/bin/env python3
"""Generate the Ollama probe parity fixture (T-16, LLMTELEMET-287).

Usage: make_probe_fixture.py OUT_DIR

No network and no machine dependence: both stacks answer every probe from
OUT_DIR/probe-canned.json (HTTP bodies + latencies + refused connections,
capability lists, this box's addresses and load), while the profile configs
(endpoint discovery) and state.db (local work + in-flight depth) are real
files. Topology covered:

  192.168.1.11 / ollama-lan.local  one machine under two spellings (fingerprint merge)
  192.168.1.12                     /api/ps times out (err "ps: ...")
  192.168.1.13, gpu-box.lan:8080   down hosts
  127.0.0.1 + LAN spellings        this box: loopback up, LAN twins refused -> one 'self' card
"""
import importlib.util
import json
import os
import sqlite3
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))

CONFIG_ALPHA = """\
custom_providers:
  - name: a
    base_url: http://192.168.1.11:11434/v1
  - name: b
    base_url: http://ollama-lan.local:11434/v1
  - name: c
    api: http://192.168.1.12:11434/v1
  - name: d
    base_url: http://192.168.1.13:11434
  - name: e
    base_url: http://127.0.0.1:11434/v1
  - name: f
    base_url: https://api.openai.com/v1
  - name: g
    api: http://gpu-box.lan:8080/v1
"""
CONFIG_BETA = "custom_providers:\n  - name: a\n    base_url: http://192.168.1.11:11434/v1\n"

PS_A = {"models": [
    {"name": "qwen3-coder:30b", "size": 31747607042, "size_vram": 14751293766, "context_length": 32768,
     "expires_at": "2026-11-17T20:00:00+03:00"},
    {"model": "unnamed:latest", "size": 0, "size_vram": 0, "expires_at": "2026-11-17T20:05:00+03:00"},
]}
TAGS_A = {"models": [
    {"name": "qwen3-coder:30b", "size": 18556700761, "details": {"parameter_size": "30.5B", "quantization_level": "Q4_K_M"}},
    {"name": "llama3:latest", "size": 4661224676},
    {"name": "tiny:1b", "size": 4661224676, "details": {"parameter_size": "1B"}},
]}
TAGS_C = {"models": [{"name": "other:7b", "size": 4000000000, "details": {"parameter_size": "7B"}}]}
TAGS_E = {"models": [{"name": "local-a:1b", "size": 1000}, {"name": "local-b:2b", "size": 2000}]}


def _ok(body, ms):
    return {"body": json.dumps(body), "ms": ms}


def _err(reason, url_error=True):
    return {"error": {"reason": reason, "url_error": url_error}}


CANNED = {
    "local_ips": ["127.0.0.1", "localhost", "172.17.0.1", "192.168.1.50"],
    "primary_ips": ["192.168.1.50", "172.17.0.1"],
    "load": {"cpu": 12.5, "load1": 1.0, "ncpu": 8,
             "gpus": [{"i": 0, "name": "RTX 4090", "util": 40.0, "used": 1000.0, "total": 8000.0, "temp": 55.0}],
             "gpu": 40.0, "gpu_mem": 12.5},
    "responses": {
        "http://192.168.1.11:11434/api/version": _ok({"version": "0.33.2"}, 12.4),
        "http://192.168.1.11:11434/api/ps": _ok(PS_A, 8.2),
        "http://192.168.1.11:11434/api/tags": _ok(TAGS_A, 9.9),
        "http://ollama-lan.local:11434/api/version": _ok({"version": "0.33.2"}, 450.5),
        "http://ollama-lan.local:11434/api/ps": _ok(PS_A, 300.5),
        "http://ollama-lan.local:11434/api/tags": _ok(TAGS_A, 20.0),
        "http://192.168.1.12:11434/api/version": _ok({"version": "0.30.0"}, 33.3),
        "http://192.168.1.12:11434/api/ps": _err("timed out"),
        "http://192.168.1.12:11434/api/tags": _ok(TAGS_C, 40.0),
        "http://192.168.1.13:11434/api/version": _err("[Errno 111] Connection refused"),
        "http://127.0.0.1:11434/api/version": _ok({"version": "0.33.2"}, 1.5),
        "http://127.0.0.1:11434/api/ps": _ok({"models": []}, 1.0),
        "http://127.0.0.1:11434/api/tags": _ok(TAGS_E, 2.0),
        "http://172.17.0.1:11434/api/version": _err("[Errno 111] Connection refused"),
        "http://192.168.1.50:11434/api/version": _err("[Errno 111] Connection refused"),
        "http://gpu-box.lan:8080/api/version": _err("[Errno -2] Name or service not known"),
    },
    "caps": {"qwen3-coder:30b": ["completion", "tools"]},
}


def main(argv):
    if len(argv) != 1:
        sys.stderr.write("usage: make_probe_fixture.py OUT_DIR\n")
        return 2
    spec = importlib.util.spec_from_file_location("make_analytics_fixture", os.path.join(HERE, "make_analytics_fixture.py"))
    base = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(base)
    out = os.path.abspath(argv[0])
    now = int(time.time())
    agent = os.path.join(out, "agent")
    profiles = []
    for name, yml in (("alpha", CONFIG_ALPHA), ("beta-bot", CONFIG_BETA)):
        home = os.path.join(agent, "profiles", name)
        os.makedirs(home, exist_ok=True)
        base.build_state_db(os.path.join(home, "state.db"), now)
        with open(os.path.join(home, "config.yaml"), "w", encoding="utf-8") as fh:
            fh.write(yml)
        profiles.append({"name": name, "home": home})
    con = sqlite3.connect(os.path.join(agent, "profiles", "alpha", "state.db"))
    usage = [
        # (session, model, provider, url, task, calls, in, out, last_seen_off)
        ("s-live", "llama3", "ollama", "http://192.168.1.11:11434/v1", "compression", 3, 100, 50, 20),
        ("s-root", "qwen3", "ollama", "http://ollama-lan.local:11434", "", 5, 400, 100, 3600),
        ("s-root", "tiny", "ollama", "http://127.0.0.1:11434/v1/", "", 2, 10, 5, 7200),
        ("s-root", "gpt", "openai", "https://api.openai.com/v1", "", 9, 1, 1, 60),
    ]
    for sid, model, prov, url, task, calls, i, o, off in usage:
        con.execute(
            "insert into session_model_usage (session_id, model, billing_provider, billing_base_url, task,"
            " api_call_count, input_tokens, output_tokens, first_seen, last_seen) values (?,?,?,?,?,?,?,?,?,?)",
            (sid, model, prov, url, task, calls, i, o, now - off - 10, now - off))
    con.commit()
    con.close()
    with open(os.path.join(out, "probe-canned.json"), "w", encoding="utf-8") as fh:
        json.dump(CANNED, fh)
    cfg = {"agent_home": agent, "profiles": profiles, "reports_dir": os.path.join(out, "reports")}
    with open(os.path.join(out, "config.json"), "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, indent=1)
    sys.stdout.write(out + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
