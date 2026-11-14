/** Live Claude Code / Codex CLI sessions — T-6 (LLMTELEMET-285), port of
 * `collect_agent_worker_live.py`.
 *
 * "File is the state": each CLI appends to one JSONL transcript per session,
 * so a session is live exactly when its file's mtime is recent. Privacy:
 * transcripts hold prompts/replies/tool args; only metadata is extracted —
 * session id, model, last-event time, token counts and a coarse phase. The
 * cwd is used only to derive the title (basename).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Config } from "./config.js";
import { isoToUnix } from "./collectPiAgents.js";
import { priceRow, type Catalog, type PriceRowInput } from "./pricing.js";

export const STALE_WINDOW_S = 180;
export const TAIL_BYTES = 256 * 1024;
export const HEAD_BYTES = 64 * 1024;
const SAFE_NAME_RE = /[^A-Za-z0-9_.:\-]/g;
const NAME_MAX = 40;
export const ENGINE_PROVIDER: Record<string, string> = {
  claude: "anthropic",
  codex: "openai-codex",
};

type Ev = Record<string, unknown>;

export function safeName(name: unknown): string {
  return String(name).replace(SAFE_NAME_RE, "").slice(0, NAME_MAX);
}

function readEvents(p: string, head = false): Ev[] {
  let data: Buffer;
  try {
    const size = fs.statSync(p).size;
    const fh = fs.openSync(p, "r");
    try {
      if (head) {
        data = Buffer.alloc(HEAD_BYTES);
        const n = fs.readSync(fh, data, 0, HEAD_BYTES, 0);
        data = data.subarray(0, n);
      } else {
        const start = Math.max(0, size - TAIL_BYTES);
        const n = size - start;
        data = Buffer.alloc(n);
        fs.readSync(fh, data, 0, n, start);
        if (start > 0) {
          const nl = data.indexOf(0x0a);
          data = nl === -1 ? Buffer.alloc(0) : data.subarray(nl + 1);
        }
      }
    } finally {
      fs.closeSync(fh);
    }
  } catch {
    return [];
  }
  const out: Ev[] = [];
  for (const line of data.toString("utf8").split(/\r?\n/)) {
    if (!line) continue;
    try {
      const obj = JSON.parse(line) as unknown;
      if (obj && typeof obj === "object" && !Array.isArray(obj)) out.push(obj as Ev);
    } catch {
      continue;
    }
  }
  return out;
}

function ts(event: Ev): number | null {
  const raw = event["timestamp"];
  if (typeof raw !== "string" || raw === "") return null;
  try {
    return isoToUnix(raw);
  } catch {
    return null;
  }
}

function modelStr(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, 80) : null;
}

function usageN(usage: Ev, key: string): number {
  const v = usage[key];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0;
}

function recent(globs: string[], now: number, staleWindowS: number): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const g of globs) {
    for (const f of expandGlob(g)) {
      try {
        const mtime = fs.statSync(f).mtimeMs / 1000;
        if (now - mtime <= staleWindowS) out.push([f, mtime]);
      } catch {
        /* raced away */
      }
    }
  }
  return out;
}

/** Minimal `glob.glob` equivalent for the two fixed patterns used here. */
function expandGlob(pattern: string): string[] {
  // Patterns: <home>/projects/*/*.jsonl  and  <home>/sessions/*/*/*/rollout-*.jsonl
  const rollout = pattern.includes("rollout-*.jsonl");
  const base = pattern.split("*")[0] ?? "";
  const out: string[] = [];
  const walk = (dir: string, depth: number, maxDepth: number, filter: (n: string) => boolean): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth) walk(full, depth + 1, maxDepth, filter);
      } else if (e.isFile() && filter(e.name)) {
        out.push(full);
      }
    }
  };
  if (rollout) {
    walk(base, 1, 3, (n) => n.startsWith("rollout-") && n.endsWith(".jsonl"));
  } else {
    walk(base, 1, 1, (n) => n.endsWith(".jsonl"));
  }
  return out;
}

export function loginHomes(engine: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env["LLM_TELEMETRY_AGENT_LOGINS"];
  const roots = raw === undefined
    ? [path.join(os.homedir(), ".hermes", "agent-logins")]
    : raw.split(path.delimiter).filter((r) => r !== "");
  const out: string[] = [];
  for (const root of roots) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(root, e.name, engine);
      if (e.isDirectory() && fs.existsSync(full) && fs.statSync(full).isDirectory()) {
        out.push(full);
      }
    }
  }
  out.sort();
  return out;
}

export function loginName(home: string, env: NodeJS.ProcessEnv = process.env): string {
  const raw = env["LLM_TELEMETRY_AGENT_LOGINS"];
  const roots = raw
    ? raw.split(path.delimiter).filter((r) => r !== "")
    : [path.join(os.homedir(), ".hermes", "agent-logins")];
  for (const root of roots) {
    if (path.dirname(path.dirname(home)) === root) return path.basename(path.dirname(home));
  }
  return "";
}

export function claudePhase(event: Ev): string | null {
  const typ = event["type"];
  const msg = event["message"];
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Ev;
  const content = m["content"];
  if (typ === "assistant") {
    if (!Array.isArray(content)) return "responding";
    let tool: string | null = null;
    let thinking = false;
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      const it = item as Ev;
      if (it["type"] === "tool_use" && it["name"]) {
        tool = safeName(it["name"]);
      } else if (it["type"] === "thinking") {
        thinking = true;
      }
    }
    if (tool) return `running ${tool}`;
    return thinking && content.length === 1 ? "thinking" : "responding";
  }
  if (typ === "user") return "thinking";
  return null;
}

export interface ParsedClaudeSession {
  sessionId: string | null;
  model: string | null;
  phase: string | null;
  cwd: string | null;
  lastTs: number | null;
}

export function parseClaudeSession(p: string): ParsedClaudeSession {
  const head = readEvents(p, true);
  const tail = readEvents(p);
  let sessionId: string | null = null;
  let model: string | null = null;
  let phase: string | null = null;
  let cwd: string | null = null;
  let lastTs: number | null = null;
  for (const ev of head) {
    const v = ev["cwd"];
    if (typeof v === "string" && v) {
      cwd = v;
      break;
    }
  }
  for (const ev of tail) {
    const t = ts(ev);
    if (t !== null && (lastTs === null || t >= lastTs)) lastTs = t;
    const v = ev["cwd"];
    if (typeof v === "string" && v) cwd = v;
    if (ev["type"] === "assistant") {
      sessionId = typeof ev["sessionId"] === "string" ? ev["sessionId"] : sessionId;
      const msg = (ev["message"] ?? {}) as Ev;
      const m = modelStr(msg["model"]) ?? modelStr(ev["requestedModel"]);
      if (m && !m.startsWith("<")) model = m;
    }
    const ph = claudePhase(ev);
    if (ph !== null) {
      phase = ph;
      const msg = (ev["message"] ?? {}) as Ev;
      if (ev["type"] === "assistant" && msg["stop_reason"] === "end_turn") phase = "idle";
    }
  }
  return { sessionId, model, phase, cwd, lastTs };
}

export interface ParsedCodexSession {
  sessionId: string | null;
  model: string | null;
  phase: string | null;
  cwd: string | null;
  lastTs: number | null;
  tokens: Record<string, Record<string, number>> | null;
}

export function parseCodexSession(p: string): ParsedCodexSession {
  const head = readEvents(p, true);
  const tail = readEvents(p);
  let sessionId: string | null = null;
  let model: string | null = null;
  let phase: string | null = null;
  let cwd: string | null = null;
  let lastTs: number | null = null;
  for (const ev of head) {
    const payload = (ev["payload"] ?? {}) as Ev;
    const v = payload["cwd"];
    if (typeof v === "string" && v) {
      cwd = v;
      break;
    }
  }
  for (const ev of tail) {
    const t = ts(ev);
    if (t !== null && (lastTs === null || t >= lastTs)) lastTs = t;
    const typ = ev["type"];
    const p1 = (ev["payload"] ?? {}) as Ev;
    const v = p1["cwd"];
    if (typ === "session_meta" && typeof v === "string" && v) cwd = v;
    if (typ === "session_meta" && typeof p1["id"] === "string") sessionId = p1["id"];
    if (p1["model"] && typeof p1["model"] === "string") model = p1["model"];
    if (typ === "response_item" && p1["type"]) {
      if (p1["type"] === "reasoning") {
        phase = "thinking";
      } else if (p1["type"] === "function_call" && p1["name"]) {
        phase = `running ${safeName(p1["name"])}`;
      } else if (p1["type"] === "message") {
        phase = "responding";
      }
    }
  }
  return { sessionId, model, phase, cwd, lastTs, tokens: codexTokens(tail) };
}

export function codexTokens(
  events: readonly Ev[],
): Record<string, Record<string, number>> | null {
  // token_count events carry a cumulative total_token_usage: the largest seen
  // per model wins (Codex emits running totals, not per-message deltas).
  const best: Record<string, Ev> = {};
  for (const ev of events) {
    if (ev["type"] !== "token_count") continue;
    const p = (ev["payload"] ?? {}) as Ev;
    const model = modelStr(p["model"]) ?? "codex";
    const t = (p["total_token_usage"] ?? {}) as Ev;
    const prev = best[model] ?? {};
    if (usageN(t, "cached_input_tokens") > usageN(prev, "cached_input_tokens") || !(model in best)) {
      best[model] = t;
    }
  }
  const out: Record<string, Record<string, number>> = {};
  for (const [model, t] of Object.entries(best)) {
    const input = Math.max(0, usageN(t, "input_tokens") - usageN(t, "cached_input_tokens"));
    out[model] = {
      input,
      output: usageN(t, "output_tokens"),
      cache_read: usageN(t, "cached_input_tokens"),
      cache_write: 0,
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Per-model tokens -> totals + the subscription-covered API-equivalent cost. */
export function priceTokens(
  engine: string,
  byModel: Record<string, Record<string, number>> | null,
  catalog: Catalog,
  cfg: Config,
): Record<string, unknown> {
  if (!byModel) return {};
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0.0;
  let priced = false;
  for (const [model, t] of Object.entries(byModel)) {
    input += t["input"] ?? 0;
    output += t["output"] ?? 0;
    cacheRead += t["cache_read"] ?? 0;
    cacheWrite += t["cache_write"] ?? 0;
    const row: PriceRowInput = {
      provider: ENGINE_PROVIDER[engine] ?? "unknown",
      model,
      input_tokens: t["input"] ?? 0,
      output_tokens: t["output"] ?? 0,
      cache_read: t["cache_read"] ?? 0,
      cache_write: t["cache_write"] ?? 0,
    };
    const pricedRow = priceRow(
      row,
      catalog,
      cfg,
      cfg.local_host_patterns ?? [],
      cfg.endpoint_aliases ?? {},
    );
    cost += pricedRow.market_value_usd;
    priced = priced || pricedRow.priced;
  }
  return {
    in_tok: input,
    out_tok: output,
    cache_read_tok: cacheRead,
    cache_write_tok: cacheWrite,
    cost_usd: Math.round(cost * 1e6) / 1e6,
    priced,
    cost_class: "subscription",
    rate_source: "api",
  };
}

export interface AgentLiveRow {
  engine: string;
  login: string;
  session_id: string | null;
  title: string;
  model: string | null;
  idle_s: number;
  phase: string | null;
  mtime: number;
  [k: string]: unknown;
}

export function buildAgentLive(opts: {
  cfg: Config;
  catalog: Catalog;
  now: number;
  staleWindowS?: number;
  claudeHome?: string;
  codexHome?: string;
  env?: NodeJS.ProcessEnv;
}): AgentLiveRow[] {
  const stale = opts.staleWindowS ?? STALE_WINDOW_S;
  const env = opts.env ?? process.env;
  const chome = opts.claudeHome ??
    env["LLM_TELEMETRY_CLAUDE_HOME"] ?? path.join(os.homedir(), ".claude");
  const xhome = opts.codexHome ??
    env["LLM_TELEMETRY_CODEX_HOME"] ?? path.join(os.homedir(), ".codex");
  const cAll = [chome, ...(opts.claudeHome ? [] : loginHomes("claude", env))];
  const xAll = [xhome, ...(opts.codexHome ? [] : loginHomes("codex", env))];
  const claudeFound: Array<[string, number, string]> = [];
  for (const h of cAll) {
    for (const [f, m] of recent([path.join(h, "projects", "*", "*.jsonl")], opts.now, stale)) {
      claudeFound.push([f, m, h]);
    }
  }
  const codexFound: Array<[string, number, string]> = [];
  for (const h of xAll) {
    for (const [f, m] of recent(
      [path.join(h, "sessions", "*", "*", "*", "rollout-*.jsonl")], opts.now, stale,
    )) {
      codexFound.push([f, m, h]);
    }
  }

  const best = new Map<string, AgentLiveRow>();
  for (const [engine, found] of [
    ["claude", claudeFound] as const,
    ["codex", codexFound] as const,
  ]) {
    for (const [p, mtime, home] of found) {
      const s = engine === "claude"
        ? (() => {
            const c = parseClaudeSession(p);
            return { ...c, tokens: claudeTokens(p) };
          })()
        : parseCodexSession(p);
      const tokens = engine === "codex"
        ? s.tokens
        : claudeTokens(p);
      const last = s.lastTs !== null ? s.lastTs : mtime;
      const cwd = s.cwd;
      const title = cwd ? path.basename(cwd.replace(/\/+$/, "")) : "";
      const row: AgentLiveRow = {
        engine,
        login: loginName(home, env),
        session_id: s.sessionId,
        title: title || engine,
        model: s.model,
        idle_s: pyRound1(Math.max(0, opts.now - last)),
        phase: s.phase,
        mtime,
        ...priceTokens(engine, tokens, opts.catalog, opts.cfg),
      };
      const key = `${engine}:${String(s.sessionId)}`;
      const prev = best.get(key);
      if (!prev || mtime > prev["mtime"]) best.set(key, row);
    }
  }
  const out = [...best.values()];
  out.sort((a, b) => a.idle_s - b.idle_s);
  return out;
}

const CLAUDE_SCAN = new Map<string, { off: number; msgs: Map<string, [string, number, number, number, number]> }>();

export function claudeTokens(
  p: string,
): Record<string, Record<string, number>> | null {
  let size: number;
  try {
    size = fs.statSync(p).size;
  } catch {
    return null;
  }
  let st = CLAUDE_SCAN.get(p);
  if (!st || size < st.off) {
    st = { off: 0, msgs: new Map() };
    CLAUDE_SCAN.set(p, st);
  }
  if (size > st.off) {
    let data: Buffer;
    try {
      const fh = fs.openSync(p, "r");
      try {
        data = Buffer.alloc(size - st.off);
        fs.readSync(fh, data, 0, data.length, st.off);
      } finally {
        fs.closeSync(fh);
      }
    } catch {
      return null;
    }
    const cut = data.lastIndexOf(0x0a) + 1;
    st.off += cut;
    for (const line of data.subarray(0, cut).toString("utf8").split(/\r?\n/)) {
      if (!line.includes('"usage"')) continue;
      let ev: Ev;
      try {
        ev = JSON.parse(line) as Ev;
      } catch {
        continue;
      }
      const msg = ev["message"];
      const usage = msg && typeof msg === "object" ? (msg as Ev)["usage"] : undefined;
      if (!msg || ev["type"] !== "assistant" || !usage || typeof usage !== "object") continue;
      const model = modelStr((msg as Ev)["model"]);
      if (!model || model.startsWith("<")) continue;
      const u = usage as Ev;
      const mid = String((msg as Ev)["id"] ?? ev["uuid"] ?? `@${st.off}:${st.msgs.size}`);
      st.msgs.set(mid, [
        model,
        usageN(u, "input_tokens"),
        usageN(u, "output_tokens"),
        usageN(u, "cache_read_input_tokens"),
        usageN(u, "cache_creation_input_tokens"),
      ]);
    }
  }
  const out: Record<string, Record<string, number>> = {};
  for (const [model, i, o, cr, cw] of st.msgs.values()) {
    const t = out[model] ?? (out[model] = { input: 0, output: 0, cache_read: 0, cache_write: 0 });
    t["input"] = (t["input"] ?? 0) + i;
    t["output"] = (t["output"] ?? 0) + o;
    t["cache_read"] = (t["cache_read"] ?? 0) + cr;
    t["cache_write"] = (t["cache_write"] ?? 0) + cw;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function pyRound1(x: number): number {
  return Number(x.toFixed(1));
}
