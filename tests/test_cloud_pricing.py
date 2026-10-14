#!/usr/bin/env python3
"""Permanent tests for #117/#118 pricing fixes: run the .py test files' style."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from llm_telemetry import pricing as P

FAIL = []
def chk(name, got, want):
    if got != want:
        FAIL.append(f"{name}: got {got!r}, want {want!r}")

cat, _ = P.fetch_catalog()
try:
    samp = json.load(open(os.path.join(
        os.path.dirname(__file__), "..", "examples", "reports", "sample-catalog.json")))
    cat = samp["models"]
except Exception:
    pass

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

chk("qwen3.8:latest local", P.is_local("qwen3.8:latest"), True)
chk("/:cloud never local", P.is_local("qwen3-coder:480b-cloud"), False)
chk("/-cloud never local", P.is_local("kimi-k3-cloud"), False)
chk("vendor id not local", P.is_local("openai/gpt-oss-120b"), False)

r = cls("qwen3.8-max", "opencode-go")
chk("qwen3.8-max priced", r["priced"], True)
r = cls("kimi-k2.7-code", "opencode-go")
chk("kimi-k2.7-code priced", r["priced"], True)

r = cls("qwen/qwen3.8-27b:free", "openrouter")
chk(":free stays free", r["cost_class"], "free")
r = cls("openrouter/auto", "openrouter")
chk("-1 sentinel unpriced", r["priced"], False)

r = cls("whatever", "custom", "https://ollama.com/v1")
chk("ollama.com -> metered", r["cost_class"], "metered")
r = cls("whatever", "custom", "http://192.168.1.11:11434/v1")
chk("LAN -> local", r["cost_class"], "local")

from llm_telemetry import pricing as P
CLOUD_CASES = [
    ("kimi-k3:cloud",          "ollama-cloud", "kimi-k3"),
    ("gpt-oss:120b-cloud",     "custom",       "gpt-oss:120b"),
    ("nemotron-3-ultra:cloud", "ollama-cloud", "nemotron-3-ultra"),
    ("minimax-m3:cloud",       "ollama-cloud", "minimax-m3"),
]
for model, prov, card_key in CLOUD_CASES:
    r = cls(model, prov, "https://ollama.com/v1")
    chk(f"{model} classed metered", r["cost_class"], "metered")
    chk(f"{model} priced from the rate card", r["priced"], True)
    want = (100 * P.WEB_RATES[card_key][0] / 1e6
            + 50 * P.WEB_RATES[card_key][1] / 1e6)
    chk(f"{model} bills at the published rate", round(r["billed_usd"], 9), round(want, 9))

r = cls("kimi-k3", "ollama-cloud", "https://ollama.com/v1")
chk("bare kimi-k3 priced", r["priced"], True)
r = cls("deepseek-v4.1-flash", "ollama-cloud", "https://ollama.com/v1")
chk("deepseek-v4.1-flash priced from card", r["billed_usd"] > 0, True)

ZEN = ["space-bunny-free", "longcat-2.5-preview-free", "big-pickle",
       "mimo-v2.5-free", "nemotron-3-ultra-free", "jev-1.13-free"]
for model in ZEN:
    r = cls(model, "opencode-go", "https://opencode.ai/zen/v1")
    chk(f"{model} is class free", r["cost_class"], "free")
    chk(f"{model} counts as priced", r["priced"], True)
    chk(f"{model} costs $0", r["market_value_usd"], 0)
    chk(f"{model} is not billed", r["billed_usd"], 0)
    chk(f"{model} is not electricity", r["energy_usd"], 0)

r = cls("zen/space-bunny-free", "custom", "https://opencode.ai/zen/v1")
chk("prefixed Zen free SKU still free", r["cost_class"], "free")

r = cls("space-bunny-free-experimental", "opencode-go", "https://opencode.ai/zen/v1")
chk("unknown '-free'-like name stays unpriced", r["priced"], False)
chk("unknown name is not classed free", r["cost_class"] != "free", True)
r = cls("glm-5.3-flash", "opencode-go", "https://opencode.ai/zen/v1")
chk("a paid Zen SKU is priced", r["priced"], True)
chk("a paid Zen SKU is not classed free", r["cost_class"] != "free", True)
chk("a paid Zen SKU carries a real value", r["market_value_usd"] > 0, True)

r = P.price_row({"provider": "anthropic", "model": "claude-opus-5",
                 "base_url": "https://api.anthropic.com/v1",
                 "calls": 1, "input_tokens": 1_000_000, "output_tokens": 0,
                 "cache_read": 0, "cache_write": 500_000}, cat)
chk("cache-write row is priced", r["priced"], True)
if r["priced"] and r["market_value_usd"] <= 0:
    FAIL.append("cache-write value: got %r, want > 0" % r["market_value_usd"])

r2 = P.price_row({"provider": "anthropic", "model": "claude-opus-5",
                  "base_url": "https://api.anthropic.com/v1",
                  "calls": 1, "input_tokens": 1_000_000, "output_tokens": 0,
                  "cache_read": 0, "cache_write": 0}, cat)
same_in_base = r2["market_value_usd"]
if r["priced"] and r2["priced"]:
    if not (r["market_value_usd"] > same_in_base + 0.5 * (r2["market_value_usd"] / 2)):
        FAIL.append("cache-write surcharge: got %r vs base %r" % (r["market_value_usd"], same_in_base))

if FAIL:
    print(f"test_cloud_pricing.py  {len(FAIL)} FAILED")
    for f in FAIL:
        print("  FAIL", f)
    sys.exit(1)
print("test_cloud_pricing.py  ALL PASS")
