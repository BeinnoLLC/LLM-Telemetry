/** Hermes profile ingest — T-18 (LLMTELEMET-289), RUN 2b.
 *
 * Faithful port of `src/llm_telemetry/collect_hermes_profiles.py`: profile
 * discovery, session-row parsing, event writing and the two orchestration
 * signals read from `session_model_usage`. Profile state databases are opened
 * read-only with the built-in `node:sqlite`.
 *
 * Python is the spec. The details that matter for row-for-row parity are the
 * `SELECT * FROM sessions ORDER BY started_at DESC LIMIT 1000` row order,
 * Python truthiness for `or` fallbacks, `int()`/`float()` conversion failures
 * (which skip a row), the overwritten `total_tokens` calculation, and the
 * event/orchestration edge insertion order.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  AnalyticsStore,
  EventSource,
  EventType,
  getStore,
  type RawEvent,
} from "./analyticsStore.js";
import { PyFloat } from "./pyJson.js";
import { cmpStr } from "./pySort.js";

/** Parsed Hermes session metadata from state.db. */
export interface HermesSession {
  profile_name: string;
  session_id: string;
  timestamp: number;
  workspace_id: string | null;
  model: string | null;
  provider: string | null;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  total_cost: number;
  message_count: number;
  tool_calls: number;
  errors: number;
}

/** Optional sinks for the Python module logger's messages. */
export interface HermesIngestLog {
  debug?: (message: string) => void;
  info?: (message: string) => void;
  warning?: (message: string) => void;
}

type Row = Record<string, unknown>;

/** `Path.home()`: POSIX Python reads HOME even when it is set to empty. */
function homeDir(): string {
  const home = process.env["HOME"];
  return home === undefined ? os.homedir() : home;
}

function hermesHome(): string {
  return join(homeDir(), ".hermes");
}

function exists(p: string): boolean {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Python truthiness, for `x or y` fallbacks and `if row[key]:`. */
function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  if (typeof v === "number" && Number.isNaN(v)) return true;
  return true;
}

/** Python `or`: first truthy operand, else the last one. */
function pyOr<T>(left: unknown, right: T): unknown {
  return pyTruthy(left) ? left : right;
}

function asText(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

/** Python `int(value)` for SQLite values: truncate a real, parse a decimal
 * string (including surrounding whitespace and digit separators). Invalid
 * input throws, which the caller turns into a skipped row. */
function pyInt(value: unknown): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ValueError("cannot convert float to integer");
    return Math.trunc(value);
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const text = value.trim().replaceAll("_", "");
    if (!/^[+-]?\d+$/.test(text)) {
      throw new ValueError(`invalid literal for int() with base 10: '${value}'`);
    }
    const n = Number(text);
    if (!Number.isFinite(n)) throw new ValueError(`int too large: ${value}`);
    return n;
  }
  throw new TypeError(`int() argument must be a string or a number, not '${typeof value}'`);
}

/** Python `float(value)` for SQLite values. */
function pyFloat(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const text = value.trim().replaceAll("_", "");
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/i.test(text)) {
      throw new ValueError(`could not convert string to float: '${value}'`);
    }
    return Number(text);
  }
  throw new TypeError(`float() argument must be a string or a number, not '${typeof value}'`);
}

class ValueError extends Error {}

/** `datetime.now(timezone.utc).timestamp()`, at microsecond resolution. */
function nowSeconds(): number {
  return (performance.timeOrigin + performance.now()) / 1000;
}

// datetime.fromisoformat, limited to the forms a session timestamp can take:
// YYYY-MM-DD[T ]HH:MM[:SS[.ffffff]][+HH[:MM[:SS[.ffffff]]]], plus date-only.
const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,6}))?)?)?(?:([+-])(\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,](\d{1,6}))?)?)?)?$/;

/** `datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()`.
 * Returns null when Python would raise ValueError/TypeError. Date.parse()
 * truncates microseconds, so the components are converted here instead. */
function isoToUnix(text: string): number | null {
  const m = ISO_RE.exec(text.replaceAll("Z", "+00:00"));
  if (m === null) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = m[4] === undefined ? 0 : Number(m[4]);
  const minute = m[5] === undefined ? 0 : Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const micro = m[7] === undefined ? 0 : Number(m[7]!.padEnd(6, "0"));
  if (year < 1 || month < 1 || month > 12 || day < 1 ||
      day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
      hour > 23 || minute > 59 || second > 59) return null;

  let tzSeconds: number;
  if (m[8] !== undefined) {
    const oh = Number(m[9]);
    const om = m[10] === undefined ? 0 : Number(m[10]);
    const os = m[11] === undefined ? 0 : Number(m[11]);
    if (oh > 23 || om > 59 || os > 59) return null;
    const magnitude = oh * 3600 + om * 60 + os;
    tzSeconds = m[8] === "-" ? -magnitude : magnitude;
  } else {
    // A naive datetime uses the system's local zone (datetime.timestamp()).
    const wall = new Date(year, month - 1, day, hour, minute, second);
    tzSeconds = -wall.getTimezoneOffset() * 60;
  }
  const wallUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return wallUtc / 1000 + micro / 1_000_000 - tzSeconds;
}

/** `sorted(profiles)` in Python: tuples compared by code point, then path. */
export function discoverHermesProfiles(): Array<[string, string]> {
  const root = hermesHome();
  const profiles: Array<[string, string]> = [];
  const defaultDb = join(root, "state.db");
  if (exists(defaultDb)) profiles.push(["default", defaultDb]);

  const profilesDir = join(root, "profiles");
  if (exists(profilesDir)) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(profilesDir, { withFileTypes: true });
    } catch {
      return profiles.sort(compareProfiles);
    }
    for (const entry of entries) {
      // Path.iterdir() includes symlinks to directories when is_dir() follows
      // them; Dirent.isDirectory() does not, so stat explicitly.
      const dir = join(profilesDir, entry.name);
      if (!isDirectory(dir)) continue;
      const stateDb = join(dir, "state.db");
      if (exists(stateDb)) profiles.push([entry.name, stateDb]);
    }
  }
  return profiles.sort(compareProfiles);
}

function compareProfiles(a: [string, string], b: [string, string]): number {
  return cmpStr(a[0], b[0]) || cmpStr(a[1], b[1]);
}

/** `_parse_hermes_session_row`: null means the row is skipped. */
export function parseHermesSessionRow(
  profileName: string,
  row: Row,
  debug?: (message: string) => void,
): HermesSession | null {
  try {
    const sessionId = pyOr(row["id"], pyOr(row["session_id"], ""));
    if (!pyTruthy(sessionId)) return null;
    const id = String(sessionId);

    let timestamp: number;
    const started = row["started_at"];
    if (pyTruthy(started)) {
      if (typeof started === "number") {
        timestamp = Number(started);
      } else {
        const parsed = isoToUnix(String(started));
        timestamp = parsed === null ? nowSeconds() : parsed;
      }
    } else {
      timestamp = nowSeconds();
    }

    const session: HermesSession = {
      profile_name: profileName,
      session_id: id,
      timestamp,
      workspace_id: asText(row["chat_id"]),
      model: asText(row["model"]),
      provider: asText(pyOr(row["billing_provider"], "unknown")),
      total_tokens: 0,
      input_tokens: 0,
      output_tokens: 0,
      total_cost: 0.0,
      message_count: 0,
      tool_calls: 0,
      errors: 0,
    };

    // Python adds the cache counters to total_tokens here but then overwrites
    // total_tokens with input + output. Keep the conversions: a bad cache
    // value still makes Python skip the whole row.
    if (pyTruthy(row["input_tokens"])) session.input_tokens = pyInt(row["input_tokens"]);
    if (pyTruthy(row["output_tokens"])) session.output_tokens = pyInt(row["output_tokens"]);
    if (pyTruthy(row["cache_read_tokens"])) session.total_tokens += pyInt(row["cache_read_tokens"]);
    if (pyTruthy(row["cache_write_tokens"])) session.total_tokens += pyInt(row["cache_write_tokens"]);
    session.total_tokens = session.input_tokens + session.output_tokens;

    if (pyTruthy(row["actual_cost_usd"])) session.total_cost = pyFloat(row["actual_cost_usd"]);
    if (pyTruthy(row["message_count"])) session.message_count = pyInt(row["message_count"]);
    if (pyTruthy(row["tool_call_count"])) session.tool_calls = pyInt(row["tool_call_count"]);
    return session;
  } catch (err) {
    // Python catches ValueError, TypeError and KeyError here, logging the
    // reason at DEBUG (visible when ingest_all.main is given --verbose).
    debug?.(`Failed to parse Hermes session row: ${errText(err)}`);
    return null;
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** node:sqlite failures (Python sqlite3.Error) and filesystem failures
 * (Python OSError) are the two exception families the Python loop catches. */
function caughtError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return code === "ERR_SQLITE_ERROR" || /sqlite/i.test(err.message) ||
    (typeof code === "string" && /^E[A-Z]+$/.test(code));
}

function isMissingTable(err: unknown, table: string): boolean {
  return err instanceof Error &&
    (err as NodeJS.ErrnoException).code === "ERR_SQLITE_ERROR" &&
    err.message.includes(`no such table: ${table}`);
}

/** `_detect_hermes_orchestration_signals`: the cursor is a read-only
 * connection to the same profile state.db, as in Python. */
export function detectHermesOrchestrationSignals(
  session: HermesSession,
  store: AnalyticsStore,
  con: DatabaseSync,
): void {
  try {
    const toolRows = con
      .prepare("SELECT * FROM session_model_usage WHERE session_id = ? LIMIT 100")
      .all(session.session_id) as Row[];
    for (const toolRow of toolRows) {
      const toolName = String(pyOr(pyOr(toolRow["tool_name"], toolRow["name"]), ""));
      const lower = toolName.toLowerCase();
      if (lower.includes("delegate") || lower.includes("subagent")) {
        store.write_orchestration_edge(
          session.timestamp,
          EventSource.HERMES,
          session.profile_name,
          session.session_id,
          "hermes:*",
          null,
          "subagent_spawn",
          { tool_name: toolName, model: session.model },
        );
      }
      if (lower.includes("profile") || lower.includes("switch")) {
        store.write_orchestration_edge(
          session.timestamp,
          EventSource.HERMES,
          session.profile_name,
          session.session_id,
          "hermes:*",
          null,
          "cross_profile_call",
          { tool_name: toolName, model: session.model },
        );
      }
    }
  } catch (err) {
    // Python swallows sqlite3.OperationalError (an older schema without the
    // table); other failures are left to ingestHermesProfiles' outer handler.
    if (!isMissingTable(err, "session_model_usage")) throw err;
  }
}

/** Port of `ingest_hermes_profiles`. Returns the number of events written. */
export function ingestHermesProfiles(
  store: AnalyticsStore | null = null,
  log: HermesIngestLog = {},
): number {
  const active = store ?? getStore();
  const profiles = discoverHermesProfiles();
  if (profiles.length === 0) {
    log.info?.("No Hermes profiles found in ~/.hermes/");
    return 0;
  }

  let totalEvents = 0;
  for (const [profileName, stateDbPath] of profiles) {
    let eventsThisProfile = 0;
    let con: DatabaseSync | null = null;
    try {
      con = new DatabaseSync(stateDbPath, { readOnly: true });
      let rows: Row[];
      try {
        rows = con.prepare(`
                    SELECT * FROM sessions
                    ORDER BY started_at DESC
                    LIMIT 1000
                `).all() as Row[];
      } catch (err) {
        if (isMissingTable(err, "sessions")) {
          log.debug?.(`No sessions table in ${profileName}: ${String((err as Error).message)}`);
          con.close();
          con = null;
          continue;
        }
        throw err;
      }

      for (const row of rows) {
        const session = parseHermesSessionRow(profileName, row, log.debug);
        if (session === null) continue;
        const event: RawEvent = {
          source: EventSource.HERMES,
          profile_or_agent: profileName,
          session_id: session.session_id,
          timestamp: session.timestamp,
          event_type: EventType.SESSION_START,
          payload: {
            workspace_id: session.workspace_id,
            model: session.model,
            provider: session.provider,
            tokens: {
              input: session.input_tokens,
              output: session.output_tokens,
              total: session.total_tokens,
            },
            cost: { total: new PyFloat(session.total_cost) },
            message_count: session.message_count,
            tool_calls: session.tool_calls,
            errors: session.errors,
          },
          workspace_id: session.workspace_id,
        };
        const rowId = active.write_event(event);
        if (rowId > 0) {
          totalEvents += 1;
          eventsThisProfile += 1;
          log.debug?.(`Ingested Hermes session ${profileName}/${session.session_id}`);
        }
        // Python runs signal detection even when the event was a duplicate.
        detectHermesOrchestrationSignals(session, active, con);
      }

      if (eventsThisProfile > 0) {
        log.info?.(`Ingested ${eventsThisProfile} sessions from ${profileName} profile`);
      }
      con.close();
      con = null;
    } catch (err) {
      if (!caughtError(err)) throw err;
      log.warning?.(`Failed to ingest from ${profileName}: ${String((err as Error).message)}`);
      continue;
    } finally {
      con?.close();
    }
  }
  return totalEvents;
}

// Python names, for consumers mirroring its call sites.
export const discover_hermes_profiles = discoverHermesProfiles;
export const ingest_hermes_profiles = ingestHermesProfiles;
export const _parse_hermes_session_row = parseHermesSessionRow;
export const _detect_hermes_orchestration_signals = detectHermesOrchestrationSignals;
