#!/usr/bin/env python3
"""P10-05 (#93): latency module unit tests — percentiles computed
independently in this test (via Python's own statistics.quantiles-style
nearest-rank, hand-rolled here so the test does not import the exact same
_percentile() it is meant to be checking) and compared to compute_gaps()/
build_latency() output within rounding.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))
from llm_telemetry.latency import compute_gaps, build_latency, DEFAULT_IDLE_THRESHOLD_S  # noqa: E402

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{('  ' + str(extra)) if extra is not None else ''}")
    if ok:
        p += 1
    else:
        f += 1


def independent_percentile(vals, pct):
    """Nearest-rank percentile, computed with different index arithmetic
    than latency.py's own _percentile — a real independent check, not a
    call to the same function under test."""
    s = sorted(vals)
    if not s:
        return None
    rank = max(1, int(round(pct / 100.0 * len(s))))
    return s[min(rank, len(s)) - 1]


# ---- compute_gaps: idle exclusion ----
rows = [
    ("s1", 1000, "opus", "http://a", 100),
    ("s1", 1003, "opus", "http://a", 90),      # 3s gap
    ("s1", 1010, "opus", "http://a", 70),      # 7s gap
    ("s1", 1010 + 5 * 3600, "opus", "http://a", 50),  # 5h gap -> idle
    ("s2", 2000, "haiku", "http://b", 10),
    ("s2", 2001, "haiku", "http://b", 10),     # 1s gap
]
gaps, idle_gaps = compute_gaps(rows)
chk(len(gaps) == 3, f"3 non-idle gaps computed (5h gap excluded)", len(gaps))
chk(len(idle_gaps) == 1, "the 5-hour gap lands in the idle bucket, not gaps", len(idle_gaps))
chk(idle_gaps[0]["s"] == 5 * 3600, "the idle gap records the correct duration", idle_gaps[0]["s"])
gap_secs = sorted(g["s"] for g in gaps)
chk(gap_secs == [1, 3, 7], "the three real gaps are exactly 1s, 3s, 7s", gap_secs)

# First message of a session produces no gap (nothing before it).
rows_single = [("s3", 5000, "opus", "http://a", 10)]
gaps3, idle3 = compute_gaps(rows_single)
chk(gaps3 == [] and idle3 == [], "a session with only one assistant message produces zero gaps")

# Duplicate/tied timestamps are handled gracefully (delta=0, not negative
# or a crash) — two assistant messages can legitimately share a timestamp
# when write resolution is coarser than the gap itself.
rows_tied = [("s4", 2000, "opus", "http://a", 10), ("s4", 2000, "opus", "http://a", 10)]
gaps4, _ = compute_gaps(rows_tied)
chk(gaps4 and gaps4[0]["s"] == 0, "a tied timestamp produces a 0s gap, not a crash or a negative value", gaps4)

# tok_s is None, not 0, when output_tokens is falsy.
rows_notok = [("s5", 100, "opus", "http://a", 0), ("s5", 105, "opus", "http://a", None)]
gaps5, _ = compute_gaps(rows_notok)
chk(gaps5[0]["tok_s"] is None, "tok_s is None (not 0) when the row carries no output token count", gaps5[0]["tok_s"])

# Custom idle threshold is honoured.
rows_thresh = [("s6", 0, "opus", "http://a", 10), ("s6", 100, "opus", "http://a", 10)]
g_default, i_default = compute_gaps(rows_thresh)
g_strict, i_strict = compute_gaps(rows_thresh, idle_threshold_s=50)
chk(len(g_default) == 1 and len(i_default) == 0, "a 100s gap is NOT idle under the default 600s threshold")
chk(len(g_strict) == 0 and len(i_strict) == 1, "the same 100s gap IS idle under a configured 50s threshold")

# ---- build_latency: percentiles independently verified ----
import random
random.seed(42)
big_rows = [("sN", i * 10, "opus", "http://a", 100) for i in range(300)]
# Inject specific known deltas by manipulating timestamps directly instead
# of random gaps, so the expected percentile is knowable without trusting
# the module's own math: deltas are exactly 1..300.
big_rows = []
ts = 0
for i in range(1, 301):
    big_rows.append(("sN", ts, "opus", "http://a", 100))
    ts += i
gaps_big, _ = compute_gaps(big_rows)
deltas = [g["s"] for g in gaps_big]
chk(len(deltas) == 299, "299 gaps computed from 300 consecutive assistant turns", len(deltas))
lat = build_latency(gaps_big, endpoint_of=lambda u: u)
by_model = lat["by_model"]["opus"]
exp_p50 = independent_percentile(deltas, 50)
exp_p90 = independent_percentile(deltas, 90)
exp_p99 = independent_percentile(deltas, 99)
chk(abs(by_model["p50"] - exp_p50) <= 1, f"p50 matches an independently-computed percentile within rounding (got {by_model['p50']}, expected ~{exp_p50})")
chk(abs(by_model["p90"] - exp_p90) <= 1, f"p90 matches within rounding (got {by_model['p90']}, expected ~{exp_p90})")
chk(abs(by_model["p99"] - exp_p99) <= 1, f"p99 matches within rounding (got {by_model['p99']}, expected ~{exp_p99})")
chk(by_model["n"] == 299, "the by_model bucket carries n=299 so a percentile is never shown unlabelled", by_model["n"])

# n is labelled honestly for a tiny sample too (the ticket's own concern:
# "a p99 from 4 samples is labelled as such").
tiny_rows = []
t = 0
for i in [5, 10, 15, 20]:
    tiny_rows.append(("sT", t, "haiku", "http://b", 50))
    t += i
gaps_tiny, _ = compute_gaps(tiny_rows)
lat_tiny = build_latency(gaps_tiny, endpoint_of=lambda u: u)
chk(lat_tiny["by_model"]["haiku"]["n"] == 3, "a tiny sample (3 gaps) is labelled n=3, not silently treated as a big sample")

# Negative control (as the ticket itself specifies): a 5-hour gap must land
# in idle, and p99 for the surviving real gaps must be UNCHANGED by its
# presence in the raw row set.
rows_control_a = [("sC", 0, "opus", "http://a", 10), ("sC", 5, "opus", "http://a", 10),
                   ("sC", 15, "opus", "http://a", 10), ("sC", 30, "opus", "http://a", 10)]
rows_control_b = rows_control_a + [("sC", 30 + 5 * 3600, "opus", "http://a", 10)]  # +5h gap
gaps_a, idle_a = compute_gaps(rows_control_a)
gaps_b, idle_b = compute_gaps(rows_control_b)
p99_a = build_latency(gaps_a, endpoint_of=lambda u: u)["by_model"]["opus"]["p99"]
p99_b = build_latency(gaps_b, endpoint_of=lambda u: u)["by_model"]["opus"]["p99"]
chk(len(idle_b) == 1 and len(idle_a) == 0, "injecting a 5-hour gap adds exactly one idle row and zero to the real-gap set")
chk(p99_a == p99_b, f"p99 is UNCHANGED by the injected 5-hour gap (a={p99_a}, b={p99_b}) — it never entered the percentile math")

# by_endpoint grouping and slowest-N.
rows_ep = [("sE1", 0, "m1", "http://gpu-a", 10), ("sE1", 2, "m1", "http://gpu-a", 10),
           ("sE2", 0, "m1", "http://gpu-b", 10), ("sE2", 9, "m1", "http://gpu-b", 10)]
gaps_ep, _ = compute_gaps(rows_ep)
lat_ep = build_latency(gaps_ep, endpoint_of=lambda u: u)
chk(set(lat_ep["by_endpoint"].keys()) == {"http://gpu-a", "http://gpu-b"},
    "by_endpoint has one bucket per distinct endpoint (LAN vs cloud are comparable)", lat_ep["by_endpoint"].keys())

slow_rows = [("sS", i * 100, "m", "http://a", 10) for i in range(15)]
gaps_slow, _ = compute_gaps(slow_rows)
lat_slow = build_latency(gaps_slow, endpoint_of=lambda u: u, slowest_n=10)
chk(len(lat_slow["slowest"]) == 10, "the slowest list is capped at slowest_n (10)", len(lat_slow["slowest"]))
chk(lat_slow["slowest"][0]["s"] >= lat_slow["slowest"][-1]["s"], "the slowest list is sorted descending by duration")
chk("session" in lat_slow["slowest"][0], "each slowest-turn entry carries a session id for the drill-down link")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
