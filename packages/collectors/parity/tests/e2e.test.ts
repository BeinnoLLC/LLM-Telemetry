/** End-to-end parity case — T-5 (LLMTELEMET-284).
 *
 * Runs the REAL producers on the same fixture: the Python side
 * (`.venv/bin/python` of the main checkout running parity/py/produce.py with
 * llm_telemetry's stamp + schema_check + collectors' write convention) and the
 * Node side through the T-4 collector platform (`writeArtifact`: stamp, schema
 * check at write time, atomic rename, Python-identical JSON). Then the harness
 * must see zero differences — and must see a seeded one.
 *
 * These tests need an interpreter with `llm_telemetry` installed (the main
 * checkout's .venv); without one they are SKIPPED and the `npm run parity` CLI
 * hard-fails instead (it is the CI gate).
 */

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { testScratchRoot } from "../../src/artifactWriter.js";
import { findCase } from "../cases.js";
import { runCase, runParity } from "../cli.js";
import { normalize } from "../normalize.js";
import { structuralDiff } from "../diff.js";
import { resolvePython } from "../pythonProducer.js";
import { seedAndDiff } from "../selfTest.js";

const PARITY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const python = resolvePython(PARITY_ROOT);

function scratch(): string {
  const root = testScratchRoot();
  return mkdtempSync(join(root, "parity-e2e-"));
}

function silent(): (line: string) => void {
  return () => undefined;
}

const live = findCase("live");
if (!live) throw new Error("parity case 'live' missing from cases.ts");

describe.runIf(python !== null)("parity end to end (py producer vs T-4 platform)", () => {
  it("py and node producers produce identical normalized artifacts for live-data", () => {
    const res = runCase(live, PARITY_ROOT, { outBase: scratch() });
    expect(res.error).toBeUndefined();
    expect(res.status).toBe("ok");
    expect(res.diffs).toEqual([]);
    expect(res.leaves).toBeGreaterThan(100); // a real artifact, not a stub
  });

  it("agrees on the ollama probe fixture too", () => {
    const ollama = findCase("ollama");
    if (!ollama) throw new Error("parity case 'ollama' missing from cases.ts");
    const res = runCase(ollama, PARITY_ROOT, { outBase: scratch() });
    expect(res.status).toBe("ok");
    expect(res.diffs).toEqual([]);
  });

  it("both artifacts carry the shared schema_version (T-4 platform stamp)", () => {
    const out = scratch();
    const res = runCase(live, PARITY_ROOT, { outBase: out });
    expect(res.status).toBe("ok");
    for (const side of ["py", "node"]) {
      const artifact = JSON.parse(
        readFileSync(join(out, side, "live", "live-data.json"), "utf8"),
      ) as unknown as { schema_version?: unknown };
      expect(artifact.schema_version).toBe(3);
    }
  });

  it("self-test: a seeded mismatch is detected as exactly one field diff", () => {
    const out = scratch();
    const res = runCase(live, PARITY_ROOT, { outBase: out, seed: true });
    expect(res.status).toBe("fail");
    expect(res.seededPath).toBeTruthy();
    expect(res.diffs).toHaveLength(1);
    const d = res.diffs[0];
    if (!d) throw new Error("no diff entry");
    expect(d.kind).toBe("value");
    expect(d.path).toBe(res.seededPath);
    expect(d.actual).toBe((d.expected as number) + 1);
  });

  it("seedAndDiff pinpoints the perturbed field on a real artifact", () => {
    const out = scratch();
    runCase(live, PARITY_ROOT, { outBase: out });
    const pyNorm = normalize(
      JSON.parse(readFileSync(join(out, "py", "live", "live-data.json"), "utf8")) as unknown,
    );
    const nodeNorm = normalize(
      JSON.parse(readFileSync(join(out, "node", "live", "live-data.json"), "utf8")) as unknown,
    );
    const { seed, diffs } = seedAndDiff(pyNorm, nodeNorm);
    expect(structuralDiff(pyNorm, nodeNorm)).toEqual([]);
    expect(diffs).toEqual([
      { path: seed.path, kind: "value", expected: seed.before, actual: seed.after },
    ]);
  });

  it("CLI: exits 0 on parity, 1 when a mismatch is seeded, 0 on --self-test", () => {
    const out = scratch();
    expect(runParity(["live"], { out: silent(), outBase: out })).toBe(0);
    expect(runParity(["live", "--seed-mismatch"], { out: silent(), outBase: out })).toBe(1);
    expect(runParity(["--self-test", "live"], { out: silent(), outBase: out })).toBe(0);
    expect(runParity(["no-such-case"], { out: silent(), outBase: out })).toBe(2);
  });
});

describe("python interpreter resolution", () => {
  it("resolves the main checkout's .venv interpreter when available", () => {
    if (python === null) return; // CI without the venv: the CLI gate covers it
    expect(python).toContain(".venv/bin/python");
    expect(existsSync(python)).toBe(true);
  });
});
