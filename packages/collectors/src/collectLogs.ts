/** Collector port — T-16 (LLMTELEMET-287).
 *
 * Port of src/llm_telemetry/collect_logs.py: log events for the full Logs page
 * with facets computed over the whole window. Events are capped at the newest
 * `cap` rows but every facet count is computed in SQL over the full window.
 * Two sources are merged: `messages` and errors.log via failures.parseErrors.
 */

import * as fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Config, get as getConfig } from "./config.js";
import { parseErrors } from "./failures.js";
import { localTimestamp } from "./collectRouter.js";
import { pySlice } from "./pySemantics.js";
import { stamp } from "./schema.js";
import { tuples } from "./sqliteUtil.js";

type Obj = Record<string, unknown>;

export const PREVIEW = 120;
export const DEFAULT_WINDOW_H = 24;
export const DEFAULT_CAP = 5000;

export const EVENTS = `
select m.timestamp, m.session_id, coalesce(s.title, s.display_name, ''),
       m.role, coalesce(m.tool_name,''), coalesce(s.model,''),
       substr(coalesce(m.content,''), 1, ?)
from messages m left join sessions s on s.id = m.session_id
where m.timestamp > ?
order by m.timestamp desc
limit ?
`;
const EVENT_COLS = ["ts", "session", "title", "role", "tool", "model", "preview"] as const;

export const FACETS: Record<string, string> = {
  tool: "select coalesce(tool_name,''), count(*) from messages " +
    "where timestamp > ? and coalesce(tool_name,'') <> '' group by 1 order by 2 desc",
  role: "select role, count(*) from messages where timestamp > ? group by 1 order by 2 desc",
  model: "select coalesce(s.model,''), count(*) from messages m " +
    "left join sessions s on s.id = m.session_id " +
    "where m.timestamp > ? and coalesce(s.model,'') <> '' group by 1 order by 2 desc",
};
export const SESSION_FACET = `
select m.session_id, coalesce(s.title, s.display_name, ''), count(*)
from messages m left join sessions s on s.id = m.session_id
where m.timestamp > ? group by 1, 2 order by 3 desc limit 200
`;

export interface LogEvent {
  ts: number; session: string; title: string; role: string; tool: string; model: string;
  level: string; kind: string; preview: string;
}

/** Failure lines from errors.log, newest first, as log events (the only entries
 * with a real severity). */
export function errorEvents(cfg: Config, cutoff: number, nowS: number, profile?: string): LogEvent[] {
  const out: LogEvent[] = [];
  for (const p of cfg.liveProfiles()) {
    if (profile && p.name !== profile) continue;
    const path = p.errorsLog;
    if (!path || !fs.existsSync(path)) continue;
    let events;
    try {
      [, events] = parseErrors(path, 7, nowS);
    } catch {
      continue;
    }
    for (const e of events) {
      const ts = localTimestamp(pySlice(e.when, 0, 19));
      if (ts === null) continue;
      if (ts < cutoff) continue;
      out.push({
        ts, session: "", title: "", role: "error", tool: "", model: e.model ?? "",
        level: "error", kind: e.kind ?? "", preview: pySlice(e.msg || "", 0, PREVIEW),
      });
    }
  }
  return out;
}

export interface CollectLogsOptions {
  cfg?: Config;
  windowH?: number;
  cap?: number;
  profile?: string;
  now?: Date;
}

/** Payload for the Logs page of one state.db, or null when the window is empty. */
export function collect(con: DatabaseSync, opts: CollectLogsOptions = {}): Obj | null {
  const cfg = opts.cfg ?? getConfig();
  const windowH = opts.windowH ?? DEFAULT_WINDOW_H;
  const cap = opts.cap ?? DEFAULT_CAP;
  const nowS = opts.now ? opts.now.getTime() / 1000 : Date.now() / 1000;
  const cutoff = nowS - windowH * 3600;
  let rows: unknown[][];
  try {
    rows = tuples(con, EVENTS, PREVIEW, cutoff, cap);
  } catch (e) {
    if (String((e as Error).message).toLowerCase().includes("no such table")) return null;
    throw e;
  }
  const events: LogEvent[] = rows.map((r) => {
    const d: Obj = {};
    EVENT_COLS.forEach((c, i) => { d[c] = r[i]; });
    d["ts"] = Number(d["ts"] || 0);
    d["level"] = "info";
    d["kind"] = "";
    return d as unknown as LogEvent;
  });
  const errs = errorEvents(cfg, cutoff, nowS, opts.profile);
  events.push(...errs);
  events.sort((a, b) => b.ts - a.ts); // stable: equal ts keep their order, like reverse=True

  const total = (tuples(con, "select count(*) from messages where timestamp > ?", cutoff)[0] as number[])[0] as number;

  const facets: Obj = {};
  for (const [name, sql] of Object.entries(FACETS)) {
    facets[name] = tuples(con, sql, cutoff).filter(([v]) => v).map(([v, n]) => ({ v, n }));
  }
  facets["session"] = tuples(con, SESSION_FACET, cutoff).map(([sid, title, n]) => ({
    v: sid, label: title || pySlice(sid as string, 0, 8), n,
  }));
  if (errs.length) {
    const kinds = new Map<string, number>();
    for (const e of errs) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
    facets["kind"] = [...kinds.entries()].sort((a, b) => b[1] - a[1]).filter(([k]) => k).map(([v, n]) => ({ v, n }));
  }
  if (!events.length) return null;
  return {
    events,
    window_h: windowH,
    events_total: total + errs.length,
    events_shown: events.length,
    errors_shown: errs.length,
    capped: total > cap,
    cap,
    facets,
    generated: nowS,
  };
}

const localIso = (d: Date): string => {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/** Every profile -> {profiles: {name: payload}}, for logs-data.json. */
export function collectLogs(opts: CollectLogsOptions = {}): Obj {
  const cfg = opts.cfg ?? getConfig();
  const now = opts.now ?? new Date();
  const out: Obj = { generated: localIso(now), profiles: {} as Obj };
  for (const prof of cfg.liveProfiles()) {
    if (!fs.existsSync(prof.db)) continue;
    const con = new DatabaseSync(prof.db, { readOnly: true });
    let payload: Obj | null;
    try {
      payload = collect(con, { ...opts, cfg, profile: prof.name, now });
    } finally {
      con.close();
    }
    if (payload) (out["profiles"] as Obj)[prof.name] = payload;
  }
  return stamp(out);
}
