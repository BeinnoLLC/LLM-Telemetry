#!/usr/bin/env python3
"""Reprice local and free-tier sample rows through the real pricing path (P7-01, #65).

The committed fixtures were generated before local models were priced from
electricity, so their local rows still say cost_class "free" with $0. This
re-runs pricing.price_row() on exactly those rows (local hardware and ":free"
tiers) so the sample follows the same rule as a real build. Metered and
subscription rows are left untouched: their prices come from the catalogue,
and repricing them offline would change numbers for no reason.

Idempotent: running it twice gives byte-identical output.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))
from llm_telemetry import pricing as P  # noqa: E402

PATH = os.path.join(HERE, "reports", "analytics-data.json")


def reprice(data):
    changed = 0
    for prof in data.get("profiles", {}).values():
        for r in prof.get("rows", []):
            if r.get("cost_class") not in ("free", "local"):
                continue
            priced = P.price_row({
                "provider": r.get("provider", ""),
                "base_url": r.get("base_url", ""),
                "model": r.get("model", ""),
                "input_tokens": r.get("inp", 0),
                "output_tokens": r.get("outp", 0),
                "cache_read": r.get("cread", 0),
            }, {})
            before = {k: r.get(k) for k in priced}
            r.update(priced)
            if before != priced:
                changed += 1
    return changed


def main():
    data = json.load(open(PATH))
    n = reprice(data)
    # Same compact layout as the generator writes, so the diff stays small.
    with open(PATH, "w") as fh:
        json.dump(data, fh, separators=(",", ":"))
    print(f"repriced {n} local/free-tier rows")


if __name__ == "__main__":
    main()
