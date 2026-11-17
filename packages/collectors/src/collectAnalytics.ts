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
import { canonicalEndpoint, splitRow } from "./bandwidth.js";
import { cachedCatalog, catalogSize, priceRow, type Catalog } from "./pricing.js";
import { projectOfSession, type SessionInfo } from "./projects.js";
import { cmpStr } from "./pySort.js";
import { pyInt, pyLen, pyRound, pyRound0, pySlice } from "./pySemantics.js";
import { buildRepoBranch } from "./repoBranch.js";
import { buildLatency as latencyOf, computeGaps, DEFAULT_IDLE_THRESHOLD_S, type TurnRow } from "./latency.js";
import { LIVE_META, resolveTitle, sourceLabel, classifySession } from "./collectLive.js";
import { forProfile } from "./failures.js";
import { collect as collectDelegations } from "./delegations.js";
import { stamp } from "./schema.js";
import { buildAlerts } from "./alerts.js";
import { buildContextForDb } from "./contextCompaction.js";
import { update as updateBandwidth } from "./bandwidthHistory.js";
import { parsedJson, toolOutcome } from "./toolOutcomes.js";

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
  /** Where the bandwidth ledger is written. Default: cfg.reports_dir. */
  reportsDir?: string;
  /** Local YYYY-MM-DD for the ledger (default: today). */
  today?: string;
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

/** Python `_pXX`: nearest-rank percentile over a sorted list, 0 when empty. */
export function pXX(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, pyRound0((pct / 100.0) * (sorted.length - 1)));
  return sorted[idx] as number;
}

/** Python `_terminal_command_hint`: first token of the result's own echoed
 * `command` field, else "(unknown)". */
export function terminalCommandHint(content: unknown): string {
  const doc = parsedJson(content);
  if (doc !== null) {
    const cmd = doc["command"];
    if (typeof cmd === "string" && cmd.trim() !== "") return cmd.trim().split(/\s+/)[0] as string;
  }
  return "(unknown)";
}

/** build_tool_reliability: per-tool calls/fail-rate/trend/wasted tokens, top
 * failing terminal commands and recent failing result heads. */
export function buildToolReliability(con: Con) {
  interface B { calls: number; fails: number; confident: number; tok_wasted: number; sizes: number[] }
  const byTool = new Map<string, B>();
  const cmdFails = new Map<string, number>();
  const failSamples = new Map<string, Row[]>();
  for (const [tool, sid, ts, content, disp, reason, tok] of tuples(con, SQL.TOOL_RESULTS_CURRENT)) {
    const name = tool as string;
    let b = byTool.get(name);
    if (!b) byTool.set(name, (b = { calls: 0, fails: 0, confident: 0, tok_wasted: 0, sizes: [] }));
    b.calls += 1;
    b.sizes.push(pyLen((content as string | null) ?? ""));
    const outcome = toolOutcome({ content, effect_disposition: disp, finish_reason: reason });
    if (outcome === "unknown") continue;
    b.confident += 1;
    if (outcome !== "fail") continue;
    b.fails += 1;
    b.tok_wasted += pyInt(Number(tok || 0));
    let samples = failSamples.get(name);
    if (!samples) failSamples.set(name, (samples = []));
    if (samples.length < 20) {
      samples.push({ session: sid, ts: ts ? pyInt(Number(ts)) : null, head: pySlice((content as string | null) ?? "", 0, 300) });
    }
    if (name === "terminal") {
      const cmd = terminalCommandHint(content);
      cmdFails.set(cmd, (cmdFails.get(cmd) ?? 0) + 1);
    }
  }
  const prevByTool = new Map<string, { confident: number; fails: number }>();
  for (const [tool, disp, reason, content] of tuples(con, SQL.TOOL_RESULTS_PREVIOUS)) {
    let b = prevByTool.get(tool as string);
    if (!b) prevByTool.set(tool as string, (b = { confident: 0, fails: 0 }));
    const outcome = toolOutcome({ content, effect_disposition: disp, finish_reason: reason });
    if (outcome === "unknown") continue;
    b.confident += 1;
    if (outcome === "fail") b.fails += 1;
  }
  const tools: Row[] = [];
  for (const [name, b] of byTool) {
    const sizes = [...b.sizes].sort((x, y) => x - y);
    const failRate = b.confident ? b.fails / b.confident : null;
    const prev = prevByTool.get(name);
    const prevRate = prev && prev.confident ? prev.fails / prev.confident : null;
    tools.push({
      name, calls: b.calls, fails: b.fails,
      fail_rate: failRate !== null ? pyRound(failRate, 4) : null,
      prev_fail_rate: prevRate !== null ? pyRound(prevRate, 4) : null,
      tok_wasted: b.tok_wasted, p50_bytes: pXX(sizes, 50), p95_bytes: pXX(sizes, 95),
    });
  }
  tools.sort((a, b) => (b["tok_wasted"] as number) - (a["tok_wasted"] as number));
  const top = [...cmdFails.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  return {
    tools,
    tool_fail_samples: Object.fromEntries(failSamples),
    terminal_top_fail_commands: top.map(([cmd, n]) => ({ cmd, n })),
  };
}

/** RESEND block: sessions re-sending large cached context, sorted by market value. */
export function buildResend(con: Con, catalog: Catalog, cfg: Config) {
  const out: Row[] = [];
  for (const r of tuples(con, SQL.RESEND, SQL.RESEND_MIN_CALLS)) {
    const [sid, title, mdl, prov, url, calls, inp, cw, cr, last] = r as [string, string, string, string | null, string | null, number, number | null, number | null, number | null, number];
    const prompt = (inp ?? 0) + (cw ?? 0) + (cr ?? 0);
    const pr = priceRow(
      { provider: prov, model: mdl, base_url: url, input_tokens: 0, output_tokens: 0, cache_read: cr ?? 0 },
      catalog, cfg, cfg.local_host_patterns, cfg.endpoint_aliases);
    out.push({
      id: sid, title, model: mdl, calls,
      ctx_per_call: calls ? pyRound0(prompt / calls) : 0,
      cread_pct: prompt ? pyRound(100.0 * (cr ?? 0) / prompt, 1) : 0.0,
      resend_usd: pr.market_value_usd, cost_class: pr.cost_class, last,
    });
  }
  // Python sort is stable on -resend_usd.
  return out.map((x, i) => [x, i] as const)
    .sort((a, b) => (-(a[0]["resend_usd"] as number) - -(b[0]["resend_usd"] as number)) || a[1] - b[1])
    .map(([x]) => x);
}

/** `live` block: LIVE rows with titles/source resolved like collect_live. */
export function buildLiveRows(con: Con, name: string) {
  const live = tuples(con, SQL.LIVE).map((r) => zip(SQL.LIVE_COLS, r));
  const meta = new Map<string, unknown[]>();
  for (const r of tuples(con, LIVE_META)) meta.set(r[0] as string, r);
  for (const L of live) {
    const m = meta.get(L["id"] as string) ?? [L["id"], "", "", null];
    L["source"] = sourceLabel(m[1] as string | null);
    L["title_raw"] = L["title"];
    L["title"] = resolveTitle(L["title"] === "(untitled)" ? "" : (L["title"] as string), (m[3] ?? null) as string | null);
  }
  for (const L of live) {
    L["profile"] = name;
    L["category"] = classifySession(L["phase"] as string | null, L["tools"] as string | null);
    L["tools"] = ((L["tools"] as string | null) ?? "").split(",").filter((t) => t !== "");
    L["kind"] = L["parent"] ? "subagent" : "top-level";
    L["model"] = L["model"] || L["init_model"];
    L["switched"] = Boolean(L["model"] && L["init_model"] && L["model"] !== L["init_model"]);
  }
  return live;
}

/** `health` block: ok calls (usage rows) vs log failures per model. */
export function buildHealth(rows: Row[], failStats: Record<string, Record<string, number | string>>) {
  const okBy: Record<string, number> = {};
  for (const r of rows) okBy[r["model"] as string] = (okBy[r["model"] as string] ?? 0) + ((r["calls"] as number) || 0);
  const models = [...new Set([...Object.keys(okBy), ...Object.keys(failStats)])];
  const health = models.map((model) => {
    const ok = okBy[model] ?? 0;
    const fs_ = failStats[model] ?? {};
    const bad = (fs_["total"] as number | undefined) ?? 0;
    const tot = ok + bad;
    const kinds: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fs_)) if (!["total", "last", "last_msg", "last_kind"].includes(k)) kinds[k] = v;
    return {
      model, ok, fail: bad, total: tot, rate: tot ? pyRound(100.0 * ok / tot, 1) : null,
      kinds, last: fs_["last"] ?? "", last_kind: fs_["last_kind"] ?? "", last_msg: fs_["last_msg"] ?? "",
    };
  });
  return health.sort((a, b) => (b.fail - a.fail) || (b.total - a.total));
}

/** build_latency: SQL-to-payload glue over latency.ts. */
export function buildLatency(con: Con, cfg: Config) {
  const rows = tuples(con, SQL.ASSISTANT_TURNS) as TurnRow[];
  const { gaps, idle } = computeGaps(rows);
  const result = latencyOf(gaps, (u) => canonicalEndpoint(u, cfg.endpoint_aliases));
  return { ...result, idle_threshold_s: DEFAULT_IDLE_THRESHOLD_S, idle_n: idle.length };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Python `concurrency_by_hour`: sessions active per local hour, top-level vs
 * subagent; a session counts in every hour it overlaps. */
export function concurrencyByHour(
  intervals: Iterable<readonly unknown[]>,
  now: number = Date.now() / 1000,
): Map<string, { top: number; sub: number }> {
  const buckets = new Map<string, { top: number; sub: number }>();
  const HOUR = 3600;
  for (const [startedAt, endedAt, isSub] of intervals) {
    if (startedAt === null || startedAt === undefined) continue;
    const start = Number(startedAt);
    const end = endedAt !== null && endedAt !== undefined ? Number(endedAt) : now;
    if (end < start) continue;
    const field = isSub ? "sub" : "top";
    for (let h = Math.floor(start / HOUR); h <= Math.floor(end / HOUR); h++) {
      const d = new Date(h * HOUR * 1000);
      const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:00`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { top: 0, sub: 0 }));
      b[field] += 1;
    }
  }
  return buckets;
}

export function buildCompressionPressure(con: Con) {
  return tuples(con, SQL.COMPRESSION_PRESSURE).map(([id, title, fb, ic, err]) =>
    ({ id, title, fallback_streak: fb, ineffective_count: ic, error: err || "" }));
}

export function buildConcurrency(con: Con, now?: number) {
  const buckets = concurrencyByHour(tuples(con, SQL.CONCURRENCY_INTERVALS), now);
  return [...buckets.entries()].sort((a, b) => cmpStr(a[0], b[0]))
    .map(([hour, v]) => ({ hour, top: v.top, sub: v.sub }));
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
  const [failStats, failRecent] = forProfile(cfg, name);
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
  const toolTokenRows = tuples(con, SQL.TOOL_TOKEN_ROWS).map(([t, sid, tok]) =>
    ({ tool_name: t as string, session_id: sid as string, tokens: tok as number }));
  const attribution = buildAttribution(rows as never, identity as SessionsById, toolTokenRows);
  const toolRel = buildToolReliability(con);
  const toolsRecent = tuples(con, SQL.RECENT_TOOLS).map(([t, n]) => ({ tool: t, calls: n }));
  const recentSessions = tuples(con, SQL.RECENT_SESSIONS).map((r) => zip(SQL.RECENT_SESSIONS_COLS, r));
  const tree = buildSessionsTree(con);
  const dates = [...new Set(rows.map((r) => r["date"] as string).filter(Boolean))].sort();
  return {
    rows, hours, sessions: sess, hour_rows: hourRows, active,
    ...classifyProfile(name, sess),
    end_reasons: endReasons, outcomes, tools: toolRel.tools,
    tool_fail_samples: toolRel.tool_fail_samples,
    terminal_top_fail_commands: toolRel.terminal_top_fail_commands,
    latency: buildLatency(con, cfg), compression_pressure: buildCompressionPressure(con),
    concurrency: buildConcurrency(con), attribution, sessions_tree: tree,
    health: buildHealth(rows, failStats), failures_recent: failRecent,
    delegations: collectDelegations(con),
    live: buildLiveRows(con, name), resend: buildResend(con, catalog, cfg), tools_recent: toolsRecent, recent_sessions: recentSessions,
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
      profiles[p.name]!["context"] = buildContextForDb(con, now.getTime() / 1000);
    } finally {
      con.close();
    }
  }
  const reportsDir = opts.reportsDir ?? cfg.reports_dir;
  fs.mkdirSync(reportsDir, { recursive: true });
  const series = updateBandwidth(
    reportsDir,
    Object.fromEntries(Object.entries(profiles).map(([n, p]) => [n, p["rows"] as Row[]])),
    opts.today,
  );
  for (const [n, p] of Object.entries(profiles)) p["bandwidth_daily"] = series[n] ?? [];
  const nowTs = now.getTime() / 1000;
  for (const p of Object.values(profiles)) {
    p["_now"] = nowTs;
    p["alerts"] = buildAlerts(p);
    delete p["_now"];
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
