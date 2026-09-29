#!/usr/bin/env python3
"""Add a synthetic latency payload to the sample data (#93/P10-05).

Sanitized fixture data only, matching the shape collect_analytics.py's
build_latency() emits.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "reports", "analytics-data.json")

LATENCY = {
    "by_model": {
        "claude-opus": {"n": 4210, "p50": 1.8, "p90": 6.4, "p99": 24.1, "tok_s": 38.2},
        "claude-haiku": {"n": 9820, "p50": 0.6, "p90": 2.1, "p99": 8.7, "tok_s": 61.5},
        "qwen3-coder:30b": {"n": 512, "p50": 3.2, "p90": 11.8, "p99": 42.0, "tok_s": 14.7},
        "deepseek-v4.1-flash": {"n": 3, "p50": 1.1, "p90": 1.9, "p99": 1.9, "tok_s": None},
    },
    "by_endpoint": {
        "https://api.anthropic.com/v1": {"n": 14030, "p50": 1.1, "p90": 4.2, "p99": 18.5, "tok_s": 45.1},
        "http://gpu-01.example.internal:11434": {"n": 512, "p50": 3.2, "p90": 11.8, "p99": 42.0, "tok_s": 14.7},
        "https://ollama.com/v1": {"n": 3, "p50": 1.1, "p90": 1.9, "p99": 1.9, "tok_s": None},
    },
    "slowest": [
        {"session": "sess_sample_slow1", "ts": 1727600000, "model": "qwen3-coder:30b", "s": 187.4},
        {"session": "sess_sample_slow2", "ts": 1727500000, "model": "claude-opus", "s": 142.0},
        {"session": "sess_sample_slow3", "ts": 1727400000, "model": "claude-opus", "s": 98.6},
    ],
    "idle_threshold_s": 600,
    "idle_n": 41,
}


def main():
    with open(DATA) as f:
        doc = json.load(f)
    for name, prof in doc["profiles"].items():
        prof["latency"] = LATENCY
    with open(DATA, "w") as f:
        json.dump(doc, f, separators=(",", ":"), default=str)
    print(f"{DATA}: latency added to {len(doc['profiles'])} profiles")


if __name__ == "__main__":
    main()
