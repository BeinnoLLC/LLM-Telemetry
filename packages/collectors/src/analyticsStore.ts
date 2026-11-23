/** Durable standalone analytics store — T-18 (LLMTELEMET-289), RUN 1.
 *
 * Faithful port of `src/llm_telemetry/analytics_store.py`: the same enums,
 * RawEvent shape, schema DDL (byte for byte, so sqlite_master matches),
 * insert/query statements, parameter order and Python JSON payload encoding.
 * Runs on the built-in `node:sqlite` DatabaseSync — no new dependencies.
 *
 * The Python module is the spec. Differences that matter:
 * - `json.dumps` defaults (", " / ": ", ensure_ascii, insertion order) come
 *   from `pyDumps`; `json.loads` and its integral-float distinction come from
 *   `parsePy` (both in pyJson.ts).
 * - `datetime.now().timestamp()` has microsecond resolution; use the epoch
 *   aligned high-resolution clock rather than Date.now()'s milliseconds.
 * - SQLite constraint failures are IntegrityError in Python; node:sqlite
 *   reports them as ERR_SQLITE_ERROR with a "constraint failed" message.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parsePy, pyDumps } from "./pyJson.js";
import { tuples } from "./sqliteUtil.js";

export const DEFAULT_DB_PATH = "~/.local/share/llm-telemetry/analytics.db";

/** Origin of the event: Hermes profile, PI agent, or external. */
export enum EventSource {
  HERMES = "hermes",
  PI = "pi",
  EXTERNAL = "external",
}

/** Type of event being recorded. */
export enum EventType {
  SESSION_START = "session_start",
  SESSION_END = "session_end",
  TOOL_CALL = "tool_call",
  SUBAGENT_SPAWN = "subagent_spawn",
  CROSS_PROFILE_CALL = "cross_profile_call",
  HERMES_PI_TRIGGER = "hermes_pi_trigger",
  PI_PI_TRIGGER = "pi_pi_trigger",
  MODEL_SELECTION = "model_selection",
  ERROR = "error",
  HEARTBEAT = "heartbeat",
}

/** A single raw event from any agent source. */
export interface RawEvent {
  source: EventSource;
  profile_or_agent: string;
  session_id: string;
  timestamp: number;
  event_type: EventType;
  payload: Record<string, unknown>;
  workspace_id?: string | null;
}

export interface RawEventRow {
  id: number;
  source: string;
  profile_or_agent: string;
  session_id: string;
  timestamp: number;
  event_type: string;
  payload: unknown;
  workspace_id: string | null;
  created_at: number;
}

export interface OrchestrationEdgeRow {
  id: number;
  timestamp: number;
  trigger_source: string;
  trigger_profile_or_agent: string;
  trigger_session_id: string;
  triggered_target: string;
  triggered_agent_or_profile: string | null;
  signal_type: string;
  payload: unknown;
  created_at: number;
}

export interface AnalyticsStatistics {
  total_events: number;
  events_by_source: Record<string, number>;
  events_by_type: Record<string, number>;
  total_orchestration_edges: number;
  orchestration_by_type: Record<string, number>;
  db_path: string;
}

// These strings are copied from analytics_store.py verbatim, including the
// leading newline, indentation and trailing spaces. SQLite stores the CREATE
// statement text in sqlite_master, so any reformatting breaks schema parity.
const CREATE_RAW_EVENTS = `
            CREATE TABLE IF NOT EXISTS raw_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source TEXT NOT NULL,
                profile_or_agent TEXT NOT NULL,
                session_id TEXT NOT NULL,
                timestamp REAL NOT NULL,
                event_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                workspace_id TEXT,
                created_at REAL NOT NULL,
                UNIQUE (source, profile_or_agent, session_id, timestamp, event_type)
            )
        `;

const CREATE_ORCHESTRATION_EDGES = `
            CREATE TABLE IF NOT EXISTS orchestration_edges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp REAL NOT NULL,
                trigger_source TEXT NOT NULL,
                trigger_profile_or_agent TEXT NOT NULL,
                trigger_session_id TEXT NOT NULL,
                triggered_target TEXT NOT NULL,
                triggered_agent_or_profile TEXT,
                signal_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at REAL NOT NULL,
                UNIQUE (trigger_source, trigger_profile_or_agent, trigger_session_id,
                        triggered_target, triggered_agent_or_profile, timestamp)
            )
        `;

const CREATE_IDX_SOURCE_PROFILE = `
            CREATE INDEX IF NOT EXISTS idx_raw_events_source_profile
            ON raw_events (source, profile_or_agent)
        `;
const CREATE_IDX_SESSION_TIMESTAMP = `
            CREATE INDEX IF NOT EXISTS idx_raw_events_session_timestamp
            ON raw_events (session_id, timestamp)
        `;
const CREATE_IDX_EVENT_TYPE = `
            CREATE INDEX IF NOT EXISTS idx_raw_events_event_type
            ON raw_events (event_type)
        `;
const CREATE_IDX_EDGE_TIMESTAMP = `
            CREATE INDEX IF NOT EXISTS idx_orchestration_edges_timestamp
            ON orchestration_edges (timestamp)
        `;
const CREATE_IDX_EDGE_TRIGGER = `
            CREATE INDEX IF NOT EXISTS idx_orchestration_edges_trigger
            ON orchestration_edges (trigger_source, trigger_profile_or_agent)
        `;

const INSERT_EVENT = `
                INSERT INTO raw_events
                (source, profile_or_agent, session_id, timestamp, event_type, payload, workspace_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;

const INSERT_EDGE = `
                INSERT INTO orchestration_edges
                (timestamp, trigger_source, trigger_profile_or_agent, trigger_session_id,
                 triggered_target, triggered_agent_or_profile, signal_type, payload, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

/** `Path(db_path).expanduser()` — only `~` and `~/…` (the Python docstring's
 * claim about env vars is not what expanduser actually does). */
function expandUser(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return join(os.homedir(), p.slice(2));
  return p;
}

/** `Path(...).resolve()`: absolute, symlinks resolved even for a path whose
 * final component (or a parent) does not exist yet. */
function resolvePath(p: string): string {
  const abs = resolve(expandUser(p));
  const tail: string[] = [];
  let cursor = abs;
  for (;;) {
    try {
      const head = fs.realpathSync(cursor);
      return tail.length === 0 ? head : join(head, ...tail.reverse());
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT" || dirname(cursor) === cursor) return abs;
      tail.push(basename(cursor));
      cursor = dirname(cursor);
    }
  }
}

/** Python treats every sqlite3.IntegrityError as a duplicate and returns -1. */
function isConstraintError(err: unknown): boolean {
  return err instanceof Error && /constraint failed/i.test(err.message);
}

/** `datetime.now().timestamp()` — epoch seconds at microsecond resolution. */
function nowSeconds(): number {
  return (performance.timeOrigin + performance.now()) / 1000;
}

function rowId(result: { lastInsertRowid: number | bigint }): number {
  return typeof result.lastInsertRowid === "bigint"
    ? Number(result.lastInsertRowid)
    : result.lastInsertRowid;
}

/** Standalone SQLite database for raw telemetry and orchestration signals. */
export class AnalyticsStore {
  readonly dbPath: string;
  private con: DatabaseSync | null = null;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    this.dbPath = resolvePath(dbPath);
    fs.mkdirSync(dirname(this.dbPath), { recursive: true });
    this.initSchema();
  }

  /** Python attribute name, kept for consumers mirroring the Python API. */
  get db_path(): string {
    return this.dbPath;
  }

  /** Python's thread-local connection is one per store here: node:sqlite is
   * synchronous and a closed connection is reopened lazily. */
  private connection(): DatabaseSync {
    if (this.con === null) this.con = new DatabaseSync(this.dbPath);
    return this.con;
  }

  private initSchema(): void {
    const con = this.connection();
    for (const ddl of [
      CREATE_RAW_EVENTS,
      CREATE_ORCHESTRATION_EDGES,
      CREATE_IDX_SOURCE_PROFILE,
      CREATE_IDX_SESSION_TIMESTAMP,
      CREATE_IDX_EVENT_TYPE,
      CREATE_IDX_EDGE_TIMESTAMP,
      CREATE_IDX_EDGE_TRIGGER,
    ]) {
      con.prepare(ddl).run();
    }
  }

  /** Write a raw event. Returns the row id, or -1 for a duplicate. */
  writeEvent(event: RawEvent): number {
    const now = nowSeconds();
    try {
      const r = this.connection().prepare(INSERT_EVENT).run(
        event.source,
        event.profile_or_agent,
        event.session_id,
        event.timestamp,
        event.event_type,
        pyDumps(event.payload),
        event.workspace_id ?? null,
        now,
      );
      return rowId(r);
    } catch (err) {
      if (isConstraintError(err)) return -1;
      throw err;
    }
  }

  /** Record a detected agent-triggers-agent relationship; -1 on duplicate.
   * A NULL triggered_agent_or_profile is never a duplicate in SQLite (NULLs
   * are distinct in UNIQUE constraints) — Python behaves the same way. */
  writeOrchestrationEdge(
    timestamp: number,
    triggerSource: EventSource,
    triggerProfileOrAgent: string,
    triggerSessionId: string,
    triggeredTarget: string,
    triggeredAgentOrProfile: string | null = null,
    signalType: string = "unknown",
    payload: Record<string, unknown> | null = null,
  ): number {
    const now = nowSeconds();
    try {
      const r = this.connection().prepare(INSERT_EDGE).run(
        timestamp,
        triggerSource,
        triggerProfileOrAgent,
        triggerSessionId,
        triggeredTarget,
        triggeredAgentOrProfile,
        signalType,
        pyDumps(payload ?? {}),
        now,
      );
      return rowId(r);
    } catch (err) {
      if (isConstraintError(err)) return -1;
      throw err;
    }
  }

  /** Query raw events with optional filters, newest timestamp first. */
  getRawEvents(
    source?: EventSource | null,
    profileOrAgent?: string | null,
    eventType?: EventType | null,
    sessionId?: string | null,
    sinceTimestamp?: number | null,
    limit: number = 1000,
  ): RawEventRow[] {
    let query = "SELECT * FROM raw_events WHERE 1=1";
    const params: (string | number | null)[] = [];
    if (source) {
      query += " AND source = ?";
      params.push(source);
    }
    if (profileOrAgent) {
      query += " AND profile_or_agent = ?";
      params.push(profileOrAgent);
    }
    if (eventType) {
      query += " AND event_type = ?";
      params.push(eventType);
    }
    if (sessionId) {
      query += " AND session_id = ?";
      params.push(sessionId);
    }
    if (sinceTimestamp !== undefined && sinceTimestamp !== null) {
      query += " AND timestamp >= ?";
      params.push(sinceTimestamp);
    }
    query += " ORDER BY timestamp DESC LIMIT ?";
    params.push(limit);

    const rows = this.connection().prepare(query).all(...params) as unknown as Record<string, unknown>[];
    return rows.map((r) => ({
      id: Number(r["id"]),
      source: String(r["source"]),
      profile_or_agent: String(r["profile_or_agent"]),
      session_id: String(r["session_id"]),
      timestamp: Number(r["timestamp"]),
      event_type: String(r["event_type"]),
      payload: parsePy(String(r["payload"])),
      workspace_id: r["workspace_id"] === null ? null : String(r["workspace_id"]),
      created_at: Number(r["created_at"]),
    }));
  }

  /** Query orchestration edges with optional filters, newest first. */
  getOrchestrationEdges(
    triggerSource?: EventSource | null,
    triggerProfileOrAgent?: string | null,
    signalType?: string | null,
    sinceTimestamp?: number | null,
    limit: number = 1000,
  ): OrchestrationEdgeRow[] {
    let query = "SELECT * FROM orchestration_edges WHERE 1=1";
    const params: (string | number | null)[] = [];
    if (triggerSource) {
      query += " AND trigger_source = ?";
      params.push(triggerSource);
    }
    if (triggerProfileOrAgent) {
      query += " AND trigger_profile_or_agent = ?";
      params.push(triggerProfileOrAgent);
    }
    if (signalType) {
      query += " AND signal_type = ?";
      params.push(signalType);
    }
    if (sinceTimestamp !== undefined && sinceTimestamp !== null) {
      query += " AND timestamp >= ?";
      params.push(sinceTimestamp);
    }
    query += " ORDER BY timestamp DESC LIMIT ?";
    params.push(limit);

    const rows = this.connection().prepare(query).all(...params) as unknown as Record<string, unknown>[];
    return rows.map((r) => ({
      id: Number(r["id"]),
      timestamp: Number(r["timestamp"]),
      trigger_source: String(r["trigger_source"]),
      trigger_profile_or_agent: String(r["trigger_profile_or_agent"]),
      trigger_session_id: String(r["trigger_session_id"]),
      triggered_target: String(r["triggered_target"]),
      triggered_agent_or_profile: r["triggered_agent_or_profile"] === null
        ? null
        : String(r["triggered_agent_or_profile"]),
      signal_type: String(r["signal_type"]),
      payload: parsePy(String(r["payload"])),
      created_at: Number(r["created_at"]),
    }));
  }

  /** Aggregate counts and the resolved database path. */
  getStatistics(): AnalyticsStatistics {
    const con = this.connection();
    const grouped = (sql: string): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const [key, count] of tuples(con, sql)) {
        out[String(key)] = Number(count);
      }
      return out;
    };
    const total = (sql: string): number => {
      const row = con.prepare(sql).get() as Record<string, unknown>;
      return Number(row["count"]);
    };
    return {
      total_events: total("SELECT COUNT(*) as count FROM raw_events"),
      events_by_source: grouped(`
            SELECT source, COUNT(*) as count
            FROM raw_events
            GROUP BY source
        `),
      events_by_type: grouped(`
            SELECT event_type, COUNT(*) as count
            FROM raw_events
            GROUP BY event_type
        `),
      total_orchestration_edges: total("SELECT COUNT(*) as count FROM orchestration_edges"),
      orchestration_by_type: grouped(`
            SELECT signal_type, COUNT(*) as count
            FROM orchestration_edges
            GROUP BY signal_type
        `),
      db_path: this.dbPath,
    };
  }

  /** Close the connection; the next call reopens it, like Python's close(). */
  close(): void {
    if (this.con !== null) {
      this.con.close();
      this.con = null;
    }
  }

  // Python-named aliases: the Python module is the spec for RUN 2's ingest
  // ports, which mirror its call sites; camelCase is the repo's TS convention.
  write_event(event: RawEvent): number { return this.writeEvent(event); }
  write_orchestration_edge(
    timestamp: number,
    triggerSource: EventSource,
    triggerProfileOrAgent: string,
    triggerSessionId: string,
    triggeredTarget: string,
    triggeredAgentOrProfile: string | null = null,
    signalType: string = "unknown",
    payload: Record<string, unknown> | null = null,
  ): number {
    return this.writeOrchestrationEdge(
      timestamp, triggerSource, triggerProfileOrAgent, triggerSessionId,
      triggeredTarget, triggeredAgentOrProfile, signalType, payload,
    );
  }
  get_raw_events(
    source?: EventSource | null,
    profileOrAgent?: string | null,
    eventType?: EventType | null,
    sessionId?: string | null,
    sinceTimestamp?: number | null,
    limit: number = 1000,
  ): RawEventRow[] {
    return this.getRawEvents(source, profileOrAgent, eventType, sessionId, sinceTimestamp, limit);
  }
  get_orchestration_edges(
    triggerSource?: EventSource | null,
    triggerProfileOrAgent?: string | null,
    signalType?: string | null,
    sinceTimestamp?: number | null,
    limit: number = 1000,
  ): OrchestrationEdgeRow[] {
    return this.getOrchestrationEdges(triggerSource, triggerProfileOrAgent, signalType, sinceTimestamp, limit);
  }
  get_statistics(): AnalyticsStatistics { return this.getStatistics(); }
}

/** Global singleton store (first path wins, as in Python's get_store). */
let store: AnalyticsStore | null = null;

export function getStore(dbPath: string = DEFAULT_DB_PATH): AnalyticsStore {
  if (store === null) store = new AnalyticsStore(dbPath);
  return store;
}

export const get_store = getStore;
