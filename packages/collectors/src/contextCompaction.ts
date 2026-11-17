/** Port of `context_compaction.py` and `collect_context_compaction.py` (P10-09):
 * context growth, compaction yield and reasoning share per profile. */

import type { DatabaseSync } from "node:sqlite";
import { estimateTokens } from "./bandwidth.js";
import { cmpStr } from "./pySort.js";
import { pyRound, pyRound0 } from "./pySemantics.js";

const INEFFECTIVE_YIELD_THRESHOLD = 0.10;
const MAX_SERIES_POINTS = 120;
export const MAX_SESSIONS = 60;

export const SESSIONS_IN_SCOPE = `
select id from sessions
where coalesce(ended_at, last_activity_at, started_at) > strftime('%s','now') - 2592000
order by coalesce(ended_at, last_activity_at, started_at) desc
limit ?
`;

export const SESSION_MESSAGES = `
select role, timestamp, content, compacted
from messages
where session_id = ? and active = 1
order by timestamp
`;

export const USAGE_BY_MODEL = `
select model, sum(reasoning_tokens), sum(output_tokens)
from session_model_usage
group by model
`;

export const COOLDOWN_SESSIONS = `
select id, title, compression_failure_cooldown_until, compression_failure_error
from sessions
where compression_failure_cooldown_until is not null
`;

export type Call = [number, number];
export type Compaction = [number, number, number];
export interface UsageRow { model: string | null; reasoning_tokens: number | null; output_tokens: number | null }
export interface CooldownRow {
  id: string; title: string | null;
  compression_failure_cooldown_until: number | null; compression_failure_error: string | null;
}

function downsample<T>(series: T[]): T[] {
  const n = series.length;
  if (n <= MAX_SERIES_POINTS) return series;
  const step = (n - 1) / (MAX_SERIES_POINTS - 1);
  const out: T[] = [];
  for (let i = 0; i < MAX_SERIES_POINTS; i++) out.push(series[pyRound0(i * step)] as T);
  return out;
}

export function buildSessionContext(id: string, calls: Call[], compactions: Compaction[]) {
  const series = calls.map(([ts, tok]) => [ts, tok]);
  const outC = compactions.map(([ts, before, after]) => {
    const yieldTok = Math.max(0, before - after);
    return { ts, before, after, yield_tok: yieldTok, ineffective: before > 0 && yieldTok / before < INEFFECTIVE_YIELD_THRESHOLD };
  });
  return { id, series: downsample(series), compactions: outC };
}

export function buildReasoningByModel(usage: UsageRow[]) {
  const out: { model: string; reasoning_tokens: number; output_tokens: number; share: number }[] = [];
  for (const r of usage) {
    const reasoning = Math.trunc(Number(r.reasoning_tokens || 0));
    const output = Math.trunc(Number(r.output_tokens || 0));
    if (reasoning === 0) continue;
    out.push({
      model: r.model || "(unknown)", reasoning_tokens: reasoning, output_tokens: output,
      share: pyRound(output ? reasoning / output : 0, 4),
    });
  }
  return out.sort((a, b) => b.reasoning_tokens - a.reasoning_tokens);
}

export function buildCooldowns(rows: CooldownRow[], now: number) {
  const out: { id: string; title: string; cooldown_until: number; error_head: string }[] = [];
  for (const r of rows) {
    const until = r.compression_failure_cooldown_until;
    if (until === null || until === undefined || until <= now) continue;
    const err = r.compression_failure_error || "";
    // Python: err.split("\n", 1)[0][:200] (code points)
    const head = [...(err.split("\n", 1)[0] as string)].slice(0, 200).join("");
    out.push({ id: r.id, title: r.title || "(untitled)", cooldown_until: until, error_head: head });
  }
  return out.sort((a, b) => a.cooldown_until - b.cooldown_until);
}

export function buildContext(
  sessionsCalls: Map<string, Call[]>, sessionsCompactions: Map<string, Compaction[]>,
  usage: UsageRow[], sessionRows: CooldownRow[], now: number,
) {
  const sessions = [];
  const ids = [...new Set([...sessionsCalls.keys(), ...sessionsCompactions.keys()])].sort(cmpStr);
  for (const id of ids) {
    const calls = sessionsCalls.get(id) ?? [];
    const comps = sessionsCompactions.get(id) ?? [];
    if (!calls.length && !comps.length) continue;
    sessions.push(buildSessionContext(id, calls, comps));
  }
  return {
    sessions, reasoning_by_model: buildReasoningByModel(usage), cooldowns: buildCooldowns(sessionRows, now),
  };
}

type Msg = { role: string; timestamp: number; content: string | null; compacted: number };

/** Walk one session's messages once: running context at each assistant turn
 * plus one entry per contiguous run of compacted=1 messages. */
export function sessionCallsAndCompactions(con: DatabaseSync, sessionId: string): [Call[], Compaction[]] {
  const calls: Call[] = [];
  let running = 0;
  let runStart: number | null = null;
  let runBefore = 0;
  const runs: Compaction[] = [];
  const size = (c: string | null): number => estimateTokens([...(c || "")].length);
  for (const m of con.prepare(SESSION_MESSAGES).all(sessionId) as unknown as Msg[]) {
    if (m.compacted) {
      if (runStart === null) { runStart = m.timestamp; runBefore = running; }
      continue;
    }
    if (runStart !== null) {
      running = size(m.content);
      runs.push([runStart, runBefore, running]);
      runStart = null;
      if (m.role === "assistant") calls.push([m.timestamp, running]);
      continue;
    }
    running += size(m.content);
    if (m.role === "assistant") calls.push([m.timestamp, running]);
  }
  if (runStart !== null) runs.push([runStart, runBefore, runBefore]);
  return [calls, runs];
}

export function buildContextForDb(con: DatabaseSync, now: number, maxSessions: number = MAX_SESSIONS) {
  const ids = (con.prepare(SESSIONS_IN_SCOPE).all(maxSessions) as unknown as { id: string }[]).map((r) => r.id);
  const sc = new Map<string, Call[]>();
  const sk = new Map<string, Compaction[]>();
  for (const id of ids) {
    const [c, k] = sessionCallsAndCompactions(con, id);
    sc.set(id, c); sk.set(id, k);
  }
  const usage = (con.prepare(USAGE_BY_MODEL).all() as unknown as Record<string, number | string | null>[])
    .map((r) => { const v = Object.values(r); return { model: v[0], reasoning_tokens: v[1], output_tokens: v[2] } as UsageRow; });
  const cool = con.prepare(COOLDOWN_SESSIONS).all() as unknown as CooldownRow[];
  return buildContext(sc, sk, usage, cool, now);
}
