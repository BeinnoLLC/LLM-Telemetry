#!/usr/bin/env python3
"""P10-09 (#97): context_compaction unit tests, zero DB.

Verification per the ticket's own criteria:
- fixture with two compactions -> two markers, yield = before - after,
  ineffective flag set on the < 10% one
- negative control: no compactions -> markers absent, yield card hidden
  (the data-layer half: compactions == [])
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))
from llm_telemetry.context_compaction import (  # noqa: E402
    MAX_SERIES_POINTS, build_context, build_cooldowns, build_reasoning_by_model,
    build_session_context,
)

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{('  ' + str(extra)) if extra is not None else ''}")
    if ok:
        p += 1
    else:
        f += 1


# --- two compactions: one effective, one ineffective ------------------
calls = [(100, 5000), (110, 20000), (120, 3000), (130, 25000), (140, 24500)]
compactions = [
    (115, 20000, 3000),   # yield 17000 / 20000 = 85% -> effective
    (135, 25000, 24500),  # yield 500 / 25000 = 2% -> ineffective
]
sc = build_session_context("s1", calls, compactions)
chk(len(sc["compactions"]) == 2, "two compactions in -> two markers out", len(sc["compactions"]))
chk(sc["compactions"][0]["yield_tok"] == 17000, "yield = before - after for the first compaction", sc["compactions"][0]["yield_tok"])
chk(sc["compactions"][0]["ineffective"] is False, "an 85%-yield compaction is NOT flagged ineffective")
chk(sc["compactions"][1]["yield_tok"] == 500, "yield = before - after for the second compaction")
chk(sc["compactions"][1]["ineffective"] is True, "a 2%-yield compaction (< 10%) IS flagged ineffective — the ticket's own threshold")
chk(len(sc["series"]) == 5, "the series carries all 5 call samples (under the downsample cap)")

# --- negative control: no compactions -> markers absent ----------------
sc_empty = build_session_context("s2", calls, [])
chk(sc_empty["compactions"] == [], "no compactions in the fixture -> an EMPTY compactions list (the ticket's own negative control)")
chk(len(sc_empty["series"]) == 5, "the series still carries the call samples even with zero compactions")

# --- downsampling caps the series -------------------------------------
big_calls = [(i, 1000 + i) for i in range(500)]
sc_big = build_session_context("s3", big_calls, [])
chk(len(sc_big["series"]) == MAX_SERIES_POINTS, f"a 500-call session downsamples to the {MAX_SERIES_POINTS}-point cap", len(sc_big["series"]))
chk(sc_big["series"][0] == [0, 1000], "downsampling keeps the FIRST point exactly")
chk(sc_big["series"][-1] == [499, 1499], "downsampling keeps the LAST point exactly")

# --- exactly-at-the-boundary count is NOT downsampled -------------------
boundary_calls = [(i, i) for i in range(MAX_SERIES_POINTS)]
sc_boundary = build_session_context("s4", boundary_calls, [])
chk(len(sc_boundary["series"]) == MAX_SERIES_POINTS, "a session at EXACTLY the cap is untouched, not off-by-one downsampled")

# --- reasoning_by_model: share is / output, never / input, never NaN ---
usage = [
    {"model": "gpt-5-thinking", "reasoning_tokens": 40000, "output_tokens": 100000},
    {"model": "claude-opus", "reasoning_tokens": 0, "output_tokens": 50000},  # no reasoning at all -> dropped
    {"model": "deepseek-r1", "reasoning_tokens": 9000, "output_tokens": 10000},
]
rbm = build_reasoning_by_model(usage)
chk(len(rbm) == 2, "a model with zero reasoning AND its own row present is dropped entirely (nothing to report)", len(rbm))
chk(rbm[0]["model"] == "gpt-5-thinking", "sorted by reasoning_tokens descending (largest first)")
chk(abs(rbm[0]["share"] - 0.4) < 1e-9, "share = reasoning / OUTPUT tokens (40000/100000 = 0.4), never / input", rbm[0]["share"])
chk(abs(rbm[1]["share"] - 0.9) < 1e-9, "deepseek-r1: 9000/10000 = 0.9", rbm[1]["share"])

usage_zero_output = [{"model": "weird", "reasoning_tokens": 5, "output_tokens": 0}]
rbm2 = build_reasoning_by_model(usage_zero_output)
chk(rbm2[0]["share"] == 0.0, "zero output tokens with nonzero reasoning gives share=0.0, never a crash or NaN")

# --- cooldowns: only CURRENT ones, error truncated to first line -------
now = 1_800_000_000
sessions = [
    {"id": "cooling", "title": "Still cooling down", "compression_failure_cooldown_until": now + 300,
     "compression_failure_error": "RateLimitError: 429 too many requests\nfull traceback line 2\nline 3"},
    {"id": "expired", "title": "Cooldown already over", "compression_failure_cooldown_until": now - 300,
     "compression_failure_error": "old error"},
    {"id": "never", "title": "Never had one", "compression_failure_cooldown_until": None,
     "compression_failure_error": None},
]
cds = build_cooldowns(sessions, now)
chk(len(cds) == 1, "only the CURRENTLY-cooling session is returned (expired and never-cooled are dropped)", len(cds))
chk(cds[0]["id"] == "cooling", "the returned cooldown is the right session")
chk(cds[0]["error_head"] == "RateLimitError: 429 too many requests", "the stored error is truncated to its first line only (verbatim head)")

# --- top-level assembly: a session with zero calls AND zero compactions
# is dropped entirely (dead weight) -----------------------------------
top = build_context(
    sessions_calls={"real": calls, "empty": []},
    sessions_compactions={"real": [], "empty": []},
    usage_rows=usage, session_rows=sessions, now=now,
)
ids = {s["id"] for s in top["sessions"]}
chk(ids == {"real"}, "a session with zero calls and zero compactions is dropped from the payload entirely", ids)
chk(len(top["reasoning_by_model"]) == 2, "top-level assembly wires reasoning_by_model through unchanged")
chk(len(top["cooldowns"]) == 1, "top-level assembly wires cooldowns through unchanged")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
