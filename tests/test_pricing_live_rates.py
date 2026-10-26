#!/usr/bin/env python3
"""Live-catalogue-wins pricing (Option A): precedence, overrides, mappings, dead ids.

Uses a fixture catalogue, so no network and no real agent data.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))
from llm_telemetry import pricing as P
from llm_telemetry import build_costs as B

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{('  ' + str(extra)) if extra is not None else ''}")
    if ok:
        p += 1
    else:
        f += 1


def per_m(r):
    return None if r is None else tuple(round(x * 1e6, 6) for x in r)


def ent(i, o, c=0.0):
    return {"prompt": str(i / 1e6), "completion": str(o / 1e6), "input_cache_read": str(c / 1e6)}


CAT = {
    "minimax/minimax-m3": ent(0.30, 1.20),
    "deepseek/deepseek-v4-flash": ent(0.091, 0.182),
    "deepseek/deepseek-v4.1-flash": ent(0.02, 1.00),
    "deepseek/deepseek-v4-pro": ent(0.749, 1.497),
    "moonshotai/kimi-k2.6": ent(0.65, 3.41),
    "moonshotai/kimi-k2.7-code": ent(0.671, 3.35),
    "openai/gpt-oss-20b": ent(0.018, 0.09),
    "z-ai/glm-5.3": ent(0.07, 1.40),
    "moonshotai/kimi-k3": ent(0.169, 20.0),
    "qwen/qwen3.5-397b-a17b": ent(0.50, 3.60),
    "nvidia/nemotron-3-nano-30b-a3b": ent(0.06, 0.24),
    "nvidia/nemotron-3-super-120b-a12b": ent(0.30, 2.40),
    "nvidia/nemotron-3-ultra-550b-a55b": ent(0.60, 2.40),
    "openai/gpt-5.1-codex": ent(1.25, 10.0),
    "openai/gpt-5.1-codex-max": ent(9.0, 9.0),
    "qwen/qwen3.7-max": ent(1.475, 4.425),
    "qwen/qwen3.7-max-preview": ent(8.0, 8.0),
    "google/gemma-4-26b-a4b-it": ent(0.09, 0.30),
    "google/gemma-4-31b-it": ent(0.20, 0.40),
}

print("live catalogue wins over WEB_RATES")
for m, want in [("minimax-m3", (0.30, 1.20)), ("deepseek-v4-flash", (0.091, 0.182)),
                ("deepseek-v4.1-flash", (0.02, 1.00)), ("deepseek-v4-pro", (0.749, 1.497)),
                ("kimi-k2.6", (0.65, 3.41)), ("kimi-k2.7-code", (0.671, 3.35))]:
    r = per_m(P.rates_for(m, CAT))
    chk(r is not None and r[:2] == want, f"{m} priced from the live entry", r)
chk(P.rate_origin("minimax-m3", CAT)[0] == "catalog", "origin is 'catalog' when a live entry exists")
chk(P.rate_origin("minimax-m3", {})[0] == "builtin" and per_m(P.rates_for("minimax-m3", {}))[:2] == (0.60, 2.40),
    "WEB_RATES is the fallback when the catalogue lacks the model")
chk(per_m(P.rates_for("gpt-oss:20b-cloud", CAT))[:2] == (0.018, 0.09),
    "a cloud-tagged gpt-oss id uses the live entry")

print("override list")
chk(set(P.RATE_OVERRIDES) >= {"glm-5.3", "kimi-k3"}, "glm-5.3 and kimi-k3 are overrides")
chk(per_m(P.rates_for("glm-5.3", CAT))[:2] == (1.40, 4.40), "glm-5.3 keeps 1.40/4.40 over live 0.07/1.40")
chk(per_m(P.rates_for("kimi-k3", CAT))[:2] == (3.0, 15.0), "kimi-k3 keeps 3/15 over live 0.169/20")
fw = "accounts/fireworks/models/deepseek-v4p1-flash"
chk(per_m(P.rates_for(fw, CAT))[:2] == (0.22, 0.66), "a Fireworks SKU keeps its provider-specific rate")
chk(P.rate_origin("glm-5.3", CAT)[0] == "override", "origin is 'override'")
extra = set(P.RATE_OVERRIDES) - {"glm-5.3", "kimi-k3"}
chk(all(k.startswith("accounts/fireworks/") for k in extra), "every other override is a Fireworks id", sorted(extra))

print("typo")
chk("big-pickle" in P.ZEN_FREE_MODELS and P.is_free_tier("big-pickle"), "big-pickle is a free-list id")
chk(not P.is_free_tier("big-pikkle"), "the 'big-pikkle' typo is not a free id")
sample = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "examples", "reports", "analytics-data.json")
chk("pikkle" not in open(sample).read(), "the sample snapshot no longer carries the typo")

print("new mappings")
for m, oid, want in [("qwen3.5:397b", "qwen/qwen3.5-397b-a17b", (0.50, 3.60)),
                     ("nemotron-3-nano", "nvidia/nemotron-3-nano-30b-a3b", (0.06, 0.24)),
                     ("nemotron-3-super", "nvidia/nemotron-3-super-120b-a12b", (0.30, 2.40)),
                     ("nemotron-3-ultra", "nvidia/nemotron-3-ultra-550b-a55b", (0.60, 2.40)),
                     ("gpt-5.1-codex", "openai/gpt-5.1-codex", (1.25, 10.0)),
                     ("qwen3.7-max", "qwen/qwen3.7-max", (1.475, 4.425))]:
    chk(P.ALIASES.get(m) == oid, f"{m} is an exact alias")
    r = per_m(P.rates_for(m, CAT))
    chk(r is not None and r[:2] == want, f"{m} prices from {oid}", r)
chk("gemma4" not in P.ALIASES, "gemma4 stays unmapped (26b vs 31b is ambiguous)")
row = {"provider": "ollama-cloud", "base_url": "https://ollama.com/v1", "model": "nemotron-3-super",
       "input_tokens": 1_000_000, "output_tokens": 0}
r = P.price_row(row, CAT)
chk(r["cost_class"] == "metered" and abs(r["billed_usd"] - 0.30) < 1e-9,
    "ollama-cloud nemotron-3-super is metered at the live rate, not local energy", r)

print("dead test endpoints")
for u in ("http://127.0.0.1:9", "http://127.0.0.1:9/v1", "localhost:9", "http://localhost:9/"):
    chk(P.is_dead_endpoint(u), f"{u} is dead")
for u in ("http://127.0.0.1:9000/v1", "http://127.0.0.1:11434/v1", "https://api.anthropic.com", "", None):
    chk(not P.is_dead_endpoint(u), f"{u!r} is not dead")
data = {"profiles": {"w": {"rows": [
    {"model": "ghost-model", "provider": "custom", "base_url": "http://127.0.0.1:9/v1", "calls": 5},
    {"model": "real-model", "provider": "custom", "base_url": "http://127.0.0.1:11434/v1", "calls": 2},
]}}}
names = {m["model"] for m in B.assemble(data, {})}
chk("ghost-model" not in names and "real-model" in names, "dead-endpoint models stay out of the price sheet")

print("local / free labelling")
for m in ("gpt-oss:20b", "qwen3.8:latest", "qwen3:14b", "qwen3-coder:30b", "deepseek-r1:14b"):
    r = P.price_row({"provider": "custom", "base_url": "http://192.168.1.5:11434/v1", "model": m,
                     "input_tokens": 1000, "output_tokens": 1000}, CAT)
    chk(r["cost_class"] == "local" and r["priced"] and r["energy_usd"] > 0 and r["rate_source"] in ("", "catalog", "energy"),
        f"{m} is local, priced, energy-costed", r["cost_class"])
r = P.price_row({"provider": "", "base_url": "", "model": "stepfun/step-3.7-flash:free",
                 "input_tokens": 1000, "output_tokens": 1000}, CAT)
chk(r["cost_class"] == "free" and r["market_value_usd"] == 0 and r["priced"], "step-3.7-flash:free stays $0")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
