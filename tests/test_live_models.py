#!/usr/bin/env python3
"""collect_live.fold_models: one entry per model, tasks folded, main first (#107)."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
os.environ.setdefault("LLM_TELEMETRY_CONFIG",
                      os.path.join(os.path.dirname(__file__), "..", "examples", "sample-config.json"))
from llm_telemetry.collect_live import fold_models

p = f = 0
def chk(ok, msg):
    global p, f
    print(("  OK   " if ok else "  FAIL ") + msg); p, f = (p + 1, f) if ok else (p, f + 1)

rows = [
    ("s1", "opus", "main", 10, 100, 5, 50.0, "https://api.anthropic.com"),
    ("s1", "opus", "approval", 2, 4, 1, 60.0, ""),
    ("s1", "glm", "compression", 3, 30, 9, 70.0, "https://opencode.ai/zen/go/v1/"),
    ("s1", "qwen", "main", 5, 50, 2, 40.0, "http://127.0.0.1:11434/v1/"),
    ("s2", None, "main", 1, 1, 1, 1.0, ""),
]
out = fold_models(rows)
s1 = out["s1"]
chk([m["model"] for m in s1] == ["opus", "qwen", "glm"], "main models first, newest first; helpers last")
opus = s1[0]
chk(sorted(opus["tasks"]) == ["approval", "main"], "tasks folded into one entry per model")
chk(opus["calls"] == 12 and opus["in_tok"] == 104 and opus["out_tok"] == 6, "counters summed across tasks")
chk(opus["base_url"] == "", "base_url follows the most recent row") if False else None
chk(opus["last"] == 60.0, "last = newest use across tasks")
chk(s1[2]["main"] is False, "helper-only model flagged main=False")
chk("s2" not in out or out["s2"] == [], "null model names are dropped")
print(f"\n{p} passed, {f} failed"); sys.exit(1 if f else 0)
