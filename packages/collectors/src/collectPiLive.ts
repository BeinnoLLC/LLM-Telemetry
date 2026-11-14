/** Live PI agent sessions — T-6 (LLMTELEMET-285), port of `collect_pi_live.py`.
 *
 * PI writes one growing JSONL file per session under
 * `~/.pi/agent<name>/sessions/<cwd-slug>/<file>.jsonl`. A session is "live"
 * exactly when its file's mtime is recent (STALE_WINDOW_S); once an agent
 * finishes the file goes quiet and ages out on its own.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { isoToUnix, parsePiSessionJsonl } from "./collectPiAgents.js";

export const STALE_WINDOW_S = 180;
export const PHASE_TEXT_MAX = 80;
export const TOOLS_WINDOW_S = 900;
export const TOOLS_LIMIT = 12;

/** PI tool names -> the Hermes-named category loeIcon's gauge scores. */
export const PI_TOOL_HERMES_ALIAS: Record<string, string> = {
  bash: "terminal",
  subagent: "delegate_task",
  dispatch_relay: "delegate_task",
  read: "read_file",
  fetch_content: "web_search",
  source_check: "web_search",
  get_search_content: "search_files",
};

type Ev = Record<string, unknown>;

function agentNameFromPath(jsonlPath: string, piHome: string): string {
  const rel = path.relative(piHome, jsonlPath);
  if (rel && !rel.startsWith("..")) {
    const parts = rel.split(path.sep);
    if (parts.length > 0 && parts[0]) return parts[0];
  }
  return path.basename(path.dirname(path.dirname(path.dirname(jsonlPath))));
}

function contentItems(msg: Ev): Ev[] {
  const content = msg["content"];
  return Array.isArray(content)
    ? content.filter((i): i is Ev => typeof i === "object" && i !== null)
    : [];
}

export function lastEventPhase(events: readonly Ev[]): [number | null, string] {
  let lastTs: number | null = null;
  let phase = "idle";
  for (const event of events) {
    const ts = event["timestamp"];
    if (typeof ts === "string" && ts !== "") {
      const t = isoToUnix(ts);
      if (lastTs === null || t >= lastTs) lastTs = t;
    }
    if (event["type"] !== "message") continue;
    const msg = (event["message"] ?? {}) as Ev;
    if (msg["role"] !== "assistant") continue;
    if (!Array.isArray(msg["content"])) continue;
    let tool: string | null = null;
    let text: string | null = null;
    let thinking = false;
    for (const item of contentItems(msg)) {
      const kind = item["type"];
      if (kind === "toolCall") {
        tool = typeof item["name"] === "string" ? item["name"] : null;
      } else if (kind === "text" && item["text"]) {
        text = typeof item["text"] === "string" ? item["text"] : null;
      } else if (kind === "thinking") {
        thinking = true;
      }
    }
    if (tool) {
      phase = `running ${tool}`;
    } else if (text) {
      const first = text.trim().split("\n")[0] ?? "";
      phase = first.slice(0, PHASE_TEXT_MAX);
    } else if (thinking) {
      phase = "thinking";
    }
  }
  return [lastTs, phase];
}

export function recentTools(
  events: readonly Ev[],
  now: number,
  windowS = TOOLS_WINDOW_S,
  limit = TOOLS_LIMIT,
): string[] {
  const seen: string[] = [];
  for (const event of events) {
    if (event["type"] !== "message") continue;
    const ts = event["timestamp"];
    if (typeof ts === "string" && ts !== "" && now - isoToUnix(ts) > windowS) continue;
    const msg = (event["message"] ?? {}) as Ev;
    if (msg["role"] !== "assistant") continue;
    if (!Array.isArray(msg["content"])) continue;
    for (const item of contentItems(msg)) {
      if (item["type"] === "toolCall") {
        const name = item["name"];
        if (typeof name === "string" && name && !seen.includes(name)) seen.push(name);
      }
    }
  }
  const recent = seen.slice(0, limit);
  recent.reverse(); // most-recently-seen tool first
  return recent;
}

export function gaugeTools(tools: readonly string[]): string[] {
  return tools.map((t) => PI_TOOL_HERMES_ALIAS[t] ?? t);
}

export function modelTimeline(events: readonly Ev[]): [string | null, boolean] {
  const models: string[] = [];
  for (const e of events) {
    if (e["type"] === "model_change" && typeof e["modelId"] === "string" && e["modelId"]) {
      models.push(e["modelId"]);
    }
  }
  if (models.length === 0) return [null, false];
  const first = models[0] ?? null;
  return [first, new Set(models).size > 1 && first !== models[models.length - 1]];
}

export function startedAt(sessionTs: string | null): number | null {
  return sessionTs ? isoToUnix(sessionTs) : null;
}

export function discoverLiveJsonl(piHome: string, now: number, staleWindowS: number): string[] {
  if (!fs.existsSync(piHome)) return [];
  const out: string[] = [];
  const walk = (base: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(base, e.name);
      if (e.isDirectory()) {
        if (depth < 3) walk(full, depth + 1);
      } else if (e.isFile() && e.name.endsWith(".jsonl") && depth === 3) {
        try {
          const mtime = fs.statSync(full).mtimeMs / 1000;
          if (now - mtime <= staleWindowS) out.push(full);
        } catch {
          /* raced away */
        }
      }
    }
  };
  // agent*/sessions/*/*.jsonl
  let agents: string[] = [];
  try {
    agents = fs.readdirSync(piHome).filter((n) => n.startsWith("agent"));
  } catch {
    return [];
  }
  for (const a of agents) {
    const sessions = path.join(piHome, a, "sessions");
    if (!fs.existsSync(sessions)) continue;
    walk(sessions, 1);
  }
  out.sort();
  return out;
}

export function buildPiLive(opts: {
  piHome: string;
  now: number;
  staleWindowS?: number;
}): Record<string, unknown>[] {
  const stale = opts.staleWindowS ?? STALE_WINDOW_S;
  const out: Array<Record<string, unknown>> = [];
  for (const jsonlPath of discoverLiveJsonl(opts.piHome, opts.now, stale)) {
    const session = parsePiSessionJsonl(jsonlPath);
    if (session === null) continue;
    const agent = agentNameFromPath(jsonlPath, opts.piHome);
    const events = session.rawEvents;
    const [lastTs, phase] = lastEventPhase(events);
    const idleS = lastTs !== null ? pyRound1(Math.max(0, opts.now - lastTs)) : null;
    const cwd = session.cwd;
    const title = cwd ? path.basename(cwd.replace(/\/+$/, "")) : agent;
    let mtime: number | null = null;
    try {
      mtime = fs.statSync(jsonlPath).mtimeMs / 1000;
    } catch {
      mtime = null;
    }
    const [initModel, switched] = modelTimeline(events);
    const started = startedAt(session.timestamp);
    const uptimeS = started ? pyRound1(Math.max(0, opts.now - started)) : null;
    const tools = recentTools(events, opts.now);
    out.push({
      agent,
      session_id: session.sessionId,
      cwd,
      title: title || agent,
      model: session.model,
      provider: session.provider,
      idle_s: idleS,
      phase,
      mtime,
      tools,
      tools_gauge: gaugeTools(tools),
      init_model: initModel,
      switched,
      started_at: started,
      uptime_s: uptimeS,
      in_tok: session.inputTokens,
      out_tok: session.outputTokens,
      cache_read_tok: session.cacheReadTokens,
      cache_write_tok: session.cacheWriteTokens,
      cost_usd: pyRound1_4(session.totalCost),
    });
  }
  out.sort((a, b) => {
    const ia = typeof a["idle_s"] === "number" ? (a["idle_s"] as number) : Infinity;
    const ib = typeof b["idle_s"] === "number" ? (b["idle_s"] as number) : Infinity;
    return ia - ib;
  });
  return out;
}

/** round(x, 1)/round(x, 4) stand-ins (toFixed: ties-away vs Python
 * ties-even; parity fixtures avoid exact ties). */
export function pyRound1(x: number): number {
  return Number(x.toFixed(1));
}
export function pyRound1_4(x: number): number {
  return Number(x.toFixed(4));
}
