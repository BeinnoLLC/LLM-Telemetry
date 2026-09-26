#!/usr/bin/env python3
"""Delegation outcomes: what happened when this agent spawned subagents.

Hermes records one row per `delegate_task` fan-out in `async_delegations`, and
`result_json` carries a structured entry per child: status, failure_reason,
exit_reason, model, cost_usd, tokens, duration_seconds and a tool_trace whose
entries each carry their OWN status.

Two things matter here and are easy to get wrong:

1. The delegation-level `state` column is NOT the child outcome. A delegation
   can be state='completed' while a child inside it failed. Rates must be
   computed per CHILD, from result_json, or a 27%-failure reality reads as a
   clean run.

2. `tool_trace[].status` is MEASURED — the runtime recorded whether each call
   succeeded. Everywhere else in this project tool failure is inferred by
   looking for error-ish text in message content, which is a guess. Numbers
   from these two sources must never be added together or shown in the same
   column: the guess reports `terminal` at ~41% failure, the measurement at
   0.1%. Callers get `measured: True` on this payload so the UI can say so.
"""
import json
import sqlite3


# Child statuses that count as a clean finish. Anything else burned wall-clock
# without delivering, which is the number the user actually wants to see.
OK_STATUS = "completed"


def _tokens_of(entry):
    """tokens is {"input": N, "output": N} — older rows may carry a bare int."""
    tk = entry.get("tokens")
    if isinstance(tk, dict):
        return int(tk.get("input") or 0) + int(tk.get("output") or 0)
    try:
        return int(tk or 0)
    except (TypeError, ValueError):
        return 0


def _children(result_json):
    """Yield each child result dict from one delegation's result_json."""
    if not result_json:
        return
    try:
        doc = json.loads(result_json)
    except (ValueError, TypeError):
        return
    if not isinstance(doc, dict):
        return
    for entry in doc.get("results") or []:
        if isinstance(entry, dict):
            yield entry


def summarize(rows):
    """rows: iterable of (delegation_id, state, dispatched_at, completed_at,
    result_json, task_json). -> payload dict for the dashboard.

    Returns None when there are no delegations at all, so the UI can hide the
    panel rather than render an empty shell.
    """
    by_model = {}
    reasons = {}
    exits = {}
    tools = {}
    recent = []
    n = ok = 0
    wasted_s = 0.0
    total_cost = 0.0

    for did, state, disp_at, comp_at, result_json, task_json in rows:
        goal = ""
        if task_json:
            try:
                t = json.loads(task_json)
                goal = (t.get("goal") or "") if isinstance(t, dict) else ""
            except (ValueError, TypeError):
                goal = ""
        kids = list(_children(result_json))
        for entry in kids:
            n += 1
            status = entry.get("status") or "unknown"
            good = status == OK_STATUS
            ok += good
            model = entry.get("model") or "(unknown)"
            dur = float(entry.get("duration_seconds") or 0)
            cost = float(entry.get("cost_usd") or 0)
            total_cost += cost
            if not good:
                wasted_s += dur

            m = by_model.setdefault(model, {
                "model": model, "n": 0, "ok": 0, "cost_usd": 0.0,
                "tokens": 0, "seconds": 0.0, "wasted_s": 0.0,
            })
            m["n"] += 1
            m["ok"] += good
            m["cost_usd"] += cost
            m["tokens"] += _tokens_of(entry)
            m["seconds"] += dur
            if not good:
                m["wasted_s"] += dur

            if not good:
                # failure_reason is None for a plain interrupt; fall back to the
                # exit_reason so every non-completed child lands in some bucket.
                why = entry.get("failure_reason") or entry.get("exit_reason") or status
                reasons[why] = reasons.get(why, 0) + 1
            exits[entry.get("exit_reason") or "unknown"] = \
                exits.get(entry.get("exit_reason") or "unknown", 0) + 1

            for call in entry.get("tool_trace") or []:
                if not isinstance(call, dict):
                    continue
                name = call.get("tool") or "(unknown)"
                t = tools.setdefault(name, {"tool": name, "calls": 0, "fail": 0})
                t["calls"] += 1
                if call.get("status") != "ok":
                    t["fail"] += 1

            recent.append({
                "id": did,
                "goal": goal[:160],
                "status": status,
                "model": model,
                "failure_reason": entry.get("failure_reason"),
                "exit_reason": entry.get("exit_reason"),
                "seconds": round(dur, 1),
                "cost_usd": round(cost, 4),
                "cost_status": entry.get("cost_status"),
                "api_calls": entry.get("api_calls"),
                "at": comp_at or disp_at,
            })

    if not n:
        return None

    for m in by_model.values():
        m["rate"] = round(100.0 * m["ok"] / m["n"], 1)
        m["cost_usd"] = round(m["cost_usd"], 4)
        m["hours"] = round(m["seconds"] / 3600.0, 2)
        m["wasted_hours"] = round(m["wasted_s"] / 3600.0, 2)
        m.pop("seconds", None)
        m.pop("wasted_s", None)

    for t in tools.values():
        t["rate"] = round(100.0 * (t["calls"] - t["fail"]) / t["calls"], 1)

    recent.sort(key=lambda r: (r["at"] or 0), reverse=True)

    return {
        "children": n,
        "ok": ok,
        "failed": n - ok,
        "rate": round(100.0 * ok / n, 1),
        "wasted_hours": round(wasted_s / 3600.0, 2),
        "cost_usd": round(total_cost, 4),
        "by_model": sorted(by_model.values(), key=lambda m: (-m["n"], m["model"])),
        "reasons": dict(sorted(reasons.items(), key=lambda kv: -kv[1])),
        "exits": dict(sorted(exits.items(), key=lambda kv: -kv[1])),
        # Measured, not inferred — see the module docstring.
        "tools": sorted(tools.values(), key=lambda t: -t["calls"]),
        "tools_measured": True,
        "recent": recent[:40],
    }


SQL = """
select delegation_id, state, dispatched_at, completed_at, result_json, task_json
  from async_delegations
"""


def collect(conn):
    """Read one profile's state.db connection -> payload (or None)."""
    try:
        rows = conn.execute(SQL).fetchall()
    except sqlite3.OperationalError as e:
        # Older Hermes builds have no async_delegations table; that is not an
        # error, it just means this profile never delegated. Anything else
        # (a closed connection, a renamed column) is a real bug and must not be
        # swallowed — a bare `except` here once turned "you called the collector
        # after closing the db" into a silent empty panel.
        if "no such table" in str(e).lower():
            return None
        raise
    return summarize(rows)
