#!/usr/bin/env python3
"""Price payload: catalogue freshness (P6-02 #60) and unpriced models (P6-03 #61).

Builds the Prices-view payload from synthetic model lists and freshness states,
so no network, no real agent data and no collector run are involved. The page
side is gone (#113 consolidation): freshness and the unpriced notice render in
the dashboard's Prices view, verified there by check_price_whatif.js and the
view checks. Here the DATA contract is what's tested: the payload carries
exactly the fields the view needs (freshness state/age/ttl/detail, unpriced
used-counts separable from the total, per-model rate + source) — no HTML.
"""
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
os.environ.setdefault("LLM_TELEMETRY_CONFIG",
                      os.path.join(os.path.dirname(__file__), "..", "examples", "sample-config.json"))
from llm_telemetry import pricing as P  # noqa: E402
from llm_telemetry import build_costs as B  # noqa: E402

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    if ok:
        p += 1
    else:
        f += 1
    print(f"  {'OK  ' if ok else 'FAIL'} {label}" + (f"  {extra}" if extra is not None else ""))


def model(name, source, calls, out=1.0):
    return {"model": name, "short": name.split("/")[-1], "in_1m": None if source == "unpriced" else out / 4,
            "out_1m": None if source == "unpriced" else out, "cache_1m": None, "source": source,
            "tps": None, "calls": calls, "inp": calls * 1000, "outp": calls * 100, "cache": 0,
            "cost": 0.0, "energy": None, "providers": ["x"], "served_by": "x", "profiles": ["p"]}


def payload(models, fresh, size=345):
    return {"models": models, "catalog_size": size, "catalog_source": fresh["state"],
            "freshness": fresh, "generated": "2026-09-26T12:00:00", "kwh": 0.047, "watts": 440,
            "gpu_w": 350, "host_w": 90, "prefill": 12, "cachex": 60}


priced = [model("anthropic/claude-x", "vendor", 10), model("qwen3-coder:30b", "local", 5)]

# ---- #60: TTL text comes from the constant ---------------------------------
src = open(B.__file__).read() + open(P.__file__).read()
chk(not re.search(r"\b24\s?h\b|\b6h\b", src.replace("ttl_label", "")),
    "no literal refresh interval in the pricing/payload source")
chk(P.ttl_label() == "6h" and P.ttl_label(86400) == "1d" and P.ttl_label(1800) == "30m",
    "ttl_label derives from TTL", (P.ttl_label(), P.ttl_label(86400), P.ttl_label(1800)))
old_ttl = P.TTL
P.TTL = 12 * 3600
chk(P.ttl_label() == "12h", "changing TTL changes the label the view prints")
P.TTL = old_ttl
fr_ok = {"state": "cache", "age": "2h", "ttl": P.ttl_label(), "detail": "", "age_s": 7200}
dh = payload(priced, fr_ok)
chk(dh["freshness"]["ttl"] == "6h" and dh["freshness"]["age"] == "2h",
    "fresh cache travels with age + ttl (view renders them as a plain line)")

# ---- #60: stale freshness travels with reason + age -------------------------
fr = {"state": "stale", "age": "3d", "ttl": "6h", "detail": "URLError", "age_s": 3 * 86400}
ds = payload(priced, fr)
chk(ds["freshness"]["state"] == "stale" and ds["freshness"]["age"] == "3d"
    and ds["freshness"]["detail"] == "URLError",
    "stale freshness carries age + reason (view renders the warning box)")

# ---- #61: unpriced with vs without traffic (payload contract) ---------------
mixed = priced + [model("acme/used-1", "unpriced", 40), model("acme/used-2", "unpriced", 2),
                  model("acme/idle", "unpriced", 0)]
dm = payload(mixed, {"state": "cache", "age": "1h", "ttl": "6h", "detail": "", "age_s": 3600})
un = [m for m in dm["models"] if m["source"] == "unpriced"]
used_un = [m for m in un if (m["calls"] or 0) > 0]
chk(len(un) == 3 and len(used_un) == 2,
    "unpriced-with-traffic count is separable from the unpriced total", (len(un), len(used_un)))
chk(sum(m["calls"] for m in used_un) == 42, "the traffic affected sums (42 calls)")
chk({m["short"] for m in used_un} == {"used-1", "used-2"}, "names the models that need a price")
chk(any((m["calls"] or 0) == 0 for m in un), "idle unpriced models ride along, harmless")
chk(all(m["in_1m"] is None and m["out_1m"] is None for m in un),
    "unpriced rows carry null rates (the view says 'no rate available', never $0)")

clean = priced + [model("acme/idle", "unpriced", 0)]
dc = payload(clean, {"state": "cache", "age": "1h", "ttl": "6h", "detail": "", "age_s": 3600})
chk(not [m for m in dc["models"] if m["source"] == "unpriced" and (m["calls"] or 0) > 0],
    "zero unpriced-with-traffic is a clean payload state (no understated warning)")

# ---- #60: cold cache + network down = 'unavailable' state -------------------
with tempfile.TemporaryDirectory() as tmp:
    # Both catalogues, or this is not a cold cache: the Nous list (#131) has
    # its own cache file, and leaving it warm made this test pass on the
    # OpenRouter failure while a list full of Nous rates came back.
    old_cache, old_url = P.CACHE, P.URL
    old_ncache, old_nurl = P.NOUS_CACHE, P.NOUS_URL
    P.CACHE = os.path.join(tmp, "none.json")
    P.NOUS_CACHE = os.path.join(tmp, "none-nous.json")
    P.URL = "http://127.0.0.1:9/nothing-listens-here"
    P.NOUS_URL = "http://127.0.0.1:9/nothing-listens-here-either"
    # A pinned catalogue file wins over the URLs above and returns "pinned"
    # without ever attempting a fetch, which made this test assert on the
    # sample catalogue instead of a cold-cache failure whenever the build env
    # was exported. Unpin for the duration: this block is about the no-network
    # path, so it has to be the thing deciding the outcome.
    old_cat = os.environ.pop("LLM_TELEMETRY_CATALOG", None)
    try:
        cat, src_state = P.fetch_catalog(force=True)
        fr = P.catalog_freshness(src_state)
    finally:
        P.CACHE, P.URL = old_cache, old_url
        P.NOUS_CACHE, P.NOUS_URL = old_ncache, old_nurl
        if old_cat is not None:
            os.environ["LLM_TELEMETRY_CATALOG"] = old_cat
chk(cat == {} and fr["state"] == "unavailable", "forced fetch failure with a cold cache is 'unavailable'", fr)
du = payload([model("anthropic/claude-x", "unpriced", 10)], fr, size=0)
chk(du["freshness"]["state"] == "unavailable" and du["catalog_size"] == 0,
    "unavailable freshness + size 0 is the payload the view's error state reads")
chk(B.costs_data_path().name == "costs-data.json" and callable(B.write_costs_data),
    "the payload writer targets costs-data.json (the view's feed)")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)