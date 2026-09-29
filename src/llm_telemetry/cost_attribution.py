#!/usr/bin/env python3
"""P10-07 (#95): cost attribution — who spent it, not just how much.

Pure functions operating on already-priced ROWS (the same per-(date,
model, provider, task, session) rows collect_analytics.build() already
produces via pricing.price_row() — this module NEVER recomputes a price,
it only re-groups the market_value_usd the dashboard already trusts).
"""
from __future__ import annotations

CRON_DISPLAY_MIN_RUNS = 1  # every cron job with at least one run gets a row


def by_source(rows):
    """Cost/tokens/session-count grouped by session source
    (desktop/subagent/cron/tui/oneshot/...). Every row's source comes from
    the caller (joined in from sessions.source — ROWS itself has no source
    column) so an unrecognised future source still gets its own bucket
    rather than silently vanishing into "unknown"."""
    buckets = {}
    for r in rows:
        src = r.get("source") or "(unknown)"
        b = buckets.setdefault(src, {"source": src, "cost": 0.0, "tokens": 0, "sessions": set()})
        b["cost"] += r.get("market_value_usd", 0.0)
        b["tokens"] += (r.get("inp", 0) + r.get("outp", 0) + r.get("cread", 0))
        b["sessions"].add(r.get("session_id"))
    out = [{"source": b["source"], "cost": round(b["cost"], 6), "tokens": b["tokens"],
            "sessions": len(b["sessions"])} for b in buckets.values()]
    out.sort(key=lambda x: -x["cost"])
    return out


def _root_of(session_id, sessions_by_id):
    """Walk parent_session_id to the root. `seen` guards against a cyclic
    parent chain (should never happen, but a collector must not infinite-
    loop on bad data) by stopping at the first repeat."""
    seen = set()
    cur = session_id
    while True:
        info = sessions_by_id.get(cur)
        if not info or not info.get("parent_session_id") or cur in seen:
            return cur
        seen.add(cur)
        cur = info["parent_session_id"]


def by_root(rows, sessions_by_id):
    """Cost grouped by ROOT session: a root's 'own' cost is spend recorded
    directly against it, 'descendants' is everything recorded against any
    session whose parent-chain walk reaches it, 'total' is both. A lonely
    session with no children and no parent is its own root — own==total,
    descendants==0 — so single-session work still shows up honestly rather
    than being hidden because it "isn't a tree"."""
    roots = {}
    for r in rows:
        sid = r.get("session_id")
        if not sid:
            continue
        root_id = _root_of(sid, sessions_by_id)
        b = roots.setdefault(root_id, {"id": root_id, "own": 0.0, "descendants": 0.0})
        cost = r.get("market_value_usd", 0.0)
        if root_id == sid:
            b["own"] += cost
        else:
            b["descendants"] += cost
    out = []
    for root_id, b in roots.items():
        info = sessions_by_id.get(root_id) or {}
        out.append({
            "id": root_id,
            "title": info.get("title") or "(untitled)",
            "own": round(b["own"], 6),
            "descendants": round(b["descendants"], 6),
            "total": round(b["own"] + b["descendants"], 6),
        })
    out.sort(key=lambda x: -x["total"])
    return out


def by_cron(rows, sessions_by_id):
    """Cron sessions grouped by their display name (job identity) into a
    recurring line item: run count, average cost per run, and a naive
    monthly projection (avg-per-run * runs-per-day-observed * 30) — NOT a
    guess at the job's actual schedule, which this module has no access
    to; the projection is explicitly "if it keeps running like this
    30-day window did", stated as such by the caller/UI, never presented
    as a real cron-expression-derived forecast."""
    jobs = {}
    for r in rows:
        sid = r.get("session_id")
        info = sessions_by_id.get(sid) or {}
        if (r.get("source") or "") != "cron":
            continue
        name = info.get("title") or info.get("display_name") or "(unnamed cron job)"
        b = jobs.setdefault(name, {"name": name, "cost": 0.0, "sessions": set()})
        b["cost"] += r.get("market_value_usd", 0.0)
        b["sessions"].add(sid)
    out = []
    for name, b in jobs.items():
        runs = len(b["sessions"])
        avg = b["cost"] / runs if runs else 0.0
        out.append({
            "name": name, "runs": runs, "total": round(b["cost"], 6),
            "avg": round(avg, 6),
            # 30-day window IS the projection base — same window ROWS is
            # already filtered to, so "runs" already means "runs in 30
            # days" and no separate day-count math is needed here.
            "monthly_projection": round(avg * runs, 6),
        })
    out.sort(key=lambda x: -x["total"])
    return out


def by_tool(rows, tool_token_rows):
    """Cost attributed to TOOL RESULTS, separate from model-call cost:
    `tool_token_rows` is [{tool_name, session_id, tokens}] (token_count of
    tool-role messages) joined against the SAME per-session average
    $/token the model-call rows already established for that session, so
    a tool doesn't get its own fictional price — it costs whatever that
    session's model already costs per token, applied to the tokens the
    tool result actually consumed (a read_file of a 30MB log really did
    make the NEXT call more expensive)."""
    session_rate = {}
    session_tokens = {}
    for r in rows:
        sid = r.get("session_id")
        if not sid:
            continue
        session_tokens[sid] = session_tokens.get(sid, 0) + r.get("inp", 0) + r.get("outp", 0) + r.get("cread", 0)
        session_rate[sid] = session_rate.get(sid, 0.0) + r.get("market_value_usd", 0.0)
    per_token = {sid: (session_rate[sid] / session_tokens[sid] if session_tokens.get(sid) else 0.0)
                 for sid in session_rate}

    tools = {}
    for t in tool_token_rows:
        name = t.get("tool_name") or "(unknown)"
        sid = t.get("session_id")
        tok = t.get("tokens", 0)
        cost = tok * per_token.get(sid, 0.0)
        b = tools.setdefault(name, {"tool": name, "tokens": 0, "cost": 0.0})
        b["tokens"] += tok
        b["cost"] += cost
    out = [{"tool": b["tool"], "tokens": b["tokens"], "cost": round(b["cost"], 6)} for b in tools.values()]
    out.sort(key=lambda x: -x["cost"])
    return out


def build_attribution(rows, sessions_by_id, tool_token_rows=None):
    return {
        "by_source": by_source(rows),
        "by_root": by_root(rows, sessions_by_id),
        "by_cron": by_cron(rows, sessions_by_id),
        "by_tool": by_tool(rows, tool_token_rows or []),
    }
