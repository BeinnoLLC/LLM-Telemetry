import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runCli, type CliIo } from "../../src/cli.js";
import { load } from "../../src/config.js";
import { check } from "../../src/schemaCheck.js";
import { resolvePython } from "../../parity/pythonProducer.js";
import { listDir, makeTmpDir } from "./helpers.js";

let inputs = "";

beforeAll(() => {
  inputs = makeTmpDir("acli-fixture-");
  const py = resolvePython(process.cwd());
  if (py === null) throw new Error("no python");
  const res = spawnSync(py, ["parity/py/make_analytics_fixture.py", inputs], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(res.stderr);
});

afterEach(() => vi.unstubAllEnvs());

/** Every home dir and env var points into the temp fixture; the pinned
 * catalogue means fetchCatalog never touches the network. */
function hermeticEnv(nodeReports: string) {
  vi.stubEnv("HOME", join(inputs, "home"));
  vi.stubEnv("LLM_TELEMETRY_CONFIG", join(inputs, "config.json"));
  vi.stubEnv("LLM_TELEMETRY_AGENT_HOME", join(inputs, "agent"));
  vi.stubEnv("LLM_TELEMETRY_CATALOG", join(inputs, "catalog.json"));
  vi.stubEnv("LLM_TELEMETRY_NODE_REPORTS_DIR", nodeReports);
  vi.stubEnv("LLM_TELEMETRY_SHARED_REPORTS", "");
  vi.stubGlobal("fetch", () => { throw new Error("network must not be used"); });
  return () => load(join(inputs, "config.json"));
}

function capture() {
  const out: string[] = []; const err: string[] = [];
  const io: CliIo = { out: (l) => void out.push(l), err: (l) => void err.push(l) };
  return { io, out, err };
}

describe("analytics CLI", () => {
  it("-o writes a schema-valid analytics-data.json to the given temp path", async () => {
    const dir = makeTmpDir("acli-o-");
    const cfg = hermeticEnv(join(dir, "node-reports"));
    const target = join(dir, "sub", "custom.json");
    const { io, out } = capture();
    expect(await runCli(["analytics", "-o", target], io, cfg)).toBe(0);
    const data = JSON.parse(fs.readFileSync(target, "utf8")) as Record<string, unknown>;
    expect(check("analytics", data)).toBeTruthy();
    expect(Object.keys(data["profiles"] as object).sort()).toEqual(["alpha", "beta-bot"]);
    expect(data["pricing_source"]).toBe("pinned");
    expect(listDir(join(dir, "sub"))).toEqual(["custom.json"]); // no .tmp left
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(new RegExp(`^${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}  \\(2 profiles, \\d+ day-rows\\)$`));
  });

  it("--out=PATH is accepted like argparse", async () => {
    const dir = makeTmpDir("acli-eq-");
    const cfg = hermeticEnv(join(dir, "node-reports"));
    const target = join(dir, "eq.json");
    expect(await runCli(["analytics", `--out=${target}`], capture().io, cfg)).toBe(0);
    expect(fs.existsSync(target)).toBe(true);
  });

  it("without -o the default file name lands in the Node reports dir only", async () => {
    const dir = makeTmpDir("acli-def-");
    const nodeReports = join(dir, "node-reports");
    const cfg = hermeticEnv(nodeReports);
    expect(await runCli(["analytics"], capture().io, cfg)).toBe(0);
    expect(listDir(nodeReports)).toEqual(["analytics-data.json"]);
  });

  it("an unknown argument is a usage error (exit 2) and writes nothing", async () => {
    const dir = makeTmpDir("acli-bad-");
    const nodeReports = join(dir, "node-reports");
    const cfg = hermeticEnv(nodeReports);
    const { io, err } = capture();
    expect(await runCli(["analytics", "--bogus"], io, cfg)).toBe(2);
    expect(err.join("\n")).toContain("unrecognized arguments: --bogus");
    expect(listDir(nodeReports)).toEqual([]);
  });
});
