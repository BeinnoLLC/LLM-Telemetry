#!/usr/bin/env python3
"""P10-09 (#97): context & compaction — growth, yield, reasoning share.

All the actual math lives in context_compaction.py (pure, independently
unit tested); this module owns only the SQL + the one estimate this repo
already has a single home for (bandwidth.py's tokens<->bytes constant,
see its own docstring: `messages.token_count` is NULL in every row of
the real DB, so context size is estimated from stored message body
bytes, same as every other token estimate in this project).
"""
import time

from . import collect_analytics as EA
from . import context_compaction as CC
from .bandwidth import estimate_tokens

CFG = EA.CFG

# Same 30-day scope as session_timeline.py's SESSIONS_IN_SCOPE, same
# MAX_SESSIONS cap reasoning: unbounded history would make this payload
# grow forever.
MAX_SESSIONS = 60
SESSIONS_IN_SCOPE = """
select id from sessions
where coalesce(ended_at, last_activity_at, started_at) > strftime('%s','now') - 2592000
order by coalesce(ended_at, last_activity_at, started_at) desc
limit ?
"""

SESSION_MESSAGES = """
select role, timestamp, content, compacted
from messages
where session_id = ? and active = 1
order by timestamp
"""

USAGE_BY_MODEL = """
select model, sum(reasoning_tokens), sum(output_tokens)
from session_model_usage
group by model
"""

COOLDOWN_SESSIONS = """
select id, title, compression_failure_cooldown_until, compression_failure_error
from sessions
where compression_failure_cooldown_until is not null
"""


def _session_calls_and_compactions(con, session_id):
    """Walks this session's messages once, in order, building:
    - calls: [(ts, running_context_tokens)] sampled at every assistant
      turn — the running total is every active message's estimated size
      accumulated so far, i.e. "how much context has this session grown
      to by this point" (the ticket's own framing).
    - compactions: [(ts, before, after)] — one entry per contiguous run
      of compacted=1 messages (mirrors collect_session_timeline.py's own
      compaction-run grouping exactly, so the two features never
      disagree about what counts as "one compaction"). `before` is the
      running-context total at the moment the run started; `after` is
      the running-context total right after the run's own (real, non-
      zero) compaction-summary message is counted — the running total
      resets to zero at that point rather than continuing to accumulate,
      because everything before it was, by definition, just folded away.
    """
    calls = []
    running = 0
    run_start_ts = None
    run_end_ts = None
    run_before = None
    runs = []  # (start_ts, end_ts, before, after)
    for role, ts, content, compacted in con.execute(SESSION_MESSAGES, (session_id,)):
        if compacted:
            # A compacted=1 message is old content already folded into a
            # compaction summary -- it no longer occupies context, so it
            # never adds to `running`; it only marks where a compaction
            # run is happening. `before` is captured the moment the run
            # starts, i.e. the running total right before anything in
            # this run was ever added.
            if run_start_ts is None:
                run_start_ts = ts
                run_before = running
            run_end_ts = ts
            continue
        if run_start_ts is not None:
            # The run just ended: everything that grew `running` up to
            # here was summarized away. The compaction summary message
            # itself (this row) starts a FRESH context, so the running
            # total resets rather than keeping the pre-compaction growth
            # baked in — the collapse IS the observable "after" size the
            # ticket asks for, captured once this row's own size is
            # counted (a real compaction summary is not zero bytes).
            running = 0
            running += estimate_tokens(len(content or ""))
            runs.append((run_start_ts, run_end_ts, run_before, running))
            run_start_ts = None
            if role == "assistant":
                calls.append((ts, running))
            continue
        running += estimate_tokens(len(content or ""))
        if role == "assistant":
            calls.append((ts, running))
    if run_start_ts is not None:
        # Session ends mid-compaction-run (no message after it yet) --
        # still record the run with `after` equal to the pre-run baseline
        # (nothing has grown back yet), rather than dropping it silently.
        runs.append((run_start_ts, run_end_ts, run_before, run_before))
    compactions = [(start, before, after) for start, _end, before, after in runs]
    return calls, compactions


def build_context_payload(max_sessions=MAX_SESSIONS, now=None):
    """Returns {profile_name: context_dict} using context_compaction's own
    build_context() shape — the collector's only job is fetching rows and
    handing them to the pure module.
    """
    now = now if now is not None else time.time()
    out = {}
    for name, db in EA.PROFILES.items():
        import os
        import sqlite3
        if not os.path.exists(db) or EA.unreadable(db):
            # Same guard as the main build() loop: a corrupt/permission-
            # denied DB is reported there and skipped here, never crashes
            # the whole collector run.
            continue
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            session_ids = [r[0] for r in con.execute(SESSIONS_IN_SCOPE, (max_sessions,))]
            sessions_calls = {}
            sessions_compactions = {}
            for sid in session_ids:
                calls, compactions = _session_calls_and_compactions(con, sid)
                sessions_calls[sid] = calls
                sessions_compactions[sid] = compactions

            usage_rows = [{"model": m, "reasoning_tokens": r, "output_tokens": o}
                          for m, r, o in con.execute(USAGE_BY_MODEL)]

            session_rows = [{"id": sid, "title": title, "compression_failure_cooldown_until": until,
                              "compression_failure_error": err}
                             for sid, title, until, err in con.execute(COOLDOWN_SESSIONS)]
        finally:
            con.close()
        out[name] = CC.build_context(sessions_calls, sessions_compactions, usage_rows, session_rows, now)
    return out
