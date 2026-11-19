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

export const TOOL_TOKEN_ROWS = `
select tool_name, session_id, coalesce(token_count, 0)
from messages
where tool_name is not null and tool_name != ''
  and timestamp > strftime('%s','now') - 2592000
`;

export const TOOL_RESULTS_CURRENT = `
select tool_name, session_id, timestamp, content, effect_disposition, finish_reason, token_count
from messages
where tool_name is not null and tool_name != ''
  and timestamp > strftime('%s','now') - 2592000
`;

export const TOOL_RESULTS_PREVIOUS = `
select tool_name, effect_disposition, finish_reason, content
from messages
where tool_name is not null and tool_name != ''
  and timestamp > strftime('%s','now') - 5184000
  and timestamp <= strftime('%s','now') - 2592000
`;

export const RECENT_TOOLS = `
select tool_name, count(*) from messages
where tool_name is not null and tool_name != ''
  and timestamp > strftime('%s','now') - 3600
group by tool_name order by 2 desc limit 14
`;

export const ASSISTANT_TURNS = `
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
`;

export const COMPRESSION_PRESSURE = `
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
`;

export const CONCURRENCY_INTERVALS = `
select started_at, ended_at, (parent_session_id is not null)
from sessions
where started_at > strftime('%s','now') - 7776000
`;

export const RECENT_SESSIONS = `
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
`;

export const RESEND = `
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
`;

export const LIVE = `
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
          order by u.last_seen desc limit 1),
       -- LST-256: how long this session has been running. The live table has an
       -- Elapsed column that showed "—" for every Hermes row because only the PI
       -- collector emitted uptime_s; the data was in sessions.started_at all
       -- along. Null when started_at is missing rather than 0, so the cell says
       -- "unknown" instead of claiming the session just started.
       case when s.started_at is null then null
            else cast(strftime('%s','now') - s.started_at as int) end
from sessions s
where s.ended_at is null
  and coalesce(s.last_activity_at, s.started_at) > strftime('%s','now') - 600
order by coalesce(s.last_activity_at, s.started_at) desc
`;

export const LIVE_BYTES = `
select u.session_id,
       coalesce(u.billing_base_url,''),
       coalesce(sum(u.input_tokens + u.cache_read_tokens),0),
       coalesce(sum(u.output_tokens),0)
from session_model_usage u join sessions s on s.id = u.session_id
where s.ended_at is null
  and coalesce(s.last_activity_at, s.started_at) > strftime('%s','now') - 600
group by u.session_id, u.billing_base_url
`;

export const RECENT_SESSIONS_COLS = ["id", "title", "model", "message_count", "last_ts", "dur_s", "last_model", "base_url", "prov", "api_calls", "tokens"];
export const LIVE_COLS = ["id", "title", "init_model", "phase", "idle_s", "parent", "tools", "model", "nmodels", "base_url", "uptime_s"];
export const RESEND_MIN_CALLS = 10;
