/** Collector port — T-16 (LLMTELEMET-287).
 *
 * Port of src/llm_telemetry/collect_transcripts.py: the last WINDOW messages of
 * every currently-live session, for the "open the real chat" modal.
 */

import * as fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Config, get as getConfig } from "./config.js";
import { stamp } from "./schema.js";
import { tuples } from "./sqliteUtil.js";

type Obj = Record<string, unknown>;

export const WINDOW = 200;

export const LIVE_SESSION_IDS = `
select id from sessions
where ended_at is null
  and coalesce(last_activity_at, started_at) > strftime('%s','now') - 600
`;

export const TRANSCRIPT = `
select id, role, content, tool_name, tool_calls, timestamp
from messages
where session_id = ?
  and active = 1
order by id desc
limit ?
`;

export function messagesFor(con: DatabaseSync, sessionId: string, window: number): Obj[] {
  const rows = tuples(con, TRANSCRIPT, sessionId, window);
  rows.reverse();
  return rows.map(([mid, role, content, toolName, toolCalls, ts]) => {
    const entry: Obj = { id: mid, role, content: content || "", ts };
    if (toolName) entry["tool_name"] = toolName;
    if (toolCalls) {
      try {
        entry["tool_calls"] = JSON.parse(toolCalls as string) as unknown;
      } catch {
        entry["tool_calls"] = toolCalls;
      }
    }
    return entry;
  });
}

const localIso = (d: Date): string => {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export interface CollectTranscriptsOptions {
  cfg?: Config;
  window?: number;
  now?: Date;
}

export function collectTranscripts(opts: CollectTranscriptsOptions = {}): Obj {
  const cfg = opts.cfg ?? getConfig();
  const window = opts.window ?? WINDOW;
  const out: Obj = {
    generated: localIso(opts.now ?? new Date()),
    window,
    profiles: {} as Obj,
  };
  for (const p of cfg.liveProfiles()) {
    if (!fs.existsSync(p.db)) continue;
    const con = new DatabaseSync(p.db, { readOnly: true });
    const sessions: Obj = {};
    try {
      for (const [sid] of tuples(con, LIVE_SESSION_IDS)) {
        const msgs = messagesFor(con, sid as string, window);
        if (msgs.length) sessions[sid as string] = msgs;
      }
    } finally {
      con.close();
    }
    if (Object.keys(sessions).length) (out["profiles"] as Obj)[p.name] = sessions;
  }
  return stamp(out);
}
