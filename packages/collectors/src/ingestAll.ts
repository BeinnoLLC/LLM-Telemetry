/** Combined PI + Hermes ingest command — T-18 (LLMTELEMET-289), RUN 2b.
 *
 * Port of `src/llm_telemetry/ingest_all.py`'s `main`, including the edge
 * resolution it delegates to `detect_orchestration.resolve_orchestration_edges`:
 * its options, default DB path, log messages, stdout JSON and exit codes.
 * Node's PI/Hermes ingest implementations are reused, not reimplemented.
 */

import * as os from "node:os";
import { join } from "node:path";
import {
  AnalyticsStore,
  DEFAULT_DB_PATH,
  EventSource,
  getStore,
} from "./analyticsStore.js";
import { discoverHermesProfiles, ingestHermesProfiles } from "./ingestHermes.js";
import { discoverPiAgents, ingestPiAgents } from "./ingestPi.js";
import { num, pyDumps } from "./pyJson.js";

/** Minimal shape shared with the collector CLI's CliIo. */
export interface IngestAllIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const stdIo: IngestAllIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

const PROG = "llm-telemetry ingest";
const USAGE = `usage: ${PROG} [-h] [--db DB] [--pi-only] [--hermes-only]\n` +
  `                            [--verbose] [--stats]`;
// Exact argparse help at the default 80-column width.
const HELP = `${USAGE}

Ingest PI and Hermes telemetry into the analytics store.

options:
  -h, --help     show this help message and exit
  --db DB        Path to analytics SQLite database (default:
                 ~/.local/share/llm-telemetry/analytics.db)
  --pi-only      Only ingest PI agents
  --hermes-only  Only ingest Hermes profiles
  --verbose, -v  Enable verbose logging
  --stats, -s    Print statistics after ingestion`;

const LONG_OPTIONS = ["--help", "--db", "--pi-only", "--hermes-only", "--verbose", "--stats"] as const;
type LongOption = (typeof LONG_OPTIONS)[number];

type Row = Record<string, unknown>;

function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

function asRow(v: unknown): Row {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
}

function pyTypeName(v: unknown): string {
  if (v === null) return "NoneType";
  if (Array.isArray(v)) return "list";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  return typeof v;
}

/** Python iteration over a truthy `payload.get("tool_calls", [])`: lists and
 * strings yield items, dicts yield keys; anything else raises TypeError. */
function pyIterate(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return Array.from(v);
  if (v !== null && typeof v === "object") return Object.keys(v as object);
  throw new TypeError(`'${pyTypeName(v)}' object is not iterable`);
}

/** Python's `tool_call.get(...)` raises AttributeError on a non-dict item. */
function toolCallRow(v: unknown): Row {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new TypeError(`'${pyTypeName(v)}' object has no attribute 'get'`);
  }
  return v as Row;
}

function snippet(text: string): string {
  return Array.from(text).slice(0, 200).join("");
}

// ---------------------------------------------------------------------------
// detect_orchestration.resolve_orchestration_edges (called by ingest_all.main)
// ---------------------------------------------------------------------------

interface OrchestrationSignal {
  timestamp: number;
  trigger_source: EventSource;
  trigger_agent: string;
  trigger_session_id: string;
  triggered_target: string;
  triggered_agent_or_profile: string | null;
  signal_type: string;
  confidence: number;
  payload: Row;
}

function signal(
  timestamp: number,
  triggerSource: EventSource,
  triggerAgent: string,
  triggeredTarget: string,
  triggeredAgentOrProfile: string | null,
  signalType: string,
  confidence: number,
  payload: Row,
): OrchestrationSignal {
  return {
    timestamp,
    trigger_source: triggerSource,
    trigger_agent: triggerAgent,
    trigger_session_id: "",
    triggered_target: triggeredTarget,
    triggered_agent_or_profile: triggeredAgentOrProfile,
    signal_type: signalType,
    confidence,
    payload,
  };
}

function isSelfLoop(source: string, target: string | null): boolean {
  if (target === null || target === "" || target === "*") return false;
  const sourceBase = source.includes(":") ? source.slice(source.lastIndexOf(":") + 1) : source;
  const targetBase = target.includes(":") ? target.slice(target.lastIndexOf(":") + 1) : target;
  return sourceBase.toLowerCase() === targetBase.toLowerCase();
}

/** `validate_and_filter_signals`: self-loops, confidence >= 0.3, stable sort
 * by timestamp, then deduplication on (source, target, signal type). */
function validateAndFilterSignals(signals: OrchestrationSignal[]): OrchestrationSignal[] {
  if (signals.length === 0) return [];
  const filtered = signals.filter((s) => !isSelfLoop(s.trigger_agent, s.triggered_agent_or_profile))
    .filter((s) => s.confidence >= 0.3);
  const sorted = [...filtered].sort((a, b) => a.timestamp - b.timestamp);
  const seen = new Set<string>();
  const deduped: OrchestrationSignal[] = [];
  for (const s of sorted) {
    const key = JSON.stringify([s.trigger_agent, s.triggered_agent_or_profile, s.signal_type]);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
  }
  return deduped;
}

const AGENT_REF_RE = /agent[_-]([\p{L}\p{N}_]+)/gu;
const AGENT_REF_RE_ONCE = /agent[_-]([\p{L}\p{N}_]+)/iu;

/** `detect_pi_cross_agent_calls`. Python's `\\w` is Unicode-aware. */
function detectPiCrossAgentCalls(events: Row[], agentName: string): OrchestrationSignal[] {
  const signals: OrchestrationSignal[] = [];
  let prevModel: unknown = null;
  for (const event of events) {
    if (event["type"] === "model_change") {
      const model = event["model"];
      if (model === null || model === undefined || typeof model !== "object" || Array.isArray(model)) {
        throw new TypeError("'NoneType' object has no attribute 'get'");
      }
      const newModel = Object.hasOwn(model as object, "id") ? (model as Row)["id"] : "";
      if (pyTruthy(prevModel) && prevModel !== newModel) {
        signals.push(signal(
          num(event["timestamp"]) ?? 0.0,
          EventSource.PI,
          agentName,
          "pi:*",
          null,
          "pi_model_change_delegation",
          0.4,
          { prev_model: prevModel, new_model: newModel },
        ));
      }
      prevModel = newModel;
    }

    if (event["type"] === "message") {
      const msg = asRow(event["message"]);
      const content = msg["content"];
      let contentText: string;
      if (typeof content === "string") {
        contentText = content;
      } else if (Array.isArray(content)) {
        const parts: string[] = [];
        for (const item of content) {
          if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
          const row = item as Row;
          const chosen = pyTruthy(row["text"]) ? row["text"] : (row["thinking"] ?? "");
          if (typeof chosen !== "string") throw new TypeError("sequence item: expected str instance");
          parts.push(chosen);
        }
        contentText = parts.join(" ");
      } else {
        continue;
      }
      for (const match of contentText.matchAll(AGENT_REF_RE)) {
        const ref = match[1] as string;
        if (ref.toLowerCase() === agentName.toLowerCase()) continue;
        const targetAgent = `agent-${ref}`;
        signals.push(signal(
          num(event["timestamp"]) ?? 0.0,
          EventSource.PI,
          agentName,
          `pi:${targetAgent}`,
          targetAgent,
          "pi_agent_reference",
          0.6,
          { content_snippet: snippet(contentText) },
        ));
      }
    }
  }
  return signals;
}

function toolNameOf(toolCall: unknown): string {
  const row = toolCallRow(toolCall);
  const first = pyTruthy(row["tool_name"]) ? row["tool_name"] : (row["name"] ?? "");
  return pyTruthy(first) ? String(first) : "";
}

/** `detect_hermes_pi_handoffs`. */
function detectHermesPiHandoffs(
  toolCalls: unknown[],
  profileName: string,
  _sessionId: string,
  timestamp: number,
): OrchestrationSignal[] {
  const signals: OrchestrationSignal[] = [];
  for (const toolCall of toolCalls) {
    const toolName = toolNameOf(toolCall);
    const lower = toolName.toLowerCase();
    if (!["pi", "agent", "delegate", "execute"].some((p) => lower.includes(p))) continue;
    let targetAgent: string | null = null;
    if (lower.includes("agent-")) {
      const match = AGENT_REF_RE_ONCE.exec(toolName);
      if (match !== null) targetAgent = `agent-${match[1] as string}`;
    }
    signals.push(signal(
      timestamp, EventSource.HERMES, profileName,
      targetAgent === null ? "pi:*" : `pi:${targetAgent}`,
      targetAgent, "hermes_pi_handoff", 0.5, { tool_name: toolName },
    ));
  }
  return signals;
}

/** `detect_hermes_subagent_spawns`. */
function detectHermesSubagentSpawns(
  toolCalls: unknown[],
  profileName: string,
  _sessionId: string,
  timestamp: number,
): OrchestrationSignal[] {
  const signals: OrchestrationSignal[] = [];
  for (const toolCall of toolCalls) {
    const toolName = toolNameOf(toolCall);
    if (!toolName.toLowerCase().includes("delegate")) continue;
    signals.push(signal(
      timestamp, EventSource.HERMES, profileName, "hermes:*", null,
      "hermes_subagent_spawn", 0.8, { tool_name: toolName },
    ));
  }
  return signals;
}

/** `detect_hermes_cross_profile_calls`. */
function detectHermesCrossProfileCalls(
  toolCalls: unknown[],
  profileName: string,
  _sessionId: string,
  timestamp: number,
): OrchestrationSignal[] {
  const signals: OrchestrationSignal[] = [];
  for (const toolCall of toolCalls) {
    const toolName = toolNameOf(toolCall);
    const lower = toolName.toLowerCase();
    if (!["profile", "switch_profile", "set_profile"].some((p) => lower.includes(p))) continue;
    signals.push(signal(
      timestamp, EventSource.HERMES, profileName, "hermes:*", null,
      "hermes_cross_profile_call", 0.7, { tool_name: toolName },
    ));
  }
  return signals;
}

interface ResolveLog {
  info: (message: string) => void;
  warning: (message: string) => void;
  error: (message: string) => void;
}

const noopLog: ResolveLog = { info: () => {}, warning: () => {}, error: () => {} };
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Port of `resolve_orchestration_edges`. Returns the number of edges written. */
export function resolveOrchestrationEdges(
  store: AnalyticsStore,
  verbose = false,
  log: ResolveLog = noopLog,
): number {
  log.info("Resolving orchestration edges from raw events...");
  const allSignals: OrchestrationSignal[] = [];

  try {
    const piBySession = new Map<string, { agent: string; timestamp: number; events: Row[] }>();
    for (const event of store.get_raw_events(EventSource.PI)) {
      const sessionId = event.session_id;
      let group = piBySession.get(sessionId);
      if (group === undefined) {
        group = { agent: event.profile_or_agent, timestamp: event.timestamp, events: [] };
        piBySession.set(sessionId, group);
      }
      group.events.push(asRow(event.payload));
    }
    for (const [sessionId, group] of piBySession) {
      const signals = detectPiCrossAgentCalls(group.events, group.agent);
      for (const s of signals) {
        s.trigger_session_id = sessionId;
        s.timestamp = group.timestamp;
      }
      allSignals.push(...signals);
    }
    if (verbose) log.info(`Detected ${allSignals.length} PI-related signals`);
  } catch (err) {
    log.warning(`Error detecting PI signals: ${errText(err)}`);
  }

  try {
    const hermesBySession = new Map<string, { profile: string; timestamp: number; payload: Row }>();
    for (const event of store.get_raw_events(EventSource.HERMES)) {
      const sessionId = event.session_id;
      let group = hermesBySession.get(sessionId);
      if (group === undefined) {
        group = { profile: event.profile_or_agent, timestamp: event.timestamp, payload: {} };
        hermesBySession.set(sessionId, group);
      }
      group.payload = asRow(event.payload);
    }
    for (const [sessionId, group] of hermesBySession) {
      const payload = group.payload;
      const rawCalls = payload["tool_calls"];
      // `if not tool_calls: tool_calls = []` in Python, then the detector
      // iterates whatever is left; a non-iterable value raises and is logged
      // as a warning by resolve_orchestration_edges (as in Python).
      const toolCalls: unknown[] = pyTruthy(rawCalls) ? pyIterate(rawCalls) : [];
      const hermesSignals = [
        ...detectHermesPiHandoffs(toolCalls, group.profile, sessionId, group.timestamp),
        ...detectHermesSubagentSpawns(toolCalls, group.profile, sessionId, group.timestamp),
        ...detectHermesCrossProfileCalls(toolCalls, group.profile, sessionId, group.timestamp),
      ];
      for (const s of hermesSignals) s.trigger_session_id = sessionId;
      allSignals.push(...hermesSignals);
    }
    if (verbose) log.info(`Detected ${allSignals.length} Hermes-related signals (cumulative)`);
  } catch (err) {
    log.warning(`Error detecting Hermes signals: ${errText(err)}`);
  }

  const validated = validateAndFilterSignals(allSignals);
  log.info(`After validation: ${validated.length} signals`);
  let written = 0;
  for (const s of validated) {
    try {
      store.write_orchestration_edge(
        s.timestamp, s.trigger_source, s.trigger_agent, s.trigger_session_id,
        s.triggered_target, s.triggered_agent_or_profile, s.signal_type, s.payload,
      );
      // Python increments even if write_orchestration_edge returned -1.
      written += 1;
    } catch (err) {
      log.error(`Error writing edge ${s.signal_type}: ${errText(err)}`);
    }
  }
  log.info(`Wrote ${written} orchestration edges`);
  return written;
}

// ---------------------------------------------------------------------------
// argparse / main
// ---------------------------------------------------------------------------

interface ParsedArgs {
  db: string;
  piOnly: boolean;
  hermesOnly: boolean;
  verbose: boolean;
  stats: boolean;
  help: boolean;
}

/** Python's long-option prefix matching, including ambiguous prefixes. */
function longOption(arg: string, io: IngestAllIo): LongOption | null | undefined {
  const name = arg.split("=", 1)[0]!;
  const hits = LONG_OPTIONS.filter((option) => option.startsWith(name));
  if (hits.length === 1) return hits[0]!;
  if (hits.length > 1) {
    argError(io, `ambiguous option: ${name} could match ${hits.join(", ")}`);
    return undefined;
  }
  return null;
}

function argError(io: IngestAllIo, message: string): null {
  io.err(`${USAGE}\n${PROG}: error: ${message}`);
  return null;
}

/** The subset of argparse used by ingest_all.main. */
function parseArgs(argv: string[], io: IngestAllIo): ParsedArgs | null {
  const parsed: ParsedArgs = {
    db: DEFAULT_DB_PATH, piOnly: false, hermesOnly: false,
    verbose: false, stats: false, help: false,
  };
  const unknown: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") { unknown.push(arg, ...argv.slice(i + 1)); break; }
    if (arg === "-h") { parsed.help = true; continue; }
    if (arg.startsWith("--")) {
      const option = longOption(arg, io);
      if (option === undefined) return null;
      const eq = arg.indexOf("=");
      const value = eq === -1 ? null : arg.slice(eq + 1);
      if (option === null) { unknown.push(arg); continue; }
      if (option === "--help") {
        if (value !== null) return argError(io, `argument -h/--help: ignored explicit argument '${value}'`);
        parsed.help = true;
      } else if (option === "--db") {
        if (value === null) {
          // argparse will not consume a following option-looking token as a
          // value (negative numbers are the exception).
          const next = argv[i + 1];
          if (next === undefined || (next.startsWith("-") && !/^-\d/.test(next))) {
            return argError(io, "argument --db: expected one argument");
          }
          parsed.db = argv[++i]!;
        } else parsed.db = value;
      } else if (option === "--pi-only" || option === "--hermes-only") {
        if (value !== null) return argError(io, `argument ${option}: ignored explicit argument '${value}'`);
        if (option === "--pi-only") parsed.piOnly = true;
        else parsed.hermesOnly = true;
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

/** `Path(args.db).expanduser()`. */
function expandUser(p: string): string {
  const home = process.env["HOME"] === undefined ? os.homedir() : process.env["HOME"]!;
  if (p === "~") return home;
  if (p.startsWith("~/")) return join(home, p.slice(2));
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

/** `logging.basicConfig` format, in local time. */
function log(io: IngestAllIo, level: "DEBUG" | "INFO" | "WARNING" | "ERROR", name: string, message: string): void {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-` +
    `${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:` +
    `${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")},` +
    String(now.getMilliseconds()).padStart(3, "0");
  io.err(`${stamp} [${level}] ${name}: ${message}`);
}

/** Port of ingest_all.main(argv): same options, stdout and exit codes. */
export function main(argv: string[] = [], io: IngestAllIo = stdIo): number {
  const args = parseArgs(argv, io);
  if (args === null) return 2;
  if (args.help) { io.out(HELP); return 0; }

  const NAME = "llm_telemetry.ingest_all";
  const say = (level: "DEBUG" | "INFO" | "WARNING" | "ERROR", name: string, message: string): void => {
    if (level === "DEBUG" && !args.verbose) return;
    log(io, level, name, message);
  };

  const dbPath = expandUser(args.db);
  const store = getStore(dbPath);
  say("INFO", NAME, `Using analytics store: ${dbPath}`);

  const piAgents: string[] = [];
  let hermesProfiles: Array<[string, string]> = [];
  let totalEvents = 0;

  if (!args.hermesOnly) {
    piAgents.push(...discoverPiAgents());
    if (piAgents.length > 0) {
      say("INFO", NAME, `Discovered ${piAgents.length} PI agents: ${piAgents.join(", ")}`);
      const debug = args.verbose
        ? (message: string) => say("DEBUG", "llm_telemetry.collect_pi_agents", message)
        : undefined;
      const piEvents = ingestPiAgents(store, debug);
      totalEvents += piEvents;
      say("INFO", NAME, `Ingested ${piEvents} PI session events`);
    } else {
      say("WARNING", NAME, "No PI agents found in ~/.pi/");
    }
  }

  if (!args.piOnly) {
    hermesProfiles = discoverHermesProfiles();
    if (hermesProfiles.length > 0) {
      say("INFO", NAME, `Discovered ${hermesProfiles.length} Hermes profiles`);
      const hermesEvents = ingestHermesProfiles(store, {
        debug: args.verbose
          ? (message: string) => say("DEBUG", "llm_telemetry.collect_hermes_profiles", message)
          : undefined,
        info: (message: string) => say("INFO", "llm_telemetry.collect_hermes_profiles", message),
        warning: (message: string) => say("WARNING", "llm_telemetry.collect_hermes_profiles", message),
      });
      totalEvents += hermesEvents;
      say("INFO", NAME, `Ingested ${hermesEvents} Hermes session events`);
    } else {
      say("WARNING", NAME, "No Hermes profiles found in ~/.hermes/");
    }
  }

  say("INFO", NAME, "Resolving orchestration edges...");
  const resolveLog: ResolveLog = {
    info: (message) => say("INFO", "llm_telemetry.detect_orchestration", message),
    warning: (message) => say("WARNING", "llm_telemetry.detect_orchestration", message),
    error: (message) => say("ERROR", "llm_telemetry.detect_orchestration", message),
  };
  const edges = resolveOrchestrationEdges(store, args.verbose, resolveLog);
  say("INFO", NAME, `Resolved ${edges} orchestration edges`);

  const result: Record<string, unknown> = {
    pi_agents: piAgents,
    hermes_profiles: hermesProfiles.map(([name]) => name),
    total_events: totalEvents,
  };
  if (args.stats) {
    const stats = store.get_statistics();
    result["statistics"] = stats;
    say("INFO", NAME, `Store statistics: ${dumpsIndent(stats)}`);
  }
  io.out(dumpsIndent(result));
  return 0;
}

export const main_ingest_all = main;
