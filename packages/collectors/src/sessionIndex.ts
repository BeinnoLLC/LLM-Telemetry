/** Port of `collect_session_index.py` (P10-12): one small row per session for
 * the Session Finder palette. Never reads message content. */

import * as fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Config } from "./config.js";
import { unreadable } from "./unreadable.js";
import { cmpStr } from "./pySort.js";
import { pyRound } from "./pySemantics.js";

export const SESSION_INDEX_SQL = `
select s.id,
       coalesce(nullif(s.title,''),'(untitled)') as title,
       s.model,
       coalesce(s.source,'') as source,
       coalesce(s.git_branch,'') as branch,
       coalesce(s.cwd,'') as cwd,
       coalesce(s.end_reason,'') as end,
       coalesce(s.actual_cost_usd, s.estimated_cost_usd, 0) as cost,
       cast(coalesce(s.ended_at, s.last_activity_at, s.started_at) - s.started_at as integer) as dur_s,
       (select group_concat(distinct m.tool_name) from messages m
         where m.session_id = s.id and m.tool_name is not null and m.tool_name != '') as tools
from sessions s
where s.started_at >= ? and s.started_at <= ?
order by s.started_at desc
limit 2000
`;

/** The last 1-2 path segments of a cwd. */
export function cwdTail(cwd: string | null | undefined): string {
  if (!cwd) return "";
  const parts = cwd.replace(/\/+$/, "").split("/").filter((p) => p);
  return parts.slice(-2).join("/");
}

export function buildSessionIndexPayload(con: DatabaseSync, fromTs: number, toTs: number) {
  const stmt = con.prepare(SESSION_INDEX_SQL);
  stmt.setReturnArrays(true);
  return (stmt.all(fromTs, toTs) as unknown as unknown[][]).map((r) => {
    const [id, title, model, source, branch, cwd, end, cost, durS, tools] = r as [
      string, string, string | null, string, string, string, string, number | null, number | null, string | null];
    return {
      id, title, model: model || "", source,
      tools: tools ? tools.split(",").sort(cmpStr) : [],
      branch, cwd_tail: cwdTail(cwd), end,
      cost: pyRound(Number(cost || 0), 4),
      dur: durS !== null && durS >= 0 ? Math.trunc(durS) : 0,
    };
  });
}

/** Python looks back 90 days from now. */
export function buildSessionIndexForDb(con: DatabaseSync, nowTs: number) {
  return buildSessionIndexPayload(con, nowTs - 90 * 86400, nowTs);
}

/** Port of `build_session_index_by_profile`: unreadable DBs are skipped. */
export function buildSessionIndexByProfile(cfg: Config, nowTs: number = Date.now() / 1000) {
  const out: Record<string, ReturnType<typeof buildSessionIndexForDb>> = {};
  for (const p of cfg.profiles) {
    if (!fs.existsSync(p.db) || unreadable(p.db)) continue;
    const con = new DatabaseSync(p.db, { readOnly: true });
    try {
      out[p.name] = buildSessionIndexForDb(con, nowTs);
    } finally {
      con.close();
    }
  }
  return out;
}
