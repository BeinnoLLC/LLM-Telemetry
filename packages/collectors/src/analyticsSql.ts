/** SQL text of collect_analytics.py, copied verbatim (T-15, LLMTELEMET-286).
 * A test compares every constant with the Python module, so drift fails CI. */

export const HOUR_WINDOW_S = 259200;

export const ROWS = `
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
`;

export const HOUR_ROWS = `
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
where coalesce(u.last_seen, s.started_at) > strftime('%s','now') - 259200
group by d, h, u.model, u.billing_provider, task, u.session_id
order by d, h
`;

export const SESSION_IDENTITY = `select id, title, cwd, parent_session_id, source, display_name, git_branch from sessions`;

export const SESS_BY_NODE = `
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
`;

export const HOURS = `
select date(coalesce(u.last_seen, s.started_at),'unixepoch','localtime') d,
       cast(strftime('%H', coalesce(u.last_seen, s.started_at),'unixepoch','localtime') as int) h,
       sum(u.api_call_count)
from session_model_usage u join sessions s on s.id = u.session_id
group by d, h
`;

export const HEATMAP = `
select date(coalesce(u.last_seen, s.started_at),'unixepoch','localtime') d,
       u.billing_provider p, u.billing_base_url url, u.model m,
       sum(u.api_call_count) calls
from session_model_usage u join sessions s on s.id = u.session_id
where u.last_seen > strftime('%s','now') - 7776000
group by d, u.billing_provider, u.billing_base_url, u.model
order by d
`;

export const SESS = `
select date(started_at,'unixepoch','localtime') d, coalesce(nullif(source,''),'-') src, count(*)
from sessions group by d, src
`;

export const END_REASONS = `
select coalesce(nullif(end_reason,''), '(none)'), count(*)
from sessions
where ended_at is not null
  and ended_at > strftime('%s','now') - 2592000
group by 1
order by count(*) desc
`;

export const OUTCOMES_BY_REASON = `
select coalesce(nullif(end_reason,''), '(none)'), count(*)
from sessions
where ended_at is not null
  and ended_at > strftime('%s','now') - 2592000
group by 1
`;

export const OUTCOMES_BY_SOURCE_REASON = `
select coalesce(nullif(source,''), '(unknown)'), coalesce(nullif(end_reason,''), '(none)'), count(*)
from sessions
where ended_at is not null
  and ended_at > strftime('%s','now') - 2592000
group by 1, 2
`;

export const OUTCOMES_SILENT = `
select id, coalesce(nullif(title,''), nullif(display_name,''), '(untitled)'),
       coalesce(nullif(source,''), '(unknown)'), model, cast(ended_at as integer)
from sessions
where ended_at is not null
  and ended_at > strftime('%s','now') - 2592000
  and (end_reason is null or end_reason = '')
order by ended_at desc
`;

export const OUTCOMES_REAPED = `
select id, coalesce(nullif(source,''), '(unknown)'), model, cast(ended_at as integer)
from sessions
where ended_at is not null
  and ended_at > strftime('%s','now') - 2592000
  and end_reason in ('startup_orphan_reap', 'ws_orphan_reap')
order by ended_at desc
`;

export const OUTCOMES_REAP_TREND = `
select date(ended_at,'unixepoch','localtime') d, count(*)
from sessions
where ended_at is not null
  and ended_at > strftime('%s','now') - 2592000
  and end_reason in ('startup_orphan_reap', 'ws_orphan_reap')
group by 1
order by 1
`;

export const SESSIONS_TREE = `
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
`;

export const ACTIVE = `
select count(*) from sessions
where ended_at is null
  and coalesce(last_activity_at, started_at) > strftime('%s','now') - 600
`;

export const SESSIONS_TREE_COLS = ["id", "parent", "source", "title", "model", "started", "ended", "end_reason", "msgs", "tools", "tok", "cost", "cost_is_actual"];
export const COLS = ["date", "model", "provider", "task", "calls", "inp", "outp", "cread", "cwrite", "rtok", "est", "act", "sessions", "base_url", "session_id"];
export const HOUR_COLS = ["date", "hour", "model", "provider", "task", "calls", "inp", "outp", "cread", "cwrite", "rtok", "est", "act", "sessions", "base_url", "session_id"];
