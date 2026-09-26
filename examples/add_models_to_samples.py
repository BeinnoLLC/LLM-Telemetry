#!/usr/bin/env python3
"""Add per-session `models` lists to the sanitized live-data.json fixture (#107).

Mirrors collect_live.fold_models(): one entry per model, tasks folded in, main
models first. Invented numbers only; hostnames are public API endpoints.
"""
import json
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(HERE, "reports", "live-data.json")
NOW = time.time()

SAMPLE = [
    ("claude-opus-5", ["main", "background_review"], 212, True, "https://api.anthropic.com", 20),
    ("claude-fable-5-1", ["main", "approval"], 31, True, "https://api.anthropic.com", 900),
    ("qwen3-coder:30b", ["main", "compression"], 44, True, "http://127.0.0.1:11434/v1/", 4000),
    ("glm-5.3-flash", ["approval", "compression"], 18, False, "https://opencode.ai/zen/go/v1/", 300),
    ("qwen3:14b", ["title_generation"], 1, False, "http://127.0.0.1:11434/v1/", 9000),
]

d = json.load(open(P))
for prof in d["profiles"].values():
    for L in prof.get("live", []):
        n = max(1, int(L.get("nmodels") or 1))
        picks = SAMPLE[:max(n, 1)] if n > 1 else [s for s in SAMPLE if s[0] == L.get("model")][:1]
        if not picks:
            picks = [(L.get("model") or "", ["main"], 12, True, "https://api.anthropic.com", 30)]
        L["models"] = [{"model": m, "tasks": t, "calls": c, "in_tok": c * 9000,
                        "out_tok": c * 150, "last": NOW - age, "base_url": u, "main": mn}
                       for m, t, c, mn, u, age in picks]
json.dump(d, open(P, "w"), separators=(",", ":"))
print(P, "models added")
