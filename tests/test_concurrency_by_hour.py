#!/usr/bin/env python3
"""concurrency_by_hour: hourly active-session bucketing for the concurrency
band (#83/P9-06)."""
import datetime
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
os.environ.setdefault(
    "LLM_TELEMETRY_CONFIG",
    os.path.join(os.path.dirname(__file__), "..", "examples", "sample-config.json"))

from llm_telemetry.collect_analytics import concurrency_by_hour

p = f = 0


def chk(ok, msg):
    global p, f
    print(("  OK   " if ok else "  FAIL ") + msg)
    p, f = (p + 1, f) if ok else (p, f + 1)


def h(y, m, d, hh):
    return datetime.datetime(y, m, d, hh, 0, 0).timestamp()


# Two top-level sessions overlapping in the 9am hour only.
b = concurrency_by_hour([
    (h(2026, 1, 1, 9), h(2026, 1, 1, 9) + 1800, False),
    (h(2026, 1, 1, 9) + 600, h(2026, 1, 1, 9) + 2400, False),
])
chk(b["2026-01-01 09:00"]["top"] == 2, f"two overlapping top-level sessions both count in the shared hour, got {b}")
chk(len(b) == 1, f"a single-hour overlap produces exactly one bucket, got {len(b)} buckets")

# A session spanning 8am-11am must count in EVERY hour it touches, not just
# the hour it started in.
b = concurrency_by_hour([(h(2026, 1, 1, 8), h(2026, 1, 1, 11) + 1, False)])
for hh in (8, 9, 10, 11):
    key = f"2026-01-01 {hh:02d}:00"
    chk(b.get(key, {}).get("top") == 1, f"a multi-hour session counts in hour {hh}, got {b.get(key)}")

# Subagent vs top-level split.
b = concurrency_by_hour([
    (h(2026, 1, 1, 12), h(2026, 1, 1, 12) + 60, False),
    (h(2026, 1, 1, 12), h(2026, 1, 1, 12) + 60, True),
    (h(2026, 1, 1, 12), h(2026, 1, 1, 12) + 60, True),
])
chk(b["2026-01-01 12:00"] == {"top": 1, "sub": 2},
    f"top-level and subagent sessions are counted separately, got {b['2026-01-01 12:00']}")

# A still-running session (ended_at is None) counts through to `now`.
now = h(2026, 1, 1, 15)
b = concurrency_by_hour([(h(2026, 1, 1, 13), None, False)], now=now)
chk(set(b.keys()) == {"2026-01-01 13:00", "2026-01-01 14:00", "2026-01-01 15:00"},
    f"a still-running session counts through to 'now', got {sorted(b.keys())}")

# Negative-duration / bad data (ended before it started) contributes nothing
# rather than iterating backwards or crashing.
b = concurrency_by_hour([(h(2026, 1, 1, 10), h(2026, 1, 1, 9), False)])
chk(b == {}, f"a session ending before it started contributes zero buckets, got {b}")

# Empty input -> empty output; the "empty range renders an empty state, not
# a broken axis" acceptance criterion is a rendering concern, but the data
# layer must not synthesize a fake bucket to paper over it.
chk(concurrency_by_hour([]) == {}, "empty input produces an empty dict, not a placeholder bucket")

# A session with started_at=None (should never happen, but defensively) is
# skipped rather than crashing the whole collector run.
b = concurrency_by_hour([(None, h(2026, 1, 1, 9), False), (h(2026, 1, 1, 9), h(2026, 1, 1, 9) + 60, False)])
chk(b == {"2026-01-01 09:00": {"top": 1, "sub": 0}},
    f"a row with no started_at is skipped, not crashed on, got {b}")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
