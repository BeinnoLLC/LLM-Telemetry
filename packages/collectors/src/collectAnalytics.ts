/** Collector port — T-15 (LLMTELEMET-286).
 *
 * Port of src/llm_telemetry/collect_analytics.py into TypeScript. Ported so far:
 * the day/hour SQL rows (priced + bandwidth-enriched), the sessions tree, the
 * outcomes buckets, and the cheap per-profile SQL sections (hours, sessions,
 * active, end_reasons, heatmap, node_sessions, profile kind, repo_branch,
 * attribution). Every other section of `build()` is still absent, so the
 * parity `analytics` case reports them as field diffs until they land.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import { DatabaseSync } from "node:sqlite";
import * as SQL from "./analyticsSql.js";
import { buildAttribution, type SessionsById } from "./costAttribution.js";
import { Config, load as loadConfig } from "./config.js";
import { splitRow } from "./bandwidth.js";
import { cachedCatalog, catalogSize, priceRow, type Catalog } from "./pricing.js";
import { projectOfSession, type SessionInfo } from "./projects.js";
import { pyRound } from "./pySemantics.js";
import { buildRepoBranch } from "./repoBranch.js";
import { stamp } from "./schema.js";

export interface AnalyticsPayload {
  generated: string;
  schema_version: number;
  [key: string]: unknown;
}

export interface CollectAnalyticsOptions {
  /** Directory produced by parity/py/make_analytics_fixture.py (config.json,
   * catalog.json, agent/…/state.db). Omitted → the process config/env. */
  inputsDir?: string;
  now?: Date;
}

type Row = Record<string, unknown>;
type Con = DatabaseSync;

/** Row values in column order, like Python's tuple rows. */
const tuples = (con: Con, sql: string, ...params: (string | number)[]): unknown[][] => {
  const stmt = con.prepare(sql);
  stmt.setReturnArrays(true);
  return stmt.all(...params) as unknown as unknown[][];
};

const zip = (cols: readonly string[], r: unknown[]): Row => {
  const o: Row = {};
  cols.forEach((c, i) => { o[c] = r[i]; });
  return o;
};

const sessionIdentity = (con: Con): Record<string, SessionInfo & Row> => {
  const out: Record<string, SessionInfo & Row> = {};
  for (const r of tuples(con, SQL.SESSION_IDENTITY)) {
    out[r[0] as string] = {
      title: r[1] as string | null, cwd: r[2] as string | null,
      parent_session_id: r[3] as string | null, source: r[4] as string | null,
      display_name: r[5] as string | null, git_branch: r[6] as string | null,
    };
  }
  return out;
};

function resolveRows(rows: Row[], sessionsById: Record<string, SessionInfo & Row>): Row[] {
  for (const r of rows) {
    r["project"] = projectOfSession(r["session_id"] as string, sessionsById);
    r["source"] = sessionsById[r["session_id"] as string]?.["source"] ?? null;
  }
  return rows;
}

/** fetch_rows: day-grain usage rows with project + source resolved. */
export function fetchRows(con: Con): Row[] {
  const sessionsById = sessionIdentity(con);
  return resolveRows(tuples(con, SQL.ROWS).map((r) => zip(SQL.COLS, r)), sessionsById);
}

/** fetch_hour_rows: hour-grain twin of fetchRows over HOUR_WINDOW_S. */
export function fetchHourRows(con: Con): Row[] {
  const sessionsById = sessionIdentity(con);
  return resolveRows(tuples(con, SQL.HOUR_ROWS).map((r) => zip(SQL.HOUR_COLS, r)), sessionsById);
}

/** _enrich_rows: price + bandwidth-enrich rows in place. */
export function enrichRows(rows: Row[], catalog: Catalog, cfg: Config): void {
  for (const r of rows) {
    Object.assign(r, priceRow(
      {
        provider: r["provider"] as string, model: r["model"] as string,
        base_url: r["base_url"] as string | null,
        input_tokens: r["inp"] as number, output_tokens: r["outp"] as number,
        cache_read: r["cread"] as number, cache_write: (r["cwrite"] as number | null) || 0,
        calls: r["calls"] as number | null,
      },
      catalog, cfg, cfg.local_host_patterns, cfg.endpoint_aliases,
    ));
    const s = splitRow(
      r["base_url"] as string | null, r["inp"] as number, r["outp"] as number,
      r["cread"] as number, r["cwrite"] as number | null,
      cfg.local_host_patterns, cfg.endpoint_aliases,
    );
    r["up_bytes"] = s.up;
    r["down_bytes"] = s.down;
    r["lan_up_bytes"] = s.lanUp;
    r["lan_down_bytes"] = s.lanDown;
  }
}

/** build_outcomes: the four P10-03 buckets from one snapshot. */
export function buildOutcomes(con: Con) {
  const byReason: Record<string, number> = {};
  for (const [r, n] of tuples(con, SQL.OUTCOMES_BY_REASON)) byReason[r as string] = n as number;
  const bySourceReason: Record<string, Record<string, number>> = {};
  for (const [src, reason, n] of tuples(con, SQL.OUTCOMES_BY_SOURCE_REASON)) {
    (bySourceReason[src as string] ??= {})[reason as string] = n as number;
  }
  const silent = tuples(con, SQL.OUTCOMES_SILENT).map(([id, title, src, model, when]) =>
    ({ id, title, source: src, model, when }));
  const reaped = tuples(con, SQL.OUTCOMES_REAPED).map(([id, src, model, when]) =>
    ({ id, source: src, model, when }));
  const reapTrend = tuples(con, SQL.OUTCOMES_REAP_TREND).map(([d, n]) => ({ date: d, n }));
  return { by_reason: byReason, by_source_reason: bySourceReason, silent, reaped, reap_trend: reapTrend };
}

export interface TreeNode {
  id: string; parent: string | null; source: string; title: string; model: unknown;
  started: unknown; ended: unknown; end_reason: string; msgs: number; tools: number; tok: number;
  cost: number; cost_is_actual: boolean; children: TreeNode[]; child_count: number;
  failed_child_count: number; own_cost?: number; own_tok?: number;
}

/** build_sessions_tree: nodes with a roll-up of every descendant. */
export function buildSessionsTree(con: Con): TreeNode[] {
  const rows = tuples(con, SQL.SESSIONS_TREE).map((r) => zip(SQL.SESSIONS_TREE_COLS, r));
  const nodes = new Map<string, TreeNode>();
  for (const r of rows) {
    const cost = pyRound((r["cost"] as number) || 0, 6);
    nodes.set(r["id"] as string, {
      id: r["id"] as string, parent: (r["parent"] as string) || null, source: r["source"] as string,
      title: r["title"] as string, model: r["model"], started: r["started"], ended: r["ended"],
      end_reason: r["end_reason"] as string, msgs: r["msgs"] as number, tools: r["tools"] as number,
      tok: r["tok"] as number, cost, cost_is_actual: Boolean(r["cost_is_actual"]),
      own_cost: cost, own_tok: r["tok"] as number,
      children: [], child_count: 0, failed_child_count: 0,
    });
  }
  const roots: TreeNode[] = [];
  for (const r of rows) {
    const n = nodes.get(r["id"] as string) as TreeNode;
    const parent = r["parent"] ? nodes.get(r["parent"] as string) : undefined;
    if (parent !== undefined) parent.children.push(n);
    else roots.push(n);
  }
  const rollup = (node: TreeNode, depth: number, visited: Set<string>): void => {
    if (visited.has(node.id) || depth > 20) return;
    const seen = new Set(visited).add(node.id);
    let totalCost = node.own_cost as number;
    let totalTok = node.own_tok as number;
    let childN = 0;
    let failedN = 0;
    for (const child of node.children) {
      rollup(child, depth + 1, seen);
      totalCost += child.cost;
      totalTok += child.tok;
      childN += 1 + child.child_count;
      failedN += child.failed_child_count + (
        child.end_reason !== "(none)" && child.end_reason !== "(running)" &&
        child.end_reason.toLowerCase().includes("error") ? 1 : 0);
    }
    node.cost = pyRound(totalCost, 6);
    node.tok = totalTok;
    node.child_count = childN;
    node.failed_child_count = failedN;
  };
  for (const root of roots) rollup(root, 0, new Set());
  for (const n of nodes.values()) { delete n.own_cost; delete n.own_tok; }
  return roots;
}

const BOT_SOURCES = new Set(["cron", "oneshot", "subagent"]);
const INTERACTIVE_SOURCES = new Set(["desktop", "tui", "cli"]);

/** classify_profile: {"kind": "bot"|"profile", "sources": {...}}. */
export function classifyProfile(name: string, sess: { source?: string | null; sessions?: number }[]) {
  const counts: Record<string, number> = {};
  for (const s of sess) {
    if (s.source) counts[s.source] = (counts[s.source] ?? 0) + (s.sessions || 0);
  }
  const sum = (set: Set<string>): number => [...set].reduce((a, k) => a + (counts[k] ?? 0), 0);
  const interactive = sum(INTERACTIVE_SOURCES);
  const machine = sum(BOT_SOURCES);
  const nameBot = name.includes("bot") || name.startsWith("pv-");
  let kind: string;
  if (nameBot && interactive <= 2) kind = "bot";
  else if (machine > interactive) kind = "bot";
  else if (interactive > machine) kind = "profile";
  else kind = nameBot ? "bot" : "profile";
  return { kind, sources: counts };
}

function tilde(p: string): string {
  const home = os.homedir();
  return p === home || p.startsWith(home + "/") ? "~" + p.slice(home.length) : p;
}

/** Local time like Python `datetime.now().isoformat(timespec="seconds")`. */
function localIso(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** unreadable(): why a state.db cannot be read, or null if it can. */
export function unreadable(db: string): string | null {
  try {
    const con = new DatabaseSync(db, { readOnly: true });
    try {
      con.prepare("select 1 from session_model_usage limit 1").all();
    } finally {
      con.close();
    }
  } catch (e) {
    return `OperationalError: ${e instanceof Error ? e.message : String(e)}`;
  }
  return null;
}

function buildProfile(name: string, con: Con, catalog: Catalog, cfg: Config): Row {
  const rows = fetchRows(con);
  enrichRows(rows, catalog, cfg);
  const hourRows = fetchHourRows(con);
  enrichRows(hourRows, catalog, cfg);
  const hours = tuples(con, SQL.HOURS).map(([d, h, c]) => ({ date: d, hour: h, calls: c }));
  const identity = sessionIdentity(con);
  const forRepo: Record<string, SessionInfo> = {};
  for (const [id, v] of Object.entries(identity)) forRepo[id] = { cwd: v.cwd, git_branch: v.git_branch };
  const repo = buildRepoBranch(rows as never, forRepo);
  const heatmap = tuples(con, SQL.HEATMAP).map(([d, p, url, m, c]) => ({ d, p, url, m, v: c }));
  const nodeSessions: Record<string, { title: unknown; calls: unknown; id: unknown }[]> = {};
  for (const [mdl, tsk, title, calls, sid] of tuples(con, SQL.SESS_BY_NODE)) {
    (nodeSessions[`${mdl as string}\t${tsk as string}`] ??= []).push({ title, calls, id: sid });
  }
  const sess = tuples(con, SQL.SESS).map(([d, s, n]) => ({ date: d as string, source: s as string, sessions: n as number }));
  const active = (tuples(con, SQL.ACTIVE)[0] as unknown[])[0];
  const endReasons = tuples(con, SQL.END_REASONS).map(([r, n]) => ({ reason: r, n }));
  const outcomes = buildOutcomes(con);
  const attribution = buildAttribution(rows as never, identity as SessionsById, []);
  const tree = buildSessionsTree(con);
  const dates = [...new Set(rows.map((r) => r["date"] as string).filter(Boolean))].sort();
  return {
    rows, hours, sessions: sess, hour_rows: hourRows, active,
    ...classifyProfile(name, sess),
    end_reasons: endReasons, outcomes, attribution, sessions_tree: tree,
    heatmap, node_sessions: nodeSessions, repo_branch: repo,
    min_date: dates[0] ?? null, max_date: dates.at(-1) ?? null,
  };
}

export function collectAnalytics(opts: CollectAnalyticsOptions = {}): AnalyticsPayload {
  const now = opts.now ?? new Date();
  const env: NodeJS.ProcessEnv = { ...process.env };
  let cfg: Config;
  if (opts.inputsDir !== undefined) {
    env["LLM_TELEMETRY_CATALOG"] = `${opts.inputsDir}/catalog.json`;
    env["LLM_TELEMETRY_AGENT_HOME"] = `${opts.inputsDir}/agent`;
    const saved = process.env["LLM_TELEMETRY_AGENT_HOME"];
    process.env["LLM_TELEMETRY_AGENT_HOME"] = env["LLM_TELEMETRY_AGENT_HOME"];
    try {
      cfg = loadConfig(`${opts.inputsDir}/config.json`);
    } finally {
      if (saved === undefined) delete process.env["LLM_TELEMETRY_AGENT_HOME"];
      else process.env["LLM_TELEMETRY_AGENT_HOME"] = saved;
    }
  } else {
    cfg = loadConfig();
  }
  const catalog = cachedCatalog(cfg, env);
  const res = { ...cfg.resolution } as Record<string, unknown>;
  res["failed"] = [...(cfg.resolution.failed ?? [])];
  for (const k of ["agent_home", "config_file"]) {
    if (res[k]) res[k] = tilde(String(res[k]));
  }
  const profiles: Record<string, Row> = {};
  for (const p of cfg.profiles) {
    if (!fs.existsSync(p.db)) continue;
    const why = unreadable(p.db);
    if (why) {
      (res["failed"] as unknown[]).push({
        name: p.name, path: tilde(p.db), reason: why.replaceAll(os.homedir(), "~"),
      });
      continue;
    }
    const con = new DatabaseSync(p.db, { readOnly: true });
    try {
      profiles[p.name] = buildProfile(p.name, con, catalog, cfg);
    } finally {
      con.close();
    }
  }
  const payload: AnalyticsPayload = {
    generated: localIso(now),
    profiles,
    pricing_source: env["LLM_TELEMETRY_CATALOG"] ? "pinned" : "cache",
    pricing_models: catalogSize(catalog),
    resolution: res,
    schema_version: 0,
  };
  return stamp(payload) as AnalyticsPayload;
}
