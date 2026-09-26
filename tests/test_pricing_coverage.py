#!/usr/bin/env python3
"""Every cloud model Hermes has ever recorded must resolve to a price.

A model that prices at $0.00 looks free on the dashboard, and the dashboard's
whole job is to say what things cost. Runs the real resolver against the real
catalog cache: this fails the moment a new release appears that neither the
alias table nor the dashed->dotted fallback can place.
"""
import json, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
os.environ.setdefault("LLM_TELEMETRY_NO_COLLECT", "1")
from llm_telemetry import pricing  # noqa: E402

# The catalog cache location belongs to the config, not to this test — hard
# coding a path here would make the guard pass or fail depending on whose
# machine ran it.
cat = json.load(open(pricing.CACHE))["models"] if os.path.exists(pricing.CACHE) \
    else pricing.fetch_catalog()[0]

# Names exactly as Hermes writes them into session_model_usage.
MUST_PRICE = [
    "claude-opus-5", "claude-opus-5-5", "claude-fable-5", "claude-fable-5-1",
    "claude-sonnet-5", "claude-opus-4-8", "claude-opus-4-7", "claude-sonnet-4-6",
    "claude-sonnet-4-5-20250929", "claude-opus-4-5-20251101",
    "glm-5.3-flash", "glm-5.3", "deepseek-v4.1-flash",
]
# Must NOT price (local hardware) — a resolver that is too eager would start
# charging Ollama traffic at cloud rates.
MUST_NOT = ["qwen3-coder:30b", "gpt-oss:20b", "deepseek-r1:14b", "qwen3.8:latest"]

fails = 0
for m in MUST_PRICE:
    r = pricing.rates_for(m, cat)
    ok = r is not None and r[0] > 0 and r[1] > 0
    print(f"  {'OK  ' if ok else 'FAIL'} {m:30s} {r}")
    fails += not ok
for m in MUST_NOT:
    r = pricing.rates_for(m, cat)
    ok = r is None
    print(f"  {'OK  ' if ok else 'FAIL'} {m:30s} local -> {r}")
    fails += not ok

# Negative control on the fallback itself: an unknown dashed name must not
# match a :batch SKU, and a nonsense name must return None, not a neighbour.
r = pricing._resolve_catalog_id("claude-opus-5-5", cat)
print(f"  {'OK  ' if r and ':batch' not in r else 'FAIL'} fallback picks {r!r}, not the :batch SKU")
fails += not (r and ":batch" not in r)
r = pricing._resolve_catalog_id("claude-nonexistent-9-9", cat)
print(f"  {'OK  ' if r is None else 'FAIL'} unknown model -> {r!r}")
fails += r is not None

print(f"\n{'ALL PASS' if not fails else 'FAILED'}  ({fails} failed)")
sys.exit(1 if fails else 0)