#!/usr/bin/env python3
"""Claude Code / Codex live sessions: tokens counted, API-price equivalent
priced from the pricing table, flagged subscription-covered.

Fixtures live in a tmp dir (never ~/.claude / ~/.codex); rates come from the
committed sample catalogue so the expected dollars are exact."""
import datetime
import json
import os
import sys
import tempfile
import time

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "src"))
os.environ["LLM_TELEMETRY_CONFIG"] = os.path.join(ROOT, "examples", "sample-config.json")
os.environ["LLM_TELEMETRY_CATALOG"] = os.path.join(ROOT, "examples", "reports", "sample-catalog.json")
from llm_telemetry.collect_agent_worker_live import build_agent_live

p = f = 0


def chk(ok, msg, extra=None):
    global p, f
    print(("  OK   " if ok else "  FAIL ") + msg + (f"  ({extra})" if extra is not None else ""))
    p, f = (p + 1, f) if ok else (p, f + 1)


def iso(t):
    return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def write(path, events, mtime):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        for ev in events:
            fh.write(json.dumps(ev) + "\n")
    os.utime(path, (mtime, mtime))


def asst(now, mid, usage, model="claude-opus-4-5"):
    return {"type": "assistant", "cwd": "w/alpha", "timestamp": iso(now - 10),
            "message": {"id": mid, "role": "assistant", "model": model,
                        "content": [{"type": "text", "text": "x"}], "usage": usage}}


now = time.time()
with tempfile.TemporaryDirectory() as tmp:
    ch, xh = os.path.join(tmp, "claude"), os.path.join(tmp, "codex")
    # msg m1 streams as two records repeating usage (last wins); m2 is a second turn.
    # m1 final: in 1000 out 2000 cache_read 5000 cache_write 400 ; m2: in 500 out 100
    write(os.path.join(ch, "projects", "-w-alpha", "aaaaaaaa-1111.jsonl"), [
        asst(now, "m1", {"input_tokens": 1000, "output_tokens": 1}),
        asst(now, "m1", {"input_tokens": 1000, "output_tokens": 2000,
                         "cache_read_input_tokens": 5000, "cache_creation_input_tokens": 400}),
        asst(now, "m2", {"input_tokens": 500, "output_tokens": 100}),
    ], now - 2)
    # a Claude session whose model has no price anywhere: tokens yes, cost null
    write(os.path.join(ch, "projects", "-w-beta", "bbbbbbbb-2222.jsonl"), [
        asst(now, "u1", {"input_tokens": 70, "output_tokens": 30}, model="mystery-model-9")], now - 2)
    # Codex: cumulative total_token_usage; input includes the 4000 cached
    write(os.path.join(xh, "sessions", "2026", "10", "27",
                       "rollout-2026-10-27T00-00-00-0199aaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl"), [
        {"timestamp": iso(now - 30), "type": "session_meta",
         "payload": {"id": "0199aaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "cwd": "w/gamma", "model": "gpt-5.3-codex"}},
        {"timestamp": iso(now - 20), "type": "event_msg", "payload": {"type": "token_count", "info": {
            "total_token_usage": {"input_tokens": 1000, "cached_input_tokens": 0, "output_tokens": 10}}}},
        {"timestamp": iso(now - 5), "type": "event_msg", "payload": {"type": "token_count", "info": {
            "total_token_usage": {"input_tokens": 10000, "cached_input_tokens": 4000,
                                  "output_tokens": 500, "total_tokens": 10500}}}},
    ], now - 2)

    by = {s["session_id"]: s for s in build_agent_live(claude_home=ch, codex_home=xh, now=now)}
    a = by["aaaaaaaa-1111"]
    chk(a["in_tok"] == 1500 and a["out_tok"] == 2100, "claude: input/output tokens counted, streamed id deduped",
        (a["in_tok"], a["out_tok"]))
    chk(a["cache_read_tok"] == 5000 and a["cache_write_tok"] == 400, "claude: cache tokens counted",
        (a["cache_read_tok"], a["cache_write_tok"]))
    # opus-4.5 sample rates: 5/M in, 25/M out, 0.5/M cache read, cache write 1.25x in
    exp = 1500 * 5e-6 + 2100 * 25e-6 + 5000 * 0.5e-6 + 400 * 1.25 * 5e-6
    chk(abs(a["cost_usd"] - round(exp, 4)) < 1e-9, "claude: API-equivalent from the pricing table",
        (a["cost_usd"], round(exp, 4)))
    chk(a["cost_class"] == "subscription", "claude: flagged subscription-covered", a["cost_class"])

    g = by["0199aaaa-bbbb-cccc-dddd-eeeeeeeeeeee"]
    chk(g["in_tok"] == 6000 and g["out_tok"] == 500 and g["cache_read_tok"] == 4000,
        "codex: newest cumulative total, cached split out of input",
        (g["in_tok"], g["out_tok"], g["cache_read_tok"]))
    expc = 6000 * 1.75e-6 + 500 * 14e-6 + 4000 * 0.175e-6
    chk(abs(g["cost_usd"] - round(expc, 4)) < 1e-9, "codex: API-equivalent from the pricing table",
        (g["cost_usd"], round(expc, 4)))
    chk(g["cost_class"] == "subscription", "codex: flagged subscription-covered")

    b = by["bbbbbbbb-2222"]
    chk(b["in_tok"] == 70 and b["out_tok"] == 30, "unpriced model: tokens still counted")
    chk(b["cost_usd"] is None and b["cost_class"] == "subscription",
        "unpriced model: cost null (not a real $0), still flagged covered", b["cost_usd"])

    # incremental re-read: appending a record grows the totals, nothing double counts
    with open(os.path.join(ch, "projects", "-w-alpha", "aaaaaaaa-1111.jsonl"), "a") as fh:
        fh.write(json.dumps(asst(now, "m3", {"input_tokens": 10, "output_tokens": 20})) + "\n")
    a2 = {s["session_id"]: s for s in build_agent_live(claude_home=ch, codex_home=xh, now=now)}["aaaaaaaa-1111"]
    chk(a2["in_tok"] == 1510 and a2["out_tok"] == 2120, "claude: appended turn added once (incremental)",
        (a2["in_tok"], a2["out_tok"]))

print(f"\ntest_agent_worker_cost.py  {p} passed, {f} failed")
sys.exit(1 if f else 0)
