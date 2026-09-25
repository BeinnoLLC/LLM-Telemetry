#!/usr/bin/env python3
"""Export ONLY the live-work slice, for fast polling.

The full export walks every usage row, prices each one against the model
catalog and rebuilds 76 day-rows — far too much to repeat every few seconds.
Live data (what is running right now) is three cheap indexed queries, so it
gets its own tiny file that the dashboard can poll aggressively without
touching the expensive path.

Reuses the queries from export_analytics so the two exports can never drift.
"""
import datetime
import json
import os
import re
import sqlite3
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Plain import now that the module is `collect_analytics`, not the old
# hyphenated `export-analytics.py` that needed a spec-from-file workaround.
from . import collect_analytics as EA

CFG = EA.CFG

# The full export's RECENT_TOOLS scans all 317k messages (157 ms on the 1.2 GB
# default profile DB) — far too slow to poll every few seconds. Scoping it to currently
# live sessions uses idx_messages_session instead of a full scan, and is also
# the more honest number for a live panel: tools used by the work running now,
# not by sessions that ended an hour ago.
LIVE_TOOLS = """
select m.tool_name, count(*) from messages m
where m.session_id in (
        select id from sessions
        where ended_at is null
          and coalesce(last_activity_at, started_at) > strftime('%s','now') - 600)
  and m.tool_name is not null and m.tool_name != ''
  and m.timestamp > strftime('%s','now') - 3600
group by m.tool_name order by 2 desc limit 14
"""

# Live log tail — recent tool calls + assistant messages across all active sessions,
# for the log drawer. Indexed on session_id so it stays fast even on the 1.2 GB DB.
LIVE_LOGS = """
select m.timestamp, s.title, m.role, coalesce(m.tool_name,'') tool,
       substr(coalesce(m.content,''),1,200) preview
from messages m join sessions s on s.id=m.session_id
where m.session_id in (
        select id from sessions
        where ended_at is null
          and coalesce(last_activity_at, started_at) > strftime('%s','now') - 600)
  and m.timestamp > strftime('%s','now') - 600
order by m.timestamp desc limit 80
"""
LIVE_LOGS_COLS = "ts title role tool preview".split()


def tail_errors(limit=60, window_s=7200):
    """Recent failure lines from every profile's errors.log, newest first.

    The drawer interleaves these with tool events, so each entry carries the
    same shape: a unix timestamp, a severity, and a one-line message.
    """
    from . import failures as F

    out = []
    cutoff = time.time() - window_s
    for prof, path in F.LOGS.items():
        if not path or not os.path.exists(path):
            continue
        try:
            # Read only the tail: errors.log grows unbounded and re-reading it
            # whole every 5s would dominate the export's runtime.
            with open(path, "rb") as fh:
                fh.seek(0, os.SEEK_END)
                size = fh.tell()
                fh.seek(max(0, size - 400_000))
                lines = fh.read().decode("utf-8", "replace").splitlines()
        except OSError:
            continue
        for line in lines:
            kind = F.classify(line)
            if not kind:
                continue
            # classify() alone is too loose for a live feed: an LSP lint
            # "timed out" WARNING matches "timeout" but is not a model failure.
            # Require evidence the line is about a model call.
            has_model = bool(F.MODEL_ONLY.search(line))
            # A bare 3-digit number is not a status code — an LSP port or a
            # duration matches too. Require it to be introduced as a status.
            has_http = bool(re.search(
                r"(?:HTTP|status|code|Error code:)\s*[:=]?\s*(4\d\d|5\d\d)\b",
                line, re.I))
            if not (has_model or has_http):
                continue
            m = F.TS.match(line)
            if not m:
                continue
            try:
                ts = time.mktime(time.strptime(m.group(1), "%Y-%m-%d %H:%M:%S"))
            except ValueError:
                continue
            if ts < cutoff:
                continue
            msg = line.strip()
            for marker in ("HTTP ", "Error code: ", "error_type="):
                i = msg.find(marker)
                if i != -1:
                    msg = msg[i:]
                    break
            out.append({
                "ts": ts,
                "profile": prof,
                "level": "error",
                "kind": kind,
                "model": (F.MODEL_ONLY.search(line).group(1)
                          if F.MODEL_ONLY.search(line) else ""),
                "msg": msg[:180],
            })
    out.sort(key=lambda e: e["ts"], reverse=True)
    return out[:limit]


def read_ollama():
    """Cached Ollama telemetry, with staleness exposed rather than hidden.

    If the probe timer dies the panel must say "stale 8m ago" instead of showing
    a confident snapshot of a host that may have gone down since.
    """
    try:
        with open(CFG.reports_dir / "ollama-data.json") as f:
            d = json.load(f)
        d["age"] = max(0, int(time.time()) - int(d.get("ts", 0)))
        return d
    except Exception:
        return {"hosts": [], "age": None, "missing": True}


def build_live():
    out = {
        "generated": datetime.datetime.now().isoformat(timespec="seconds"),
        "profiles": {},
        # Failures are cross-profile and come from log files, not the DB, so
        # they sit at the top level rather than under a single profile.
        "errors": tail_errors(),
        # Ollama host telemetry, collected out-of-band by probe_hosts.py on a
        # slower timer. Reading the cached file keeps this 5s export free of
        # network I/O — probing four endpoints inline (two over HTTPS at ~450ms)
        # would stall the whole live panel behind the slowest GPU box.
        "ollama": read_ollama(),
    }
    for name, db in EA.PROFILES.items():
        if not os.path.exists(db):
            continue
        # Read-only, same as the full export: a polling job must never be able
        # to write to the user's session store.
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            active = con.execute(EA.ACTIVE).fetchone()[0]
            live = [dict(zip(EA.LIVE_COLS, r)) for r in con.execute(EA.LIVE)]
            for L in live:
                L["category"] = EA.classify(L["phase"], L["tools"])
                L["tools"] = [t for t in (L["tools"] or "").split(",") if t]
                L["kind"] = "subagent" if L["parent"] else "top-level"
                L["model"] = L["model"] or L["init_model"]
                L["switched"] = bool(
                    L["model"] and L["init_model"] and L["model"] != L["init_model"]
                )
            tools_recent = [
                {"tool": t, "calls": n} for t, n in con.execute(LIVE_TOOLS)
            ]
            logs = [dict(zip(LIVE_LOGS_COLS, r)) for r in con.execute(LIVE_LOGS)]
        finally:
            con.close()
        out["profiles"][name] = {
            "active": active,
            "live": live,
            "tools_recent": tools_recent,
            "logs": logs,
        }
    return out


if __name__ == "__main__":
    out_path = str(CFG.reports_dir / "live-data.json")
    if len(sys.argv) > 1:
        out_path = sys.argv[1]
    data = build_live()
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    # Atomic replace: the dashboard polls this file every few seconds and must
    # never read a half-written JSON document.
    tmp = out_path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, separators=(",", ":"), default=str)
    os.replace(tmp, out_path)
    n = sum(len(p["live"]) for p in data["profiles"].values())
    print(f"{out_path}  ({len(data['profiles'])} profiles, {n} live sessions)")
