/** LLMTELEMET-289 T-18 RUN 2a: Node PI ingest vs the Python oracle.
 *
 * A hermetic PI agent tree is written into a temp HOME (no real user data is
 * read). The real Python `ingest_pi.main` and the Node port write separate
 * SQLite databases; every row of both tables is compared with `SELECT *`
 * ordered by primary key, ignoring only the wall-clock `created_at` column.
 * Python is located through the shared resolvePython helper — no absolute
 * interpreter or home paths are hardcoded here.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AnalyticsStore } from "../../src/analyticsStore.js";
import { runCli, type CliIo } from "../../src/cli.js";
import { Config } from "../../src/config.js";
import { discoverPiAgents, ingestPiAgents } from "../../src/ingestPi.js";
import { resolvePython } from "../../parity/pythonProducer.js";
import { makeTmpDir } from "./helpers.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const PY_SRC = join(REPO_ROOT, "src");
const PY_CODE = "import sys\nfrom llm_telemetry.ingest_pi import main\nraise SystemExit(main(sys.argv[1:]))\n";

function python(): string {
  const py = resolvePython(process.cwd());
  if (py === null) throw new Error("no python with llm_telemetry (set LLM_TELEMETRY_PARITY_PYTHON)");
  return py;
}

function runPythonArgs(home: string, args: string[]) {
  const res = spawnSync(python(), ["-c", PY_CODE, ...args], {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, HOME: home, PYTHONPATH: PY_SRC },
  });
  if (res.error) throw res.error;
  return res;
}

function runPythonIngest(home: string, db: string, args: string[] = []): ReturnType<typeof runPythonArgs> {
  return runPythonArgs(home, ["--db", db, ...args]);
}

function pythonDiscovery(home: string): string[] {
  const res = spawnSync(
    python(),
    ["-c", "import json\nfrom llm_telemetry.collect_pi_agents import discover_pi_agents\nprint(json.dumps(discover_pi_agents()))\n"],
    {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, HOME: home, PYTHONPATH: PY_SRC },
    },
  );
  if (res.error || res.status !== 0) throw new Error(String(res.error ?? res.stderr));
  return JSON.parse(res.stdout) as string[];
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

const line = (event: unknown): string => JSON.stringify(event) + "\n";

let dir: string;
let home: string;
let emptyHome: string;

beforeAll(() => {
  dir = makeTmpDir("ingest-pi-");
  home = join(dir, "home");
  emptyHome = join(dir, "empty-home");
  fs.mkdirSync(emptyHome, { recursive: true });
  const alpha = join(home, ".pi", "agent-alpha", "sessions");
  const beta = join(home, ".pi", "agent-beta", "sessions");

  writeFile(join(alpha, "s1.jsonl"), [
    { type: "session", id: "s1", timestamp: "2026-11-20T10:00:00.123Z", cwd: "/work/alpha" },
    { type: "model_change", provider: "pv", modelId: "scout" },
    { type: "thinking_level_change", thinkingLevel: "high" },
    {
      type: "message",
      message: { role: "user", content: "subagent hermes dispatch_relay must be ignored" },
      usage: { input: 999, output: 999, totalTokens: 1998, cost: { total: 9.0 } },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        content: "Use a SUBAGENT, then hermes:// and dispatch_relay to delegate_task.",
      },
      usage: { input: 100, output: 20, cacheRead: 5, cacheWrite: 3, totalTokens: 128, cost: { total: 0.125 } },
    },
  ].map(line).join(""));

  // Integral floats must stay floats; the long unicode snippet is clipped at
  // 200 Python code points. The text-thinking fallback is covered by s3.
  writeFile(join(alpha, "nested", "s2.jsonl"), [
    { type: "session", id: "s2", timestamp: "2026-11-20T10:01:00Z", cwd: "/work/nested" },
    { type: "model_change", provider: "fireworks", modelId: "sage" },
  ].map(line).join("") +
    `{"type":"message","message":{"role":"assistant","content":[{"text":"subagents are not a Hermes handoff match"},{"text":"${"é".repeat(250)}"}]},"usage":{"input":10.0,"output":2.5,"cacheRead":0,"cacheWrite":0,"totalTokens":12.5,"cost":{"total":0}}}\n`);

  writeFile(join(beta, "s3.jsonl"), [
    { type: "session", id: "s3", timestamp: "2026-11-20T12:02:00+02:00", cwd: "/work/beta é" },
    { type: "message", message: { role: "assistant", content: [{ text: "", thinking: "delegate_task to a subagent via dispatch_relay" }] } },
  ].map(line).join(""));

  // Same identity as s3: duplicate raw event (-1) but a NULL-target edge is
  // inserted twice in both runtimes (SQLite NULLs are distinct in UNIQUE).
  writeFile(join(beta, "s4.jsonl"), [
    { type: "session", id: "s3", timestamp: "2026-11-20T12:02:00+02:00", cwd: "/work/beta duplicate" },
    { type: "message", message: { role: "assistant", content: "Hermes again" }, usage: { input: 1, output: 1, totalTokens: 2 } },
  ].map(line).join(""));

  writeFile(join(alpha, ".hidden.jsonl"), [
    { type: "session", id: "hidden-1", timestamp: "2026-11-19T23:59:59Z", cwd: "/work/hidden" },
  ].map(line).join(""));
  writeFile(join(alpha, "bad.jsonl"), "not json\n");
  writeFile(join(alpha, "ignored.txt"), line({ type: "session", id: "ignored" }));
  fs.mkdirSync(join(home, ".pi", "agent-empty"), { recursive: true });
  writeFile(join(home, ".pi", "agent-file"), "not a directory\n");
  fs.mkdirSync(join(home, ".pi", "other-dir", "sessions"), { recursive: true });
  fs.mkdirSync(join(alpha, "nested", "deeper"), { recursive: true });
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

describe("PI ingest port (Python is the spec)", () => {
  it("discovers the same agent directories as Python", () => {
    vi.stubEnv("HOME", home);
    const want = pythonDiscovery(home);
    expect(discoverPiAgents()).toEqual(want);
    expect(want).toEqual(["agent-alpha", "agent-beta", "agent-empty"]);
  });

  it("writes byte-identical rows to both tables", () => {
    const pyDb = join(dir, "python.db");
    const nodeDb = join(dir, "node.db");
    const py = runPythonIngest(home, pyDb);
    expect(py.status, py.stderr).toBe(0);
    vi.stubEnv("HOME", home);
    const store = new AnalyticsStore(nodeDb);
    const total = ingestPiAgents(store);
    store.close();
    expect(total).toBe((JSON.parse(py.stdout) as { total_events: number }).total_events);
    expect(total).toBe(4); // s4 duplicates s3's event identity and is skipped

    for (const table of ["raw_events", "orchestration_edges"] as const) {
      const got = rows(nodeDb, table);
      const want = rows(pyDb, table);
      expect(got, `${table}: node rows`).toEqual(want);
    }
    expect(rows(nodeDb, "raw_events")).toHaveLength(4);
    expect(rows(nodeDb, "orchestration_edges")).toHaveLength(8);
  });

  it("matches the CLI stdout, statistics and exit codes", async () => {
    const pyDb = join(dir, "python-cli.db");
    const nodeDb = join(dir, "node-cli.db");
    const py = runPythonIngest(home, pyDb, ["--stats"]);
    expect(py.status, py.stderr).toBe(0);
    vi.stubEnv("HOME", home);
    vi.resetModules();
    const mod = await import("../../src/ingestPi.js");
    const { io, out } = capture();
    expect(mod.main(["--db", nodeDb, "--stats"], io)).toBe(0);
    // Python's print() adds a trailing newline; the captured io.out does not.
    expect(normaliseDbPath(out.join("\n"), nodeDb).trimEnd())
      .toBe(normaliseDbPath(py.stdout, pyDb).trimEnd());

    const result = JSON.parse(out.join("\n")) as Record<string, unknown>;
    expect(result["agents"]).toEqual(["agent-alpha", "agent-beta", "agent-empty"]);
    expect(result["total_events"]).toBe(4);
    expect(result).not.toHaveProperty("total_edges");
    expect((result["statistics"] as { db_path: string }).db_path).toBe(fs.realpathSync(nodeDb));
  });

  it("prints the Python no-agent payload and returns 0", async () => {
    const pyDb = join(dir, "python-empty.db");
    const nodeDb = join(dir, "node-empty.db");
    const py = runPythonIngest(emptyHome, pyDb);
    expect(py.status, py.stderr).toBe(0);
    vi.stubEnv("HOME", emptyHome);
    vi.resetModules();
    const mod = await import("../../src/ingestPi.js");
    const { io, out } = capture();
    expect(mod.main(["--db", nodeDb], io)).toBe(0);
    expect(out.join("\n")).toBe('{"agents": [], "total_events": 0, "total_edges": 0}');
    expect(out.join("\n").trimEnd()).toBe(py.stdout.trimEnd());
  });

  it("rejects unknown arguments like argparse and exposes --help", async () => {
    const pyBad = runPythonIngest(home, join(dir, "unused.db"), ["--bogus"]);
    expect(pyBad.status).toBe(2);
    const { io, err } = capture();
    vi.stubEnv("HOME", emptyHome);
    vi.resetModules();
    const mod = await import("../../src/ingestPi.js");
    expect(mod.main(["--bogus"], io)).toBe(2);
    expect(err.join("\n")).toContain("unrecognized arguments: --bogus");

    const { io: helpIo, out: helpOut } = capture();
    expect(mod.main(["--help"], helpIo)).toBe(0);
    const pyHelp = runPythonArgs(home, ["--help"]);
    expect(pyHelp.status).toBe(0);
    expect(helpOut.join("\n").trimEnd()).toBe(pyHelp.stdout.trimEnd());
  });

  it("wires the real command into the collector CLI", () => {
    vi.stubEnv("HOME", emptyHome);
    const target = join(dir, "cli-empty.db");
    const { io, out } = capture();
    expect(runCli(["ingest-pi", "--db", target], io, () => new Config())).toBe(0);
    expect(out.join("\n").trimEnd()).toBe('{"agents": [], "total_events": 0, "total_edges": 0}');
    expect(fs.existsSync(target)).toBe(true);
  });
});
