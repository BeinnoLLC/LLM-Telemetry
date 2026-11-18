import * as fs from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COMMANDS, runCli, type CliIo } from "../../src/cli.js";
import { Config } from "../../src/config.js";
import { check } from "../../src/schemaCheck.js";
import { listDir, makeTmpDir } from "./helpers.js";

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { out: (l) => void out.push(l), err: (l) => void err.push(l) },
  };
}

// One-to-one mirror of src/llm_telemetry/cli.py's subcommands (plus `demo`,
// the T-4 writer exercise). If cli.py grows a command, this registry must too.
const PYTHON_SUBCOMMANDS = [
  "dashboard", "costs", "pricing", "rankings", "live", "transcripts",
  "session-timeline", "logs", "probe", "analytics", "router", "quota",
  "serve", "config", "doctor", "ingest", "ingest-pi",
];

describe("CLI dispatch", () => {
  let dir: string;
  let savedNodeReports: string | undefined;

  beforeEach(() => {
    dir = makeTmpDir("cli-");
    savedNodeReports = process.env["LLM_TELEMETRY_NODE_REPORTS_DIR"];
    process.env["LLM_TELEMETRY_NODE_REPORTS_DIR"] = join(dir, "node-reports");
  });

  afterEach(() => {
    if (savedNodeReports === undefined) delete process.env["LLM_TELEMETRY_NODE_REPORTS_DIR"];
    else process.env["LLM_TELEMETRY_NODE_REPORTS_DIR"] = savedNodeReports;
  });

  it("registry mirrors every cli.py subcommand", () => {
    for (const name of PYTHON_SUBCOMMANDS) {
      expect(COMMANDS[name], `missing subcommand '${name}'`).toBeDefined();
    }
    expect(COMMANDS["demo"]).toBeDefined();
  });

  it("every collector command is a stub that exits non-zero 'not yet ported'", () => {
    for (const name of Object.keys(COMMANDS)) {
      if (COMMANDS[name]!.status !== "stub") continue;
      const { io, err } = capture();
      const code = runCli([name], io, () => new Config());
      expect(code, `'${name}' must exit non-zero`).not.toBe(0);
      expect(err.join("\n")).toContain("not yet ported");
    }
  });

  it("analytics dispatches to stub (exit code 1)", () => {
    for (const name of ["analytics"]) {
      const { io, err } = capture();
      expect(runCli([name], io, () => new Config())).toBe(1);
      expect(err.join("\n")).toContain(`'${name}' is not yet ported`);
    }
  });

  it("demo writes a schema-passing artifact through the real writer path", () => {
    const { io, out } = capture();
    expect(runCli(["demo"], io, () => new Config())).toBe(0);
    const target = join(dir, "node-reports", "demo-data.json");
    expect(listDir(join(dir, "node-reports"))).toEqual(["demo-data.json"]); // no .tmp
    const parsed = JSON.parse(fs.readFileSync(target, "utf8")) as Record<string, unknown>;
    expect(parsed["schema_version"]).toBe(3);
    expect(check("live", parsed)).toBeTruthy();
    expect(out.join("\n")).toContain("live schema OK");
  });

  it("config prints the resolved configuration as JSON", () => {
    const { io, out } = capture();
    expect(runCli(["config"], io, () => new Config())).toBe(0);
    const parsed = JSON.parse(out.join("\n")) as Record<string, unknown>;
    expect(parsed["reports_dir"]).toBe(new Config().toDict().reports_dir);
    expect(parsed["node_reports_dir"]).toBe("");
  });

  it("unknown or missing commands exit 2 with usage (argparse parity)", () => {
    const missing = capture();
    expect(runCli([], missing.io, () => new Config())).toBe(2);
    expect(missing.err.join("\n")).toContain("usage: node cli.js <command>");

    const unknown = capture();
    expect(runCli(["bogus"], unknown.io, () => new Config())).toBe(2);
    expect(unknown.err.join("\n")).toContain("unknown command 'bogus'");
  });

  it("--help lists the registry and exits 0", () => {
    const { io, out } = capture();
    expect(runCli(["--help"], io, () => new Config())).toBe(0);
    const text = out.join("\n");
    for (const name of Object.keys(COMMANDS)) expect(text).toContain(name);
    expect(text).toContain("not yet ported");
  });
});
