#!/usr/bin/env python3
"""P10-05 (#93): latency — p50/p90/p99 of assistant-turn gaps, idle excluded.

"Latency" here means what the user actually waited: the gap between one
assistant message and the previous one, within the SAME session. A gap
above the idle threshold (default 600s) means the user walked away and
came back — that is not the model being slow, and must never enter the
percentile math. It is counted in a separate `idle_gaps` bucket instead
so the two questions ("how long do responses take" vs "how often do
sessions sit idle") stay answerable independently.
"""
from __future__ import annotations

DEFAULT_IDLE_THRESHOLD_S = 600


def _percentile(sorted_vals, pct):
    """Nearest-rank percentile over an already-sorted list of numbers.
    Returns None for an empty list — a p99 with zero samples is not 0,
    it's undefined, and the payload must say so rather than lie with a
    round number."""
    if not sorted_vals:
        return None
    idx = min(len(sorted_vals) - 1, int(round(pct / 100.0 * (len(sorted_vals) - 1))))
    return sorted_vals[idx]


def compute_gaps(rows, idle_threshold_s=DEFAULT_IDLE_THRESHOLD_S):
    """rows: iterable of (session_id, ts, model, base_url, output_tokens) for
    assistant messages, ANY ORDER — this function sorts per-session by
    timestamp itself so callers never need to pre-sort across sessions.

    Returns (gaps, idle_gaps) where each gap is
    {session, ts, model, base_url, s, tok_s}. `tok_s` is None when the row
    carries no token count (nothing to divide) rather than 0, which would
    read as "zero tokens per second" instead of "unknown".

    Only CONSECUTIVE assistant turns within the same session produce a gap
    — the first assistant message of a session has nothing before it to
    compare to and is correctly excluded, not counted as a 0s gap.
    """
    by_session = {}
    for sid, ts, model, base_url, out_tok in rows:
        by_session.setdefault(sid, []).append((ts, model, base_url, out_tok))

    gaps, idle_gaps = [], []
    for sid, turns in by_session.items():
        turns.sort(key=lambda t: t[0])
        for i in range(1, len(turns)):
            prev_ts = turns[i - 1][0]
            ts, model, base_url, out_tok = turns[i]
            delta = ts - prev_ts
            if delta < 0:
                # Clock skew / out-of-order write — not a real gap either
                # direction; skip rather than record a negative latency.
                continue
            tok_s = (out_tok / delta) if (out_tok and delta > 0) else None
            row = {"session": sid, "ts": ts, "model": model, "base_url": base_url,
                   "s": round(delta, 3), "tok_s": round(tok_s, 2) if tok_s is not None else None}
            (idle_gaps if delta > idle_threshold_s else gaps).append(row)
    return gaps, idle_gaps


def build_latency(gaps, endpoint_of, slowest_n=10):
    """gaps: the non-idle list from compute_gaps(). endpoint_of: callable
    base_url -> endpoint label (injected so this module never has to know
    about canonical_endpoint/prov_of itself — keeps it independently
    testable with a trivial identity function).

    Returns {by_model, by_endpoint, slowest}. `n` is carried on every
    bucket so a p99 computed from 4 samples is visibly labelled as such,
    per the ticket's own payload spec — the UI must not present a 4-sample
    p99 with the same visual weight as a 4,000-sample one.
    """
    by_model_raw = {}
    by_endpoint_raw = {}
    for g in gaps:
        by_model_raw.setdefault(g["model"] or "(unknown)", []).append(g)
        ep = endpoint_of(g["base_url"]) or "(unknown)"
        by_endpoint_raw.setdefault(ep, []).append(g)

    def summarize(bucket_rows):
        secs = sorted(r["s"] for r in bucket_rows)
        tok_s_vals = sorted(r["tok_s"] for r in bucket_rows if r["tok_s"] is not None)
        return {
            "n": len(bucket_rows),
            "p50": _percentile(secs, 50), "p90": _percentile(secs, 90), "p99": _percentile(secs, 99),
            "tok_s": _percentile(tok_s_vals, 50),
        }

    by_model = {name: summarize(rows) for name, rows in by_model_raw.items()}
    by_endpoint = {name: summarize(rows) for name, rows in by_endpoint_raw.items()}
    slowest = sorted(gaps, key=lambda g: -g["s"])[:slowest_n]
    slowest = [{"session": g["session"], "ts": g["ts"], "model": g["model"], "s": g["s"]} for g in slowest]

    return {"by_model": by_model, "by_endpoint": by_endpoint, "slowest": slowest}
