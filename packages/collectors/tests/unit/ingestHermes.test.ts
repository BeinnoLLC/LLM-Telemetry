/** LLMTELEMET-289 T-18 RUN 2b: Node Hermes ingest vs the Python oracle.
 *
 * A hermetic HOME contains a default profile, two named profiles with real
 * sessions, and a profile without a sessions table. The real Python
 * `ingest_hermes_profiles` / `ingest_all.main` and the Node ports write
 * separate SQLite databases; every row of both tables is compared with
 * `SELECT *` ordered by primary key, ignoring only wall-clock `created_at`.
 * Python comes from resolvePython() — no absolute interpreter or home paths.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  AnalyticsStore, EventSource, EventType, type RawEvent,
} from "../../src/analyticsStore.js";
import { COMMANDS, runCli, type CliIo } from "../../src/cli.js";
import { Config } from "../../src/config.js";
import { discoverHermesProfiles, ingestHermesProfiles } from "../../src/ingestHermes.js";
import { resolvePython } from "../../parity/pythonProducer.js";
import { makeTmpDir } from "./helpers.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const PY_SRC = join(REPO_ROOT, "src");
const PY_HERMES_CODE = `import json, sys
from pathlib import Path
from llm_telemetry.collect_hermes_profiles import discover_hermes_profiles, ingest_hermes_profiles
from llm_telemetry.analytics_store import get_store
if sys.argv[1] == "discover":
    print(json.dumps([[name, str(path)] for name, path in discover_hermes_profiles()]))
else:
    print(ingest_hermes_profiles(get_store(Path(sys.argv[2]))))
`;
const PY_INGEST_CODE = "import sys\nfrom llm_telemetry.ingest_all import main\nraise SystemExit(main(sys.argv[1:]))\n";
const PY_RESOLVE_CODE = `import sys, logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
from pathlib import Path
from llm_telemetry.analytics_store import get_store
from llm_telemetry.detect_orchestration import resolve_orchestration_edges
print(resolve_orchestration_edges(get_store(Path(sys.argv[1])), verbose=True))
`;

function python(): string {
  const py = resolvePython(process.cwd());
  if (py === null) throw new Error("no python with llm_telemetry (set LLM_TELEMETRY_PARITY_PYTHON)");
  return py;
}

function runPython(home: string, code: string, args: string[]) {
  const res = spawnSync(python(), ["-c", code, ...args], {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, HOME: home, PYTHONPATH: PY_SRC },
  });
  if (res.error) throw res.error;
  return res;
}

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => void out.push(l), err: (l) => void err.push(l) }, out, err };
}

function writeFile(path: string, text: string): void {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, text);
}

const SESSION_COLS = [
  "id", "session_id", "started_at", "chat_id", "model", "billing_provider",
  "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens",
  "actual_cost_usd", "message_count", "tool_call_count",
];
const USAGE_COLS = ["session_id", "tool_name", "name", "model"];

function insert(
  con: DatabaseSync,
  table: "sessions" | "session_model_usage",
  columns: string[],
  row: Record<string, unknown>,
): void {
  const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
  con.prepare(sql).run(...columns.map((c) => (row[c] as string | number | null) ?? null));
}

function stateDb(
  path: string,
  sessions: Record<string, unknown>[],
  usage?: Record<string, unknown>[],
): void {
  fs.mkdirSync(dirname(path), { recursive: true });
  const con = new DatabaseSync(path);
  con.exec(`CREATE TABLE sessions (
    id, session_id, started_at, chat_id, model, billing_provider,
    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
    actual_cost_usd, message_count, tool_call_count, errors, workspace_id
  )`);
  for (const row of sessions) insert(con, "sessions", SESSION_COLS, row);
  if (usage !== undefined) {
    con.exec("CREATE TABLE session_model_usage (session_id, tool_name, name, model)");
    for (const row of usage) insert(con, "session_model_usage", USAGE_COLS, row);
  }
  con.close();
}

let dir: string;
let home: string;

beforeAll(() => {
  dir = makeTmpDir("ingest-hermes-");
  home = join(dir, "home");

  // Default profile: valid numeric and ISO timestamps, an integral float
  // token count, a duplicate session, rows Python skips, and all three
  // orchestration-signal branches.
  stateDb(
    join(home, ".hermes", "state.db"),
    [
      {
        id: "s-iso", started_at: "2026-11-20T10:00:00.123456Z", chat_id: "chat-é",
        model: "gpt-é", billing_provider: "openai", input_tokens: 10,
        output_tokens: "2", cache_read_tokens: 5, cache_write_tokens: 7,
        actual_cost_usd: "0.125", message_count: "3", tool_call_count: 4,
      },
      {
        id: "s-num", started_at: 1795168000.5, chat_id: null,
        model: "local-model", billing_provider: "", input_tokens: 7.9,
        output_tokens: 1, cache_read_tokens: 100, cache_write_tokens: 200,
        actual_cost_usd: 0, message_count: 5, tool_call_count: 2,
      },
      // Same event identity as s-num: the raw event is skipped but its
      // orchestration edges are still written (NULL target columns are
      // distinct under SQLite's UNIQUE constraint).
      {
        id: "s-num", started_at: 1795168000.5, chat_id: "duplicate-chat",
        model: "local-model", billing_provider: "ollama", input_tokens: 7.9,
        output_tokens: 1, actual_cost_usd: 0,
      },
      // id is falsy; Python falls back to session_id.
      {
        id: 0, session_id: "s-fallback", started_at: 1795168001,
        chat_id: "chat-fallback", model: "fallback-model", billing_provider: 0,
        input_tokens: "4", output_tokens: "6", actual_cost_usd: "0.5",
      },
      // Skipped: no id at all.
      { id: "", session_id: "", started_at: 1795168002 },
      // Skipped: int("oops") raises ValueError inside the row parser.
      { id: "bad-tokens", started_at: 1795168003, input_tokens: "oops" },
    ],
    [
      { session_id: "s-iso", tool_name: "delegate_task", name: null, model: "gpt-é" },
      { session_id: "s-iso", tool_name: "switch_profile", name: null, model: null },
      { session_id: "s-iso", tool_name: "delegate_and_switch_profile", name: null, model: null },
      { session_id: "s-iso", tool_name: null, name: "ordinary_tool", model: null },
      { session_id: "s-num", tool_name: null, name: "subagent.dispatch", model: null },
      { session_id: "s-fallback", tool_name: "profile: research", name: null, model: null },
    ],
  );

  stateDb(
    join(home, ".hermes", "profiles", "alpha", "state.db"),
    [
      {
        id: "alpha-1", started_at: 1795168100, chat_id: "alpha-chat",
        model: "alpha-model", billing_provider: "anthropic", input_tokens: 20,
        output_tokens: 30, cache_read_tokens: 9, actual_cost_usd: "1.5",
        message_count: 12, tool_call_count: 3,
      },
    ],
    [],
  );

  stateDb(
    join(home, ".hermes", "profiles", "é-profile", "state.db"),
    [
      {
        id: "unicode-1", started_at: "2026-11-20 09:00:00+02:00", chat_id: "unicode-chat",
        model: "é-model", billing_provider: "ollama", input_tokens: 3,
        output_tokens: 4, actual_cost_usd: "0.25", message_count: 2, tool_call_count: 1,
      },
    ],
    [{ session_id: "unicode-1", tool_name: "delegate_to_profile", name: null, model: null }],
  );

  // Discovered, but its state.db has no sessions table (debug path).
  fs.mkdirSync(join(home, ".hermes", "profiles", "no-sessions"), { recursive: true });
  const bare = new DatabaseSync(join(home, ".hermes", "profiles", "no-sessions", "state.db"));
  bare.exec("CREATE TABLE unrelated (x)");
  bare.close();
  // Discovered only if it has a state.db.
  fs.mkdirSync(join(home, ".hermes", "profiles", "orphan"), { recursive: true });

  // A small PI tree so the combined command also exercises PI ingest.
  writeFile(join(home, ".pi", "agent-pi", "sessions", "p1.jsonl"), [
    { type: "session", id: "p1", timestamp: "2026-11-20T09:00:00Z", cwd: "/work/pi" },
    { type: "model_change", provider: "pv", modelId: "scout" },
    {
      type: "message",
      message: { role: "assistant", content: "Use a subagent and hermes handoff." },
      usage: { input: 10, output: 5, totalTokens: 15, cost: { total: 0.25 } },
    },
  ].map((event) => JSON.stringify(event) + "\n").join(""));
});

afterEach(() => vi.unstubAllEnvs());

/** SELECT * ordered by primary key, minus only the wall-clock column. */
function rows(db: string, table: "raw_events" | "orchestration_edges"): Record<string, unknown>[] {
  const con = new DatabaseSync(db, { readOnly: true });
  try {
    return con.prepare(`SELECT * FROM ${table} ORDER BY id`).all().map((row) => {
      const copy = { ...row } as Record<string, unknown>;
      delete copy["created_at"];
      return copy;
    });
  } finally {
    con.close();
  }
}

function normaliseDbPath(text: string, db: string): string {
  return text.replaceAll(db, "<db>").replaceAll(fs.realpathSync(db), "<db>");
}

/** Strip only logging's wall-clock prefix; the messages themselves are spec. */
function normaliseLog(text: string, db: string): string {
  return normaliseDbPath(text, db)
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3} /, "<time> "))
    .join("\n");
}

function expectSameRows(pyDb: string, nodeDb: string): void {
  for (const table of ["raw_events", "orchestration_edges"] as const) {
    expect(rows(nodeDb, table), `${table}: node rows`).toEqual(rows(pyDb, table));
  }
}

describe("Hermes profile ingest port (Python is the spec)", () => {
  it("discovers the same profiles in Python's code-point order", () => {
    const py = runPython(home, PY_HERMES_CODE, ["discover"]);
    expect(py.status, py.stderr).toBe(0);
    const want = JSON.parse(py.stdout) as Array<[string, string]>;
    vi.stubEnv("HOME", home);
    expect(discoverHermesProfiles()).toEqual(want);
    expect(want.map(([name]) => name)).toEqual(["alpha", "default", "no-sessions", "é-profile"]);
  });

  it("writes byte-identical rows to both tables", () => {
    const pyDb = join(dir, "python.db");
    const nodeDb = join(dir, "node.db");
    const py = runPython(home, PY_HERMES_CODE, ["ingest", pyDb]);
    expect(py.status, py.stderr).toBe(0);
    vi.stubEnv("HOME", home);
    const store = new AnalyticsStore(nodeDb);
    const total = ingestHermesProfiles(store);
    store.close();
    expect(total).toBe(Number(py.stdout.trim()));
    expect(total).toBe(5); // two parser-skipped rows and one duplicate event

    expectSameRows(pyDb, nodeDb);
    const events = rows(nodeDb, "raw_events");
    expect(events).toHaveLength(5);
    const iso = events.find((row) => row["session_id"] === "s-iso")!;
    expect(JSON.parse(String(iso["payload"]))).toMatchObject({
      workspace_id: "chat-é",
      model: "gpt-é",
      provider: "openai",
      tokens: { input: 10, output: 2, total: 12 },
      cost: { total: 0.125 },
      message_count: 3,
      tool_calls: 4,
      errors: 0,
    });
    expect(rows(nodeDb, "orchestration_edges").length).toBeGreaterThan(0);
  });
});

describe("combined ingest command port (Python is the spec)", () => {
  const cases: Array<[string, string[]]> = [
    ["hermes-only", ["--hermes-only"]],
    ["pi-only", ["--pi-only"]],
    ["both", []],
    ["stats", ["--stats"]],
    ["verbose", ["--verbose"]],
  ];

  for (const [label, extra] of cases) {
    it(`matches Python stdout and rows with ${label}`, async () => {
      const pyDb = join(dir, `python-${label}.db`);
      const nodeDb = join(dir, `node-${label}.db`);
      const py = runPython(home, PY_INGEST_CODE, ["--db", pyDb, ...extra]);
      expect(py.status, py.stderr).toBe(0);
      vi.stubEnv("HOME", home);
      vi.resetModules();
      const mod = await import("../../src/ingestAll.js");
      const { io, out, err } = capture();
      expect(mod.main(["--db", nodeDb, ...extra], io)).toBe(0);
      // Python's print() adds a trailing newline; io.out() does not.
      expect(normaliseDbPath(out.join("\n"), nodeDb).trimEnd())
        .toBe(normaliseDbPath(py.stdout, pyDb).trimEnd());
      expect(normaliseLog(err.join("\n"), nodeDb))
        .toBe(normaliseLog(py.stderr, pyDb));
      expectSameRows(pyDb, nodeDb);
    });
  }

  it("reports the expected discoveries and totals", async () => {
    const nodeDb = join(dir, "node-summary.db");
    vi.stubEnv("HOME", home);
    vi.resetModules();
    const mod = await import("../../src/ingestAll.js");
    const { io, out } = capture();
    expect(mod.main(["--db", nodeDb], io)).toBe(0);
    const result = JSON.parse(out.join("\n")) as Record<string, unknown>;
    expect(result["pi_agents"]).toEqual(["agent-pi"]);
    expect(result["hermes_profiles"]).toEqual(["alpha", "default", "no-sessions", "é-profile"]);
    expect(result["total_events"]).toBe(6); // 5 Hermes + 1 PI
  });

  it("matches Python's help and argparse exit codes", async () => {
    const help = runPython(home, PY_INGEST_CODE, ["--help"]);
    expect(help.status).toBe(0);
    vi.stubEnv("HOME", home);
    vi.resetModules();
    const mod = await import("../../src/ingestAll.js");
    const { io, out } = capture();
    expect(mod.main(["--help"], io)).toBe(0);
    expect(out.join("\n").trimEnd()).toBe(help.stdout.trimEnd());

    for (const bad of [
      ["--bogus"], ["--pi-only=x"], ["--h"], ["--db"], ["--db", "-x"], ["--", "extra"],
    ]) {
      const pyBad = runPython(home, PY_INGEST_CODE, bad);
      expect(pyBad.status).toBe(2);
      const { io: badIo, err } = capture();
      expect(mod.main(bad, badIo)).toBe(2);
      expect(err.join("\n").trimEnd()).toBe(pyBad.stderr.trimEnd());
    }
  });

  it("resolves orchestration edges like Python when signals are present", async () => {
    const pyDb = join(dir, "python-resolve.db");
    const nodeDb = join(dir, "node-resolve.db");
    const seeded: RawEvent[] = [
      {
        source: EventSource.PI,
        profile_or_agent: "agent-pi",
        session_id: "pi-session",
        timestamp: 1795168300,
        event_type: EventType.SESSION_START,
        payload: {
          type: "message",
          message: { role: "assistant", content: "call agent-other and agent-pi self" },
          timestamp: 1.0,
        },
      },
      {
        source: EventSource.HERMES,
        profile_or_agent: "default",
        session_id: "hermes-session",
        timestamp: 1795168400,
        event_type: EventType.SESSION_START,
        payload: {
          model: "m",
          tool_calls: [
            { tool_name: "delegate_to_agent-pv" },
            { tool_name: "switch_profile" },
            { name: "call agent-sage" },
          ],
        },
      },
    ];
    for (const db of [pyDb, nodeDb]) {
      const store = new AnalyticsStore(db);
      for (const event of seeded) expect(store.writeEvent(event)).toBeGreaterThan(0);
      store.close();
    }

    const py = runPython(home, PY_RESOLVE_CODE, [pyDb]);
    expect(py.status, py.stderr).toBe(0);
    vi.resetModules();
    const mod = await import("../../src/ingestAll.js");
    const err: string[] = [];
    const store = new AnalyticsStore(nodeDb);
    const written = mod.resolveOrchestrationEdges(store, true, {
      info: (message) => void err.push(`<time> [INFO] llm_telemetry.detect_orchestration: ${message}`),
      warning: (message) => void err.push(`<time> [WARNING] llm_telemetry.detect_orchestration: ${message}`),
      error: (message) => void err.push(`<time> [ERROR] llm_telemetry.detect_orchestration: ${message}`),
    });
    store.close();
    expect(written).toBe(Number(py.stdout.trim()));
    expect(normaliseLog(err.join("\n"), nodeDb)).toBe(normaliseLog(py.stderr, pyDb));
    expect(rows(nodeDb, "orchestration_edges")).toHaveLength(5);
    expectSameRows(pyDb, nodeDb);
  });

  it("wires the real command into the collector CLI", () => {
    expect(COMMANDS["ingest"]?.status).toBe("ported");
    vi.stubEnv("HOME", home);
    const target = join(dir, "cli-ingest.db");
    const { io, out } = capture();
    expect(runCli(["ingest", "--db", target, "--hermes-only"], io, () => new Config())).toBe(0);
    expect((JSON.parse(out.join("\n")) as Record<string, unknown>)["total_events"]).toBe(5);
    expect(rows(target, "raw_events")).toHaveLength(5);
  });
});
