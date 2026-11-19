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
import { priceRow, pyRound, type Catalog, type PriceRowInput } from "./pricing.js";

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

function isEv(v: unknown): v is Ev {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

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
    // Python splits on \n and keeps every non-empty chunk, including a final
    // line with no trailing newline (`start == 0` keeps the whole chunk).
    if (!line) continue;
    try {
      const obj = JSON.parse(line) as unknown;
      if (isEv(obj)) out.push(obj);
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

/** Segment-exact `glob.glob` for the fixed patterns used here. Each `*`
 * matches exactly ONE path segment (never a dot-prefixed name, like Python's
 * glob — and unlike recursive walks that over- or under-match depth). */
function expandGlob(pattern: string): string[] {
  const segs = pattern.split(path.sep).filter((s) => s !== "");
  const root = path.isAbsolute(pattern) ? path.sep : "";
  const out: string[] = [];
  const walk = (base: string, i: number): void => {
    if (i === segs.length) {
      out.push(base);
      return;
    }
    const seg = segs[i] ?? "";
    const isLast = i === segs.length - 1;
    const dirMatch = !seg.includes("*");
    if (dirMatch) {
      walk(path.join(base, seg), i + 1);
      return;
    }
    const [pre, post] = seg.split("*", 2);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue; // glob `*` skips dot names
      const nameOk = e.name.startsWith(pre ?? "") &&
        e.name.endsWith(post ?? "") &&
        (isLast ? e.isFile() : e.isDirectory());
      if (nameOk) walk(path.join(base, e.name), i + 1);
    }
  };
  walk(root, 0);
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
  if (!isEv(msg)) return null;
  const content = msg["content"];
  if (typ === "assistant") {
    if (!Array.isArray(content)) return "responding";
    let tool: string | null = null;
    let thinking = false;
    for (const item of content) {
      if (!isEv(item)) continue;
      if (item["type"] === "tool_use" && item["name"]) {
        // Python: `tool = _safe_name(item["name"])` — the LAST tool_use in the
        // content wins, not the first (a multi-tool assistant turn reports the
        // tool it is running at the end).
        tool = safeName(item["name"]);
      } else if (item["type"] === "thinking") {
        thinking = true;
      }
    }
    if (tool) return `running ${tool}`;
    return thinking && content.length === 1 ? "thinking" : "responding";
  }
  if (typ === "user") return "thinking";
  return null;
}

/** Python's `_codex_phase`: all eight branches, in order. */
export function codexPhase(event: Ev): string | null {
  const typ = event["type"];
  const payload = event["payload"];
  if (typ === "response_item" && isEv(payload)) {
    const t = payload["type"];
    if (t === "function_call" || t === "custom_tool_call" || t === "local_shell_call") {
      const name = t === "local_shell_call" ? (payload["name"] || "shell") : payload["name"];
      return name ? `running ${safeName(name)}` : "running tool";
    }
    if (t === "function_call_output" || t === "custom_tool_call_output" || t === "reasoning") {
      return "thinking";
    }
    if (t === "message") {
      return payload["role"] === "user" ? "thinking" : "responding";
    }
  }
  if (typ === "event_msg" && isEv(payload)) {
    const t = payload["type"];
    if (t === "task_complete" || t === "turn_aborted" || t === "shutdown_complete") return "idle";
    if (t === "task_started" || t === "user_message") return "thinking";
    return null;
  }
  return null;
}

export interface ParsedClaudeSession {
  sessionId: string;
  model: string | null;
  phase: string | null;
  cwd: string;
  lastTs: number | null;
}

export function parseClaudeSession(p: string): ParsedClaudeSession | null {
  const tail = readEvents(p);
  const head = readEvents(p, true);
  if (head.length === 0 && tail.length === 0) return null; // Python: `if not head and not tail: return None`
  // Python `parse_claude_session`: session identity is the FILE STEM — a
  // resumed/forked transcript repeats message-level sessionIds across files,
  // and the stem is the only stable identity. message-level `sessionId` is
  // never trusted.
  const sessionId = path.basename(p, path.extname(p));
  let model: string | null = null;
  let phase: string | null = "idle"; // Python: phase starts "idle"
  let cwd: string | null = null; // Python: cwd starts None
  let lastTs: number | null = null;
  for (const ev of head) {
    // Python: `if cwd is None and isinstance(ev.get("cwd"), str): cwd =
    // ev["cwd"]` — the FIRST string cwd wins in the head scan, even "".
    const v = ev["cwd"];
    if (cwd === null && typeof v === "string") cwd = v;
  }
  for (const ev of tail) {
    const t = ts(ev);
    if (t !== null && (lastTs === null || t >= lastTs)) lastTs = t;
    const v = ev["cwd"];
    if (typeof v === "string") cwd = v; // Python: any string, last one wins (even "")
    const msg = isEv(ev["message"]) ? ev["message"] : null;
    if (ev["type"] === "assistant" && msg) {
      const m = modelStr(msg["model"]) ?? modelStr(ev["requestedModel"]);
      if (m && !m.startsWith("<")) model = m;
    }
    const ph = claudePhase(ev);
    if (ph !== null) {
      phase = ph;
    }
    // A finished turn: the last assistant record ended with end_turn. Any
    // later user/tool record overwrites this via _claude_phase above.
    if (ev["type"] === "assistant" && msg && msg["stop_reason"] === "end_turn") {
      phase = "idle";
    }
  }
  return { sessionId, model, phase, cwd: cwd ?? "", lastTs };
}

export interface ParsedCodexSession {
  sessionId: string;
  model: string | null;
  phase: string | null;
  cwd: string;
  lastTs: number | null;
  tokens: Record<string, Record<string, number>> | null;
}

export function parseCodexSession(p: string): ParsedCodexSession | null {
  const tail = readEvents(p);
  const head = readEvents(p, true);
  if (head.length === 0 && tail.length === 0) return null;
  // Python `parse_codex_session`: identity/cwd/model come from
  // `payload.session_meta` in the HEAD only (first match wins: `sid = sid or
  // ...`), and the tail re-reads cwd/model from `turn_context` only — never
  // arbitrary payload shapes.
  let sessionId = "";
  let model: string | null = null;
  let phase: string | null = "idle";
  let cwd: string | null = null;
  let lastTs: number | null = null;
  for (const ev of head) {
    const payload = ev["payload"];
    if (ev["type"] !== "session_meta" || !isEv(payload)) continue;
    if (!sessionId && typeof payload["id"] === "string") sessionId = payload["id"];
    if (cwd === null && typeof payload["cwd"] === "string") cwd = payload["cwd"];
    if (!model) model = modelStr(payload["model"]);
  }
  for (const ev of tail) {
    const t = ts(ev);
    if (t !== null && (lastTs === null || t >= lastTs)) lastTs = t;
    const payload = ev["payload"];
    if (ev["type"] === "turn_context" && isEv(payload)) {
      model = modelStr(payload["model"]) || model;
      if (typeof payload["cwd"] === "string") cwd = payload["cwd"];
    }
    const ph = codexPhase(ev);
    if (ph) phase = ph;
  }
  // Python: `m = re.search(r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-
  // [0-9a-f]{12})$", path.stem); sid = m.group(1) if m else path.stem` — a
  // Codex transcript without a session id keeps the trailing UUID of the file
  // stem when it has one, else the whole stem.
  if (!sessionId) {
    const stem = path.basename(p, path.extname(p));
    const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(stem);
    sessionId = m?.[1] ?? stem;
  }
  return { sessionId, model, phase, cwd: cwd ?? "", lastTs, tokens: codexTokens(tail, model) };
}

export function codexTokens(
  events: readonly Ev[],
  model: string | null,
): Record<string, Record<string, number>> | null {
  // Python `codex_tokens`: Codex logs a CUMULATIVE total_token_usage in each
  // token_count event — an event_msg whose payload.type is "token_count" with
  // the totals under payload.info.total_token_usage. The newest one in the
  // tail is the session total; its input_tokens INCLUDES the cached ones,
  // which are split out here. Grouped under `model or ""`, never invented.
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (!ev || ev["type"] !== "event_msg") continue;
    const payload = ev["payload"];
    if (!isEv(payload) || payload["type"] !== "token_count") continue;
    const info = payload["info"];
    const u = isEv(info) ? info["total_token_usage"] : undefined;
    if (isEv(u)) {
      const cached = usageN(u, "cached_input_tokens");
      return {
        [model ?? ""]: {
          input: Math.max(0, usageN(u, "input_tokens") - cached),
          output: usageN(u, "output_tokens"),
          cache_read: cached,
          cache_write: 0,
        },
      };
    }
  }
  return null;
}

/** Per-model tokens -> totals + the subscription-covered API-equivalent cost.
 * Python `price_tokens`: `cost, priced = 0.0, True` — a session is priced
 * unless ANY model row lacks a rate, and cost_usd is then null (never a real
 * $0). */
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
  let priced = true;
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
    priced = priced && pricedRow.priced;
  }
  // Python `price_tokens` returns exactly six keys (in_tok, out_tok,
  // cache_read_tok, cache_write_tok, cost_usd, cost_class); the internal
  // `priced` flag only decides cost_usd, never leaks as a field.
  return {
    in_tok: input,
    out_tok: output,
    cache_read_tok: cacheRead,
    cache_write_tok: cacheWrite,
    cost_usd: priced ? pyRound(cost, 4) : null,
    cost_class: "subscription",
  };
}

export interface AgentLiveRow {
  engine: string;
  login: string;
  session_id: string;
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
      let s: ParsedClaudeSession | ParsedCodexSession | null;
      let tokens: Record<string, Record<string, number>> | null;
      if (engine === "claude") {
        s = parseClaudeSession(p);
        // Python: `tokens = s.get("tokens") if engine == "codex" else
        // claude_tokens(path)` — exactly ONE token scan per file (NIT 13).
        tokens = s === null ? null : claudeTokens(p);
      } else {
        const cs = parseCodexSession(p);
        s = cs;
        tokens = cs === null ? null : cs.tokens;
      }
      if (s === null) continue;
      const last = s.lastTs !== null ? s.lastTs : mtime;
      const cwd = s.cwd;
      const title = cwd ? path.basename(cwd.replace(/\/+$/, "")) : "";
      const row: AgentLiveRow = {
        engine,
        login: loginName(home, env),
        session_id: s.sessionId,
        title: title || engine,
        model: s.model,
        idle_s: pyRound(Math.max(0, opts.now - last), 1),
        phase: s.phase,
        mtime,
        ...priceTokens(engine, tokens, opts.catalog, opts.cfg),
      };
      // One row per engine:session_id (a resumed/forked transcript can repeat
      // an id across files): keep the most recently written.
      const key = `${engine}:${s.sessionId}`;
      const prev = best.get(key);
      if (!prev || mtime > prev["mtime"]) best.set(key, row);
    }
  }
  const out = [...best.values()];
  out.sort((a, b) => a.idle_s - b.idle_s);
  return out;
}

const CLAUDE_SCAN = new Map<string, { off: number; msgs: Map<string, [string, number, number, number, number]> }>();

/** Per-model token totals of a Claude Code transcript. A message streams as
 * several records sharing message.id, each repeating its usage: the last one
 * per id wins. The file is read incrementally (offset kept per path) as it
 * can be tens of MB and is polled every few seconds. */
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
      const usage = isEv(msg) ? msg["usage"] : undefined;
      if (!isEv(msg) || ev["type"] !== "assistant" || !isEv(usage)) continue;
      const model = modelStr(msg["model"]);
      if (!model || model.startsWith("<")) continue;
      const u = usage as Ev;
      // Python: `mid = msg.get("id") or ev.get("uuid") or f"@{st['off']}:{len(st['msgs'])}"`
      // — truthy `or`, so an empty-string id falls through (not `??`).
      const mid = String(msg["id"] || ev["uuid"] || `@${st.off}:${st.msgs.size}`);
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
