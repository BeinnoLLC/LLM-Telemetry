#!/usr/bin/env python3
"""Export a bounded per-session transcript for the "open the real chat" modal
(#79 / P9-02).

A live session's full history can be tens of megabytes (72,421 messages /
30.6 MB measured on the busiest observed session) — far too much to embed in
the single-file dashboard (ADR 0001) or push through the 5s live poll. This
writes only the LAST N messages per currently-live session to its own small
file, so the modal shows a recent tail rather than the whole conversation
(ticket's option (a): windowed payload, chosen over a live query endpoint
because that would need #36 — the single-user access-control question —
answered first).

Runs on the same cheap "sessions with ended_at is null" scope as
collect_live.py, so it stays proportional to what is actually running, not
to the whole DB.
"""
import datetime
import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from . import collect_analytics as EA
from .schema import stamp

CFG = EA.CFG

# Per the ticket's own recommendation: "last N messages per live session
# (say 200)". Kept as a module constant so tests can assert the real number
# without hardcoding it a second time.
WINDOW = 200

LIVE_SESSION_IDS = """
select id from sessions
where ended_at is null
  and coalesce(last_activity_at, started_at) > strftime('%s','now') - 600
"""

# Newest-first, capped at WINDOW*3 rows scanned per session via LIMIT — the
# window is applied again in Python after re-reversing to chronological
# order, but capping the SQL side too means a session with 40k messages
# doesn't force sqlite to materialize all of them before the LIMIT applies.
TRANSCRIPT = """
select id, role, content, tool_name, tool_calls, timestamp
from messages
where session_id = ?
  and active = 1
order by id desc
limit ?
"""


def _messages_for(con, session_id, window):
    rows = con.execute(TRANSCRIPT, (session_id, window)).fetchall()
    # rows arrived newest-first (for the LIMIT to bound the right end);
    # the modal renders top-to-bottom chronologically.
    rows.reverse()
    out = []
    for mid, role, content, tool_name, tool_calls, ts in rows:
        entry = {
            "id": mid,
            "role": role,
            # Kept as raw text — the dashboard is the one place that decides
            # how to render it (escape-first, then opt in to markdown/links/
            # code fences/data-images), never here.
            "content": content or "",
            "ts": ts,
        }
        if tool_name:
            entry["tool_name"] = tool_name
        if tool_calls:
            # tool_calls is a JSON string in the DB; keep it parsed so the
            # dashboard doesn't need a second JSON.parse pass, but degrade to
            # the raw string if it's ever malformed rather than dropping the
            # message.
            try:
                entry["tool_calls"] = json.loads(tool_calls)
            except (TypeError, ValueError):
                entry["tool_calls"] = tool_calls
        out.append(entry)
    return out


def build_transcripts(window=WINDOW):
    out = {
        "generated": datetime.datetime.now().isoformat(timespec="seconds"),
        "window": window,
        "profiles": {},
    }
    for name, db in EA.PROFILES.items():
        if not os.path.exists(db):
            continue
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            live_ids = [r[0] for r in con.execute(LIVE_SESSION_IDS)]
            sessions = {}
            for sid in live_ids:
                msgs = _messages_for(con, sid, window)
                if msgs:
                    sessions[sid] = msgs
        finally:
            con.close()
        if sessions:
            out["profiles"][name] = sessions
    return stamp(out)


if __name__ == "__main__":
    out_path = str(CFG.reports_dir / "transcripts.json")
    if len(sys.argv) > 1:
        out_path = sys.argv[1]
    data = build_transcripts()
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    tmp = out_path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, separators=(",", ":"), default=str)
    os.replace(tmp, out_path)
    n = sum(len(s) for p in data["profiles"].values() for s in p.values())
    print(f"{out_path}  ({len(data['profiles'])} profiles, {n} messages windowed)")
