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

from . import collect_analytics as EA
from . import collect_agent_worker_live, collect_pi_live
from .schema import stamp
from .schema_check import check
from .bandwidth import BYTES_PER_TOKEN, estimate_bytes, is_lan as _is_lan
from . import agents_alive
import socket

CFG = EA.CFG

THIS_HOST = socket.gethostname()

GATEWAY_HEARTBEATS = "select backend_id, pid, started_at, last_heartbeat, profile, host from gateway_heartbeats"
SESSION_TURN_LEASES = "select conversation_id, holder, acquired_at, expires_at from session_turn_leases"

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

# A title that names the SURFACE the chat came from, not its content. Hermes
# stores "Bot Chat" (title_source=user) on dashboard/bot sessions, which made
# most live rows read identically.
GENERIC_TITLES = {"", "(untitled)", "untitled", "bot chat", "new chat", "chat",
                  "new session", "new conversation", "cli", "tui"}
SOURCE_LABELS = {"tui": "TUI", "cli": "CLI", "kanban": "Kanban", "cron": "Cron",
                 "desktop": "Desktop", "tool": "Tool", "local": "Local"}
TITLE_MAX = 80

LIVE_META = """
select s.id, coalesce(s.source,''), coalesce(s.chat_type,''),
       (select substr(m.content,1,600) from messages m
         where m.session_id = s.id and m.role = 'user'
           and coalesce(m.content,'') != ''
         order by m.timestamp, m.id limit 1)
from sessions s
where s.ended_at is null
  and coalesce(s.last_activity_at, s.started_at) > strftime('%s','now') - 600
"""


def is_generic_title(title):
    return (title or "").strip().lower() in GENERIC_TITLES


def clean_title(text, limit=TITLE_MAX):
    """Collapse whitespace, drop markdown/prompt chrome, cut at `limit` chars."""
    t = re.sub(r"\s+", " ", re.sub(r"[`*_#>]+", " ", text or "")).strip()
    if len(t) > limit:
        t = t[: limit - 1].rstrip() + "\u2026"
    return t


def source_label(source, chat_type=""):
    """Small muted tag for where a session came from; 'Bot Chat' only when the
    source is unknown (a bot/gateway DM with no recorded surface)."""
    if source in SOURCE_LABELS:
        return SOURCE_LABELS[source]
    return (source or "").title() or "Bot Chat"


def resolve_title(raw_title, first_user):
    """Real title if the session has one, else the cleaned first user message,
    else the untitled marker. Never returns a surface name as the title."""
    if not is_generic_title(raw_title):
        return clean_title(raw_title, 120)
    c = clean_title(first_user)
    return c or "(untitled)"


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

RECENT_ENDED = """
select id, title, ended_at, end_reason
from sessions
where ended_at is not null
  and ended_at > strftime('%s','now') - 90
order by ended_at desc
"""

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
            has_model = bool(F.MODEL_ONLY.search(line))
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


def read_pi_live():
    """Live PI agent sessions, with failures contained to an empty list rather
    than taking the whole Live payload down -- PI's JSONL files are read
    straight off disk with no transaction guarantees, so a session file mid-
    write is expected, not exceptional."""
    try:
        return collect_pi_live.build_pi_live()
    except Exception:
        return []


def read_agent_live():
    """Live Claude Code / Codex sessions (agent-worker); failures contained to
    an empty list for the same reason as read_pi_live."""
    try:
        return collect_agent_worker_live.build_agent_live()
    except Exception:
        return []


def build_live():
    out = {
        "generated": datetime.datetime.now().isoformat(timespec="seconds"),
        "bytes_per_token": BYTES_PER_TOKEN,
        "profiles": {},
        "errors": tail_errors(),
        "ollama": read_ollama(),
        "pi_live": read_pi_live(),
        "agent_live": read_agent_live(),
    }
    for name, db in EA.PROFILES.items():
        if not os.path.exists(db):
            continue
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
                L["up_bytes"] = L["down_bytes"] = 0
                L["lan_up_bytes"] = L["lan_down_bytes"] = 0
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
                L["bw_local"] = (L["up_bytes"] + L["down_bytes"]) == 0 and (
                    L["lan_up_bytes"] + L["lan_down_bytes"]) > 0
            meta = {r[0]: r for r in con.execute(LIVE_META)}
            for L in live:
                _, src, ctype, first = meta.get(L["id"], (L["id"], "", "", None))
                L["source"] = source_label(src, ctype)
                L["title_raw"] = L["title"]
                L["title"] = resolve_title(
                    "" if L["title"] == "(untitled)" else L["title"], first)
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
                if "no such table" not in str(e).lower():
                    raise
                recent_delegations = []
            try:
                heartbeats = [
                    {"backend_id": bid, "pid": pid, "started_at": started, "last_heartbeat": last,
                     "profile": prof, "host": host}
                    for bid, pid, started, last, prof, host in con.execute(GATEWAY_HEARTBEATS)
                ]
                leases = [
                    {"conversation_id": cid, "holder": holder, "acquired_at": acq, "expires_at": exp}
                    for cid, holder, acq, exp in con.execute(SESSION_TURN_LEASES)
                ]
                agents = agents_alive.build_agents(heartbeats, leases, this_host=THIS_HOST)
            except sqlite3.OperationalError as e:
                if "no such table" not in str(e).lower():
                    raise
                agents = []
        finally:
            con.close()
        out["profiles"][name] = {
            "active": active,
            "live": live,
            "tools_recent": tools_recent,
            "logs": logs,
            "recent_ended": recent_ended,
            "recent_delegations": recent_delegations,
            "agents": agents,
        }
    return stamp(out)


if __name__ == "__main__":
    out_path = str(CFG.reports_dir / "live-data.json")
    if len(sys.argv) > 1:
        out_path = sys.argv[1]
    data = build_live()
    check("live", data)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    tmp = out_path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, separators=(",", ":"), default=str)
    os.replace(tmp, out_path)
    n = sum(len(p["live"]) for p in data["profiles"].values())
    print(f"{out_path}  ({len(data['profiles'])} profiles, {n} live sessions)")
