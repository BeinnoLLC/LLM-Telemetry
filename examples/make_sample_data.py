#!/usr/bin/env python3
"""Build synthetic sample telemetry by RESHAPING a real payload.

Hand-writing the JSON shape is how the first attempt shipped `d` instead of
`date` and rendered an empty dashboard. Instead this reads a real
analytics-data.json, keeps its exact structure, and replaces every identifying
value with synthetic equivalents:

  * profile names  -> work / personal
  * chat titles    -> generic project names
  * model names    -> kept (they are public product names, not secrets)
  * host URLs      -> example.internal / api vendors
  * costs/counts   -> jittered so the figures are not the author's real spend

Run:  python3 examples/make_sample_data.py [source.json]
"""
import json
import os
import random
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "reports")
random.seed(7)

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
    "~/.local/share/llm-telemetry/reports/analytics-data.json")

PROFILE_MAP = {}
TITLES = ["Billing service", "Mobile client", "Docs site", "Data pipeline",
          "Auth rewrite", "Search indexer", "Infra cleanup", "API gateway",
          "Onboarding flow", "Report builder", "(untitled)"]
_title_cache = {}


def fake_title(t):
    if not t or t == "(untitled)":
        return "(untitled)"
    if t not in _title_cache:
        _title_cache[t] = TITLES[len(_title_cache) % (len(TITLES) - 1)]
    return _title_cache[t]


def fake_url(u):
    """Keep the provider-identity shape; drop real LAN addresses."""
    if not u:
        return u
    u = re.sub(r"https?://\d+\.\d+\.\d+\.\d+(:\d+)?", "http://gpu-01.example.internal:11434", u)
    u = re.sub(r"https?://[\w.-]*llmstudio[\w.-]*", "http://gpu-02.example.internal:11434", u)
    return u


def jitter(v, lo=0.6, hi=1.5):
    if isinstance(v, bool) or v in (0, None):
        return v
    if isinstance(v, int):
        return max(1, int(v * random.uniform(lo, hi)))
    if isinstance(v, float):
        return round(v * random.uniform(lo, hi), 6)
    return v


NUMERIC = {"calls", "inp", "outp", "cread", "cwrite", "rtok", "est", "act",
           "sessions", "market_value_usd", "billed_usd", "tokens", "api_calls",
           "message_count", "v", "ok", "fail", "total", "value"}


def scrub(o, key=None):
    if isinstance(o, dict):
        return {k: scrub(v, k) for k, v in o.items()}
    if isinstance(o, list):
        return [scrub(v, key) for v in o]
    if key in ("title",):
        return fake_title(o)
    if key in ("base_url", "url", "billing_base_url", "base"):
        # `base` is the key inside ollama hosts[].urls[] — a nested array the
        # earlier key list missed entirely.
        return fake_url(o)
    if key == "id" and isinstance(o, str):
        return "sess_" + str(abs(hash(o)) % 10**8)
    if key == "profile" and isinstance(o, str):
        # Profile names appear as VALUES too (live errors, rows), not only as
        # dict keys — renaming only the keys leaves the real names published.
        return PROFILE_MAP.get(o, o)
    if key in ("label", "fp") and isinstance(o, str):
        # Host labels ARE the LAN IP in the real payload, so leaving them alone
        # publishes the network layout even when every other field is scrubbed.
        return fake_url("http://" + o).replace("http://", "")
    if key in NUMERIC:
        return jitter(o)
    if key in ("preview", "text", "last_msg_full") and isinstance(o, str):
        # Log previews are raw tool output: file paths, diffs, usernames, real
        # work content. There is nothing safe to salvage, so synthesise instead
        # of pattern-scrubbing — a redaction miss here publishes real work.
        return "sample tool output (redacted)"
    if key in ("msg", "last_msg") and isinstance(o, str):
        # Failure messages embed real LAN addresses and thread ids. `last_msg`
        # on health rows is a SECOND copy of the same text — scrubbing only
        # `msg` left one real IP in the published sample.
        o = re.sub(r"(?<!127\.0\.0\.)\b(\d{1,3}\.){3}\d{1,3}\b",
                   "gpu-01.example.internal", o)
        return o[:160]
    return o


def main():
    if not os.path.exists(SRC):
        sys.exit(f"source payload not found: {SRC}\n"
                 f"run `llm-telemetry collect` first, or pass a path")
    with open(SRC) as f:
        real = json.load(f)

    names = [n for n in real.get("profiles", {}) if n != "All"]
    for i, n in enumerate(names):
        PROFILE_MAP[n] = ["work", "personal", "research"][i] if i < 3 else f"profile{i}"

    out_profiles = {}
    for n, p in real.get("profiles", {}).items():
        if n == "All":
            continue
        sp = scrub(p)
        # `profile` appears inside rows on some builds; keep it consistent.
        for r in sp.get("rows", []):
            if "profile" in r:
                r["profile"] = PROFILE_MAP[n]
        out_profiles[PROFILE_MAP[n]] = sp

    data = {
        "profiles": out_profiles,
        "generated": real.get("generated"),
        "pricing_source": "sample",
        "pricing_models": real.get("pricing_models", 0),
        "sample": True,
    }
    os.makedirs(OUT, exist_ok=True)
    with open(f"{OUT}/analytics-data.json", "w") as f:
        json.dump(data, f)
    print(f"{OUT}/analytics-data.json  ({len(out_profiles)} profiles, sample)")

    # Router payload: same reshape, so the help page renders too.
    rsrc = os.path.join(os.path.dirname(SRC), "router-data.json")
    if os.path.exists(rsrc):
        with open(rsrc) as f:
            rr = json.load(f)
        rp = {PROFILE_MAP.get(k, k): scrub(v) for k, v in rr.get("profiles", {}).items()}
        with open(f"{OUT}/router-data.json", "w") as f:
            json.dump({"profiles": rp, "sample": True}, f)
        print(f"{OUT}/router-data.json  ({len(rp)} profiles, sample)")

    # Live + host payloads. The DOM suites read these directly, so without
    # samples CI can never run the drawer or fleet tests.
    for fname, key in (("live-data.json", "profiles"), ("ollama-data.json", None)):
        src = os.path.join(os.path.dirname(SRC), fname)
        if not os.path.exists(src):
            continue
        with open(src) as f:
            payload = json.load(f)
        payload = scrub(payload)
        if key and isinstance(payload.get(key), dict):
            payload[key] = {PROFILE_MAP.get(k, k): v for k, v in payload[key].items()}
        payload["sample"] = True
        with open(f"{OUT}/{fname}", "w") as f:
            json.dump(payload, f)
        print(f"{OUT}/{fname}  (sample)")


if __name__ == "__main__":
    main()
