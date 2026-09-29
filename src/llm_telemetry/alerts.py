#!/usr/bin/env python3
"""P10-10 (#98): Attention card — every rule that tripped, in one place.

Rules live in ONE Python table (RULES below): name, severity, a predicate
function over the already-built analytics payload, and a message
template. The dashboard JS renders only what this module evaluated — it
never re-derives a threshold client-side, so the page cannot drift from
the collector (the ticket's own explicit requirement).

Every threshold is an opinion. Each rule carries its own `why` string
saying so, shown on hover in the UI — this module states them plainly
rather than pretending a cutoff is objective fact.
"""
from __future__ import annotations

SEVERITY_ORDER = {"critical": 0, "warning": 1, "info": 2}


def _rule(name, severity, target_view, why, predicate, message, threshold=0.0, value=lambda v: v):
    return {
        "name": name, "severity": severity, "target_view": target_view,
        "why": why, "predicate": predicate, "message": message,
        "threshold": threshold, "value": value,
    }


def _r_unpriced_cloud(payload):
    """#82: a metered/cloud row with no catalogue rate silently contributes
    $0 to every cost total — the dashboard would be lying about spend."""
    rows = payload.get("rows") or []
    models = sorted({r.get("model") or "(unknown)" for r in rows
                      if r.get("cost_class") == "metered" and not r.get("priced")})
    if not models:
        return None
    return len(models), ", ".join(models[:5]) + (", ..." if len(models) > 5 else "")


def _r_delegation_failure(payload):
    """Delegation child failure rate over the payload's own 7-day-scoped
    numbers (delegations.summarize() is already scoped to whatever range
    the collector queried it over)."""
    d = payload.get("delegations")
    if not d or not d.get("children"):
        return None
    total = d["children"]
    failed = d.get("failed", 0)
    rate = 100.0 * failed / total
    if rate <= 25.0:
        return None
    return round(rate, 1), failed, total


def _r_orphan_reap(payload):
    """Any session the collector itself detected as abandoned mid-turn in
    the last 24h — end_reason startup_orphan_reap / ws_orphan_reap."""
    import time
    now = payload.get("_now", time.time())
    reaps = [
        s for s in (payload.get("recent_ended") or [])
        if (s.get("end_reason") in ("startup_orphan_reap", "ws_orphan_reap"))
        and (now - (s.get("ended_at") or 0)) <= 86400
    ]
    if not reaps:
        return None
    return len(reaps)


def _r_backend_stale(payload):
    """A gateway backend (agents_alive.py, #96) stale or dead for more than
    10 minutes -- its own age_s already carries the classification."""
    stale = [a for a in (payload.get("agents") or [])
             if a.get("state") in ("stale", "dead") and (a.get("age_s") or 0) > 600]
    if not stale:
        return None
    worst = max(stale, key=lambda a: a["age_s"])
    return len(stale), worst["backend"], round(worst["age_s"] / 60.0, 1)


def _r_long_session(payload):
    """A live session running longer than 3 hours -- runaway agent or a
    forgotten background job, either way worth a human's attention."""
    import time
    now = payload.get("_now", time.time())
    long_ones = [s for s in (payload.get("live") or [])
                 if s.get("started_at") and (now - s["started_at"]) > 3 * 3600]
    if not long_ones:
        return None
    oldest = max(long_ones, key=lambda s: now - s["started_at"])
    return len(long_ones), oldest.get("title") or oldest.get("id"), round((now - oldest["started_at"]) / 3600.0, 1)


def _r_tool_failure_high(payload):
    """A tool with a real (MEASURED, not inferred-from-text) failure rate
    above 20% over the last 7 days, at least 5 calls so one bad call
    can't trip this -- reuses delegations.py's own `tools` aggregate
    (tool_trace[].status), never the separate error-text-guess signal
    delegations.py's own docstring warns must never be mixed with it."""
    tools = ((payload.get("delegations") or {}).get("tools")) or []
    bad = [t for t in tools if t.get("calls", 0) >= 5 and (100.0 - t.get("rate", 100.0)) > 20.0]
    if not bad:
        return None
    worst = max(bad, key=lambda t: 100.0 - t["rate"])
    return len(bad), worst["tool"], round(100.0 - worst["rate"], 1), worst["calls"]


def _r_bandwidth_spike(payload):
    """Today's total bandwidth more than 3x the trailing daily mean --
    payload's own `bandwidth_daily` series (P8-04, bandwidth_history.py),
    same rows the Bandwidth view sums; each row is per (date, provider,
    model), so this aggregates up_bytes+down_bytes per date first, the
    same way the Bandwidth view's own daily total is built."""
    rows = payload.get("bandwidth_daily") or []
    by_date: dict = {}
    for r in rows:
        d = r.get("date") or ""
        by_date[d] = by_date.get(d, 0) + int(r.get("up_bytes") or 0) + int(r.get("down_bytes") or 0)
    dates = sorted(by_date)
    if len(dates) < 2:
        return None
    today_bytes = by_date[dates[-1]]
    trailing = [by_date[d] for d in dates[:-1]]
    mean = sum(trailing) / len(trailing)
    if mean <= 0 or today_bytes <= 3 * mean:
        return None
    return round(today_bytes / mean, 1)


def _r_compression_failure(payload):
    """A session with a stored compaction failure error right now --
    reuses context_compaction.py's own cooldowns list (#97), never a
    second query for the same fact."""
    cooldowns = (payload.get("context") or {}).get("cooldowns") or []
    if not cooldowns:
        return None
    return len(cooldowns), cooldowns[0].get("title") or cooldowns[0].get("id")


RULES = [
    _rule("unpriced_cloud_model", "warning", "Cost",
          "A metered/cloud model with no catalogue rate silently counts as $0 spend.",
          _r_unpriced_cloud,
          lambda v: f"{v[0]} unpriced cloud model{'s' if v[0]!=1 else ''} counted as $0: {v[1]}",
          threshold=0, value=lambda v: v[0]),
    _rule("delegation_failure_rate", "critical", "Health",
          "25% is roughly the point where a delegation run stops being a normal tail and starts wasting real wall-clock time.",
          _r_delegation_failure,
          lambda v: f"Delegation failure rate {v[0]}% over the last 7 days ({v[1]}/{v[2]} children)",
          threshold=25.0, value=lambda v: v[0]),
    _rule("orphan_reap", "critical", "Usage",
          "A reap means the agent process died mid-turn with the work unaccounted for -- always worth knowing about.",
          _r_orphan_reap,
          lambda v: f"{v} session{'s' if v!=1 else ''} reaped as orphaned in the last 24h",
          threshold=0, value=lambda v: v),
    _rule("backend_stale", "warning", "Live",
          "10 minutes is well past the ~1-minute heartbeat cadence -- a healthy backend should never be this quiet.",
          _r_backend_stale,
          lambda v: f"{v[0]} backend{'s' if v[0]!=1 else ''} stale/dead, worst: {v[1]} ({v[2]} min)",
          threshold=10.0, value=lambda v: v[2]),
    _rule("long_running_session", "info", "Live",
          "3 hours is well past a normal interactive turn -- likely a runaway agent or a forgotten background job.",
          _r_long_session,
          lambda v: f"{v[0]} session{'s' if v[0]!=1 else ''} running over 3h, longest: {v[1]} ({v[2]}h)",
          threshold=3.0, value=lambda v: v[2]),
    _rule("tool_failure_high", "warning", "Health",
          "20% failure over at least 5 calls is a real, measured problem, not noise from one bad call.",
          _r_tool_failure_high,
          lambda v: f"{v[0]} tool{'s' if v[0]!=1 else ''} with a measured failure rate above 20%, worst: {v[1]} ({v[2]}% over {v[3]} calls)",
          threshold=20.0, value=lambda v: v[2]),
    _rule("bandwidth_spike", "info", "Usage",
          "3x the trailing mean is a real spike worth a look, not the normal day-to-day variance.",
          _r_bandwidth_spike,
          lambda v: f"Today's bandwidth is {v}x the trailing mean",
          threshold=3.0, value=lambda v: v),
    _rule("compression_failure", "warning", "Detail",
          "A session stuck failing to compact will keep growing its context until something breaks.",
          _r_compression_failure,
          lambda v: f"{v[0]} session{'s' if v[0]!=1 else ''} in a compaction-failure cooldown, e.g. {v[1]}",
          threshold=0, value=lambda v: v[0]),
]


def build_alerts(payload):
    """Evaluates every rule in RULES against `payload`, returns the list of
    TRIPPED alerts sorted by severity (critical first). Returns [] when
    nothing tripped -- the UI hides the whole card on an empty list.
    """
    out = []
    for rule in RULES:
        raw = rule["predicate"](payload)
        if raw is None:
            continue
        out.append({
            "rule": rule["name"],
            "severity": rule["severity"],
            "value": rule["value"](raw),
            "threshold": rule["threshold"],
            "message": rule["message"](raw),
            "target_view": rule["target_view"],
            "why": rule["why"],
        })
    out.sort(key=lambda a: SEVERITY_ORDER.get(a["severity"], 99))
    return out
