#!/usr/bin/env python3
"""Add a synthetic `context` payload to the sample analytics-data.json
(#97/P10-09). Sanitized fixture data only, matching the shape
context_compaction.build_context() emits: two sessions (one with two
compactions -- one effective, one ineffective -- one with none, the
ticket's own negative control), one reasoning-heavy model, one live
cooldown.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "reports", "analytics-data.json")

CONTEXT = {
    "sessions": [
        {
            "id": "sess_ctxdemo1",
            "series": [[1758700000, 4000], [1758700100, 9000], [1758700200, 20000],
                       [1758700210, 3000], [1758700300, 14000], [1758700400, 25000],
                       [1758700410, 24500]],
            "compactions": [
                {"ts": 1758700205, "before": 20000, "after": 3000,
                 "yield_tok": 17000, "ineffective": False},
                {"ts": 1758700405, "before": 25000, "after": 24500,
                 "yield_tok": 500, "ineffective": True},
            ],
        },
        {
            "id": "sess_sample_slow1",
            "series": [[1758700000, 1200], [1758700100, 2400], [1758700200, 3100]],
            "compactions": [],
        },
    ],
    "reasoning_by_model": [
        {"model": "deepseek-r1", "reasoning_tokens": 41000, "output_tokens": 60000, "share": 0.6833},
        {"model": "claude-opus-5", "reasoning_tokens": 8200, "output_tokens": 110000, "share": 0.0745},
    ],
    "cooldowns": [
        {"id": "sess_cooldown1", "title": "Billing migration retry loop",
         "cooldown_until": 9999999999, "error_head": "RateLimitError: 429 too many requests"},
    ],
}


def main():
    with open(DATA) as f:
        doc = json.load(f)
    for name, prof in doc["profiles"].items():
        prof["context"] = CONTEXT
    with open(DATA, "w") as f:
        json.dump(doc, f, separators=(",", ":"), default=str)
    print(f"{DATA}: context added to {len(doc['profiles'])} profiles")


if __name__ == "__main__":
    main()
