/** Port of `cost_attribution.py` (P10-07): who spent it. Pure functions over
 * already-priced rows; never recomputes a price. */

import { pyRound } from "./pySemantics.js";
import type { SessionInfo } from "./projects.js";

export interface PricedRow {
  session_id?: string | null;
  source?: string | null;
  market_value_usd?: number;
  inp?: number;
  outp?: number;
  cread?: number;
  [key: string]: unknown;
}
export interface AttrSession extends SessionInfo { display_name?: string | null }
export type SessionsById = Record<string, AttrSession>;
export interface ToolTokenRow { tool_name?: string | null; session_id?: string | null; tokens?: number }

const cost = (r: PricedRow): number => r.market_value_usd ?? 0;
const toks = (r: PricedRow): number => (r.inp ?? 0) + (r.outp ?? 0) + (r.cread ?? 0);
/** Python `sort(key=-x)` is stable; JS sort is too. */
const byDesc = <T>(f: (x: T) => number) => (a: T, b: T): number => f(b) - f(a);

export function bySource(rows: PricedRow[]) {
  const buckets = new Map<string, { source: string; cost: number; tokens: number; sessions: Set<unknown> }>();
  for (const r of rows) {
    const src = r.source || "(unknown)";
    let b = buckets.get(src);
    if (!b) buckets.set(src, (b = { source: src, cost: 0, tokens: 0, sessions: new Set() }));
    b.cost += cost(r);
    b.tokens += toks(r);
    b.sessions.add(r.session_id ?? null);
  }
  return [...buckets.values()]
    .map((b) => ({ source: b.source, cost: pyRound(b.cost, 6), tokens: b.tokens, sessions: b.sessions.size }))
    .sort(byDesc((x) => x.cost));
}

function rootOf(sessionId: string, sessionsById: SessionsById): string {
  const seen = new Set<string>();
  let cur = sessionId;
  for (;;) {
    const info = sessionsById[cur];
    if (!info || !info.parent_session_id || seen.has(cur)) return cur;
    seen.add(cur);
    cur = info.parent_session_id;
  }
}

export function byRoot(rows: PricedRow[], sessionsById: SessionsById) {
  const roots = new Map<string, { id: string; own: number; descendants: number }>();
  for (const r of rows) {
    const sid = r.session_id;
    if (!sid) continue;
    const rootId = rootOf(sid, sessionsById);
    let b = roots.get(rootId);
    if (!b) roots.set(rootId, (b = { id: rootId, own: 0, descendants: 0 }));
    if (rootId === sid) b.own += cost(r);
    else b.descendants += cost(r);
  }
  return [...roots.entries()]
    .map(([rootId, b]) => ({
      id: rootId,
      title: sessionsById[rootId]?.title || "(untitled)",
      own: pyRound(b.own, 6),
      descendants: pyRound(b.descendants, 6),
      total: pyRound(b.own + b.descendants, 6),
    }))
    .sort(byDesc((x) => x.total));
}

export function byCron(rows: PricedRow[], sessionsById: SessionsById) {
  const jobs = new Map<string, { name: string; cost: number; sessions: Set<unknown> }>();
  for (const r of rows) {
    const sid = r.session_id;
    const info = (sid ? sessionsById[sid] : undefined) ?? {};
    if ((r.source || "") !== "cron") continue;
    const name = info.title || info.display_name || "(unnamed cron job)";
    let b = jobs.get(name);
    if (!b) jobs.set(name, (b = { name, cost: 0, sessions: new Set() }));
    b.cost += cost(r);
    b.sessions.add(sid ?? null);
  }
  return [...jobs.values()]
    .map((b) => {
      const runs = b.sessions.size;
      const avg = runs ? b.cost / runs : 0;
      return {
        name: b.name, runs, total: pyRound(b.cost, 6), avg: pyRound(avg, 6),
        monthly_projection: pyRound(avg * runs, 6),
      };
    })
    .sort(byDesc((x) => x.total));
}

export function byTool(rows: PricedRow[], toolTokenRows: ToolTokenRow[]) {
  const sessionRate = new Map<string, number>();
  const sessionTokens = new Map<string, number>();
  for (const r of rows) {
    const sid = r.session_id;
    if (!sid) continue;
    sessionTokens.set(sid, (sessionTokens.get(sid) ?? 0) + toks(r));
    sessionRate.set(sid, (sessionRate.get(sid) ?? 0) + cost(r));
  }
  const perToken = (sid: string | null | undefined): number => {
    if (!sid || !sessionRate.has(sid)) return 0;
    const t = sessionTokens.get(sid) ?? 0;
    return t ? (sessionRate.get(sid) as number) / t : 0;
  };
  const tools = new Map<string, { tool: string; tokens: number; cost: number }>();
  for (const t of toolTokenRows) {
    const name = t.tool_name || "(unknown)";
    const tok = t.tokens ?? 0;
    let b = tools.get(name);
    if (!b) tools.set(name, (b = { tool: name, tokens: 0, cost: 0 }));
    b.tokens += tok;
    b.cost += tok * perToken(t.session_id);
  }
  return [...tools.values()]
    .map((b) => ({ tool: b.tool, tokens: b.tokens, cost: pyRound(b.cost, 6) }))
    .sort(byDesc((x) => x.cost));
}

export function buildAttribution(
  rows: PricedRow[],
  sessionsById: SessionsById,
  toolTokenRows: ToolTokenRow[] = [],
) {
  return {
    by_source: bySource(rows),
    by_root: byRoot(rows, sessionsById),
    by_cron: byCron(rows, sessionsById),
    by_tool: byTool(rows, toolTokenRows),
  };
}
