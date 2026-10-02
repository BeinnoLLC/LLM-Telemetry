"""Nous Portal pricing (#131): Nous traffic prices at Nous's own published rate.

Injected catalogues only - no network. Covers the rate choice, the long-context
override, the guard against fuzzy matches leaking Nous rates onto other rows,
and the stale-cache fallback of the fetcher.
"""
import json
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
os.environ.setdefault("LLM_TELEMETRY_CONFIG", os.path.join(ROOT, "examples", "sample-config.json"))
os.environ.setdefault("LLM_TELEMETRY_AGENT_HOME", os.path.join(ROOT, "examples", "agent-home"))
sys.path.insert(0, os.path.join(ROOT, "src"))

from llm_telemetry import pricing as P  # noqa: E402

p = f = 0


def chk(ok, label, got=None):
    global p, f
    if ok:
        p += 1
        print(f"  OK   {label}")
    else:
        f += 1
        print(f"  FAIL {label}" + (f"  got: {got!r}" if got is not None else ""))


def close(a, b):
    return abs(a - b) < 1e-12


OR_DS = {"prompt": "0.00000066", "completion": "0.00000198", "input_cache_read": "0.000000022"}
NOUS_DS = {"prompt": "0.000000132", "completion": "0.000000396", "input_cache_read": "0.0000000042",
           "original": {"prompt": "0.00000066", "completion": "0.00000198"}}
NOUS_LC = {"prompt": "0.000002", "completion": "0.00001", "input_cache_read": "0.0000002",
           "overrides": [{"min_prompt_tokens": 272000, "prompt": "0.000004", "completion": "0.000015",
                          "input_cache_read": "0.0000002"}]}
CAT = {
    "deepseek/deepseek-v4-pro-0813": OR_DS,
    "openai/gpt-6.1-sol": {"prompt": "0.000002", "completion": "0.00001"},
    P.NOUS_PREFIX + "deepseek/deepseek-v4-pro-0813": NOUS_DS,
    P.NOUS_PREFIX + "openai/gpt-6.1-sol": NOUS_LC,
    P.NOUS_PREFIX + "stepfun/step-3.7-flash:free": {"prompt": "0", "completion": "0"},
    # Only on Nous: a fuzzy basename match must not hand this to other rows.
    P.NOUS_PREFIX + "nousonly/secret-model": {"prompt": "0.000001", "completion": "0.000001"},
}
NOUS_URL = "https://inference-api.nousresearch.com/v1/"


def row(model, provider="nous", url: "str | None" = NOUS_URL, inp=1_000_000, out=1_000_000, cread=0, calls=10):
    return {"provider": provider, "model": model, "base_url": url, "input_tokens": inp,
            "output_tokens": out, "cache_read": cread, "calls": calls}


print("rate choice")
r = P.price_row(row("deepseek/deepseek-v4-pro-0813"), CAT)
chk(r["rate_source"] == "nous", "Nous row uses the Nous price list", r["rate_source"])
chk(close(r["market_value_usd"], 0.132 + 0.396), "...at Nous's discounted rate ($0.132 + $0.396)", r["market_value_usd"])
r = P.price_row(row("deepseek/deepseek-v4-pro-0813", provider="openrouter", url="https://openrouter.ai/api/v1"), CAT)
chk(r["rate_source"] == "catalog" and close(r["market_value_usd"], 0.66 + 1.98),
    "the same model via OpenRouter keeps the OpenRouter rate", r["market_value_usd"])
r = P.price_row(row("deepseek/deepseek-v4-pro-0813", provider="custom"), CAT)
chk(r["rate_source"] == "nous", "a Nous URL behind a 'custom' slot is still Nous", r["rate_source"])
r = P.price_row(row("openai/gpt-6.1-sol", provider="nous", url=None), CAT)
chk(r["rate_source"] == "nous", "slot 'nous' with no URL is Nous")
r = P.price_row(row("stepfun/step-3.7-flash:free"), CAT)
chk(r["priced"] and r["market_value_usd"] == 0 and r["rate_source"] == "nous", "Nous :free SKU is a priced $0")
r = P.price_row(row("no/such-model"), CAT)
chk(r["rate_source"] == "", "a model on neither list stays unpriced", r)

print("long-context override")
small = P.price_row(row("openai/gpt-6.1-sol", inp=100_000, out=0, calls=1), CAT)
chk(close(small["market_value_usd"], 0.2), "100k-token prompt: base rate", small["market_value_usd"])
big = P.price_row(row("openai/gpt-6.1-sol", inp=300_000, out=0, calls=1), CAT)
chk(close(big["market_value_usd"], 1.2), "300k-token prompt: the >=272k override rate", big["market_value_usd"])
spread = P.price_row(row("openai/gpt-6.1-sol", inp=300_000, out=0, calls=3), CAT)
chk(close(spread["market_value_usd"], 0.6), "same tokens over 3 calls (100k avg): base rate", spread["market_value_usd"])
cached = P.price_row(row("openai/gpt-6.1-sol", inp=10_000, out=0, cread=290_000, calls=1), CAT)
chk(close(cached["market_value_usd"], 10_000 * 4e-6 + 290_000 * 2e-7),
    "cached tokens count toward the prompt size", cached["market_value_usd"])

print("isolation")
chk(P._resolve_catalog_id("secret-model", CAT) is None, "fuzzy id resolution never returns a Nous entry")
r = P.price_row(row("nousonly/secret-model", provider="openrouter", url="https://openrouter.ai/api/v1"), CAT)
chk(r["rate_source"] == "", "a non-Nous row never borrows a Nous-only rate", r["rate_source"])
chk(P.nous_rates_for("deepseek-v4-pro-0813", CAT) is None, "no basename guessing on the Nous list")
chk(P.catalog_size(CAT) == 2, "catalog_size counts OpenRouter models only", P.catalog_size(CAT))

print("fetcher")
shaped = P._shape_nous({"data": [{"id": "a/b", "aliases": ["a/b-2026"], "pricing": {"prompt": "1"}}]})
chk(set(shaped) == {"nous:a/b", "nous:a/b-2026"}, "id and every alias become nous: keys", sorted(shaped))
with tempfile.TemporaryDirectory() as d:
    cache = os.path.join(d, "c.json")
    json.dump({"fetched": 0, "models": {"nous:x": {"prompt": "1"}}}, open(cache, "w"))
    old = time.time() - 10 * P.TTL
    os.utime(cache, (old, old))

    def boom(raw):
        raise OSError("offline")
    models, src = P._fetch_cached("http://127.0.0.1:9/never", cache, boom)
    chk(models == {"nous:x": {"prompt": "1"}} and src.startswith("stale"), "network failure -> stale cache", src)
    os.remove(cache)
    models, src = P._fetch_cached("http://127.0.0.1:9/never", cache, boom)
    chk(models == {} and src.startswith("unavailable"), "no cache -> empty, Nous rows fall back to OpenRouter", src)

print(f"\ntest_nous_pricing.py  {p} passed, {f} failed")
sys.exit(1 if f else 0)
