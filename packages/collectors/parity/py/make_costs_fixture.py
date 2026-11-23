#!/usr/bin/env python3
"""Generate the deterministic costs parity fixture (T-17, LLMTELEMET-288).

Usage: make_costs_fixture.py OUT_DIR

Writes a self-contained reports dir plus the config/pin both producers point at:
  config.json            LLM_TELEMETRY_CONFIG (reports_dir + a fixed tariff)
  catalog.json           LLM_TELEMETRY_CATALOG pin: no network, fixed rates
  reports/analytics-data.json   traffic for the six pricing shapes below
  reports/ollama-data.json      the local model listed as installed

Traffic covers one catalogue-priced model, one built-in WEB_RATES model, one
local Ollama model, one free-tier model, one unknown unpriced model and one
catalogue row whose rates are all zero. Every value is a fixed literal: no
clock, no wall-clock-derived filename, no network.
"""
import json
import os
import sys

# Two profiles so aggregation across profiles is part of the diff as well.
# Row: model, provider, base_url, calls, inp, outp, cread, market_value_usd,
#      cost_class (all fixed literals, no timestamps).
TRAFFIC = [
    ("alpha", "openai/gpt-4o-mini", "openrouter", "https://openrouter.ai/api/v1",
     12, 100000, 20000, 5000, 0.0123, "metered"),
    ("alpha", "gpt-6-astra", "opencode-go", "https://opencode.ai/v1",
     3, 40000, 8000, 0, 0.5, "subscription"),
    ("alpha", "qwen3:14b", "ollama", "http://192.168.1.11:11434/v1",
     5, 50000, 10000, 0, 0.0, "local"),
    ("alpha", "beam-free", "opencode-go", "https://opencode.ai/v1",
     7, 7000, 1400, 0, 0.0, "subscription"),
    ("alpha", "mystery/unlisted-xyz", "openrouter", "https://openrouter.ai/api/v1",
     2, 900, 100, 20, 0.001, "metered"),
    ("alpha", "zero/promo-model", "openrouter", "https://openrouter.ai/api/v1",
     4, 800, 200, 0, 0.0, "metered"),
    ("beta", "openai/gpt-4o-mini", "fireworks", "https://api.fireworks.ai/inference/v1",
     1, 1000, 250, 50, 0.002, "metered"),
]

# Pinned catalogue: only the priced and zero-rate rows under test. The fixed
# `fetched` is data, not a clock; pinned catalogues skip freshness age anyway.
CATALOG = {
    "fetched": 1790000000,
    "models": {
        "openai/gpt-4o-mini": {
            "prompt": "0.00000015",
            "completion": "0.0000006",
            "input_cache_read": "0.000000075",
        },
        "zero/promo-model": {
            "prompt": "0", "completion": "0", "input_cache_read": "0",
        },
    },
}


def write(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1, sort_keys=True)
        fh.write("\n")


def main(argv):
    if len(argv) != 1:
        sys.stderr.write("usage: make_costs_fixture.py OUT_DIR\n")
        return 2
    out = os.path.abspath(argv[0])
    reports = os.path.join(out, "reports")
    rows = {}
    for profile, model, provider, base_url, calls, inp, outp, cread, value, cls in TRAFFIC:
        rows.setdefault(profile, []).append({
            "model": model,
            "provider": provider,
            "base_url": base_url,
            "calls": calls,
            "inp": inp,
            "outp": outp,
            "cread": cread,
            "market_value_usd": value,
            "cost_class": cls,
        })
    write(os.path.join(reports, "analytics-data.json"), {
        "generated": "2026-11-17T00:00:00",
        "profiles": {name: {"rows": profile_rows} for name, profile_rows in rows.items()},
        "schema_version": 3,
    })
    write(os.path.join(reports, "ollama-data.json"), {
        "hosts": [{
            "name": "local-1",
            "catalog": [{"name": "qwen3:14b", "size": 9000000000}],
        }],
    })
    write(os.path.join(out, "catalog.json"), CATALOG)
    os.makedirs(os.path.join(out, "agent"), exist_ok=True)
    os.makedirs(os.path.join(out, "home"), exist_ok=True)
    write(os.path.join(out, "config.json"), {
        "agent_home": os.path.join(out, "agent"),
        "profiles": [],
        "reports_dir": reports,
        "electricity_rate_kwh": 0.11,
        "gpu_draw_watts": 320,
        "host_overhead_watts": 80,
    })
    sys.stdout.write(out + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
