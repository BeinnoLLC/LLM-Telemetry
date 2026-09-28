#!/usr/bin/env python3
"""Permanent tests for #117/#118 pricing fixes: run the .py test files' style."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from llm_telemetry import pricing as P  # noqa: E402

FAIL = []
def chk(name, got, want):
    if got != want:
        FAIL.append(f"{name}: got {got!r}, want {want!r}")

cat, _ = P.fetch_catalog()
# use the committed sample catalogue when present so tests stay offline-deterministic
try:
    samp = json.load(open(os.path.join(
        os.path.dirname(__file__), "..", "examples", "reports", "sample-catalog.json")))
    cat = samp["models"]          # the file is {sample, fetched, models}; the map is under "models"
except Exception:
    pass

# --- classification ----------------------------------------------------------
def cls(model, provider, url=None):
    r = P.price_row({"provider": provider, "model": model, "base_url": url,
                     "calls": 1, "input_tokens": 100, "output_tokens": 50, "cread": 0}, cat)
    return r

r = cls("deepseek-v4.1-flash", "ollama-cloud", "https://ollama.com/v1")
chk("ollama-cloud class", r["cost_class"], "metered")
chk("ollama-cloud priced", r["priced"], True)
chk("ollama-cloud billed>0", r["billed_usd"] > 0, True)

r = cls("kimi-k3:cloud", None)
chk(":cloud class", r["cost_class"], "metered")
chk(":cloud priced", r["priced"], True)

r = cls("qwen3-coder:480b-cloud", "custom")
chk("cloud-tag over custom slot", r["cost_class"], "metered")

# --- is_local precedence ------------------------------------------------------
chk("qwen3.8:latest local", P.is_local("qwen3.8:latest"), True)
chk("/:cloud never local", P.is_local("qwen3-coder:480b-cloud"), False)
chk("/-cloud never local", P.is_local("kimi-k3-cloud"), False)
chk("vendor id not local", P.is_local("openai/gpt-oss-120b"), False)

# --- aliases (#117) -----------------------------------------------------------
r = cls("qwen3.8-max", "opencode-go")
chk("qwen3.8-max priced", r["priced"], True)
r = cls("kimi-k2.7-code", "opencode-go")
chk("kimi-k2.7-code priced", r["priced"], True)

# --- free/batch/sentinel regressions ------------------------------------------
r = cls("qwen/qwen3.8-27b:free", "openrouter")
chk(":free stays free", r["cost_class"], "free")
r = cls("openrouter/auto", "openrouter")
chk("-1 sentinel unpriced", r["priced"], False)

# --- url mapping ---------------------------------------------------------------
r = cls("whatever", "custom", "https://ollama.com/v1")
chk("ollama.com -> metered", r["cost_class"], "metered")
r = cls("whatever", "custom", "http://192.168.1.11:11434/v1")
chk("LAN -> local", r["cost_class"], "local")

if FAIL:
    print(f"test_cloud_pricing.py  {len(FAIL)} FAILED")
    for f in FAIL:
        print("  FAIL", f)
    sys.exit(1)
print("test_cloud_pricing.py  ALL PASS")
