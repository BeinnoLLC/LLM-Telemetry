#!/usr/bin/env python3
"""Price sheet: catalogue freshness (P6-02 #60) and unpriced models (P6-03 #61).

Renders the sheet from synthetic model lists and freshness states, so no
network, no real agent data and no collector run are involved.
"""
import os
import re
import sys
import tempfile
import time

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


def sheet(models, fresh, size=345):
    d = {"models": models, "catalog_size": size, "catalog_source": fresh["state"],
         "freshness": fresh, "generated": "2026-09-26T12:00:00", "kwh": 0.047, "watts": 440,
         "gpu_w": 350, "host_w": 90, "prefill": 12, "cachex": 60}
    return B.render(d)


def text(html):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))


priced = [model("anthropic/claude-x", "vendor", 10), model("qwen3-coder:30b", "local", 5)]

# ---- #60: TTL text comes from the constant ---------------------------------
src = open(B.__file__).read() + open(P.__file__).read()
chk(not re.search(r"\b24\s?h\b|\b6h\b", src.replace("ttl_label", "")),
    "no literal refresh interval in the pricing/sheet source")
chk(P.ttl_label() == "6h" and P.ttl_label(86400) == "1d" and P.ttl_label(1800) == "30m",
    "ttl_label derives from TTL", (P.ttl_label(), P.ttl_label(86400), P.ttl_label(1800)))
h = sheet(priced, {"state": "cache", "age": "2h", "ttl": P.ttl_label(), "detail": "", "age_s": 7200})
chk(f"cached {P.ttl_label()}" in text(h) and f"every {P.ttl_label()}" in text(h),
    "sheet states the TTL from the constant")
old_ttl = P.TTL
P.TTL = 12 * 3600
h12 = sheet(priced, {"state": "cache", "age": "2h", "ttl": P.ttl_label(), "detail": "", "age_s": 7200})
P.TTL = old_ttl
chk("every 12h" in text(h12) and "cached 12h" in text(h12), "changing TTL changes the sheet text")

# ---- #60: age shown, stale visibly distinct --------------------------------
chk("fetched 2h ago" in text(h), "age shown next to the source")
chk('id="catfresh" data-state="cache"' in h and "warnbox" not in h.split('id="catfresh"')[0][-40:],
    "a fresh cache renders as a plain line")
hs = sheet(priced, {"state": "stale", "age": "3d", "ttl": "6h", "detail": "URLError", "age_s": 3 * 86400})
chk('class="warnbox" id="catfresh" data-state="stale"' in hs, "stale renders as a warning box")
chk("Prices are stale" in text(hs) and "3d ago" in text(hs) and "URLError" in text(hs),
    "stale box says how old and why")

# ---- #60: cold cache + network down = readable error -----------------------
with tempfile.TemporaryDirectory() as tmp:
    old_cache, old_url = P.CACHE, P.URL
    P.CACHE = os.path.join(tmp, "none.json")
    P.URL = "http://127.0.0.1:9/nothing-listens-here"
    cat, src_state = P.fetch_catalog(force=True)
    fr = P.catalog_freshness(src_state)
    P.CACHE, P.URL = old_cache, old_url
chk(cat == {} and fr["state"] == "unavailable", "forced fetch failure with a cold cache is 'unavailable'", fr)
hu = sheet([model("anthropic/claude-x", "unpriced", 10)], fr, size=0)
chk('data-state="unavailable"' in hu and "Catalogue prices are missing" in text(hu),
    "cold-cache failure renders a readable error, not an empty table")

# ---- #61: unpriced with vs without traffic ---------------------------------
mixed = priced + [model("acme/used-1", "unpriced", 40), model("acme/used-2", "unpriced", 2),
                  model("acme/idle", "unpriced", 0)]
hm = sheet(mixed, {"state": "cache", "age": "1h", "ttl": "6h", "detail": "", "age_s": 3600})
t = text(hm)
chk('id="unpriced" data-used="2"' in hm, "unpriced-with-traffic count is separate", (re.search(r'data-used="\d+"', hm) or [None])[0])
chk("3 models unpriced, 2 of them with recorded traffic" in t, "headline gives both counts")
chk("used-1" in t and "used-2" in t, "names the models that need a price")
chk("Spend is understated" in t and "42 calls" in t, "says spend is understated, with the traffic affected")
chk("WEB_RATES" in t and "ALIASES" in t, "names WEB_RATES / ALIASES as the fix")
chk("Another 1 unpriced model had no traffic" in t, "unused unpriced models are called harmless")

clean = priced + [model("acme/idle", "unpriced", 0)]
hc = sheet(clean, {"state": "cache", "age": "1h", "ttl": "6h", "detail": "", "age_s": 3600})
chk('class="okbox" id="unpriced" data-used="0"' in hc and "understated" not in text(hc),
    "zero unpriced-with-traffic is a clean state, not a warning")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
