#!/usr/bin/env python3
"""Export cross-profile Hermes router analytics as one JSON document.

Rows are emitted at DAY granularity so the dashboard can filter any from/to
range entirely client-side without re-querying.
"""
import sqlite3
import json
import os
import datetime
import argparse
import sys
import time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from . import pricing
from . import cost_attribution
from .schema import stamp
from .schema_check import check
from . import failures
from . import bandwidth
from . import bandwidth_history
from . import delegations
from . import collect_repo_branch as repo_branch
from .projects import project_of_session

from .config import get as _cfg

CFG = _cfg()
REPORTS = CFG.reports_dir
# {display name: state.db} for every profile that exists on this machine.
PROFILES = {p.name: p.db for p in CFG.live_profiles()}

# one row per (day, model, provider, task, session) — grouped further down
# to session grain (not just title/cwd) because project resolution can
# require walking parent_session_id (P4-03, #40), which is a per-session
# fact, not a per-title one.
ROWS = """
select date(coalesce(u.last_seen, s.started_at),'unixepoch','localtime') d,
       u.model, u.billing_provider, coalesce(nullif(u.task,''),'main') task,
       sum(u.api_call_count), sum(u.input_tokens), sum(u.output_tokens),
       sum(u.cache_read_tokens), sum(u.cache_write_tokens), sum(u.reasoning_tokens),
       sum(u.estimated_cost_usd), sum(u.actual_cost_usd),
       count(distinct u.session_id),
       max(u.billing_base_url),
       u.session_id
from session_model_usage u join sessions s on s.id = u.session_id
group by d, u.model, u.billing_provider, task, u.session_id
order by d
"""

# Hour-granularity twin of ROWS, for the dashboard's sub-day range presets
# (1h/6h/12h — #129). ROWS is DAY grain on purpose (the from/to range filter
# used to be date-only, so day grain kept the payload small); this adds an
# hour column on the SAME underlying table so an hour preset can filter rows
# by real clock time instead of collapsing to "today". Scoped to the last 72
# hours only — anything older is already covered by ROWS at day grain, and an
# unbounded hour-grain export would balloon the payload for no UI benefit
# (no preset needs hour precision past a couple of days back).
HOUR_WINDOW_S = 259200  # 72h
HOUR_ROWS = """
select date(coalesce(u.last_seen, s.started_at),'unixepoch','localtime') d,
       cast(strftime('%H', coalesce(u.last_seen, s.started_at),'unixepoch','localtime') as int) h,
       u.model, u.billing_provider, coalesce(nullif(u.task,''),'main') task,
       sum(u.api_call_count), sum(u.input_tokens), sum(u.output_tokens),
       sum(u.cache_read_tokens), sum(u.cache_write_tokens), sum(u.reasoning_tokens),
       sum(u.estimated_cost_usd), sum(u.actual_cost_usd),
       count(distinct u.session_id),
       max(u.billing_base_url),
       u.session_id
from session_model_usage u join sessions s on s.id = u.session_id
where coalesce(u.last_seen, s.started_at) > strftime('%s','now') - {window}
group by d, h, u.model, u.billing_provider, task, u.session_id
order by d, h
""".format(window=HOUR_WINDOW_S)

# All sessions' identity fields, for project resolution (P4-01/P4-03) and
# cost attribution (P10-07, #95): one query, loaded once per profile into a
# dict, so walking parent_session_id never re-hits the database per hop.
SESSION_IDENTITY = "select id, title, cwd, parent_session_id, source, display_name, git_branch from sessions"
# Context re-send per session (P9-03, #80). One row per (session, model) over
# the last 30 days. Sessions under RESEND_MIN_CALLS calls are dropped: a
# 3-call session has no meaningful average context.
RESEND_MIN_CALLS = 10
RESEND = """
select u.session_id, coalesce(nullif(s.title,''), '') title, u.model,
       max(u.billing_provider), max(u.billing_base_url),
       sum(u.api_call_count), sum(u.input_tokens), sum(u.cache_write_tokens),
       sum(u.cache_read_tokens), max(u.last_seen)
from session_model_usage u join sessions s on s.id = u.session_id
where u.last_seen > strftime('%s','now') - 2592000
group by u.session_id, u.model
having sum(u.api_call_count) >= ?
order by sum(u.cache_read_tokens) desc
limit 60
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

# P9-04 (#81): session-lifecycle signals the Health view otherwise ignores —
# end_reason breakdown, and compression-pressure sessions. Scoped to the last
# 30 days, the same window RESEND uses, so it stays a "what's happening
# lately" signal rather than growing unbounded with the DB's full history.
# rewind_count is deliberately excluded per the ticket's own note: it is 0
# everywhere observed, and a panel for an always-zero column is how
# dashboards accumulate dead space.
END_REASONS = """
select coalesce(nullif(end_reason,''), '(none)'), count(*)
from sessions
where ended_at is not null
  and ended_at > strftime('%s','now') - 2592000
group by 1
order by count(*) desc
"""
# P10-03 (#91): session outcomes. `(none)` here means "ended_at is set but
# end_reason is NULL/empty" — a session that died without saying why. That
# is DELIBERATELY never folded into an "ok" bucket: the ticket's own words
# are "the ones that died without saying why", and merging it into ok would
# hide exactly the signal this ticket exists to surface. `reap` means the
# collector itself detected an abandoned in-flight session
# (startup_orphan_reap / ws_orphan_reap) — the agent process died mid-turn
# with the work unaccounted for, a stronger and separately-tracked signal
# than a plain silent end.
OUTCOMES_BY_REASON = """
select coalesce(nullif(end_reason,''), '(none)'), count(*)
from sessions
where ended_at is not null
  and ended_at > strftime('%s','now') - 2592000
group by 1
"""
OUTCOMES_BY_SOURCE_REASON = """
select coalesce(nullif(source,''), '(unknown)'), coalesce(nullif(end_reason,''), '(none)'), count(*)
from sessions
where ended_at is not null
  and ended_at > strftime('%s','now') - 2592000
group by 1, 2
"""
OUTCOMES_SILENT = """
select id, coalesce(nullif(title,''), nullif(display_name,''), '(untitled)'),
       coalesce(nullif(source,''), '(unknown)'), model, cast(ended_at as integer)
from sessions
where ended_at is not null
  and ended_at > strftime('%s','now') - 2592000
  and (end_reason is null or end_reason = '')
order by ended_at desc
"""
OUTCOMES_REAPED = """
select id, coalesce(nullif(source,''), '(unknown)'), model, cast(ended_at as integer)
from sessions
where ended_at is not null
  and ended_at > strftime('%s','now') - 2592000
  and end_reason in ('startup_orphan_reap', 'ws_orphan_reap')
order by ended_at desc
"""
# Reaps per day for the trend line — same date() convention the rest of the
# collector uses (localtime, so the trend lines up with the other day-grain
# charts on the same page).
OUTCOMES_REAP_TREND = """
select date(ended_at,'unixepoch','localtime') d, count(*)
from sessions
where ended_at is not null
  and ended_at > strftime('%s','now') - 2592000
  and end_reason in ('startup_orphan_reap', 'ws_orphan_reap')
group by 1
order by 1
"""


def build_outcomes(con):
    """Assemble the P10-03 outcomes payload. Kept as one function so the four
    buckets share one clock (all read `ended_at` from the SAME snapshot of
    the DB — no two queries can disagree about "now" mid-build)."""
    by_reason = {r: n for r, n in con.execute(OUTCOMES_BY_REASON)}
    by_source_reason = {}
    for src, reason, n in con.execute(OUTCOMES_BY_SOURCE_REASON):
        by_source_reason.setdefault(src, {})[reason] = n
    silent = [{"id": sid, "title": title, "source": src, "model": model, "when": when}
              for sid, title, src, model, when in con.execute(OUTCOMES_SILENT)]
    reaped = [{"id": sid, "source": src, "model": model, "when": when}
              for sid, src, model, when in con.execute(OUTCOMES_REAPED)]
    reap_trend = [{"date": d, "n": n} for d, n in con.execute(OUTCOMES_REAP_TREND)]
    return {"by_reason": by_reason, "by_source_reason": by_source_reason,
            "silent": silent, "reaped": reaped, "reap_trend": reap_trend}


# P10-01 (#89): sessions_tree. Selects EVERY session touched in the last 30
# days (the same window END_REASONS/RESEND use) whose OWN activity falls in
# range, OR whose PARENT is recent (a subagent spawned by a long-running
# session started outside the window), OR whose CHILD is recent (an old
# parent whose subagent just ran must still surface so that child isn't
# orphaned at render time) — a tree built from only the first of these three
# would silently drop real relationships. Cost comes directly from
# sessions.estimated_cost_usd/actual_cost_usd — the same fields the
# Detail/session-level cost figures already read — not a recomputed
# price_row() call, so the tree can never disagree with the rest of the
# dashboard about what a session cost.
SESSIONS_TREE = """
select s.id, coalesce(s.parent_session_id,''), coalesce(s.source,''),
       coalesce(nullif(s.title,''), nullif(s.display_name,''), '(untitled)'),
       s.model,
       cast(s.started_at as integer),
       cast(s.ended_at as integer),
       coalesce(nullif(s.end_reason,''), case when s.ended_at is null then '(running)' else '(none)' end),
       coalesce(s.message_count,0), coalesce(s.tool_call_count,0),
       coalesce(s.input_tokens,0) + coalesce(s.output_tokens,0)
         + coalesce(s.cache_read_tokens,0) + coalesce(s.cache_write_tokens,0),
       coalesce(s.actual_cost_usd, s.estimated_cost_usd, 0),
       (s.actual_cost_usd is not null)
from sessions s
where (s.started_at > strftime('%s','now') - 2592000
       or coalesce(s.ended_at, 0) > strftime('%s','now') - 2592000)
   or s.parent_session_id in (
        select id from sessions
        where started_at > strftime('%s','now') - 2592000
           or coalesce(ended_at, 0) > strftime('%s','now') - 2592000)
   or s.id in (
        select parent_session_id from sessions
        where parent_session_id is not null
          and (started_at > strftime('%s','now') - 2592000
               or coalesce(ended_at, 0) > strftime('%s','now') - 2592000))
"""
SESSIONS_TREE_COLS = ("id parent source title model started ended end_reason "
                      "msgs tools tok cost cost_is_actual").split()


def build_sessions_tree(con):
    """Assemble sessions_tree: nodes, each with a roll-up of itself plus every
    descendant's cost/tokens/child-count/failed-child-count.

    Two passes because a roll-up needs every descendant to already exist:
    pass 1 builds a flat {id: node} map (own figures only, children:[]);
    pass 2 links each node under its parent and walks bottom-up (any DB order
    is possible — a child row can appear before or after its parent) to add
    descendant totals on top of each node's own figures. depth is not
    hardcoded to any fixed number: the DB's current data goes one level deep,
    but nothing here assumes that stays true (P4-03, #40 hit the same trap
    walking parent_session_id and is not repeated).
    """
    rows = [dict(zip(SESSIONS_TREE_COLS, r)) for r in con.execute(SESSIONS_TREE)]
    nodes = {}
    for r in rows:
        nodes[r["id"]] = {
            "id": r["id"], "parent": r["parent"] or None, "source": r["source"],
            "title": r["title"], "model": r["model"],
            "started": r["started"], "ended": r["ended"], "end_reason": r["end_reason"],
            "msgs": r["msgs"], "tools": r["tools"], "tok": r["tok"],
            "cost": round(r["cost"] or 0, 6), "cost_is_actual": bool(r["cost_is_actual"]),
            "own_cost": round(r["cost"] or 0, 6), "own_tok": r["tok"],
            "children": [], "child_count": 0, "failed_child_count": 0,
        }

    roots = []
    for r in rows:
        n = nodes[r["id"]]
        parent = nodes.get(r["parent"]) if r["parent"] else None
        if parent is not None:
            parent["children"].append(n)
        else:
            roots.append(n)

    # Bottom-up roll-up via post-order recursion, cycle-bounded the same way
    # project_of_session() is (MAX_PARENT_DEPTH-equivalent): a malformed
    # self-referential parent chain must not hang the collector.
    def rollup(node, depth=0, visited=None):
        visited = visited or set()
        if node["id"] in visited or depth > 20:
            return
        visited = visited | {node["id"]}
        total_cost, total_tok, child_n, failed_n = node["own_cost"], node["own_tok"], 0, 0
        for child in node["children"]:
            rollup(child, depth + 1, visited)
            total_cost += child["cost"]
            total_tok += child["tok"]
            child_n += 1 + child["child_count"]
            failed_n += child["failed_child_count"] + (
                1 if child["end_reason"] not in ("(none)", "(running)") and
                     "error" in child["end_reason"].lower() else 0)
        node["cost"] = round(total_cost, 6)
        node["tok"] = total_tok
        node["child_count"] = child_n
        node["failed_child_count"] = failed_n

    for root in roots:
        rollup(root)
    for n in nodes.values():
        del n["own_cost"], n["own_tok"]
    return roots


COMPRESSION_PRESSURE = """
select id, coalesce(nullif(title,''), nullif(display_name,''), '(untitled)'),
       compression_fallback_streak, compression_ineffective_count,
       compression_failure_error
from sessions
where started_at > strftime('%s','now') - 2592000
  and (compression_fallback_streak > 0
       or compression_ineffective_count > 0
       or coalesce(compression_failure_error,'') != '')
order by compression_ineffective_count desc, compression_fallback_streak desc
limit 40
"""

# P9-06 (#83): "how many agents were running at once" — the concurrency
# question neither Live (right now) nor Usage (daily volume) answers.
# Bucketing overlapping [started_at, ended_at] intervals into hours is
# awkward in pure SQL (a session spanning several hours needs to count in
# EACH of them), so this only pulls the raw intervals and does the bucketing
# in Python (see concurrency_by_hour below) — the SQL stays a plain scan
# with an index-friendly predicate, and the interval logic is one small,
# independently testable function instead of a recursive CTE.
# Scoped to the same 90-day window as HEATMAP.
CONCURRENCY_INTERVALS = """
select started_at, ended_at, (parent_session_id is not null)
from sessions
where started_at > strftime('%s','now') - 7776000
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

# Token totals per (live session, endpoint), for bandwidth estimation.
#
# Split per ENDPOINT, not per session: a session routinely runs several models
# (up to 6 observed), so classifying a whole session by its current model
# attributed gigabytes of metered traffic to the LAN. The caller decides which
# URLs are local, using config.local_host_patterns — the patterns are not
# duplicated into this SQL.
#
# Upload counts cache_read because every provider here uses PREFIX caching: the
# client re-sends the whole prompt and the server merely skips recomputation, so
# those tokens genuinely cross the link (verified: anthropic reports
# cache_write > 0 and ~146k cache_read tokens per call).
LIVE_BYTES = """
select u.session_id,
       coalesce(u.billing_base_url,''),
       coalesce(sum(u.input_tokens + u.cache_read_tokens),0),
       coalesce(sum(u.output_tokens),0)
from session_model_usage u join sessions s on s.id = u.session_id
where s.ended_at is null
  and coalesce(s.last_activity_at, s.started_at) > strftime('%s','now') - 600
group by u.session_id, u.billing_base_url
"""

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
# P10-07 (#95): tokens consumed by tool RESULTS, for cost-by-tool
# attribution — 30 days, same window as ROWS/the rest of the Cost view.
TOOL_TOKEN_ROWS = """
select tool_name, session_id, coalesce(token_count, 0)
from messages
where tool_name is not null and tool_name != ''
  and timestamp > strftime('%s','now') - 2592000
"""
# P10-04 (#92): tool reliability. Two windows so the panel can show a
# trend arrow — current 30 days vs the SAME-LENGTH 30 days immediately
# before it, not "vs all history" which would bury a recent regression
# under months of good data.
TOOL_RESULTS_CURRENT = """
select tool_name, session_id, timestamp, content, effect_disposition, finish_reason, token_count
from messages
where tool_name is not null and tool_name != ''
  and timestamp > strftime('%s','now') - 2592000
"""
TOOL_RESULTS_PREVIOUS = """
select tool_name, effect_disposition, finish_reason, content
from messages
where tool_name is not null and tool_name != ''
  and timestamp > strftime('%s','now') - 5184000
  and timestamp <= strftime('%s','now') - 2592000
"""


def _pXX(sorted_vals, pct):
    """Nearest-rank percentile over an already-sorted list. Returns 0 for an
    empty list rather than raising — a tool with zero results this period
    is not an error, just uninteresting."""
    if not sorted_vals:
        return 0
    idx = min(len(sorted_vals) - 1, int(round(pct / 100.0 * (len(sorted_vals) - 1))))
    return sorted_vals[idx]


def build_tool_reliability(con):
    """Per-tool calls/fail-rate/trend/wasted-tokens + top failing terminal
    commands + recent failing result heads, per P10-04 (#92).

    tool_outcome() classifies each row from structured signals only (see
    that module's own docstring for why a substring scan is explicitly
    rejected) and returns 'unknown' rather than guessing — unknown rows
    still count toward `calls` (they happened) but are excluded from the
    fail-rate numerator/denominator, exactly like the classifier's own
    precision test excludes them: an abstention is not a data point about
    whether the call worked.
    """
    from .tool_outcomes import tool_outcome

    by_tool = {}          # name -> {calls, fails, confident, tok_wasted, sizes:[], sessions_seen:set}
    cmd_fails = {}         # terminal first-token -> fail count
    fail_samples = {}      # name -> [{session, ts, head}]

    for tool_name, session_id, ts, content, disp, reason, tok in con.execute(TOOL_RESULTS_CURRENT):
        b = by_tool.setdefault(tool_name, {"calls": 0, "fails": 0, "confident": 0,
                                            "tok_wasted": 0, "sizes": []})
        b["calls"] += 1
        size = len(content or "")
        b["sizes"].append(size)
        outcome = tool_outcome({"content": content, "effect_disposition": disp, "finish_reason": reason})
        if outcome != "unknown":
            b["confident"] += 1
            if outcome == "fail":
                b["fails"] += 1
                b["tok_wasted"] += int(tok or 0)
                samples = fail_samples.setdefault(tool_name, [])
                if len(samples) < 20:
                    samples.append({"session": session_id, "ts": int(ts) if ts else None,
                                     "head": (content or "")[:300]})
                if tool_name == "terminal":
                    # First token of the command, from the fail sample's own
                    # head when it looks like a command echo is not
                    # reliable — the ticket asks for the command, which is
                    # only in the ASSISTANT tool_calls row, not this result
                    # row. Falling back to "(unknown)" rather than guessing
                    # at a command from output text.
                    cmd = _terminal_command_hint(content)
                    cmd_fails[cmd] = cmd_fails.get(cmd, 0) + 1

    prev_by_tool = {}
    for tool_name, disp, reason, content in con.execute(TOOL_RESULTS_PREVIOUS):
        b = prev_by_tool.setdefault(tool_name, {"confident": 0, "fails": 0})
        outcome = tool_outcome({"content": content, "effect_disposition": disp, "finish_reason": reason})
        if outcome != "unknown":
            b["confident"] += 1
            if outcome == "fail":
                b["fails"] += 1

    tools = []
    for name, b in by_tool.items():
        sizes = sorted(b["sizes"])
        fail_rate = (b["fails"] / b["confident"]) if b["confident"] else None
        prev = prev_by_tool.get(name)
        prev_fail_rate = (prev["fails"] / prev["confident"]) if prev and prev["confident"] else None
        tools.append({
            "name": name, "calls": b["calls"], "fails": b["fails"],
            "fail_rate": round(fail_rate, 4) if fail_rate is not None else None,
            "prev_fail_rate": round(prev_fail_rate, 4) if prev_fail_rate is not None else None,
            "tok_wasted": b["tok_wasted"],
            "p50_bytes": _pXX(sizes, 50), "p95_bytes": _pXX(sizes, 95),
        })
    # Sort by cost of failures (fails * tokens the failed results consumed)
    # per the ticket's own stated ranking — a tool failing cheaply matters
    # less than one failing after a 20k-token result.
    tools.sort(key=lambda t: -t["tok_wasted"])

    top_commands = sorted(cmd_fails.items(), key=lambda kv: -kv[1])[:10]
    return {
        "tools": tools,
        "tool_fail_samples": fail_samples,
        "terminal_top_fail_commands": [{"cmd": c, "n": n} for c, n in top_commands],
    }


def _terminal_command_hint(content):
    """Best-effort first token of a failing terminal command, read from the
    RESULT's own echoed command field when present, else '(unknown)'. Never
    parses free-text output looking for a command — that is exactly the
    kind of guess the ticket's own classifier note warns against."""
    doc = None
    try:
        import json as _json
        parsed = _json.loads(content) if isinstance(content, str) else None
        doc = parsed if isinstance(parsed, dict) else None
    except (ValueError, TypeError):
        doc = None
    if doc:
        cmd = doc.get("command")
        if isinstance(cmd, str) and cmd.strip():
            return cmd.strip().split()[0]
    return "(unknown)"


# P10-05 (#93): latency. `messages` has no per-row model column, so each
# assistant turn is attributed to the model/base_url that was MOST RECENTLY
# active for that session as of the turn's own timestamp — the same
# last-seen-subquery pattern RECENT_SESSIONS already uses, just bounded by
# `u.last_seen <= m.timestamp` so a session that later switched models does
# not retroactively relabel its earlier turns.
ASSISTANT_TURNS = """
select m.session_id, m.timestamp,
       coalesce(
         (select u.model from session_model_usage u
           where u.session_id=m.session_id and u.last_seen <= m.timestamp
           order by u.last_seen desc limit 1),
         s.model) as model,
       (select u.billing_base_url from session_model_usage u
         where u.session_id=m.session_id and u.last_seen <= m.timestamp
         order by u.last_seen desc limit 1) as base_url,
       m.token_count
from messages m
join sessions s on s.id = m.session_id
where m.role = 'assistant'
  and m.timestamp > strftime('%s','now') - 604800
order by m.session_id, m.timestamp
"""


def build_latency(con):
    """P10-05 (#93): p50/p90/p99 of assistant-turn gaps, per model and per
    endpoint, idle excluded. Delegates the actual math to latency.py
    (compute_gaps/build_latency) which is independently unit-tested; this
    function is just the SQL-to-payload glue, kept thin on purpose."""
    from . import latency as _latency
    from .bandwidth import canonical_endpoint

    rows = con.execute(ASSISTANT_TURNS).fetchall()
    gaps, idle_gaps = _latency.compute_gaps(rows)
    result = _latency.build_latency(gaps, endpoint_of=canonical_endpoint)
    result["idle_threshold_s"] = _latency.DEFAULT_IDLE_THRESHOLD_S
    result["idle_n"] = len(idle_gaps)
    return result


COLS = "date model provider task calls inp outp cread cwrite rtok est act sessions base_url session_id".split()
HOUR_COLS = "date hour model provider task calls inp outp cread cwrite rtok est act sessions base_url session_id".split()

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


def _tilde(path):
    home = os.path.expanduser("~")
    path = str(path)
    return "~" + path[len(home):] if path == home or path.startswith(home + os.sep) else path


def concurrency_by_hour(intervals, now=None):
    """(#83/P9-06) Sessions active per hour, split top-level vs. subagent.

    `intervals` is an iterable of (started_at, ended_at, is_subagent) as
    returned by CONCURRENCY_INTERVALS — ended_at may be None for a session
    that is still running (crashed-without-closing counts the same as
    genuinely still-running here: both were occupying a slot for that hour,
    which is the only thing this metric claims to measure).

    A session spanning multiple hours is counted in EVERY hour it overlaps,
    not just the hour it started in — an 8am-11am session is concurrency
    pressure at 9am and 10am too, and a start-hour-only count would hide
    that entirely.

    Returns a dict keyed "YYYY-MM-DD HH" (local time, zero-padded hour) ->
    {"top": n, "sub": n}. Empty input returns an empty dict — the caller
    decides what an empty range renders as (#83's own "not a broken axis"
    acceptance criterion), this function makes no chart-shaped assumptions.
    """
    import time as _time
    now = now if now is not None else _time.time()
    buckets = {}
    HOUR = 3600
    for started_at, ended_at, is_subagent in intervals:
        if started_at is None:
            continue
        end = ended_at if ended_at is not None else now
        if end < started_at:
            # Clock skew / bad data: a negative-duration session contributes
            # nothing rather than silently going backwards through hours.
            continue
        first_hour = int(started_at // HOUR)
        last_hour = int(end // HOUR)
        key_field = "sub" if is_subagent else "top"
        for h in range(first_hour, last_hour + 1):
            ts = h * HOUR
            key = datetime.datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:00")
            b = buckets.setdefault(key, {"top": 0, "sub": 0})
            b[key_field] += 1
    return buckets


def fetch_rows(con):
    """Fetch and resolve the ROWS query for one profile's connection
    (P4-02 #39, P4-03 #40). Extracted from build() so it's directly
    testable against a fixture connection without driving build()'s full
    profile-resolution plumbing — the SQL, the COLS zip, and the
    project_of_session() resolution (including the parent-chain walk) all
    happen in exactly one place, called from both build() and the tests.
    """
    sessions_by_id = {
        row[0]: {"title": row[1], "cwd": row[2], "parent_session_id": row[3],
                 "source": row[4], "display_name": row[5], "git_branch": row[6]}
        for row in con.execute(SESSION_IDENTITY)
    }
    rows = [dict(zip(COLS, r)) for r in con.execute(ROWS)]
    for r in rows:
        # Resolve to the single project resolver (P4-01 #56, P4-03 #40)
        # here, once, so no consumer re-implements the stem rule or the
        # parent-chain walk. Raw session_id is kept — every row already had
        # a real session_id in the fetched grain and the payload does not
        # newly expose anything by keeping it (RESEND, a separate
        # per-session payload section, already exposes session_id).
        r["project"] = project_of_session(r["session_id"], sessions_by_id)
        # P10-07 (#95): cost attribution needs the session's source
        # (desktop/subagent/cron/...) on every row — joined in here, once,
        # rather than re-joined by every consumer.
        r["source"] = (sessions_by_id.get(r["session_id"]) or {}).get("source")
    return rows


def fetch_hour_rows(con):
    """Hour-grain twin of fetch_rows (#129): same resolution (project,
    source) applied to HOUR_ROWS/HOUR_COLS instead of ROWS/COLS, so the
    dashboard's hour range presets (1h/6h/12h) filter real per-hour data
    instead of collapsing to a whole day. Scoped to HOUR_WINDOW_S — see the
    query's own docstring for why that bound exists.
    """
    sessions_by_id = {
        row[0]: {"title": row[1], "cwd": row[2], "parent_session_id": row[3],
                 "source": row[4], "display_name": row[5], "git_branch": row[6]}
        for row in con.execute(SESSION_IDENTITY)
    }
    rows = [dict(zip(HOUR_COLS, r)) for r in con.execute(HOUR_ROWS)]
    for r in rows:
        r["project"] = project_of_session(r["session_id"], sessions_by_id)
        r["source"] = (sessions_by_id.get(r["session_id"]) or {}).get("source")
    return rows


def _enrich_rows(rows, catalog):
    """Price + bandwidth-enrich rows in place. Shared by the day-grain
    (fetch_rows) and hour-grain (fetch_hour_rows, #129) paths so the two can
    never compute a different cost or wire-byte estimate for the same call.
    """
    for r in rows:
        r.update(pricing.price_row(
            {"provider": r["provider"], "model": r["model"],
             "base_url": r.get("base_url"),
             "input_tokens": r["inp"], "output_tokens": r["outp"],
             "cache_read": r["cread"], "cache_write": r.get("cwrite") or 0,
             "calls": r.get("calls")}, catalog))
        # Estimated wire bytes for this row, bucketed by destination.
        # Same helper the live collector uses, so the tables and the
        # live view can never disagree about what a token costs to send.
        up, down, lan_up, lan_down = bandwidth.split_row(
            r.get("base_url"), r["inp"], r["outp"], r["cread"], r.get("cwrite"))
        r["up_bytes"] = up
        r["down_bytes"] = down
        r["lan_up_bytes"] = lan_up
        r["lan_down_bytes"] = lan_down


def unreadable(db):
    """Why a profile's state.db cannot be read, or None if it can (P5-04).

    Opens read-only and touches the one table every query here depends on, so
    a corrupt file, a permissions problem or an older schema is caught up
    front and reported, instead of crashing the collector for every profile.
    """
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            con.execute("select 1 from session_model_usage limit 1").fetchall()
        finally:
            con.close()
    except (sqlite3.Error, OSError) as e:
        return f"{type(e).__name__}: {e}"
    return None

def build():
    out = {"generated": datetime.datetime.now().isoformat(timespec="seconds"), "profiles": {}}
    catalog, catsrc = pricing.fetch_catalog()
    out["pricing_source"] = catsrc
    out["pricing_models"] = pricing.catalog_size(catalog)
    # Resolution report (P5-04): how the profile list was arrived at, plus any
    # profile whose database could not be read. Rendered in the header so a
    # missing profile is a visible warning, never a silent omission.
    res = dict(getattr(CFG, "resolution", {}) or {})
    res["failed"] = list(res.get("failed", []))
    # Paths go out with the home directory contracted to ~: the payload is
    # rendered into a page, and the page has no business naming the user.
    for k in ("agent_home", "config_file"):
        if res.get(k):
            res[k] = _tilde(res[k])
    out["resolution"] = res
    for name, db in PROFILES.items():
        if not os.path.exists(db):
            continue
        why = unreadable(db)
        if why:
            res["failed"].append({"name": name, "path": _tilde(str(db)),
                                  "reason": why.replace(os.path.expanduser("~"), "~")})
            continue
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            rows = fetch_rows(con)
            _enrich_rows(rows, catalog)
            # #129: hour-grain rows for the dashboard's sub-day range
            # presets, enriched with the SAME pricing/bandwidth helper as
            # the day-grain rows so the two can never disagree about what a
            # call cost or weighed on the wire.
            hour_rows = fetch_hour_rows(con)
            _enrich_rows(hour_rows, catalog)
            hours = [{"date": d, "hour": h, "calls": c} for d, h, c in con.execute(HOURS)]
            # P4-05 (#101), part 2: repo & branch attribution, over the SAME
            # per-row grain fetch_rows() already resolved.
            sessions_for_repo = {
                row[0]: {"cwd": row[2], "git_branch": row[6]} for row in con.execute(SESSION_IDENTITY)
            }
            p_repo_branch = repo_branch.build_repo_branch(rows, sessions_for_repo)
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
            # Context re-send per session (P9-03, #80). Re-sent cost is the
            # cache-read tokens priced by price_row() on a cache-only row, so
            # it reconciles with the Cost view: no third disagreeing figure.
            resend = []
            for (sid, title, mdl, prov, url, calls, inp, cw, cr,
                 last) in con.execute(RESEND, (RESEND_MIN_CALLS,)):
                prompt = (inp or 0) + (cw or 0) + (cr or 0)
                pr = pricing.price_row({"provider": prov, "model": mdl, "base_url": url,
                                        "input_tokens": 0, "output_tokens": 0,
                                        "cache_read": cr or 0}, catalog)
                resend.append({
                    "id": sid, "title": title, "model": mdl, "calls": calls,
                    "ctx_per_call": round(prompt / calls) if calls else 0,
                    "cread_pct": round(100.0 * (cr or 0) / prompt, 1) if prompt else 0.0,
                    "resend_usd": pr["market_value_usd"], "cost_class": pr["cost_class"],
                    "last": last})
            resend.sort(key=lambda x: -x["resend_usd"])
            # P9-04 (#81): lifecycle signals for the Health view.
            end_reasons = [{"reason": r, "n": n} for r, n in con.execute(END_REASONS)]
            outcomes = build_outcomes(con)
            tool_rel = build_tool_reliability(con)
            latency = build_latency(con)
            # P10-07 (#95): cost attribution — reuses the SAME already-priced
            # `rows` this profile just built (market_value_usd from
            # pricing.price_row(), never recomputed) and the same
            # SESSION_IDENTITY sessions_by_id dict fetch_rows() built for
            # project resolution, so the tree and cost-by-root can never
            # disagree about parentage.
            sessions_by_id = {
                row[0]: {"title": row[1], "cwd": row[2], "parent_session_id": row[3],
                         "source": row[4], "display_name": row[5]}
                for row in con.execute(SESSION_IDENTITY)
            }
            tool_token_rows = [{"tool_name": t, "session_id": sid, "tokens": tok}
                                for t, sid, tok in con.execute(TOOL_TOKEN_ROWS)]
            attribution = cost_attribution.build_attribution(rows, sessions_by_id, tool_token_rows)
            sessions_tree = build_sessions_tree(con)
            compression_pressure = [
                {"id": sid, "title": title, "fallback_streak": fb,
                 "ineffective_count": ic, "error": err or ""}
                for sid, title, fb, ic, err in con.execute(COMPRESSION_PRESSURE)]
            # P9-06 (#83): concurrency-by-hour. concurrency_by_hour does the
            # interval bucketing in Python (see its own docstring for why);
            # this just shapes the dict into the flat list the dashboard's
            # other hour-keyed payloads (HOURS) already use.
            conc_buckets = concurrency_by_hour(con.execute(CONCURRENCY_INTERVALS))
            concurrency = [
                {"hour": k, "top": v["top"], "sub": v["sub"]}
                for k, v in sorted(conc_buckets.items())]
            # Must run BEFORE the finally below closes the connection.
            deleg = delegations.collect(con)
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
                                 "hour_rows": hour_rows,
                                 "active": active,
                                 "live": live,
                                 "tools_recent": tools_recent,
                                 "recent_sessions": recent_sessions,
                                 "resend": resend,
                                 "health": health,
                                 "end_reasons": end_reasons,
                                 "outcomes": outcomes,
                                 "tools": tool_rel["tools"],
                                 "tool_fail_samples": tool_rel["tool_fail_samples"],
                                 "terminal_top_fail_commands": tool_rel["terminal_top_fail_commands"],
                                 "latency": latency,
                                 "attribution": attribution,
                                 "sessions_tree": sessions_tree,
                                 "compression_pressure": compression_pressure,
                                 "concurrency": concurrency,
                                 "heatmap": heatmap,
                                 "node_sessions": node_sessions,
                                 "failures_recent": fail_recent,
                                 "delegations": deleg,
                                 "repo_branch": p_repo_branch,
                                 "min_date": dates[0] if dates else None,
                                 "max_date": dates[-1] if dates else None}
    # P8-04: persist the per-day bandwidth series. Closed days are frozen with
    # the bytes_per_token they were computed with, so a recalibration never
    # restates history. The page reads the series from here, not from rows.
    series = bandwidth_history.update(
        REPORTS, {n: p["rows"] for n, p in out["profiles"].items()})
    for n, p in out["profiles"].items():
        p["bandwidth_daily"] = series.get(n, [])
    # P10-09 (#97): context & compaction — a separate module walks each
    # profile's messages once for its own purpose (running context size,
    # compaction yield); merged in here rather than threaded through the
    # main per-day loop above, which has nothing to do with per-call
    # context growth.
    from . import collect_context_compaction as CX
    context_by_profile = CX.build_context_payload()
    for n, p in out["profiles"].items():
        p["context"] = context_by_profile.get(n, {"sessions": [], "reasoning_by_model": [], "cooldowns": []})
    # P10-10 (#98): Attention card — every rule in alerts.RULES evaluated
    # against this SAME finished profile payload, after every other field
    # above is already populated, so a rule can read anything (bandwidth,
    # delegations, context, agents) the rest of the payload already built.
    from . import alerts as ALERTS
    now_ts = time.time()
    for n, p in out["profiles"].items():
        p["_now"] = now_ts
        p["alerts"] = ALERTS.build_alerts(p)
        del p["_now"]
    # P10-12 (#100): Session finder palette -- one small row per session,
    # no message content (full-text search is explicitly out of scope
    # for this ticket; the existing-but-unused messages_fts index is the
    # real follow-up).
    from . import collect_session_index as SI
    session_index_by_profile = SI.build_session_index_by_profile()
    for n, p in out["profiles"].items():
        p["session_index"] = session_index_by_profile.get(n, [])
    return stamp(out)

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", default=str(REPORTS / "analytics-data.json"))
    a = ap.parse_args()
    data = build()
    # Never write a payload the page cannot read (P1-02, #24).
    check("analytics", data)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(data, f, separators=(",", ":"), default=str)
    tot = sum(len(p["rows"]) for p in data["profiles"].values())
    print(f"{a.out}  ({len(data['profiles'])} profiles, {tot} day-rows)")
