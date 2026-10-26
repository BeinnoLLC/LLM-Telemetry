#!/usr/bin/env python3
"""collect_agent_worker_live.build_agent_live: live Claude Code + Codex sessions.

Fixture transcripts are written to a tmp dir (never ~/.claude / ~/.codex).
Covers discovery per engine, mtime staleness, model (null when unnamed, never
guessed), phase derivation, env overrides, and -- most importantly -- that no
message text or tool arguments leak into the result.
"""
import datetime
import json
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
os.environ.setdefault("LLM_TELEMETRY_CONFIG",
                      os.path.join(os.path.dirname(__file__), "..", "examples", "sample-config.json"))
from llm_telemetry.collect_agent_worker_live import build_agent_live

p = f = 0
SECRET_PROMPT = "SECRET-PROMPT-do-not-leak"
SECRET_ARG = "SECRET-ARG-rm -rf /tmp/xyz"
SECRET_REPLY = "SECRET-REPLY-assistant-prose"


def chk(ok, msg, extra=None):
    global p, f
    tail = f"  ({extra})" if extra is not None else ""
    print(("  OK   " if ok else "  FAIL ") + msg + tail)
    p, f = (p + 1, f) if ok else (p, f + 1)


def iso(t):
    return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def write(path, events, mtime):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        for ev in events:
            fh.write(json.dumps(ev) + "\n")
    os.utime(path, (mtime, mtime))


def claude_events(now, cwd, last_content, model="claude-opus-4-5"):
    return [
        {"type": "user", "cwd": cwd, "sessionId": "x", "timestamp": iso(now - 60),
         "message": {"role": "user", "content": SECRET_PROMPT}},
        {"type": "assistant", "cwd": cwd, "timestamp": iso(now - 30),
         "message": {"role": "assistant", "model": model, "content": [{"type": "text", "text": SECRET_REPLY}]}},
        {"type": "assistant", "cwd": cwd, "timestamp": iso(now - 10),
         "message": {"role": "assistant", "model": model, "content": last_content}},
    ]


def codex_events(now, cwd, last_item, model="gpt-5-codex", meta_model=None):
    meta = {"id": "0199aaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "cwd": cwd}
    if meta_model:
        meta["model"] = meta_model
    evs = [
        {"timestamp": iso(now - 60), "type": "session_meta", "payload": meta},
        {"timestamp": iso(now - 50), "type": "response_item",
         "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": SECRET_PROMPT}]}},
    ]
    if model:
        evs.append({"timestamp": iso(now - 40), "type": "turn_context", "payload": {"cwd": cwd, "model": model}})
    evs.append({"timestamp": iso(now - 10), "type": last_item[0], "payload": last_item[1]})
    return evs


now = time.time()
with tempfile.TemporaryDirectory() as tmp:
    ch, xh = os.path.join(tmp, "claude"), os.path.join(tmp, "codex")

    # ---- Claude: in-flight tool call, with a secret in the tool input -------
    write(os.path.join(ch, "projects", "-work-alpha", "aaaaaaaa-1111.jsonl"),
          claude_events(now, "/work/alpha", [{"type": "tool_use", "name": "Bash", "id": "t1",
                                               "input": {"command": SECRET_ARG}}]), now - 5)
    # Claude: thinking only, no model-in-doubt
    write(os.path.join(ch, "projects", "-work-beta", "bbbbbbbb-2222.jsonl"),
          claude_events(now, "/work/beta", [{"type": "thinking", "thinking": SECRET_REPLY}]), now - 20)
    # Claude: stale (outside window) must be dropped
    write(os.path.join(ch, "projects", "-work-old", "cccccccc-3333.jsonl"),
          claude_events(now, "/work/old", [{"type": "text", "text": "x"}]), now - 3600)
    # Claude: transcript that never names a model -> null
    write(os.path.join(ch, "projects", "-work-nomodel", "dddddddd-4444.jsonl"),
          [{"type": "user", "cwd": "/work/nomodel", "timestamp": iso(now - 5),
            "message": {"role": "user", "content": SECRET_PROMPT}}], now - 5)

    # ---- Codex: function_call with secret arguments -------------------------
    write(os.path.join(xh, "sessions", "2026", "10", "26", "rollout-2026-10-26T00-00-00-0199aaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl"),
          codex_events(now, "/work/gamma", ("response_item", {
              "type": "function_call", "name": "shell", "arguments": json.dumps({"cmd": SECRET_ARG})})), now - 3)
    # Codex: task_complete -> idle; model only in session_meta
    write(os.path.join(xh, "sessions", "2026", "10", "26", "rollout-2026-10-26T00-01-00-0199ffff-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl"),
          [{"timestamp": iso(now - 40), "type": "session_meta",
            "payload": {"id": "0199ffff-bbbb-cccc-dddd-eeeeeeeeeeee", "cwd": "/work/delta", "model": "o4-mini"}},
           {"timestamp": iso(now - 15), "type": "event_msg", "payload": {"type": "task_complete"}}], now - 15)
    # Codex: stale
    write(os.path.join(xh, "sessions", "2026", "10", "25", "rollout-2026-10-25T00-00-00-0199eeee-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl"),
          codex_events(now, "/work/stale", ("event_msg", {"type": "task_complete"})), now - 7200)

    out = build_agent_live(claude_home=ch, codex_home=xh, now=now, stale_window_s=180)
    by = {s["session_id"]: s for s in out}
    blob = json.dumps(out)

    # discovery + staleness
    chk(len(out) == 5, "5 live sessions across both engines (2 stale dropped)", len(out))
    chk({s["engine"] for s in out} == {"claude", "codex"}, "both engines present in ONE list")
    chk("cccccccc-3333" not in by, "stale claude transcript dropped")
    chk(not any(s["cwd"] == "/work/stale" for s in out), "stale codex transcript dropped")
    chk([s["idle_s"] for s in out] == sorted(s["idle_s"] for s in out), "sorted most-recently-active first")

    # claude fields
    a = by["aaaaaaaa-1111"]
    chk(a["engine"] == "claude" and a["cwd"] == "/work/alpha" and a["title"] == "alpha",
        "claude: engine/cwd/title from transcript", (a["engine"], a["cwd"], a["title"]))
    chk(a["model"] == "claude-opus-4-5", "claude: model from assistant message", a["model"])
    chk(a["phase"] == "running Bash", "claude: phase is the tool NAME only", a["phase"])
    chk(9 <= a["idle_s"] <= 11, "claude: idle_s from last event timestamp", a["idle_s"])
    chk(by["bbbbbbbb-2222"]["phase"] == "thinking", "claude: thinking-only turn -> 'thinking'")
    chk(by["dddddddd-4444"]["model"] is None, "claude: unnamed model is null, never guessed")

    # codex fields
    g = by["0199aaaa-bbbb-cccc-dddd-eeeeeeeeeeee"]
    chk(g["engine"] == "codex" and g["cwd"] == "/work/gamma" and g["title"] == "gamma",
        "codex: engine/cwd/title", (g["engine"], g["cwd"], g["title"]))
    chk(g["model"] == "gpt-5-codex", "codex: model from turn_context", g["model"])
    chk(g["phase"] == "running shell", "codex: phase is function name only", g["phase"])
    dl = by["0199ffff-bbbb-cccc-dddd-eeeeeeeeeeee"]
    chk(dl["model"] == "o4-mini", "codex: model from session_meta when no turn_context", dl["model"])
    chk(dl["phase"] == "idle", "codex: task_complete -> idle", dl["phase"])

    # privacy
    for secret in (SECRET_PROMPT, SECRET_ARG, SECRET_REPLY):
        chk(secret not in blob, f"no leak of {secret[:14]}... into payload")

    # env overrides
    os.environ["LLM_TELEMETRY_CLAUDE_HOME"] = ch
    os.environ["LLM_TELEMETRY_CODEX_HOME"] = xh
    env_out = build_agent_live(now=now, stale_window_s=180)
    chk(len(env_out) == 5, "LLM_TELEMETRY_CLAUDE_HOME / _CODEX_HOME env overrides honoured", len(env_out))
    del os.environ["LLM_TELEMETRY_CLAUDE_HOME"], os.environ["LLM_TELEMETRY_CODEX_HOME"]

    # missing homes / junk
    chk(build_agent_live(claude_home=os.path.join(tmp, "nope"), codex_home=os.path.join(tmp, "nope2"),
                         now=now) == [], "missing homes -> empty list, no error")
    junk = os.path.join(ch, "projects", "-work-junk", "eeeeeeee-5555.jsonl")
    os.makedirs(os.path.dirname(junk))
    with open(junk, "w") as fh:
        fh.write("not json\n")
    chk(all(s["session_id"] != "eeeeeeee-5555" for s in
            build_agent_live(claude_home=ch, codex_home=xh, now=now)), "unparseable transcript skipped")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
