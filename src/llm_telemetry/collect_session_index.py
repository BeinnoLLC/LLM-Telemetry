#!/usr/bin/env python3
"""P10-12 (#100): session_index — one small row per session in range, for
the Session Finder command palette. This is the ONE new SQL-touching
module for the ticket; everything else (matching, ranking, highlighting)
is pure client-side JS over this payload.

Deliberately excludes message CONTENT (full-text search over transcript
bodies is explicitly out of scope for this ticket -- the palette itself
says so and points at the existing but unused `messages_fts`/
`messages_fts_trigram` indexes as the real follow-up, never pretends to
cover it).
"""
import sqlite3


SESSION_INDEX_SQL = """
select s.id,
       coalesce(nullif(s.title,''),'(untitled)') as title,
       s.model,
       coalesce(s.source,'') as source,
       coalesce(s.git_branch,'') as branch,
       coalesce(s.cwd,'') as cwd,
       coalesce(s.end_reason,'') as end,
       coalesce(s.actual_cost_usd, s.estimated_cost_usd, 0) as cost,
       cast(coalesce(s.ended_at, s.last_activity_at, s.started_at) - s.started_at as integer) as dur_s,
       (select group_concat(distinct m.tool_name) from messages m
         where m.session_id = s.id and m.tool_name is not null and m.tool_name != '') as tools
from sessions s
where s.started_at >= ? and s.started_at <= ?
order by s.started_at desc
limit 2000
"""


def _cwd_tail(cwd):
    """The last 1-2 path segments -- enough to recognize the project
    without a full path dominating the result row."""
    if not cwd:
        return ""
    parts = [p for p in cwd.rstrip("/").split("/") if p]
    return "/".join(parts[-2:]) if parts else ""


def build_session_index_payload(con, from_ts, to_ts):
    """con: a profile's state.db connection. from_ts/to_ts: unix seconds,
    the SAME range the rest of the payload is already scoped to (the
    date-range inputs on the page, converted to a day boundary by the
    caller) -- never a second, disagreeing range.

    Returns [{id, title, model, source, tools:[...], branch, cwd_tail,
    end, cost, dur}], exactly the shape the ticket's own Payload section
    specifies.
    """
    out = []
    for row in con.execute(SESSION_INDEX_SQL, (from_ts, to_ts)):
        sid, title, model, source, branch, cwd, end, cost, dur_s, tools = row
        out.append({
            "id": sid,
            "title": title,
            "model": model or "",
            "source": source,
            "tools": sorted(tools.split(",")) if tools else [],
            "branch": branch,
            "cwd_tail": _cwd_tail(cwd),
            "end": end,
            "cost": round(float(cost or 0), 4),
            "dur": int(dur_s) if dur_s is not None and dur_s >= 0 else 0,
        })
    return out


def build_session_index_by_profile(reports_dir=None):
    """Reads every profile's session_index over the full retained window
    (matches recent_sessions' own 48h lookback pattern generalized to
    the whole range the rest of the payload covers -- 90 days is the
    same horizon RECENT_ENDED and other long-lookback queries in this
    module use elsewhere, so the palette never disagrees with what the
    date-range picker can already select).
    """
    import os
    import time

    from . import collect_analytics as EA

    now = time.time()
    from_ts = now - 90 * 86400
    out = {}
    for name, db in EA.PROFILES.items():
        if not os.path.exists(db) or EA.unreadable(db):
            continue
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            out[name] = build_session_index_payload(con, from_ts, now)
        finally:
            con.close()
    return out
