import * as fs from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ArtifactWriteError,
  assertSafeOutDir,
  writeArtifact,
} from "../../src/artifactWriter.js";
import { Config, expand } from "../../src/config.js";
import { SCHEMA_VERSION } from "../../src/schema.js";
import { SchemaError, check } from "../../src/schemaCheck.js";
import { demoPayload } from "../../src/cli.js";
import { listDir, makeTmpDir } from "./helpers.js";

describe("artifact writer (atomic, schema_version, schema check)", () => {
  let dir: string;
  let savedShared: string | undefined;

  beforeEach(() => {
    dir = makeTmpDir("writer-");
    savedShared = process.env["LLM_TELEMETRY_SHARED_REPORTS"];
    delete process.env["LLM_TELEMETRY_SHARED_REPORTS"];
  });

  afterEach(() => {
    if (savedShared === undefined) delete process.env["LLM_TELEMETRY_SHARED_REPORTS"];
    else process.env["LLM_TELEMETRY_SHARED_REPORTS"] = savedShared;
  });

  it("stamps schema_version and writes via tmp+rename (no tmp left behind)", () => {
    const res = writeArtifact("demo-data.json", demoPayload(), {
      outDir: dir,
      tag: "live",
      cfg: new Config(),
    });
    expect(res.path).toBe(join(dir, "demo-data.json"));
    const parsed = JSON.parse(fs.readFileSync(res.path, "utf8")) as Record<string, unknown>;
    expect(parsed["schema_version"]).toBe(SCHEMA_VERSION);
    // Atomicity contract: the only file standing after a successful write is
    // the artifact itself — the .tmp is renamed, never left or copied.
    expect(listDir(dir)).toEqual(["demo-data.json"]);
  });

  it("replaces an existing artifact completely (no merge, no partial file)", () => {
    writeArtifact("a.json", { first: true }, { outDir: dir, cfg: new Config() });
    writeArtifact("a.json", { second: true }, { outDir: dir, cfg: new Config() });
    const parsed = JSON.parse(fs.readFileSync(join(dir, "a.json"), "utf8")) as Record<string, unknown>;
    expect(parsed["first"]).toBeUndefined();
    expect(parsed["second"]).toBe(true);
    expect(listDir(dir)).toEqual(["a.json"]);
  });

  it("refuses a schema-failing payload BEFORE any filesystem side effect", () => {
    // Missing every key live.schema.json requires.
    expect(() =>
      writeArtifact("live-data.json", { nonsense: 1 }, { outDir: dir, tag: "live", cfg: new Config() }),
    ).toThrow(SchemaError);
    // Touched nothing: no artifact, no tmp, not even the output dir.
    expect(listDir(dir)).toEqual([]);
  });

  it("a failed overwrite leaves the previous artifact intact", () => {
    writeArtifact("live-data.json", demoPayload(), { outDir: dir, tag: "live", cfg: new Config() });
    const before = fs.readFileSync(join(dir, "live-data.json"), "utf8");
    expect(() =>
      writeArtifact("live-data.json", { broken: true }, { outDir: dir, tag: "live", cfg: new Config() }),
    ).toThrow(SchemaError);
    expect(fs.readFileSync(join(dir, "live-data.json"), "utf8")).toBe(before);
    expect(listDir(dir)).toEqual(["live-data.json"]);
  });

  it("a serialization failure leaves neither target nor tmp", () => {
    expect(() =>
      writeArtifact("b.json", { big: 1n } as unknown as Record<string, unknown>, {
        outDir: dir,
        cfg: new Config(),
      }),
    ).toThrow(TypeError);
    expect(listDir(dir)).toEqual([]);
  });

  it("the stamped payload still satisfies the shared schema (writer = validator)", () => {
    const res = writeArtifact("demo-data.json", demoPayload(), {
      outDir: dir,
      tag: "live",
      cfg: new Config(),
    });
    const parsed = JSON.parse(fs.readFileSync(res.path, "utf8")) as Record<string, unknown>;
    expect(check("live", parsed)).toBe(parsed);
  });
});

describe("single-writer rule: Node never overwrites Python artifacts", () => {
  let dir: string;
  let savedShared: string | undefined;

  beforeEach(() => {
    dir = makeTmpDir("guard-");
    savedShared = process.env["LLM_TELEMETRY_SHARED_REPORTS"];
    delete process.env["LLM_TELEMETRY_SHARED_REPORTS"];
  });

  afterEach(() => {
    if (savedShared === undefined) delete process.env["LLM_TELEMETRY_SHARED_REPORTS"];
    else process.env["LLM_TELEMETRY_SHARED_REPORTS"] = savedShared;
  });

  it("refuses the resolved Python reports_dir (nothing is created)", () => {
    const cfg = new Config();
    cfg.reports_dir = join(dir, "python-reports");
    expect(() => assertSafeOutDir(cfg.reports_dir, cfg)).toThrow(ArtifactWriteError);
    expect(() =>
      writeArtifact("live-data.json", demoPayload(), {
        outDir: cfg.reports_dir,
        cfg,
      }),
    ).toThrow(ArtifactWriteError);
    expect(listDir(dir)).toEqual([]); // refused before any mkdir
  });

  it("refuses ~/.hermes/reports regardless of config", () => {
    const hermesReports = expand("~/.hermes/reports");
    const before = listDir(hermesReports);
    expect(() => assertSafeOutDir(hermesReports, new Config())).toThrow(ArtifactWriteError);
    expect(listDir(hermesReports)).toEqual(before); // untouched, read-only check
  });

  it("LLM_TELEMETRY_SHARED_REPORTS=1 is the deliberate cutover switch", () => {
    const cfg = new Config();
    cfg.reports_dir = join(dir, "python-reports");
    process.env["LLM_TELEMETRY_SHARED_REPORTS"] = "1";
    expect(() => assertSafeOutDir(cfg.reports_dir, cfg)).not.toThrow();
  });

  it("a separate node output dir passes the guard", () => {
    expect(() => assertSafeOutDir(join(dir, "node-reports"), new Config())).not.toThrow();
  });
});
