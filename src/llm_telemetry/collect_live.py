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
from .bandwidth import BYTES_PER_TOKEN, estimate_bytes, is_lan as _is_lan

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
# Every model a live session has touched, per task. The row used to show only
# "N models used" -- a count with no names, and one that silently ignored helper
# tasks (compression, approval, title generation...) which also burn tokens.
LIVE_MODELS = """
select u.session_id, u.model, coalesce(nullif(u.task,''),'main'),
       coalesce(sum(u.api_call_count),0),
       coalesce(sum(u.input_tokens + u.cache_read_tokens),0),
       coalesce(sum(u.output_tokens),0),
       max(u.last_seen), max(coalesce(u.billing_base_url,''))
from session_model_usage u join sessions s on s.id = u.session_id
where s.ended_at is null
  and coalesce(s.last_activity_at, s.started_at) > strftime('%s','now') - 600
group by u.session_id, u.model, 3
"""


def fold_models(rows):
    """[(sid, model, task, calls, in, out, last, url)] -> {sid: [model dicts]}.

    One entry per model, tasks folded in. 'main' models first (the ones that
    actually answered the conversation), then helpers; newest first within each.
    """
    out = {}
    for sid, model, task, calls, tin, tout, last, url in rows:
        if not model:
            continue
        per = out.setdefault(sid, {})
        m = per.setdefault(model, {"model": model, "tasks": [], "calls": 0,
                                   "in_tok": 0, "out_tok": 0, "last": 0,
                                   "base_url": "", "main": False})
        m["tasks"].append(task)
        m["calls"] += int(calls or 0)
        m["in_tok"] += int(tin or 0)
        m["out_tok"] += int(tout or 0)
        if (last or 0) >= m["last"]:
            m["last"] = float(last or 0)
            m["base_url"] = url or m["base_url"]
        m["main"] = m["main"] or task == "main"
    return {sid: sorted(per.values(), key=lambda m: (not m["main"], -m["last"]))
            for sid, per in out.items()}


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

# Sessions that ended within the last 90 seconds: two missed 5s polls of
# margin without stretching so wide that an old close is mistaken for a
# fresh completion. The dashboard diffs consecutive polls itself, so this
# just needs to guarantee an ended session appears in at least one payload.
RECENT_ENDED = """
select id, title, ended_at, end_reason
from sessions
where ended_at is not null
  and ended_at > strftime('%s','now') - 90
order by ended_at desc
"""

# Delegated child runs (#90) that finished in the same 90s window. state is
# the delegation-level outcome ('completed'/'error'); good enough for a
# completion tone -- the per-child status inside result_json is only needed
# for the Health tab's failure-rate breakdown, not for "did something finish".
RECENT_DELEGATIONS = """
select delegation_id, state, completed_at
from async_delegations
where completed_at is not null
  and completed_at > strftime('%s','now') - 90
order by completed_at desc
"""


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
        # Emitted so the UI can label bandwidth as an estimate and state the
        # factor it used, instead of hardcoding a copy that silently diverges
        # from the collector's.
        "bytes_per_token": BYTES_PER_TOKEN,
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
                # Estimated wire bytes, filled in below from LIVE_BYTES.
                L["up_bytes"] = L["down_bytes"] = 0
                L["lan_up_bytes"] = L["lan_down_bytes"] = 0
            # Bandwidth per (session, endpoint), classified here rather than in
            # SQL so config.local_host_patterns stays the single source of truth
            # for what counts as LAN.
            by_id = {L["id"]: L for L in live}
            for sid, url, up_tok, down_tok in con.execute(EA.LIVE_BYTES):
                L = by_id.get(sid)
                if L is None:
                    continue
                lan = _is_lan(url)
                up = estimate_bytes(up_tok)
                down = estimate_bytes(down_tok)
                if lan:
                    L["lan_up_bytes"] += up
                    L["lan_down_bytes"] += down
                else:
                    L["up_bytes"] += up
                    L["down_bytes"] += down
            for L in live:
                # True only when EVERY byte stayed on the LAN, so a mixed session
                # is never labelled "not metered".
                L["bw_local"] = (L["up_bytes"] + L["down_bytes"]) == 0 and (
                    L["lan_up_bytes"] + L["lan_down_bytes"]) > 0
            models = fold_models(con.execute(LIVE_MODELS).fetchall())
            for L in live:
                L["models"] = models.get(L["id"], [])
            tools_recent = [
                {"tool": t, "calls": n} for t, n in con.execute(LIVE_TOOLS)
            ]
            logs = [dict(zip(LIVE_LOGS_COLS, r)) for r in con.execute(LIVE_LOGS)]
            recent_ended = [
                {"id": sid, "title": title, "ended_at": ended_at, "end_reason": reason}
                for sid, title, ended_at, reason in con.execute(RECENT_ENDED)
            ]
            try:
                recent_delegations = [
                    {"id": did, "state": state, "completed_at": completed_at}
                    for did, state, completed_at in con.execute(RECENT_DELEGATIONS)
                ]
            except sqlite3.OperationalError as e:
                # Same guard as delegations.py: older Hermes builds have no
                # async_delegations table at all. That is not an error.
                if "no such table" not in str(e).lower():
                    raise
                recent_delegations = []
        finally:
            con.close()
        out["profiles"][name] = {
            "active": active,
            "live": live,
            "tools_recent": tools_recent,
            "logs": logs,
            "recent_ended": recent_ended,
            "recent_delegations": recent_delegations,
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
