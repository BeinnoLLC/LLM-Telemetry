#!/usr/bin/env python3
"""Write the fixed OpenRouter catalogue the sample price sheet is built from.

CI builds costs.html with no network, and the committed sheet must not churn
every time OpenRouter changes a price. So the sample build reads a small,
committed catalogue (examples/reports/sample-catalog.json) via
LLM_TELEMETRY_CATALOG instead of fetching.

Contents: every model the sample traffic uses, every ALIASES target, a slice
of unused models (so "listed but never used" is exercised), plus the two
shapes that once broke pricing: a ":batch" SKU and a "-1" router sentinel.
Prices are public OpenRouter list prices, nothing identifying.

Usage: python3 examples/make_sample_catalog.py <real pricing-cache.json>
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))
OUT = os.path.join(HERE, "reports", "sample-catalog.json")


def pick(real):
    from llm_telemetry import pricing as P
    want = set(P.ALIASES.values())
    data = json.load(open(os.path.join(HERE, "reports", "analytics-data.json")))
    for prof in data["profiles"].values():
        for r in prof.get("rows", []):
            oid = P.ALIASES.get(r["model"]) or r["model"]
            want.add(oid)
    # Unused but listed: the first 25 ids in sorted order, deterministic.
    want.update(sorted(real)[:25])
    # Shapes that once broke pricing.
    want.update(k for k in real if k.endswith(":batch"))
    want.update(k for k in real if str(real[k].get("prompt")) == "-1")
    return {k: real[k] for k in sorted(want) if k in real}


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
        "~/.hermes/reports/pricing-cache.json")
    real = json.load(open(src))["models"]
    models = pick(real)
    # Keep the :batch slice small: three is enough to exercise the shape.
    batch = [k for k in models if k.endswith(":batch")]
    for k in batch[3:]:
        del models[k]
    doc = {"sample": True, "fetched": 1790000000, "models": models}
    with open(OUT, "w") as f:
        json.dump(doc, f, indent=1, sort_keys=True)
        f.write("\n")
    print(f"{OUT}  ({len(models)} models)")


if __name__ == "__main__":
    main()
