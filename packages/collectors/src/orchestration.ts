/** Port of `collect_analytics.build_orchestration`: aggregate the analytics
 * store's orchestration_edges into graph nodes + directed edges. Read-only; a
 * missing or unreadable store yields an empty graph. */

import * as fs from "node:fs";
import * as os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { cmpStr } from "./pySort.js";

export const DEFAULT_DB = "~/.local/share/llm-telemetry/analytics.db";

export interface OrchNode { id: string; name: unknown; kind: string }
export interface OrchEdge { from: string; to: string; type: unknown; count: number; last: number }
export interface Orchestration { nodes: OrchNode[]; edges: OrchEdge[] }

type EdgeRow = {
  timestamp: number; trigger_source: string; trigger_profile_or_agent: string;
  triggered_target: string; triggered_agent_or_profile: string | null; signal_type: string;
};

const expandUser = (p: string): string => (p === "~" || p.startsWith("~/") ? os.homedir() + p.slice(1) : p);

export function buildOrchestration(dbPath: string = DEFAULT_DB): Orchestration {
  const empty = (): Orchestration => ({ nodes: [], edges: [] });
  const path = expandUser(dbPath);
  if (!fs.existsSync(path)) return empty();
  let rows: EdgeRow[];
  try {
    const con = new DatabaseSync(path, { readOnly: true });
    try {
      rows = con.prepare("SELECT * FROM orchestration_edges ORDER BY timestamp DESC LIMIT ?")
        .all(5000) as unknown as EdgeRow[];
    } finally {
      con.close();
    }
  } catch {
    return empty();
  }
  const edges = new Map<string, OrchEdge>();
  const nodes = new Map<string, OrchNode>();
  for (const r of rows) {
    const srcKind = r.trigger_source || "external";
    const src = r.trigger_profile_or_agent;
    const target = r.triggered_target || "";
    const i = target.indexOf(":");
    let tgtKind = i < 0 ? target : target.slice(0, i);
    const tgtRaw = i < 0 ? "" : target.slice(i + 1);
    const tgt = r.triggered_agent_or_profile || tgtRaw || tgtKind;
    if (!tgtRaw) tgtKind = "external";
    const a = `${srcKind}:${src}`;
    const b = `${tgtKind}:${tgt}`;
    for (const [nid, kind, name] of [[a, srcKind, src], [b, tgtKind, tgt]] as const) {
      if (!nodes.has(nid)) nodes.set(nid, { id: nid, name, kind });
    }
    const key = JSON.stringify([a, b, r.signal_type]);
    let e = edges.get(key);
    if (!e) { e = { from: a, to: b, type: r.signal_type, count: 0, last: 0 }; edges.set(key, e); }
    e.count += 1;
    e.last = Math.max(e.last, r.timestamp);
  }
  return {
    nodes: [...nodes.values()].sort((x, y) => cmpStr(x.id, y.id)),
    edges: [...edges.values()].sort((x, y) => y.count - x.count),
  };
}
