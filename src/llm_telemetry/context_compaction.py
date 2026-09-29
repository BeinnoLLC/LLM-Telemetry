#!/usr/bin/env python3
"""P10-09 (#97): context & compaction — growth, yield, reasoning share.

Pure functions, zero DB dependency. Operates on already-fetched per-
session assistant-call token samples and the session's own
`compression_*` bookkeeping columns.
"""
from __future__ import annotations

# A compaction that recovers less than this fraction of the pre-compaction
# context is "ineffective" -- same semantics Hermes's own
# `compression_ineffective_count` uses, so the two never disagree.
INEFFECTIVE_YIELD_THRESHOLD = 0.10

# Downsample any session's series to at most this many points before it
# leaves this module -- the payload asserts on this cap directly (ticket's
# own requirement), so a 10,000-call session never balloons the page.
MAX_SERIES_POINTS = 120


def _downsample(series):
    """Evenly-spaced downsample, always keeping the first and last point
    (a session's start and its most recent state are the two points a
    reader looks for first)."""
    n = len(series)
    if n <= MAX_SERIES_POINTS:
        return series
    step = (n - 1) / (MAX_SERIES_POINTS - 1)
    out = []
    for i in range(MAX_SERIES_POINTS):
        out.append(series[round(i * step)])
    return out


def build_session_context(session_id, calls, compactions):
    """calls: [(ts, input_tokens)] for this session's assistant calls,
    ASCENDING by ts, input_tokens already includes cache-read per the
    ticket's own "context size" framing (a cache-read tokens the model
    still has to hold in its context window). compactions: [(ts, before,
    after)] where before/after are the input_tokens of the call
    immediately preceding/following the compaction event.

    Returns {id, series, compactions} -- `compactions` entries gain
    `yield_tok` and `ineffective`.
    """
    series = [[ts, tok] for ts, tok in calls]
    out_compactions = []
    for ts, before, after in compactions:
        yield_tok = max(0, before - after)
        ineffective = before > 0 and (yield_tok / before) < INEFFECTIVE_YIELD_THRESHOLD
        out_compactions.append({
            "ts": ts, "before": before, "after": after,
            "yield_tok": yield_tok, "ineffective": ineffective,
        })
    return {
        "id": session_id,
        "series": _downsample(series),
        "compactions": out_compactions,
    }


def build_reasoning_by_model(usage_rows):
    """usage_rows: [{model, reasoning_tokens, output_tokens}] (already
    grouped/summed per model by the caller's SQL, one row per model).
    Returns [{model, reasoning_tokens, output_tokens, share}] sorted by
    reasoning_tokens descending -- reasoning is billed as OUTPUT tokens,
    so `share` is reasoning_tokens / output_tokens, never / input, and a
    model with zero output tokens (shouldn't happen, but no invented
    denominator) gets share=0 rather than a ZeroDivisionError or NaN.
    """
    out = []
    for r in usage_rows:
        reasoning = int(r.get("reasoning_tokens") or 0)
        output = int(r.get("output_tokens") or 0)
        if reasoning == 0:
            # Nothing to report for a model that never used reasoning
            # tokens -- showing a permanent 0% row for every non-reasoning
            # model would drown out the ones that matter.
            continue
        share = (reasoning / output) if output else 0.0
        out.append({
            "model": r.get("model") or "(unknown)",
            "reasoning_tokens": reasoning,
            "output_tokens": output,
            "share": round(share, 4),
        })
    out.sort(key=lambda x: x["reasoning_tokens"], reverse=True)
    return out


def build_cooldowns(session_rows, now):
    """session_rows: [{id, title, compression_failure_cooldown_until,
    compression_failure_error}]. Returns only sessions CURRENTLY under
    cooldown (until > now) -- a session whose cooldown already expired is
    not "currently" anything, per the ticket's own wording, so it is
    dropped rather than shown as a stale warning. The stored error is
    truncated to its first line only (verbatim head, per the ticket --
    never a full traceback dumped into the dashboard).
    """
    out = []
    for r in session_rows:
        until = r.get("compression_failure_cooldown_until")
        if until is None or until <= now:
            continue
        err = r.get("compression_failure_error") or ""
        head = err.split("\n", 1)[0][:200]
        out.append({
            "id": r["id"],
            "title": r.get("title") or "(untitled)",
            "cooldown_until": until,
            "error_head": head,
        })
    out.sort(key=lambda x: x["cooldown_until"])
    return out


def build_context(sessions_calls, sessions_compactions, usage_rows, session_rows, now):
    """Top-level assembly. sessions_calls: {session_id: [(ts, tok)]}.
    sessions_compactions: {session_id: [(ts, before, after)]}. Sessions
    with zero calls AND zero compactions are dropped entirely -- an empty
    series/compactions pair for a session nobody ran anything in would
    just be dead weight on the payload.
    """
    sessions = []
    all_ids = set(sessions_calls) | set(sessions_compactions)
    for sid in sorted(all_ids):
        calls = sessions_calls.get(sid, [])
        compactions = sessions_compactions.get(sid, [])
        if not calls and not compactions:
            continue
        sessions.append(build_session_context(sid, calls, compactions))
    return {
        "sessions": sessions,
        "reasoning_by_model": build_reasoning_by_model(usage_rows),
        "cooldowns": build_cooldowns(session_rows, now),
    }
