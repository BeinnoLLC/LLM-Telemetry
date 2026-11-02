"""Stale-rate policy: how old each data source may be before it counts as stale.

One definition shared by the dashboard build (DATA.stale) and the doctor, so
the page and the preflight can never disagree about what "stale" means.
"""
import datetime
import json
import os
import time

SOURCES = {
    "prices": {"file": "pricing-cache.json", "env": "LLM_TELEMETRY_STALE_PRICES_H",
               "default_h": 24.0, "timer": "llm-telemetry-prices.timer", "cadence_s": 24 * 3600},
    "rankings": {"file": "rankings-data.json", "env": "LLM_TELEMETRY_STALE_RANKINGS_H",
                 "default_h": 12.0, "timer": "llm-telemetry-rankings.timer", "cadence_s": 6 * 3600},
    "router": {"file": "router-data.json", "env": "LLM_TELEMETRY_STALE_ROUTER_H",
               "default_h": 3.0, "timer": "llm-telemetry-router.timer", "cadence_s": 3600},
    "quota": {"file": "quota-data.json", "env": "LLM_TELEMETRY_STALE_QUOTA_H",
              "default_h": 3.0, "timer": "llm-telemetry-quota.timer", "cadence_s": 3600},
    "analytics": {"file": "analytics-data.json", "env": "LLM_TELEMETRY_STALE_ANALYTICS_H",
                  "default_h": 0.25, "timer": "llm-telemetry-build.timer", "cadence_s": 60},
}


def policy_seconds(name, env=None):
    spec = SOURCES[name]
    env = os.environ if env is None else env
    try:
        hours = float(env.get(spec["env"], ""))
        if hours <= 0:
            raise ValueError
    except ValueError:
        hours = spec["default_h"]
    return int(hours * 3600)


def _ts(value):
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return float(value) / 1000 if value > 1e12 else float(value)
    try:
        dt = datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt.timestamp()


def stamp(value):
    """Epoch seconds for a payload timestamp, or None. Sample builds age against their own snapshot."""
    return _ts(value)


def _error(payload):
    err = payload.get("last_error")
    if isinstance(err, dict):
        err = err.get("reason")
    if not err and payload.get("status") == "unavailable":
        err = payload.get("reason") or "unavailable"
    return str(err) if err else None


def _stamp(name, payload):
    if name == "prices":
        return _ts(payload.get("fetched_at")) or _ts(payload.get("fetched"))
    if name == "rankings":
        return _ts(payload.get("fetched_at"))
    if name == "analytics":
        return _ts(payload.get("generated"))
    return _ts(payload.get("collected_at"))


def compute(reports_dir, now=None, env=None):
    """-> {source: {age_s, policy_s, stale, last_error, timer, cadence_s}}.

    A source with no artifact or no timestamp has age_s None and is not stale:
    plenty of hosts run without the quota plugin or rankings key, and absence
    is the doctor's artifact check to report, not a staleness verdict.
    """
    now = time.time() if now is None else now
    out = {}
    for name, spec in SOURCES.items():
        policy = policy_seconds(name, env)
        payload = {}
        try:
            with open(os.path.join(str(reports_dir), spec["file"]), encoding="utf-8") as fh:
                payload = json.load(fh)
        except (OSError, ValueError):
            pass
        if not isinstance(payload, dict):
            payload = {}
        ts = _stamp(name, payload)
        age = None if ts is None else max(0, int(now - ts))
        out[name] = {"age_s": age, "policy_s": policy,
                     "stale": age is not None and age > policy,
                     "last_error": _error(payload),
                     "timer": spec["timer"], "cadence_s": spec["cadence_s"]}
    return out
