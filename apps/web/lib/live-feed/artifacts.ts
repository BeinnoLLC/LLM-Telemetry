// LLMTELEMET-282 (T-3): the events feed collector — reads the collectors'
// artifacts (plan §"Live feeds": the dashboard feed is backed by the
// artifacts) and hands the feed a snapshot whose `tasks` map is diffed into
// delta frames. Same artifact shape the Python dashboard polls as
// live-data.json (`collect_live.py`), so the snapshot carries that payload
// unchanged alongside the derived task map.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CollectSnapshot, TaskRow } from "./types";

export interface LiveSessionRow {
  id?: string | number;
  title?: string;
  phase?: string;
  category?: string;
  parent?: string;
  [key: string]: unknown;
}

/** Reports dir the collectors write (config-driven in Python; overridable here
 * during the overlap so both stacks can be pointed at the same artifacts). */
export function reportsDir(): string {
  return (
    process.env.LLM_TELEMETRY_REPORTS_DIR ??
    join(homedir(), ".local/share/llm-telemetry/reports")
  );
}

/** Derive the diffable `tasks` map from a live-data payload: one row per live
 * session, keyed `<profile>:<session id>`, `status` from the session's
 * category/phase. Rows carry `worker: true` so a session that disappears from
 * the artifact emits a `finished` frame (hive.py `diff_tasks` only reports
 * departures for workers). */
export function collectFromLiveArtifact(
  artifact: Record<string, unknown>,
  now: number = Date.now() / 1000,
): CollectSnapshot {
  const tasks: Record<string, TaskRow> = {};
  const profiles = artifact.profiles;
  if (profiles && typeof profiles === "object" && !Array.isArray(profiles)) {
    for (const [name, prof] of Object.entries(
      profiles as Record<string, unknown>,
    )) {
      const live =
        prof && typeof prof === "object" && !Array.isArray(prof)
          ? ((prof as Record<string, unknown>).live as unknown)
          : undefined;
      if (!Array.isArray(live)) continue;
      for (const raw of live) {
        const s = raw as LiveSessionRow;
        if (s == null || s.id === undefined) continue;
        tasks[`${name}:${s.id}`] = {
          family: name,
          brain: s.parent || name,
          board: name,
          agent: s.id,
          status: s.category || s.phase || "unknown",
          title: s.title || s.id,
          worker: true,
        };
      }
    }
  }
  const at = Number(artifact.generated) || now;
  return { ...artifact, at, tasks, comms: [], user: null };
}

/** One collect tick: read `<reportsDir>/live-data.json` and derive a snapshot. */
export async function readLiveArtifact(
  dir: string = reportsDir(),
): Promise<CollectSnapshot> {
  const raw = await readFile(join(dir, "live-data.json"), "utf8");
  return collectFromLiveArtifact(JSON.parse(raw) as Record<string, unknown>);
}
