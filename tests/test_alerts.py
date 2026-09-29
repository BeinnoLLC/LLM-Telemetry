#!/usr/bin/env python3
"""P10-10 (#98): alerts.py unit tests -- one tripping + one non-tripping
fixture per rule, per the ticket's own verification criterion.
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))
from llm_telemetry.alerts import RULES, SEVERITY_ORDER, build_alerts  # noqa: E402

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{('  ' + str(extra)) if extra is not None else ''}")
    if ok:
        p += 1
    else:
        f += 1


def trip(rule_name, payload):
    alerts = build_alerts(payload)
    return next((a for a in alerts if a["rule"] == rule_name), None)


NOW = 1_800_000_000

# --- unpriced_cloud_model ------------------------------------------------
trip_payload = {"rows": [{"cost_class": "metered", "priced": False, "model": "new-model-x"},
                          {"cost_class": "local", "priced": True, "model": "qwen3"}]}
non_trip_payload = {"rows": [{"cost_class": "metered", "priced": True, "model": "claude-opus"}]}
chk(trip("unpriced_cloud_model", trip_payload) is not None, "unpriced_cloud_model TRIPS on an unpriced metered row")
chk(trip("unpriced_cloud_model", non_trip_payload) is None, "unpriced_cloud_model does NOT trip when every metered row is priced")

# --- delegation_failure_rate ---------------------------------------------
trip_payload = {"delegations": {"children": 20, "failed": 6}}  # 30%
non_trip_payload = {"delegations": {"children": 20, "failed": 4}}  # 20%
chk(trip("delegation_failure_rate", trip_payload) is not None, "delegation_failure_rate TRIPS at 30% (> 25%)")
chk(trip("delegation_failure_rate", non_trip_payload) is None, "delegation_failure_rate does NOT trip at 20% (<= 25%)")
chk(trip("delegation_failure_rate", {"delegations": {"children": 0, "failed": 0}}) is None,
    "delegation_failure_rate does NOT trip / crash on zero children (no ZeroDivisionError)")

# --- orphan_reap -----------------------------------------------------------
trip_payload = {"_now": NOW, "recent_ended": [{"end_reason": "ws_orphan_reap", "ended_at": NOW - 100}]}
non_trip_payload = {"_now": NOW, "recent_ended": [{"end_reason": "agent_close", "ended_at": NOW - 100}]}
old_reap_payload = {"_now": NOW, "recent_ended": [{"end_reason": "ws_orphan_reap", "ended_at": NOW - 90000}]}
chk(trip("orphan_reap", trip_payload) is not None, "orphan_reap TRIPS on a reap within 24h")
chk(trip("orphan_reap", non_trip_payload) is None, "orphan_reap does NOT trip on a normal close")
chk(trip("orphan_reap", old_reap_payload) is None, "orphan_reap does NOT trip on a reap older than 24h")

# --- backend_stale ----------------------------------------------------------
trip_payload = {"agents": [{"state": "dead", "age_s": 900, "backend": "b1"}]}
non_trip_payload = {"agents": [{"state": "alive", "age_s": 5, "backend": "b1"}]}
just_stale_not_old = {"agents": [{"state": "stale", "age_s": 300, "backend": "b1"}]}  # 5 min, under 10
chk(trip("backend_stale", trip_payload) is not None, "backend_stale TRIPS on a dead backend stale > 10 min")
chk(trip("backend_stale", non_trip_payload) is None, "backend_stale does NOT trip on an alive backend")
chk(trip("backend_stale", just_stale_not_old) is None, "backend_stale does NOT trip under the 10-minute threshold")

# --- long_running_session ---------------------------------------------------
trip_payload = {"_now": NOW, "live": [{"started_at": NOW - 4 * 3600, "title": "long one"}]}
non_trip_payload = {"_now": NOW, "live": [{"started_at": NOW - 1800, "title": "short one"}]}
chk(trip("long_running_session", trip_payload) is not None, "long_running_session TRIPS on a 4h session")
chk(trip("long_running_session", non_trip_payload) is None, "long_running_session does NOT trip on a 30min session")

# --- tool_failure_high -------------------------------------------------
trip_payload = {"delegations": {"tools": [{"tool": "terminal", "calls": 20, "fail": 6, "rate": 70.0}]}}  # 30% fail
non_trip_payload = {"delegations": {"tools": [{"tool": "terminal", "calls": 20, "fail": 2, "rate": 90.0}]}}  # 10% fail
too_few_calls = {"delegations": {"tools": [{"tool": "terminal", "calls": 2, "fail": 1, "rate": 50.0}]}}  # 50% but n=2
chk(trip("tool_failure_high", trip_payload) is not None, "tool_failure_high TRIPS at 30% failure over 20 calls")
chk(trip("tool_failure_high", non_trip_payload) is None, "tool_failure_high does NOT trip at 10% failure")
chk(trip("tool_failure_high", too_few_calls) is None, "tool_failure_high does NOT trip on too few calls even at 50% failure")

# --- bandwidth_spike ------------------------------------------------------
trip_payload = {"bandwidth_daily": [
    {"date": "2026-09-27", "up_bytes": 500, "down_bytes": 500},
    {"date": "2026-09-28", "up_bytes": 500, "down_bytes": 500},
    {"date": "2026-09-29", "up_bytes": 2500, "down_bytes": 2500},  # today 5x mean(1000)
]}
non_trip_payload = {"bandwidth_daily": [
    {"date": "2026-09-27", "up_bytes": 500, "down_bytes": 500},
    {"date": "2026-09-28", "up_bytes": 500, "down_bytes": 500},
    {"date": "2026-09-29", "up_bytes": 750, "down_bytes": 750},
]}
chk(trip("bandwidth_spike", trip_payload) is not None, "bandwidth_spike TRIPS when today is 5x the trailing mean")
chk(trip("bandwidth_spike", non_trip_payload) is None, "bandwidth_spike does NOT trip at 1.5x the trailing mean")
chk(trip("bandwidth_spike", {"bandwidth_daily": [{"date": "2026-09-29", "up_bytes": 100, "down_bytes": 0}]}) is None,
    "bandwidth_spike does NOT trip / crash with fewer than 2 days of data")

# --- compression_failure ---------------------------------------------------
trip_payload = {"context": {"cooldowns": [{"id": "s1", "title": "stuck session"}]}}
non_trip_payload = {"context": {"cooldowns": []}}
chk(trip("compression_failure", trip_payload) is not None, "compression_failure TRIPS when a session is in cooldown")
chk(trip("compression_failure", non_trip_payload) is None, "compression_failure does NOT trip with an empty cooldowns list")

# --- build_alerts: sort order + shape --------------------------------------
combined = {
    "_now": NOW,
    "rows": [{"cost_class": "metered", "priced": False, "model": "x"}],
    "agents": [{"state": "dead", "age_s": 900, "backend": "b1"}],
    "recent_ended": [{"end_reason": "ws_orphan_reap", "ended_at": NOW - 10}],
}
alerts = build_alerts(combined)
chk(len(alerts) == 3, "3 tripping rules in the combined fixture -> 3 alerts", len(alerts))
severities = [a["severity"] for a in alerts]
chk(severities == sorted(severities, key=lambda s: SEVERITY_ORDER[s]),
    "alerts are sorted severity-first (critical before warning before info)", severities)
chk(all({"rule", "severity", "value", "threshold", "message", "target_view", "why"} <= set(a.keys()) for a in alerts),
    "every alert carries the full documented shape (rule/severity/value/threshold/message/target_view/why)")

# --- negative control: an empty payload -> zero alerts ----------------------
chk(build_alerts({}) == [], "a completely empty payload trips NOTHING (every predicate degrades safely)")

# --- every rule in RULES has both a real tripping AND non-tripping case
# covered above -- sanity check that this test file actually exercises
# every rule, not a subset.
tested_rules = {"unpriced_cloud_model", "delegation_failure_rate", "orphan_reap", "backend_stale",
                 "long_running_session", "tool_failure_high", "bandwidth_spike",
                 "compression_failure"}
chk({r["name"] for r in RULES} == tested_rules, "every rule in RULES has an explicit test above", {r["name"] for r in RULES})

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
