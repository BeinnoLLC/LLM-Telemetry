/** PI ingest + CLI entry point — T-18 (LLMTELEMET-289), RUN 2a.
 *
 * Faithful port of the ingest half of `src/llm_telemetry/collect_pi_agents.py`
 * (discovery, ingest, orchestration signals/edges) and of
 * `src/llm_telemetry/ingest_pi.py`'s `main`. The JSONL walker itself is the
 * verified `parsePiSessionJsonl` / `isoToUnix` pair from collectPiAgents.ts —
 * this module never reimplements either one.
 *
 * Python's JSONL numbers keep int vs float (`json.loads("10.0")` is a float),
 * while JSON.parse collapses them. `parsePy` is used on the session file a
 * second time only to recover that distinction for payload bytes; the parsed
 * session's own counters still come from the shared parser.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import {
  AnalyticsStore,
  EventSource,
  EventType,
  getStore,
  type RawEvent,
} from "./analyticsStore.js";
import { isoToUnix, parsePiSessionJsonl, type PiParsedSession } from "./collectPiAgents.js";
import { parsePy, pyDumps, PyFloat } from "./pyJson.js";

/** Minimal shape shared with the collector CLI's CliIo. */
export interface IngestPiIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const stdIo: IngestPiIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

const PROG = "llm-telemetry ingest-pi";
/** Node's shadow DB stays separate from the Python collector's analytics.db.
 * The shared DEFAULT_DB_PATH constant is intentionally left untouched. */
const NODE_DEFAULT_DB_PATH = "~/.local/share/llm-telemetry/analytics-node.db";

const USAGE = `usage: ${PROG} [-h] [--db DB] [--verbose] [--stats]`;
// Exact argparse help at the default 80-column width.
const HELP = `${USAGE}

Ingest PI agent sessions into the analytics store.

options:
  -h, --help     show this help message and exit
  --db DB        Path to analytics SQLite database (default:
                 ~/.local/share/llm-telemetry/analytics-node.db)
  --verbose, -v  Enable verbose logging
  --stats, -s    Print statistics after ingestion`;

/** `Path.home()`: POSIX Python reads HOME even when it is empty. */
function homeDir(): string {
  const home = process.env["HOME"];
  return home === undefined ? os.homedir() : home;
}

function piHome(): string {
  return join(homeDir(), ".pi");
}

/** Python string comparison (code points, not UTF-16 code units). */
function pyCompare(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i++) {
    const x = left[i]!.codePointAt(0)!;
    const y = right[i]!.codePointAt(0)!;
    if (x !== y) return x < y ? -1 : 1;
  }
  return left.length - right.length;
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Node's readdirSync sorts; Python's scandir (used by Path.glob/rglob)
 * preserves the filesystem's own order, which decides which of two
 * duplicate events is inserted first. opendirSync preserves that order. */
function readDirEntries(dir: string): fs.Dirent[] {
  const stream = fs.opendirSync(dir);
  const entries: fs.Dirent[] = [];
  try {
    for (;;) {
      const entry = stream.readSync();
      if (entry === null) break;
      entries.push(entry);
    }
  } finally {
    stream.closeSync();
  }
  return entries;
}

/** `Path.home().glob("agent*")`, directories only, sorted like Python. */
export function discoverPiAgents(): string[] {
  const root = piHome();
  if (!isDirectory(root)) return [];
  let entries: fs.Dirent[];
  try {
    entries = readDirEntries(root);
  } catch {
    return [];
  }
  const agents: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith("agent") && isDirectory(join(root, entry.name))) agents.push(entry.name);
  }
  return agents.sort(pyCompare);
}

/** `sessions_dir.rglob("*.jsonl")`: Python yields the matches in the current
 * directory first, then recurses into real subdirectories in scandir order
 * (opendirSync preserves it and does not follow symlinked directories). */
function rglobJsonl(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = readDirEntries(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.endsWith(".jsonl")) found.push(join(current, entry.name));
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(join(current, entry.name));
    }
  };
  walk(dir);
  return found;
}

/** Python truthiness, used for `if usage:` and `text or thinking`. */
function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

/** `json.loads` float vs int for a parsed JSON value. parsePy wraps integral
 * floats in PyFloat; non-integral ones remain ordinary JS numbers. */
function isPyFloat(v: unknown): boolean {
  return v instanceof PyFloat || (typeof v === "number" && !Number.isInteger(v));
}

const USAGE_FIELDS = ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const;
type UsageField = (typeof USAGE_FIELDS)[number];

/** Recover which usage counters Python would hold as floats. The session
 * itself is still parsed by parsePiSessionJsonl; this only preserves the
 * int/float spelling of the numbers inside its payload. */
function floatUsageFields(jsonlPath: string): Set<UsageField> {
  const floats = new Set<UsageField>();
  let text: string;
  try {
    text = fs.readFileSync(jsonlPath, "utf8");
  } catch {
    return floats;
  }
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === "") continue;
    let event: unknown;
    try {
      event = parsePy(raw);
    } catch {
      continue; // parsePiSessionJsonl drops such sessions before we get here
    }
    if (event === null || typeof event !== "object" || Array.isArray(event)) continue;
    const rec = event as Record<string, unknown>;
    if (rec["type"] !== "message") continue;
    const msg = rec["message"];
    if (msg === null || typeof msg !== "object" || Array.isArray(msg)) continue;
    if ((msg as Record<string, unknown>)["role"] !== "assistant") continue;
    const usage = rec["usage"];
    if (!pyTruthy(usage) || usage === null || typeof usage !== "object" || Array.isArray(usage)) continue;
    const u = usage as Record<string, unknown>;
    for (const field of USAGE_FIELDS) {
      if (isPyFloat(u[field])) floats.add(field);
    }
  }
  return floats;
}

/** Plain JS numbers from the shared parser, rewrapped as Python ints/floats. */
function tokenValue(value: number, field: UsageField, floats: Set<UsageField>): number | PyFloat {
  return floats.has(field) ? new PyFloat(value) : value;
}

function pythonPayload(session: PiParsedSession, jsonlPath: string): Record<string, unknown> {
  const floats = floatUsageFields(jsonlPath);
  return {
    cwd: session.cwd,
    model: session.model,
    provider: session.provider,
    thinking_level: session.thinkingLevel,
    tokens: {
      input: tokenValue(session.inputTokens, "input", floats),
      output: tokenValue(session.outputTokens, "output", floats),
      cache_read: tokenValue(session.cacheReadTokens, "cacheRead", floats),
      cache_write: tokenValue(session.cacheWriteTokens, "cacheWrite", floats),
      total: tokenValue(session.totalTokens, "totalTokens", floats),
    },
    // PISession.total_cost starts at 0.0 and += always yields a Python float.
    cost: { total: new PyFloat(session.totalCost) },
    jsonl_path: jsonlPath,
  };
}

/** Python `re.IGNORECASE` + `\b` word boundaries are Unicode-aware; JS's `\b`
 * is not, so check the neighbouring code points ourselves. */
function isPyWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /^[\p{L}\p{N}_]$/u.test(ch);
}

function containsWord(text: string, word: string): boolean {
  const re = new RegExp(word, "giu");
  for (const match of text.matchAll(re)) {
    const start = match.index;
    const end = start + match[0].length;
    const before = start > 0 ? Array.from(text.slice(0, start)).at(-1) : undefined;
    const after = Array.from(text.slice(end))[0];
    if (!isPyWordChar(before) && !isPyWordChar(after)) return true;
  }
  return false;
}

/** `content` -> the text scanned by `_detect_orchestration_signals`. Returns
 * null for content that Python would skip (not list/str). */
function contentText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const item of content) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const text = rec["text"] ?? "";
    const chosen = pyTruthy(text) ? text : rec["thinking"] ?? "";
    if (typeof chosen !== "string") {
      // Python's "\n".join(...) would raise TypeError here.
      throw new TypeError("orchestration content item is not a string");
    }
    parts.push(chosen);
  }
  return parts.join("\n");
}

function snippet(text: string): string {
  return Array.from(text).slice(0, 200).join("");
}

/** Port of `_detect_orchestration_signals`. The three patterns are checked in
 * Python's order, so edge insertion order matches for multi-signal messages. */
export function detectOrchestrationSignals(
  session: PiParsedSession,
  store: AnalyticsStore,
): void {
  if (!session.rawEvents.length) return;
  for (const event of session.rawEvents) {
    if (event["type"] !== "message") continue;
    const msg = event["message"];
    if (msg === null || typeof msg !== "object" || Array.isArray(msg)) continue;
    const rec = msg as Record<string, unknown>;
    if (rec["role"] !== "assistant") continue;
    const text = contentText(rec["content"]);
    if (text === null) continue;
    if (containsWord(text, "subagent")) {
      recordOrchestrationEdge(session, store, "pi:*", "pi_subagent_spawn", snippet(text));
    }
    if (/hermes|delegate_task/iu.test(text)) {
      recordOrchestrationEdge(session, store, "hermes:*", "pi_hermes_interaction", snippet(text));
    }
    if (/dispatch_relay/iu.test(text)) {
      recordOrchestrationEdge(session, store, "pi:relay", "pi_dispatch_relay", snippet(text));
    }
  }
}

/** Port of `_record_orchestration_edge`, including the `^(\w+):(.*)$` split
 * and NULL target agent for `*`. */
export function recordOrchestrationEdge(
  session: PiParsedSession,
  store: AnalyticsStore,
  triggeredTarget: string,
  signalType: string,
  contentSnippet = "",
): void {
  const match = /^([A-Za-z0-9_]+):(.*)$/.exec(triggeredTarget);
  const targetAgent = match !== null && match[2] !== "*" ? match[2]! : null;
  store.write_orchestration_edge(
    isoToUnix(session.timestamp),
    EventSource.PI,
    session.agentName,
    session.sessionId,
    triggeredTarget,
    targetAgent,
    signalType,
    {
      model: session.model,
      thinking_level: session.thinkingLevel,
      content_snippet: contentSnippet,
    },
  );
}

/** Port of `ingest_pi_agents`. `debug` is the module logger's DEBUG sink,
 * used by main when --verbose is set. */
export function ingestPiAgents(store: AnalyticsStore | null = null, debug?: (message: string) => void): number {
  const active = store ?? getStore();
  const agents = discoverPiAgents();
  if (agents.length === 0) return 0;
  let totalEvents = 0;
  for (const agentName of agents) {
    const sessionsDir = join(piHome(), agentName, "sessions");
    if (!isDirectory(sessionsDir)) continue;
    for (const jsonlPath of rglobJsonl(sessionsDir)) {
      const session = parsePiSessionJsonl(jsonlPath);
      if (!session) continue;
      const event: RawEvent = {
        source: EventSource.PI,
        profile_or_agent: agentName,
        session_id: session.sessionId,
        timestamp: isoToUnix(session.timestamp),
        event_type: EventType.SESSION_START,
        payload: pythonPayload(session, jsonlPath),
      };
      const rowId = active.write_event(event);
      if (rowId > 0) {
        totalEvents += 1;
        debug?.(`Ingested PI session ${agentName}/${session.sessionId}`);
      }
      detectOrchestrationSignals(session, active);
    }
  }
  return totalEvents;
}

// Python names, for consumers mirroring its call sites.
export const discover_pi_agents = discoverPiAgents;
export const ingest_pi_agents = ingestPiAgents;
export const _detect_orchestration_signals = detectOrchestrationSignals;
export const _record_orchestration_edge = recordOrchestrationEdge;

interface ParsedArgs {
  db: string;
  verbose: boolean;
  stats: boolean;
  help: boolean;
}

const LONG_OPTIONS = ["--help", "--db", "--verbose", "--stats"] as const;

/** argparse's long-option prefix matching (all four options are unique). */
function longOption(arg: string): string | null {
  if (!arg.startsWith("--")) return null;
  const name = arg.split("=", 1)[0]!;
  const hits = LONG_OPTIONS.filter((option) => option.startsWith(name));
  return hits.length === 1 ? hits[0]! : null;
}

function argError(io: IngestPiIo, message: string): null {
  io.err(`${USAGE}\n${PROG}: error: ${message}`);
  return null;
}

/** The subset of argparse used by ingest_pi.py: --db, --verbose/-v,
 * --stats/-s, -h/--help (including prefixes, `=`, and short clusters). */
function parseArgs(argv: string[], io: IngestPiIo): ParsedArgs | null {
  const parsed: ParsedArgs = { db: NODE_DEFAULT_DB_PATH, verbose: false, stats: false, help: false };
  const unknown: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h") { parsed.help = true; continue; }
    if (arg.startsWith("--")) {
      const option = longOption(arg);
      const eq = arg.indexOf("=");
      const value = eq === -1 ? null : arg.slice(eq + 1);
      if (option === null) { unknown.push(arg); continue; }
      if (option === "--help") {
        if (value !== null) return argError(io, `argument -h/--help: ignored explicit argument '${value}'`);
        parsed.help = true;
      } else if (option === "--db") {
        if (value === null) {
          if (i + 1 >= argv.length) return argError(io, "argument --db: expected one argument");
          parsed.db = argv[++i]!;
        } else parsed.db = value;
      } else if (option === "--verbose") {
        if (value !== null) return argError(io, `argument --verbose/-v: ignored explicit argument '${value}'`);
        parsed.verbose = true;
      } else {
        if (value !== null) return argError(io, `argument --stats/-s: ignored explicit argument '${value}'`);
        parsed.stats = true;
      }
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      for (const flag of arg.slice(1)) {
        if (flag === "h") parsed.help = true;
        else if (flag === "v") parsed.verbose = true;
        else if (flag === "s") parsed.stats = true;
        else { unknown.push(arg); break; }
      }
      continue;
    }
    unknown.push(arg);
  }
  if (unknown.length > 0) return argError(io, `unrecognized arguments: ${unknown.join(" ")}`);
  return parsed;
}

/** `Path(args.db).expanduser()` — the same rule as AnalyticsStore. */
function expandUser(p: string): string {
  if (p === "~") return homeDir();
  if (p.startsWith("~/")) return join(homeDir(), p.slice(2));
  return p;
}

/** Python `json.dumps(indent=2)` (ensure_ascii, insertion order). */
function dumpsIndent(value: unknown, depth = 0): string {
  const pad = " ".repeat(depth * 2);
  const inner = " ".repeat((depth + 1) * 2);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return "[\n" + value.map((v) => inner + dumpsIndent(v, depth + 1)).join(",\n") + "\n" + pad + "]";
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return "{\n" + entries.map(([k, v]) => `${inner}${pyDumps(k)}: ${dumpsIndent(v, depth + 1)}`).join(",\n") +
      "\n" + pad + "}";
  }
  return pyDumps(value);
}

function log(
  io: IngestPiIo,
  level: "DEBUG" | "INFO" | "WARNING",
  name: string,
  message: string,
  verbose: boolean,
): void {
  if (level === "DEBUG" && !verbose) return;
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-` +
    `${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:` +
    `${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")},` +
    String(now.getMilliseconds()).padStart(3, "0");
  io.err(`${stamp} [${level}] ${name}: ${message}`);
}

/** Port of ingest_pi.main(argv): same options, defaults, stdout and codes. */
export function main(argv: string[] = [], io: IngestPiIo = stdIo): number {
  const args = parseArgs(argv, io);
  if (args === null) return 2;
  if (args.help) { io.out(HELP); return 0; }

  const dbPath = expandUser(args.db);
  const store = getStore(dbPath);
  log(io, "INFO", "llm_telemetry.ingest_pi", `Using analytics store: ${dbPath}`, args.verbose);

  const agents = discoverPiAgents();
  if (agents.length === 0) {
    log(io, "WARNING", "llm_telemetry.ingest_pi", "No PI agents found in ~/.pi/", args.verbose);
    io.out(pyDumps({ agents: [], total_events: 0, total_edges: 0 }));
    return 0;
  }
  log(io, "INFO", "llm_telemetry.ingest_pi", `Discovered ${agents.length} PI agents: ${agents.join(", ")}`, args.verbose);

  const debug = args.verbose
    ? (message: string) => log(io, "DEBUG", "llm_telemetry.collect_pi_agents", message, true)
    : undefined;
  const totalEvents = ingestPiAgents(store, debug);
  log(io, "INFO", "llm_telemetry.ingest_pi", `Ingested ${totalEvents} PI session events`, args.verbose);

  const result: Record<string, unknown> = { agents, total_events: totalEvents };
  if (args.stats) {
    const stats = store.get_statistics();
    result["statistics"] = stats;
    log(io, "INFO", "llm_telemetry.ingest_pi", `Store statistics: ${dumpsIndent(stats)}`, args.verbose);
  }
  io.out(dumpsIndent(result));
  return 0;
}
