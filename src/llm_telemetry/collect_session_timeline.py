#!/usr/bin/env python3
"""Export one session's timeline shape to its own file (#94/P10-06).

Same static-file architecture #79's transcripts.json already established
(ADR 0001, resolved together per the ticket): a 589-message session is
fine to compute on demand, the 72k-message one is not — so this writes
`sessions/<id>.json` per session in scope, capped at N most recent, and
the dashboard's on-demand fetch says "not exported" for anything older
(mirrors #79's windowed-transcript decision exactly, on purpose, so the
two features share one mental model).

All the actual span-building math lives in session_timeline.py (pure,
independently unit tested); this module owns only the SQL + file I/O.
"""
import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from . import collect_analytics as EA
from . import session_timeline as ST
from .schema import stamp

CFG = EA.CFG

# Per the ticket's own note ("capped at N most recent") — mirrors #79's
# WINDOW constant pattern so both are tunable in one obvious place.
MAX_SESSIONS = 100

SESSIONS_IN_SCOPE = """
select id, title, source, started_at, ended_at, end_reason
from sessions
where coalesce(ended_at, last_activity_at, started_at) > strftime('%s','now') - 2592000
order by coalesce(ended_at, last_activity_at, started_at) desc
limit ?
"""

SESSION_USAGE = """
select group_concat(distinct model), sum(input_tokens), sum(output_tokens),
       sum(cache_read_tokens), sum(estimated_cost_usd), sum(actual_cost_usd)
from session_model_usage
where session_id = ?
"""

SESSION_MESSAGES = """
select role, timestamp, tool_name, effect_disposition, finish_reason, content, compacted
from messages
where session_id = ? and active = 1
order by timestamp
"""

SESSION_DELEGATIONS = """
select delegation_id, dispatched_at, completed_at, state
from async_delegations
where origin_session = ?
order by dispatched_at
"""

# Model attribution for assistant messages, same as latency.py's
# ASSISTANT_TURNS pattern: the model active for the session at the time of
# each message, from session_model_usage last_seen — NOT a per-message
# model column, which does not exist.
LAST_SEEN_MODEL = """
select u.model from session_model_usage u
where u.session_id = ? and u.last_seen <= ?
order by u.last_seen desc limit 1
"""


def _annotated_messages(con, session_id):
    """Attach model (assistant rows) and outcome (tool-result rows) to
    each message so session_timeline.build_spans() has what it needs,
    without importing DB code into that pure module."""
    from .tool_outcomes import tool_outcome

    out = []
    last_model = None
    run_start = None
    run_end = None
    compaction_runs = []
    for role, ts, tool_name, disp, reason, content, compacted in con.execute(SESSION_MESSAGES, (session_id,)):
        entry = {"role": role, "timestamp": ts}
        if role == "assistant":
            row = con.execute(LAST_SEEN_MODEL, (session_id, ts)).fetchone()
            entry["model"] = row[0] if row else last_model
            if entry["model"]:
                last_model = entry["model"]
        elif role == "tool" and tool_name:
            entry["tool_name"] = tool_name
            entry["outcome"] = tool_outcome({"content": content, "effect_disposition": disp,
                                              "finish_reason": reason})
        # Compaction run detection: a contiguous stretch of compacted=1
        # messages becomes ONE compaction span, not one per message.
        if compacted:
            if run_start is None:
                run_start = ts
            run_end = ts
        else:
            if run_start is not None:
                compaction_runs.append({"start": run_start, "end": run_end})
                run_start = None
        out.append(entry)
    if run_start is not None:
        compaction_runs.append({"start": run_start, "end": run_end})
    return out, compaction_runs


def build_session_timeline(con, session_row, now=None):
    sid, title, source, started, ended, end_reason = session_row
    urow = con.execute(SESSION_USAGE, (sid,)).fetchone()
    models_csv, in_tok, out_tok, cread, est, act = urow or (None, 0, 0, 0, 0, 0)
    models = [m for m in (models_csv or "").split(",") if m]

    messages, compactions = _annotated_messages(con, sid)
    delegations = [{"dispatched_at": d, "completed_at": c, "status": s, "child_id": did}
                    for did, d, c, s in con.execute(SESSION_DELEGATIONS, (sid,))]

    session = {
        "id": sid, "title": title, "source": source, "started_at": started,
        "ended_at": ended, "end_reason": end_reason, "models": models,
        "input_tokens": in_tok or 0, "output_tokens": out_tok or 0,
        "cache_read_tokens": cread or 0,
        "estimated_cost_usd": est or 0, "actual_cost_usd": act or 0,
    }
    return ST.build_timeline(session, messages, delegations, compactions, now=now)


def build_all(max_sessions=MAX_SESSIONS):
    """Returns {profile_name: {session_id: timeline_dict}}. Only sessions
    within scope are exported; the dashboard treats a missing id as
    "not exported" rather than an error."""
    import time
    now = time.time()
    out = {}
    for name, db in EA.PROFILES.items():
        if not os.path.exists(db):
            continue
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            rows = con.execute(SESSIONS_IN_SCOPE, (max_sessions,)).fetchall()
            sessions = {}
            for row in rows:
                sid = row[0]
                sessions[sid] = build_session_timeline(con, row, now=now)
        finally:
            con.close()
        if sessions:
            out[name] = sessions
    return out


def write_session_files(out_dir, max_sessions=MAX_SESSIONS):
    """Writes one JSON file per (profile, session): <out_dir>/<profile>/<id>.json.
    Returns the count of files written."""
    all_data = build_all(max_sessions)
    n = 0
    for profile, sessions in all_data.items():
        pdir = os.path.join(out_dir, profile)
        os.makedirs(pdir, exist_ok=True)
        for sid, timeline in sessions.items():
            path = os.path.join(pdir, f"{sid}.json")
            tmp = path + ".tmp"
            with open(tmp, "w") as f:
                json.dump(stamp(timeline), f, separators=(",", ":"), default=str)
            os.replace(tmp, path)
            n += 1
    return n


if __name__ == "__main__":
    out_dir = str(CFG.reports_dir / "sessions")
    if len(sys.argv) > 1:
        out_dir = sys.argv[1]
    n = write_session_files(out_dir)
    print(f"{out_dir}  ({n} session timeline files written)")
