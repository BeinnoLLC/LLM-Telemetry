#!/usr/bin/env python3
"""Export a bounded per-session transcript for the "open the real chat" modal
(

A live session's full history can be tens of megabytes (72,421 messages /
30.6 MB measured on the busiest observed session) — far too much to embed in
the single-file dashboard (ADR 0001) or push through the 5s live poll. This
writes only the LAST N messages per currently-live session to its own small
file, so the modal shows a recent tail rather than the whole conversation
(ticket's option (a): windowed payload, chosen over a live query endpoint
because that would need
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

WINDOW = 200

LIVE_SESSION_IDS = """
select id from sessions
where ended_at is null
  and coalesce(last_activity_at, started_at) > strftime('%s','now') - 600
"""

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
    rows.reverse()
    out = []
    for mid, role, content, tool_name, tool_calls, ts in rows:
        entry = {
            "id": mid,
            "role": role,
            "content": content or "",
            "ts": ts,
        }
        if tool_name:
            entry["tool_name"] = tool_name
        if tool_calls:
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
