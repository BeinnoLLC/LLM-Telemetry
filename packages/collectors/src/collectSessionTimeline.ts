/** Collector port — T-16 (LLMTELEMET-287).
 *
 * Port of src/llm_telemetry/collect_session_timeline.py: one session's timeline
 * per file (`sessions/<profile>/<id>.json`), the newest MAX_SESSIONS in scope.
 * This module owns only the SQL + file I/O; the span math is sessionTimeline.ts.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Config, get as getConfig } from "./config.js";
import { assertSafeOutDir } from "./artifactWriter.js";
import { stamp } from "./schema.js";
import { tuples } from "./sqliteUtil.js";
import { toolOutcome } from "./toolOutcomes.js";
import { buildTimeline, type TimelineDelegation, type TimelineMessage, type TimelineSession } from "./sessionTimeline.js";

type Obj = Record<string, unknown>;

export const MAX_SESSIONS = 100;

export const SESSIONS_IN_SCOPE = `
select id, title, source, started_at, ended_at, end_reason
from sessions
where coalesce(ended_at, last_activity_at, started_at) > strftime('%s','now') - 2592000
order by coalesce(ended_at, last_activity_at, started_at) desc
limit ?
`;

export const SESSION_USAGE = `
select group_concat(distinct model), sum(input_tokens), sum(output_tokens),
       sum(cache_read_tokens), sum(estimated_cost_usd), sum(actual_cost_usd)
from session_model_usage
where session_id = ?
`;

export const SESSION_MESSAGES = `
select role, timestamp, tool_name, effect_disposition, finish_reason, content, compacted
from messages
where session_id = ? and active = 1
order by timestamp
`;

export const SESSION_DELEGATIONS = `
select delegation_id, dispatched_at, completed_at, state
from async_delegations
where origin_session = ?
order by dispatched_at
`;

export const LAST_SEEN_MODEL = `
select u.model from session_model_usage u
where u.session_id = ? and u.last_seen <= ?
order by u.last_seen desc limit 1
`;

/** Attach model (assistant rows) and outcome (tool rows) to each message, and
 * collect the compacted-message runs. */
export function annotatedMessages(
  con: DatabaseSync, sessionId: string,
): { messages: TimelineMessage[]; compactions: Array<{ start: number; end: number }> } {
  const out: TimelineMessage[] = [];
  let lastModel: string | null = null;
  let runStart: number | null = null;
  let runEnd: number | null = null;
  const compactions: Array<{ start: number; end: number }> = [];
  for (const [role, ts, toolName, disp, reason, content, compacted] of tuples(con, SESSION_MESSAGES, sessionId)) {
    const entry: TimelineMessage = { role: role as string | null, timestamp: ts as number };
    if (role === "assistant") {
      const row = tuples(con, LAST_SEEN_MODEL, sessionId, ts as number)[0];
      entry.model = row ? (row[0] as string | null) : lastModel;
      if (entry.model) lastModel = entry.model;
    } else if (role === "tool" && toolName) {
      entry.tool_name = toolName as string;
      entry.outcome = toolOutcome({ content, effect_disposition: disp, finish_reason: reason });
    }
    if (compacted) {
      if (runStart === null) runStart = ts as number;
      runEnd = ts as number;
    } else if (runStart !== null) {
      compactions.push({ start: runStart, end: runEnd as number });
      runStart = null;
    }
    out.push(entry);
  }
  if (runStart !== null) compactions.push({ start: runStart, end: runEnd as number });
  return { messages: out, compactions };
}

export function buildSessionTimeline(con: DatabaseSync, row: unknown[], now: number | null = null): Obj {
  const [sid, title, source, started, ended, endReason] = row as [string, string | null, string | null, number, number | null, string | null];
  const u = tuples(con, SESSION_USAGE, sid)[0] ?? [null, 0, 0, 0, 0, 0];
  const [modelsCsv, inTok, outTok, cread, est, act] = u as [string | null, number | null, number | null, number | null, number | null, number | null];
  const models = (modelsCsv ?? "").split(",").filter((m) => m);
  const { messages, compactions } = annotatedMessages(con, sid);
  const delegations: TimelineDelegation[] = tuples(con, SESSION_DELEGATIONS, sid)
    .map(([did, d, c, s]) => ({
      dispatched_at: d as number, completed_at: c as number | null, status: s as string | null, child_id: did as string | null,
    }));
  const session: TimelineSession = {
    id: sid, title, source, started_at: started, ended_at: ended, end_reason: endReason, models,
    input_tokens: inTok || 0, output_tokens: outTok || 0, cache_read_tokens: cread || 0,
    estimated_cost_usd: est || 0, actual_cost_usd: act || 0,
  };
  return buildTimeline(session, messages, delegations, compactions, now);
}

export interface CollectTimelineOptions {
  cfg?: Config;
  maxSessions?: number;
  now?: Date;
}

/** {profile: {session_id: timeline}} for every session in scope. */
export function buildAll(opts: CollectTimelineOptions = {}): Record<string, Record<string, Obj>> {
  const cfg = opts.cfg ?? getConfig();
  const now = (opts.now ?? new Date()).getTime() / 1000;
  const max = opts.maxSessions ?? MAX_SESSIONS;
  const out: Record<string, Record<string, Obj>> = {};
  for (const p of cfg.liveProfiles()) {
    if (!fs.existsSync(p.db)) continue;
    const con = new DatabaseSync(p.db, { readOnly: true });
    const sessions: Record<string, Obj> = {};
    try {
      for (const row of tuples(con, SESSIONS_IN_SCOPE, max)) {
        sessions[row[0] as string] = buildSessionTimeline(con, row, now);
      }
    } finally {
      con.close();
    }
    if (Object.keys(sessions).length) out[p.name] = sessions;
  }
  return out;
}

/** Writes <outDir>/<profile>/<id>.json (stamped, atomic). Returns the file count. */
export function writeSessionFiles(outDir: string, opts: CollectTimelineOptions = {}): number {
  assertSafeOutDir(outDir, opts.cfg);
  let n = 0;
  for (const [profile, sessions] of Object.entries(buildAll(opts))) {
    const pdir = path.join(outDir, profile);
    fs.mkdirSync(pdir, { recursive: true });
    for (const [sid, timeline] of Object.entries(sessions)) {
      const file = path.join(pdir, `${sid}.json`);
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(stamp(timeline)), "utf8");
      fs.renameSync(tmp, file);
      n += 1;
    }
  }
  return n;
}

/** Harness view: the merged build_all() map as one stamped artifact. */
export function collectSessionTimelines(opts: CollectTimelineOptions = {}): Obj {
  const all = buildAll(opts);
  for (const sessions of Object.values(all)) for (const t of Object.values(sessions)) stamp(t);
  return { profiles: all };
}
