#!/usr/bin/env python3
"""Export cross-profile Hermes router analytics as one JSON document.

Rows are emitted at DAY granularity so the dashboard can filter any from/to
range entirely client-side without re-querying.
"""
import sqlite3, json, os, datetime, argparse, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from . import pricing
from . import failures

from .config import get as _cfg

CFG = _cfg()
REPORTS = CFG.reports_dir
# {display name: state.db} for every profile that exists on this machine.
PROFILES = {p.name: p.db for p in CFG.live_profiles()}

# one row per (day, model, provider, task)
ROWS = """
select date(coalesce(u.last_seen, s.started_at),'unixepoch','localtime') d,
       u.model, u.billing_provider, coalesce(nullif(u.task,''),'main') task,
       sum(u.api_call_count), sum(u.input_tokens), sum(u.output_tokens),
       sum(u.cache_read_tokens), sum(u.cache_write_tokens), sum(u.reasoning_tokens),
       sum(u.estimated_cost_usd), sum(u.actual_cost_usd),
       count(distinct u.session_id),
       max(u.billing_base_url)
from session_model_usage u join sessions s on s.id = u.session_id
group by d, u.model, u.billing_provider, task
order by d
"""
# Top sessions per (model, task) — powers "which chat" on the Flow graph.
# Capped at 5 per node: 504 (model,task,session) combos exist, but a tooltip
# can only show a handful, and shipping them all would bloat every payload.
SESS_BY_NODE = """
with agg as (
  select u.model m, coalesce(nullif(u.task,''),'main') t, u.session_id sid,
         sum(u.api_call_count) c
  from session_model_usage u
  where u.last_seen > strftime('%s','now') - 7776000
  group by u.model, t, u.session_id
), rk as (
  select agg.*, row_number() over (partition by m,t order by c desc) rn from agg
)
select rk.m, rk.t,
       substr(coalesce(nullif(s.title,''),nullif(s.display_name,''),'(untitled)'),1,48),
       rk.c, rk.sid
from rk join sessions s on s.id = rk.sid
where rk.rn <= 5 order by rk.m, rk.t, rk.c desc
"""
HOURS = """
select date(coalesce(u.last_seen, s.started_at),'unixepoch','localtime') d,
       cast(strftime('%H', coalesce(u.last_seen, s.started_at),'unixepoch','localtime') as int) h,
       sum(u.api_call_count)
from session_model_usage u join sessions s on s.id = u.session_id
group by d, h
"""

# Heatmap: daily call totals for the last 90 days, BROKEN DOWN BY PROVIDER so
# each calendar cell can be tinted with the providers actually used that day
# (a mixed day renders as proportional bands, not one flat accent colour).
#
# billing_provider/billing_base_url/model are all carried through because the
# dashboard resolves the provider with the SAME provOf(provider, model, url)
# helper every other widget uses — resolving it here in SQL instead would give
# the heatmap its own private notion of "provider" and let the two drift.
# Grouping this finely costs ~71 rows over 90 days, so the payload stays small.
HEATMAP = """
select date(coalesce(u.last_seen, s.started_at),'unixepoch','localtime') d,
       u.billing_provider p, u.billing_base_url url, u.model m,
       sum(u.api_call_count) calls
from session_model_usage u join sessions s on s.id = u.session_id
where u.last_seen > strftime('%s','now') - 7776000
group by d, u.billing_provider, u.billing_base_url, u.model
order by d
"""
SESS = """
select date(started_at,'unixepoch','localtime') d, coalesce(nullif(source,''),'-') src, count(*)
from sessions group by d, src
"""
# "In progress" = open session with activity inside the window. A null ended_at
# alone is not enough: crashed/killed sessions never get one and would inflate
# this forever (9 open rows here, only 3 genuinely live).
ACTIVE = """
select count(*) from sessions
where ended_at is null
  and coalesce(last_activity_at, started_at) > strftime('%s','now') - 600
"""

# One row per genuinely-live session, with enough signal to classify what kind
# of work it is doing: the phase text Hermes writes to last_activity_description
# plus the tools it actually called in the last 15 minutes.
LIVE = """
select s.id,
       coalesce(nullif(s.title,''),'(untitled)'),
       s.model,
       coalesce(s.last_activity_description,''),
       cast(strftime('%s','now') - coalesce(s.last_activity_at, s.started_at) as int),
       coalesce(s.parent_session_id,''),
       (select group_concat(tn) from (
           select distinct m.tool_name tn from messages m
           where m.session_id = s.id and m.tool_name is not null and m.tool_name != ''
             and m.timestamp > strftime('%s','now') - 900
           limit 12)),
       -- The model ACTUALLY serving this session right now. sessions.model is
       -- only the initial pick; the router silently falls back (seen up to 6
       -- models in one session), so reporting sessions.model would be a lie.
       (select u.model from session_model_usage u
          where u.session_id = s.id
            and coalesce(nullif(u.task,''),'main') = 'main'
          order by u.last_seen desc limit 1),
       -- how many distinct models this session has burned through
       (select count(distinct u.model) from session_model_usage u
          where u.session_id = s.id
            and coalesce(nullif(u.task,''),'main') = 'main'),
       -- provider backing the current model, for an accurate badge
       (select u.billing_base_url from session_model_usage u
          where u.session_id = s.id
            and coalesce(nullif(u.task,''),'main') = 'main'
          order by u.last_seen desc limit 1)
from sessions s
where s.ended_at is null
  and coalesce(s.last_activity_at, s.started_at) > strftime('%s','now') - 600
order by coalesce(s.last_activity_at, s.started_at) desc
"""
LIVE_COLS = "id title init_model phase idle_s parent tools model nmodels base_url".split()

# Recent completed sessions (last 48h) for the Live tab activity table.
RECENT_SESSIONS = """
select s.id,
       coalesce(nullif(s.title,''),'(untitled)') title,
       s.model,
       s.message_count,
       cast(coalesce(s.ended_at, s.last_activity_at, s.started_at) as integer) last_ts,
       cast(coalesce(s.ended_at, s.last_activity_at) - s.started_at as integer) dur_s,
       (select u.model from session_model_usage u
         where u.session_id=s.id and coalesce(nullif(u.task,''),'main')='main'
         order by u.last_seen desc limit 1) as last_model,
       (select u.billing_base_url from session_model_usage u
         where u.session_id=s.id order by u.last_seen desc limit 1) as base_url,
       (select u.billing_provider from session_model_usage u
         where u.session_id=s.id order by u.last_seen desc limit 1) as prov,
       (select sum(u.api_call_count) from session_model_usage u where u.session_id=s.id) as api_calls,
       (select sum(u.input_tokens+u.output_tokens) from session_model_usage u where u.session_id=s.id) as tokens
from sessions s
where s.ended_at is not null
  and s.ended_at > strftime('%s','now') - 172800
order by s.ended_at desc limit 40
"""
RECENT_SESSIONS_COLS = "id title model message_count last_ts dur_s last_model base_url prov api_calls tokens".split()

# Tool calls in the last hour — shows which kind of work dominates right now.
RECENT_TOOLS = """
select tool_name, count(*) from messages
where tool_name is not null and tool_name != ''
  and timestamp > strftime('%s','now') - 3600
group by tool_name order by 2 desc limit 14
"""
COLS = "date model provider task calls inp outp cread cwrite rtok est act sessions base_url".split()

# Work categories. Order matters: the live phase text is checked first for
# every category, because it says what the session is doing RIGHT NOW. The tool
# mix is only a fallback — a session that ran `patch` ten minutes ago but is
# currently in a terminal command is Running, not Coding.
CATEGORIES = [
    ("Compressing", ("compression",), ()),
    ("Reviewing",   ("review", "critique"), ("delegate_task",)),
    ("Waiting",     ("approval", "waiting", "confirm"), ()),
    ("Thinking",    ("reasoning", "thinking", "planning"), ()),
    ("Running",     ("terminal", "command running", "process"), ("terminal", "process_manage", "execute_code")),
    ("Coding",      ("patch", "write_file", "editing"), ("patch", "write_file", "edit_file")),
    ("Researching", ("web", "browser", "search"), ("web_search", "web_extract", "browser_exec", "search_files")),
    ("Reading",     ("read_file", "skill", "reading"), ("read_file", "skill_view", "chat_history_lookup")),
]

def classify(phase, tools):
    """Bucket one live session into a work category.

    Two passes: the phase text wins outright, and only when it carries no signal
    do we fall back to which tools the session touched recently.
    """
    p = (phase or "").lower()
    tl = [t.strip() for t in (tools or "").split(",") if t.strip()]
    for name, phrases, _ in CATEGORIES:
        if any(w in p for w in phrases):
            return name
    if "stream" in p or "turn" in p or "thinking" in p:
        return "Generating"
    ts = set(tl)
    for name, _, toolset in CATEGORIES:
        if toolset and ts & set(toolset):
            return name
    return "Idle" if not tl else "Working"

def build():
    out = {"generated": datetime.datetime.now().isoformat(timespec="seconds"), "profiles": {}}
    catalog, catsrc = pricing.fetch_catalog()
    out["pricing_source"] = catsrc
    out["pricing_models"] = len(catalog)
    for name, db in PROFILES.items():
        if not os.path.exists(db):
            continue
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            rows = [dict(zip(COLS, r)) for r in con.execute(ROWS)]
            for r in rows:
                r.update(pricing.price_row(
                    {"provider": r["provider"], "model": r["model"],
                     "base_url": r.get("base_url"),
                     "input_tokens": r["inp"], "output_tokens": r["outp"],
                     "cache_read": r["cread"]}, catalog))
            hours = [{"date": d, "hour": h, "calls": c} for d, h, c in con.execute(HOURS)]
            heatmap = [{"d": d, "p": p, "url": url, "m": m, "v": c}
                       for d, p, url, m, c in con.execute(HEATMAP)]
            # Keyed "model\ttask" so the Flow graph can look a node up directly
            # instead of scanning a flat list on every hover.
            node_sessions = {}
            for mdl, tsk, title, calls, sid in con.execute(SESS_BY_NODE):
                node_sessions.setdefault(f"{mdl}\t{tsk}", []).append(
                    {"title": title, "calls": calls, "id": sid})
            sess = [{"date": d, "source": s, "sessions": n} for d, s, n in con.execute(SESS)]
            active = con.execute(ACTIVE).fetchone()[0]
            live = [dict(zip(LIVE_COLS, r)) for r in con.execute(LIVE)]
            for L in live:
                L["category"] = classify(L["phase"], L["tools"])
                L["tools"] = [t for t in (L["tools"] or "").split(",") if t]
                L["kind"] = "subagent" if L["parent"] else "top-level"
                # Fall back to the initial pick only when no usage is recorded
                # yet (a session that has not made its first call).
                L["model"] = L["model"] or L["init_model"]
                L["switched"] = bool(L["model"] and L["init_model"]
                                     and L["model"] != L["init_model"])
            tools_recent = [{"tool": t, "calls": n} for t, n in con.execute(RECENT_TOOLS)]
            recent_sessions = [dict(zip(RECENT_SESSIONS_COLS, r)) for r in con.execute(RECENT_SESSIONS)]
        finally:
            con.close()
        dates = sorted({r["date"] for r in rows if r["date"]})

        # Reliability: successes come from the DB (a usage row means the call
        # returned), failures from errors.log. Both keyed by model so the
        # matrix can show a real success rate rather than a guess.
        fail_stats, fail_recent = failures.for_profile(name)
        ok_by_model = {}
        for r in rows:
            ok_by_model[r["model"]] = ok_by_model.get(r["model"], 0) + (r["calls"] or 0)
        health = []
        for model in set(list(ok_by_model) + list(fail_stats)):
            ok = ok_by_model.get(model, 0)
            fs = fail_stats.get(model, {})
            bad = fs.get("total", 0)
            tot = ok + bad
            health.append({
                "model": model,
                "ok": ok, "fail": bad, "total": tot,
                "rate": round(100.0 * ok / tot, 1) if tot else None,
                "kinds": {k: v for k, v in fs.items()
                          if k not in ("total", "last", "last_msg", "last_kind")},
                "last": fs.get("last", ""),
                "last_kind": fs.get("last_kind", ""),
                "last_msg": fs.get("last_msg", ""),
            })
        health.sort(key=lambda h: (-h["fail"], -h["total"]))
        out["profiles"][name] = {"rows": rows, "hours": hours, "sessions": sess,
                                 "active": active,
                                 "live": live,
                                 "tools_recent": tools_recent,
                                 "recent_sessions": recent_sessions,
                                 "health": health,
                                 "heatmap": heatmap,
                                 "node_sessions": node_sessions,
                                 "failures_recent": fail_recent,
                                 "min_date": dates[0] if dates else None,
                                 "max_date": dates[-1] if dates else None}
    return out

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", default=str(REPORTS / "analytics-data.json"))
    a = ap.parse_args()
    data = build()
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(data, f, separators=(",", ":"), default=str)
    tot = sum(len(p["rows"]) for p in data["profiles"].values())
    print(f"{a.out}  ({len(data['profiles'])} profiles, {tot} day-rows)")
