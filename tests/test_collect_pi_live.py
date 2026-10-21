#!/usr/bin/env python3
"""collect_pi_live.build_pi_live: live PI agent sessions (LST-245).

Fixture JSONL files are written to a tmp dir (never ~/.pi) so this never
depends on, or leaks, a real PI install. Covers: staleness windowing by mtime,
agent-name extraction from the real nested path shape (one level deeper than
collect_pi_agents' own parent.parent guess -- see
collect_pi_live._agent_name_from_path's docstring for why that guess is wrong
here), phase derivation (tool call > text > thinking > idle) and idle_s.
"""
import json
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
os.environ.setdefault("LLM_TELEMETRY_CONFIG",
                      os.path.join(os.path.dirname(__file__), "..", "examples", "sample-config.json"))
from llm_telemetry.collect_pi_live import (
    build_pi_live, discover_live_jsonl, _model_timeline, _recent_tools, gauge_tools,
)

p = f = 0


def chk(ok, msg, extra=None):
    global p, f
    tail = f"  ({extra})" if extra is not None else ""
    print(("  OK   " if ok else "  FAIL ") + msg + tail)
    p, f = (p + 1, f) if ok else (p, f + 1)


def write_session(pi_home, agent, slug, session_id, cwd, events, mtime=None):
    d = os.path.join(pi_home, agent, "sessions", slug)
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, f"2026-10-16T00-00-00-000Z_{session_id}.jsonl")
    with open(path, "w") as fh:
        for ev in events:
            fh.write(json.dumps(ev) + "\n")
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


def iso(ts_epoch):
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(ts_epoch))


def ev_session(session_id, ts, cwd):
    return {"type": "session", "id": session_id, "timestamp": ts, "cwd": cwd}


def ev_model(ts, provider, model):
    return {"type": "model_change", "timestamp": ts, "provider": provider, "modelId": model}


def ev_assistant(ts, *, tool=None, text=None, thinking=None, usage=None):
    content = []
    if thinking:
        content.append({"type": "thinking", "thinking": thinking})
    if tool:
        content.append({"type": "toolCall", "id": "call_1", "name": tool, "arguments": {}})
    if text:
        content.append({"type": "text", "text": text})
    ev = {"type": "message", "timestamp": ts, "message": {"role": "assistant", "content": content}}
    if usage is not None:
        ev["usage"] = usage
    return ev


with tempfile.TemporaryDirectory() as tmp:
    now = time.time()

    # ---- a live session: running a tool call right now, with a model switch,
    # a prior tool call and real token/cost usage to exercise the LST-251
    # gauge/detail fields (tools, init_model/switched, uptime, tokens, cost).
    live_path = write_session(
        tmp, "agent-sp", "--tmp-user-workspace-billing--", "01live",
        "/tmp/user/workspace/billing",
        [
            ev_session("sess-live", iso(now - 600), "/tmp/user/workspace/billing"),
            ev_model(iso(now - 599), "pv", "sage"),
            ev_assistant(iso(now - 400), tool="read_file",
                         usage={"input": 1000, "output": 200, "cacheRead": 50, "cacheWrite": 10,
                                "totalTokens": 1260, "cost": {"total": 0.02}}),
            ev_model(iso(now - 380), "pv", "claude-opus-5"),
            ev_assistant(iso(now - 5), tool="bash",
                         usage={"input": 500, "output": 100, "cacheRead": 0, "cacheWrite": 0,
                                "totalTokens": 600, "cost": {"total": 0.01}}),
        ],
        mtime=now - 5,
    )

    # ---- a stale session: last touched well outside the window --------------
    stale_path = write_session(
        tmp, "agent-pv", "--tmp-user-workspace-old--", "02stale",
        "/tmp/user/workspace/old",
        [
            ev_session("sess-stale", iso(now - 3700), "/tmp/user/workspace/old"),
            ev_assistant(iso(now - 3600), text="done"),
        ],
        mtime=now - 3600,
    )

    # ---- a live session mid-thought (no tool call, no text yet) -------------
    thinking_path = write_session(
        tmp, "agent-local", "--tmp-user-workspace-docs--", "03think",
        "/tmp/user/workspace/docs",
        [
            ev_session("sess-think", iso(now - 35), "/tmp/user/workspace/docs"),
            ev_model(iso(now - 34), "ollama", "qwen3-coder:30b"),
            ev_assistant(iso(now - 30), thinking="let me check"),
        ],
        mtime=now - 30,
    )

    discovered = discover_live_jsonl(__import__("pathlib").Path(tmp), now, 180)
    chk(live_path in [str(x) for x in discovered], "a freshly-touched session file is discovered")
    chk(thinking_path in [str(x) for x in discovered], "a session touched 30s ago is within the window")
    chk(stale_path not in [str(x) for x in discovered],
        "a session untouched for an hour is NOT discovered (outside the 180s window)")

    out = build_pi_live(pi_home=tmp, now=now, stale_window_s=180)
    by_id = {s["session_id"]: s for s in out}

    chk(len(out) == 2, "only the two live sessions are returned, not the stale one", len(out))
    chk("sess-stale" not in by_id, "the stale session never appears in the result")

    live = by_id.get("sess-live")
    chk(live is not None, "the live session is present")
    if live:
        chk(live["agent"] == "agent-sp",
            "agent name is read from the real path depth (agent-sp), not the buggy parent.parent guess",
            live["agent"])
        chk(live["cwd"] == "/tmp/user/workspace/billing", "cwd comes from the session event")
        chk(live["model"] == "claude-opus-5", "model comes from the model_change event")
        chk(live["provider"] == "pv", "provider comes from the model_change event")
        chk(live["phase"] == "running bash", "phase names the in-flight tool call", live["phase"])
        chk(live["idle_s"] is not None and 4 <= live["idle_s"] <= 6,
            "idle_s is measured from the last event timestamp, not the file mtime", live["idle_s"])
        # ---- LST-251: gauge + full-detail fields, matching the Hermes level ----
        chk(set(live["tools"]) == {"read_file", "bash"},
            "tools lists every distinct tool called within the recency window", live["tools"])
        chk(live["init_model"] == "sage",
            "init_model is the FIRST model_change, not the current one", live["init_model"])
        chk(live["switched"] is True,
            "switched is true when the session's model differs from its initial pick")
        chk(live["started_at"] is not None and abs(live["started_at"] - (now - 600)) < 1,
            "started_at reads the session event's own timestamp", live["started_at"])
        chk(live["uptime_s"] is not None and 598 <= live["uptime_s"] <= 602,
            "uptime_s is measured from started_at to now", live["uptime_s"])
        chk(live["in_tok"] == 1500 and live["out_tok"] == 300,
            "token totals are summed across every assistant message in the session",
            (live["in_tok"], live["out_tok"]))
        chk(live["cache_read_tok"] == 50 and live["cache_write_tok"] == 10,
            "cache token totals are summed too",
            (live["cache_read_tok"], live["cache_write_tok"]))
        chk(abs(live["cost_usd"] - 0.03) < 1e-6,
            "cost_usd sums every assistant message's cost", live["cost_usd"])

    # ---- a session with only one model never reports it has switched --------
    think_events_model = by_id.get("sess-think")
    if think_events_model:
        chk(think_events_model["init_model"] == "qwen3-coder:30b",
            "init_model is set even for a session with a single model_change")
        chk(think_events_model["switched"] is False,
            "switched is false when there was only ever one model")
        chk(think_events_model["tools"] == [],
            "a session that never called a tool reports an empty tools list")

    think = by_id.get("sess-think")
    chk(think is not None, "the thinking session is present")
    if think:
        chk(think["agent"] == "agent-local", "agent name for the second fixture", think["agent"])
        chk(think["phase"] == "thinking",
            "a session with only a thinking block (no tool/text yet) phases as 'thinking'",
            think["phase"])

    # ---- empty / missing pi_home never raises --------------------------------
    chk(build_pi_live(pi_home=os.path.join(tmp, "does-not-exist"), now=now) == [],
        "a missing PI home returns an empty list, not an error")

    # ---- a malformed jsonl file (not valid PI session JSON) is skipped -------
    junk_dir = os.path.join(tmp, "agent-junk", "sessions", "--slug--")
    os.makedirs(junk_dir, exist_ok=True)
    junk_path = os.path.join(junk_dir, "2026-10-16T00-00-00-000Z_junk.jsonl")
    with open(junk_path, "w") as fh:
        fh.write("not json at all\n")
    os.utime(junk_path, (now, now))
    out2 = build_pi_live(pi_home=tmp, now=now, stale_window_s=180)
    chk(all(s["session_id"] != "" for s in out2),
        "a session file that fails to parse is skipped, not included as a blank row")

    # ---- _model_timeline / _recent_tools edge cases, unit-level ------------
    chk(_model_timeline([]) == (None, False),
        "no model_change events at all -> no init_model, never switched")
    chk(_recent_tools([], now) == [],
        "no events at all -> an empty tools list, never an error")
    stale_tool_events = [ev_assistant(iso(now - 1000), tool="bash")]
    chk(_recent_tools(stale_tool_events, now) == [],
        "a tool call older than the recency window is excluded, not just the newest kept")
    recency_events = [ev_assistant(iso(now - 100), tool="read"),
                       ev_assistant(iso(now - 50), tool="edit"),
                       ev_assistant(iso(now - 10), tool="bash")]
    chk(_recent_tools(recency_events, now) == ["bash", "edit", "read"],
        "recent tools come back most-recent-first, matching the chip UI's slice(0,5)",
        _recent_tools(recency_events, now))

    # ---- gauge_tools: PI tool names translated to loeIcon's Hermes-named ----
    # heavy/light sets, so a PI session's load gauge scores the same way a
    # Hermes session's equivalent activity would (the LST-251 follow-up fix).
    chk(gauge_tools([]) == [], "gauge_tools on an empty list is an empty list")
    chk(gauge_tools(["bash", "subagent", "dispatch_relay"]) ==
        ["terminal", "delegate_task", "delegate_task"],
        "bash/subagent/dispatch_relay map to loeIcon's heavy tool names",
        gauge_tools(["bash", "subagent", "dispatch_relay"]))
    chk(gauge_tools(["read", "fetch_content", "source_check", "get_search_content"]) ==
        ["read_file", "web_search", "web_search", "search_files"],
        "read/fetch_content/source_check/get_search_content map to loeIcon's light tool names",
        gauge_tools(["read", "fetch_content", "source_check", "get_search_content"]))
    chk(gauge_tools(["edit", "write", "get_goal"]) == ["edit", "write", "get_goal"],
        "a PI tool with no Hermes-named equivalent passes through unchanged")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
