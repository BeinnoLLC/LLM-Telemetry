/** LLMTELEMET-289 T-18 RUN 1: Node analytics store vs the Python module.
 *
 * Every expected value here is produced by the Python store or Python's
 * json module, run with the main checkout's read-only venv python and
 * PYTHONPATH pointed at THIS worktree's src. `created_at` is the only field
 * discarded when comparing rows: both runtimes stamp it with wall-clock time.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  AnalyticsStore,
  DEFAULT_DB_PATH,
  EventSource,
  EventType,
  type AnalyticsStatistics,
  type RawEvent,
} from "../../src/analyticsStore.js";
import { parsePy, pyDumps, PyFloat } from "../../src/pyJson.js";
import { makeTmpDir } from "./helpers.js";

const PYTHON = "/home/hazemhagrass/workspace/beinno/LLM-Telemtry/.venv/bin/python";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const PY_SRC = join(REPO_ROOT, "src");

const PY_IMPORTS = [
  "import sys, json, sqlite3",
  "from pathlib import Path",
  "from llm_telemetry.analytics_store import AnalyticsStore, EventSource, EventType, RawEvent, get_store",
].join("\n");

/** Run a Python snippet with `db` = argv[1] and print its `result` as JSON. */
function py(body: string, args: string[] = [], extraEnv: Record<string, string> = {}): unknown {
  if (!fs.existsSync(PYTHON)) throw new Error(`missing python oracle: ${PYTHON}`);
  const code = `${PY_IMPORTS}\ndb = sys.argv[1]\n${body}\nsys.stdout.write(json.dumps(result))\n`;
  // Some snippets (enum values) never touch `db`, but the script always has
  // an argv[1] so the same code shape works everywhere.
  const argv = args.length === 0 ? [join(PY_SRC, "unused.db")] : args;
  const res = spawnSync(PYTHON, ["-c", code, ...argv], {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, PYTHONPATH: PY_SRC, ...extraEnv },
  });
  if (res.error || res.status !== 0) {
    throw new Error(`python analytics_store oracle failed: ${String(res.error ?? res.stderr)}`);
  }
  return parsePy(res.stdout);
}

function stripCreated(rows: unknown): unknown[] {
  return (rows as Record<string, unknown>[]).map((r) => {
    const { created_at: _created, ...rest } = r;
    return rest;
  });
}

/** Both sides come from Python (via parsePy, which preserves 1.0 as PyFloat),
 * but Python sqlite REAL columns are floats while JS numbers have no int/float
 * distinction. Compare numeric VALUES here; the payload bytes are checked
 * separately and exactly above. */
function plainNumbers(v: unknown): unknown {
  if (v instanceof PyFloat) return v.value;
  if (Array.isArray(v)) return v.map(plainNumbers);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, plainNumbers(x)]),
    );
  }
  return v;
}

const WRITE_EVENTS_BODY = `
s = AnalyticsStore(db)
specs = json.loads(sys.argv[2])
result = [s.write_event(RawEvent(
    EventSource(sp["source"]), sp["profile_or_agent"], sp["session_id"],
    sp["timestamp"], EventType(sp["event_type"]), json.loads(sp["payload_text"]),
    sp["workspace_id"])) for sp in specs]
`;

const WRITE_EDGES_BODY = `
s = AnalyticsStore(db)
specs = json.loads(sys.argv[2])
ids = []
for sp in specs:
    if "signal_type" in sp:
        ids.append(s.write_orchestration_edge(
            sp["timestamp"], EventSource(sp["trigger_source"]),
            sp["trigger_profile_or_agent"], sp["trigger_session_id"],
            sp["triggered_target"], sp["triggered_agent_or_profile"],
            sp["signal_type"], json.loads(sp["payload_text"])))
    else:
        ids.append(s.write_orchestration_edge(
            sp["timestamp"], EventSource(sp["trigger_source"]),
            sp["trigger_profile_or_agent"], sp["trigger_session_id"],
            sp["triggered_target"]))
result = ids
`;

interface EventSpec {
  source: string;
  profile_or_agent: string;
  session_id: string;
  timestamp: number;
  event_type: string;
  payload_text: string;
  workspace_id: string | null;
}

interface EdgeSpec {
  timestamp: number;
  trigger_source: string;
  trigger_profile_or_agent: string;
  trigger_session_id: string;
  triggered_target: string;
  triggered_agent_or_profile?: string | null;
  signal_type?: string;
  payload_text?: string;
}

const EVENT_SPECS: EventSpec[] = [
  {
    source: "hermes", profile_or_agent: "hazem", session_id: "s-1", timestamp: 1000.5,
    event_type: "session_start", workspace_id: "ws-1",
    payload_text: `{"cost":1.0,"name":"héllo 🎉","nested":{"a":[1,true,false,null]},"ratio":0.125}`,
  },
  {
    source: "pi", profile_or_agent: "agent-pv", session_id: "s-1", timestamp: 1001.25,
    event_type: "tool_call", workspace_id: null,
    payload_text: `{"tool":"terminal","quoted":"a\\"b\\nc","empty":{},"list":[2,3]}`,
  },
  {
    source: "external", profile_or_agent: "cron", session_id: "s-2", timestamp: 2000,
    event_type: "heartbeat", workspace_id: null,
    payload_text: `{"ok":true,"bad":NaN,"inf":Infinity,"neg":-Infinity}`,
  },
  {
    source: "hermes", profile_or_agent: "hazem", session_id: "s-3", timestamp: 3000.75,
    event_type: "error", workspace_id: "ws-2",
    payload_text: `{"msg":"oops"}`,
  },
];

const EDGE_SPECS: EdgeSpec[] = [
  {
    timestamp: 5000.25, trigger_source: "hermes", trigger_profile_or_agent: "hazem",
    trigger_session_id: "s-1", triggered_target: "pi:agent-pv",
    triggered_agent_or_profile: "agent-pv", signal_type: "delegate_task",
    payload_text: `{"tokens":123}`,
  },
  {
    timestamp: 6000, trigger_source: "pi", trigger_profile_or_agent: "agent-pv",
    trigger_session_id: "s-2", triggered_target: "hermes:research",
    triggered_agent_or_profile: null, signal_type: "hermes_pi_trigger",
    payload_text: `{"cost":2.0,"note":"héllo"}`,
  },
  {
    timestamp: 7000.5, trigger_source: "external", trigger_profile_or_agent: "cron",
    trigger_session_id: "s-3", triggered_target: "pi:agent-x",
    triggered_agent_or_profile: "agent-x", signal_type: "unknown",
    payload_text: `{}`,
  },
  // Defaults omitted: Python writes signal_type "unknown" and payload "{}".
  {
    timestamp: 8000, trigger_source: "pi", trigger_profile_or_agent: "agent-pv",
    trigger_session_id: "s-4", triggered_target: "hermes:review",
  },
];

const sourceOf = (v: string): EventSource =>
  Object.values(EventSource).find((x) => x === v) as EventSource;
const typeOf = (v: string): EventType =>
  Object.values(EventType).find((x) => x === v) as EventType;

function toEvent(sp: EventSpec): RawEvent {
  return {
    source: sourceOf(sp.source),
    profile_or_agent: sp.profile_or_agent,
    session_id: sp.session_id,
    timestamp: sp.timestamp,
    event_type: typeOf(sp.event_type),
    payload: parsePy(sp.payload_text) as Record<string, unknown>,
    workspace_id: sp.workspace_id,
  };
}

function writeEdge(store: AnalyticsStore, sp: EdgeSpec): number {
  if (sp.signal_type === undefined) {
    return store.writeOrchestrationEdge(
      sp.timestamp, sourceOf(sp.trigger_source), sp.trigger_profile_or_agent,
      sp.trigger_session_id, sp.triggered_target,
    );
  }
  return store.writeOrchestrationEdge(
    sp.timestamp, sourceOf(sp.trigger_source), sp.trigger_profile_or_agent,
    sp.trigger_session_id, sp.triggered_target,
    sp.triggered_agent_or_profile ?? null, sp.signal_type,
    parsePy(sp.payload_text ?? "{}") as Record<string, unknown>,
  );
}

type RawFilter = Parameters<AnalyticsStore["getRawEvents"]>;
type EdgeFilter = Parameters<AnalyticsStore["getOrchestrationEdges"]>;

let dir: string;
let nodeDb: string;
let pyDb: string;
let nodeStore: AnalyticsStore;
let nodeEventIds: number[];
let nodeEdgeIds: number[];

beforeAll(() => {
  dir = makeTmpDir("analytics-store-");
  nodeDb = join(dir, "node.db");
  pyDb = join(dir, "python.db");
  fs.mkdirSync(dirname(pyDb), { recursive: true });
  nodeStore = new AnalyticsStore(nodeDb);
  nodeEventIds = EVENT_SPECS.map((sp) => nodeStore.writeEvent(toEvent(sp)));
  nodeEdgeIds = EDGE_SPECS.map((sp) => writeEdge(nodeStore, sp));
  py(WRITE_EVENTS_BODY, [pyDb, JSON.stringify(EVENT_SPECS)]);
  py(WRITE_EDGES_BODY, [pyDb, JSON.stringify(EDGE_SPECS)]);
});

afterAll(() => {
  nodeStore?.close();
});

describe("analytics store port (Python is the spec)", () => {
  it("exposes the Python enum values", () => {
    const want = py(`result = {
      "source": {m.name: m.value for m in EventSource},
      "event": {m.name: m.value for m in EventType},
    }`) as Record<string, Record<string, string>>;
    expect({ source: { ...EventSource }, event: { ...EventType } }).toEqual(want);
    expect(DEFAULT_DB_PATH).toBe("~/.local/share/llm-telemetry/analytics.db");
  });

  it("creates byte-identical sqlite_master DDL", () => {
    const nDb = join(dir, "node-schema.db");
    const pDb = join(dir, "python-schema.db");
    fs.mkdirSync(dirname(pDb), { recursive: true });
    const n = new AnalyticsStore(nDb);
    n.close();
    const want = py(`
s = AnalyticsStore(db)
s.close()
con = sqlite3.connect(db)
result = con.execute("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").fetchall()
`, [pDb]);
    const con = new DatabaseSync(nDb, { readOnly: true });
    try {
      const got = con.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")
        .all().map((r) => [r["type"], r["name"], r["sql"]]);
      expect(got).toEqual(want);
      expect(got).toHaveLength((want as unknown[]).length);
    } finally {
      con.close();
    }
  });

  it("serialises payloads exactly like Python json.dumps", () => {
    const want = py(`result = [json.dumps(json.loads(t)) for t in json.loads(sys.argv[2])]`,
      [pyDb, JSON.stringify(EVENT_SPECS.map((s) => s.payload_text))]);
    const got = EVENT_SPECS.map((s) => pyDumps(parsePy(s.payload_text)));
    expect(got).toEqual(want);
  });

  it("inserts events with Python's ids and payload bytes", () => {
    const ids = py(WRITE_EVENTS_BODY, [join(dir, "python-ids.db"), JSON.stringify(EVENT_SPECS)]);
    expect(nodeEventIds).toEqual(ids);
    const want = py(`con = sqlite3.connect(db)
result = [r[0] for r in con.execute("SELECT payload FROM raw_events ORDER BY id")]`, [pyDb]);
    const con = new DatabaseSync(nodeDb, { readOnly: true });
    try {
      const got = con.prepare("SELECT payload FROM raw_events ORDER BY id")
        .all().map((r) => r["payload"]);
      expect(got).toEqual(want);
    } finally {
      con.close();
    }
    const first = nodeStore.getRawEvents().find((r) => r.session_id === "s-1" &&
      r.event_type === "session_start") as { created_at: number; payload: Record<string, unknown> };
    expect(first.created_at).toBeGreaterThan(Date.now() / 1000 - 3600);
    expect(first.created_at).toBeLessThan(Date.now() / 1000 + 60);
    expect(first.payload["cost"]).toBeInstanceOf(PyFloat); // Python json.loads keeps 1.0 a float
  });

  it("matches every get_raw_events filter", () => {
    const want = py(`
s = AnalyticsStore(db)
def strip(rows):
    for r in rows:
        del r["created_at"]
    return rows
filters = [
    {},
    {"source": EventSource.PI},
    {"profile_or_agent": "hazem"},
    {"event_type": EventType.TOOL_CALL},
    {"session_id": "s-1"},
    {"since_timestamp": 0},
    {"since_timestamp": 2000.0},
    {"limit": 2},
]
result = [strip(s.get_raw_events(**f)) for f in filters]
`, [pyDb]);
    const filters: RawFilter[] = [
      [],
      [EventSource.PI],
      [undefined, "hazem"],
      [undefined, undefined, EventType.TOOL_CALL],
      [undefined, undefined, undefined, "s-1"],
      [undefined, undefined, undefined, undefined, 0],
      [undefined, undefined, undefined, undefined, 2000],
      [undefined, undefined, undefined, undefined, undefined, 2],
    ];
    const got = filters.map((f) => stripCreated(nodeStore.getRawEvents(...f)));
    expect(got.map(plainNumbers)).toEqual(plainNumbers(want));
  });

  it("returns -1 for a duplicate raw event (Python silently skips it)", () => {
    const dup = JSON.stringify([EVENT_SPECS[0] as EventSpec]);
    const want = py(WRITE_EVENTS_BODY, [pyDb, dup]) as number[];
    const got = nodeStore.writeEvent(toEvent(EVENT_SPECS[0] as EventSpec));
    expect(got).toBe(-1);
    expect(got).toBe(want[0]);
    expect(nodeStore.getRawEvents().filter((r) => r.session_id === "s-1" &&
      r.event_type === "session_start")).toHaveLength(1);
  });

  it("inserts orchestration edges with Python's ids and defaults", () => {
    const ids = py(WRITE_EDGES_BODY, [join(dir, "python-edge-ids.db"), JSON.stringify(EDGE_SPECS)]);
    expect(nodeEdgeIds).toEqual(ids);
    const want = py(`con = sqlite3.connect(db)
result = [r[0] for r in con.execute("SELECT payload FROM orchestration_edges ORDER BY id")]`, [pyDb]);
    const con = new DatabaseSync(nodeDb, { readOnly: true });
    try {
      const got = con.prepare("SELECT payload FROM orchestration_edges ORDER BY id")
        .all().map((r) => r["payload"]);
      expect(got).toEqual(want);
    } finally {
      con.close();
    }
    const defaultEdge = nodeStore.getOrchestrationEdges()[0] as {
      signal_type: string; payload: Record<string, unknown>;
    };
    expect(defaultEdge.signal_type).toBe("unknown");
    expect(defaultEdge.payload).toEqual({});
  });

  it("matches every get_orchestration_edges filter", () => {
    const want = py(`
s = AnalyticsStore(db)
def strip(rows):
    for r in rows:
        del r["created_at"]
    return rows
filters = [
    {},
    {"trigger_source": EventSource.PI},
    {"trigger_profile_or_agent": "hazem"},
    {"signal_type": "delegate_task"},
    {"since_timestamp": 0},
    {"since_timestamp": 6000.0},
    {"limit": 2},
]
result = [strip(s.get_orchestration_edges(**f)) for f in filters]
`, [pyDb]);
    const filters: EdgeFilter[] = [
      [],
      [EventSource.PI],
      [undefined, "hazem"],
      [undefined, undefined, "delegate_task"],
      [undefined, undefined, undefined, 0],
      [undefined, undefined, undefined, 6000],
      [undefined, undefined, undefined, undefined, 2],
    ];
    const got = filters.map((f) => stripCreated(nodeStore.getOrchestrationEdges(...f)));
    expect(got.map(plainNumbers)).toEqual(plainNumbers(want));
  });

  it("matches Python duplicate-edge semantics, including NULL targets", () => {
    const withTarget = EDGE_SPECS[0] as EdgeSpec;
    const wantDup = py(WRITE_EDGES_BODY, [pyDb, JSON.stringify([withTarget])]) as number[];
    const gotDup = writeEdge(nodeStore, withTarget);
    expect(gotDup).toBe(-1);
    expect(gotDup).toBe(wantDup[0]);

    // UNIQUE treats NULLs as distinct: Python inserts another edge here.
    const nullTarget = EDGE_SPECS[1] as EdgeSpec;
    const wantNull = py(WRITE_EDGES_BODY, [pyDb, JSON.stringify([nullTarget])]) as number[];
    const gotNull = writeEdge(nodeStore, nullTarget);
    expect(gotNull).toBeGreaterThan(0);
    expect(gotNull).toBe(wantNull[0]);
  });

  it("returns Python's statistics, including the resolved db path", () => {
    const want = py(`s = AnalyticsStore(db)
result = {"stats": s.get_statistics(), "resolved": str(Path(db).expanduser().resolve())}`, [pyDb]) as {
      stats: AnalyticsStatistics; resolved: string;
    };
    const got = nodeStore.getStatistics();
    expect(nodeStore.dbPath).toBe(py(`result = str(Path(db).expanduser().resolve())`, [nodeDb]));
    expect(got.db_path).toBe(nodeStore.dbPath);
    expect({ ...got, db_path: "<db>" }).toEqual({ ...want.stats, db_path: "<db>" });
    expect(want.resolved).toBe(pyDb);
  });

  it("reopens the connection after close, like Python's close()", () => {
    const before = nodeStore.getStatistics().total_events;
    nodeStore.close();
    expect(nodeStore.getStatistics().total_events).toBe(before);
    expect(nodeStore.getRawEvents()).toHaveLength(before);
  });
});

describe("getStore singleton", () => {
  it("uses the Python default path and ignores later paths", async () => {
    const home = fs.realpathSync(makeTmpDir("analytics-home-"));
    const wantDefault = py(`result = str(AnalyticsStore().db_path)`, [join(home, "unused.db")], { HOME: home });
    const wantTilde = py(`s = AnalyticsStore("~/custom/analytics.db")
result = str(s.db_path)`, [join(home, "unused.db")], { HOME: home });

    const oldHome = process.env.HOME;
    process.env.HOME = home;
    vi.resetModules();
    try {
      const mod = await import("../../src/analyticsStore.js");
      expect(mod.DEFAULT_DB_PATH).toBe(DEFAULT_DB_PATH);
      const first = mod.getStore();
      expect(first.dbPath).toBe(wantDefault);
      expect(first.dbPath).toBe(join(home, ".local/share/llm-telemetry/analytics.db"));
      expect(fs.existsSync(first.dbPath)).toBe(true);
      const second = mod.getStore(join(home, "ignored.db"));
      expect(second).toBe(first);

      const custom = new mod.AnalyticsStore("~/custom/analytics.db");
      expect(custom.dbPath).toBe(wantTilde);
      expect(fs.existsSync(custom.dbPath)).toBe(true);
      custom.close();
    } finally {
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
    }
  });
});
