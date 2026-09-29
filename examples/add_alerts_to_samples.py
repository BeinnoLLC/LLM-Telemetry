#!/usr/bin/env python3
"""Add a synthetic `alerts` payload to the sample analytics-data.json
(#98/P10-10). Sanitized fixture data only, in the exact shape
alerts.build_alerts() emits: a realistic mix across severities so the
Attention card's grouping/sort/jump-to-view all have something to show.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "reports", "analytics-data.json")

ALERTS = [
    {"rule": "delegation_failure_rate", "severity": "critical", "value": 31.2, "threshold": 25.0,
     "message": "Delegation failure rate 31.2% over the last 7 days (14/45 children)",
     "target_view": "Health",
     "why": "25% is roughly the point where a delegation run stops being a normal tail and starts wasting real wall-clock time."},
    {"rule": "orphan_reap", "severity": "critical", "value": 2, "threshold": 0,
     "message": "2 sessions reaped as orphaned in the last 24h",
     "target_view": "Usage",
     "why": "A reap means the agent process died mid-turn with the work unaccounted for -- always worth knowing about."},
    {"rule": "unpriced_cloud_model", "severity": "warning", "value": 1, "threshold": 0,
     "message": "1 unpriced cloud model counted as $0: new-preview-model-x",
     "target_view": "Cost",
     "why": "A metered/cloud model with no catalogue rate silently counts as $0 spend."},
    {"rule": "compression_failure", "severity": "warning", "value": 1, "threshold": 0,
     "message": "1 session in a compaction-failure cooldown, e.g. Billing migration retry loop",
     "target_view": "Detail",
     "why": "A session stuck failing to compact will keep growing its context until something breaks."},
    {"rule": "bandwidth_spike", "severity": "info", "value": 3.4, "threshold": 3.0,
     "message": "Today's bandwidth is 3.4x the trailing mean",
     "target_view": "Usage",
     "why": "3x the trailing mean is a real spike worth a look, not the normal day-to-day variance."},
]


def main():
    with open(DATA) as f:
        doc = json.load(f)
    for i, (name, prof) in enumerate(doc["profiles"].items()):
        # Give the second profile a smaller, single-alert set so the card's
        # empty-vs-populated states both show up across the two samples.
        prof["alerts"] = ALERTS if i == 0 else ALERTS[-1:]
    with open(DATA, "w") as f:
        json.dump(doc, f, separators=(",", ":"), default=str)
    print(f"{DATA}: alerts added to {len(doc['profiles'])} profiles")


if __name__ == "__main__":
    main()
