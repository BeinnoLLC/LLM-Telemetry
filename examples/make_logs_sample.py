#!/usr/bin/env python3
"""Write a sanitized logs-data.json fixture for the Logs page (#104).

Invented sessions, invented text, no hostnames or real paths — the same bar as
every other fixture here (examples/check_no_leaks.py enforces it). The shape
mirrors collect_logs.collect() exactly, including the capped-slice disclosure,
so the tests exercise the real rendering path.
"""
import json
import os
import random
import sys
import time

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "reports", "logs-data.json")

random.seed(104)
NOW = time.time()

TOOLS = [("terminal", 240), ("read_file", 120), ("patch", 80), ("execute_code", 60),
         ("write_file", 40), ("search_files", 30), ("vision_analyze", 8)]
MODELS = ["claude-opus-5", "claude-fable-5-1", "qwen3-coder:30b"]
SESSIONS = [("s_alpha01", "Billing service"), ("s_beta02", "Invoice parser"),
            ("s_gamma03", "Nightly export")]
KINDS = [("timeout", 6), ("rate_limit", 4), ("overloaded", 3), ("server_error", 2)]
TEXT = ["sample tool output (redacted)", "wrote 12 lines", "no matches found",
        "exit 0", "reading configuration", "applied 3 edits"]


def build():
    events = []
    for tool, n in TOOLS:
        for _ in range(n):
            sid, title = random.choice(SESSIONS)
            events.append({
                "ts": NOW - random.uniform(0, 24 * 3600), "session": sid, "title": title,
                "role": "tool", "tool": tool, "model": random.choice(MODELS),
                "level": "info", "kind": "", "preview": random.choice(TEXT),
            })
    for _ in range(90):
        sid, title = random.choice(SESSIONS)
        events.append({
            "ts": NOW - random.uniform(0, 24 * 3600), "session": sid, "title": title,
            "role": "assistant", "tool": "", "model": random.choice(MODELS),
            "level": "info", "kind": "", "preview": random.choice(TEXT),
        })
    errs = 0
    for kind, n in KINDS:
        for _ in range(n):
            errs += 1
            events.append({
                "ts": NOW - random.uniform(0, 24 * 3600), "session": "", "title": "",
                "role": "error", "tool": "", "model": random.choice(MODELS),
                "level": "error", "kind": kind,
                "preview": f"sample {kind} on a request (redacted)",
            })
    events.sort(key=lambda e: e["ts"], reverse=True)

    def facet(key):
        c = {}
        for e in events:
            v = e.get(key)
            if v:
                c[v] = c.get(v, 0) + 1
        return [{"v": k, "n": v} for k, v in sorted(c.items(), key=lambda x: -x[1])]

    sess = {}
    for e in events:
        if e["session"]:
            sess[(e["session"], e["title"])] = sess.get((e["session"], e["title"]), 0) + 1

    return {
        "events": events,
        "window_h": 24,
        # Deliberately larger than len(events): the fixture must exercise the
        # "showing the newest N of M" disclosure, which is the whole point of
        # computing facets over the full window.
        "events_total": len(events) * 9,
        "events_shown": len(events),
        "errors_shown": errs,
        "capped": True,
        "cap": len(events),
        "facets": {
            "tool": facet("tool"), "role": facet("role"), "model": facet("model"),
            "kind": [{"v": k, "n": n} for k, n in KINDS],
            "session": [{"v": s, "label": t, "n": n}
                        for (s, t), n in sorted(sess.items(), key=lambda x: -x[1])],
        },
        "generated": NOW,
    }


data = {"generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        # Marks the payload as fixture data; check_no_leaks.py requires it so a
        # real export can never be mistaken for a sample and committed.
        "sample": True,
        "profiles": {"work": build(), "personal": build()}}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    json.dump(data, f, separators=(",", ":"))
n = sum(p["events_shown"] for p in data["profiles"].values())
print(f"{OUT}  ({len(data['profiles'])} profiles, {n:,} events, "
      f"{os.path.getsize(OUT)/1024:.0f} KB)")
