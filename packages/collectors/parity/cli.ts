/** Parity harness CLI — T-5 (LLMTELEMET-284), migration plan §7.
 *
 *   npm run parity -- [case…]        run parity on one/all fixture cases
 *   npm run parity -- --self-test    seeded-mismatch self-test (exit 0 when the
 *                                    harness detects the seeded field)
 *   npm run parity -- --seed-mismatch live
 *                                    inject a deliberate mismatch — a correct
 *                                    harness REPORTS it and exits 1 here
 *
 * Per case: run the Python producer (`<main-repo>/.venv/bin/python`, read-only)
 * and the Node producer (T-4 collector platform `writeArtifact`) on the same
 * fixture, normalize both artifacts (drop run-stamp timestamps, sort keys,
 * documented float rounding) and diff structurally. Any value mismatch prints a
 * field-level diff and exits non-zero (plan §7.3).
 */

import "./schemaDir.js"; // must load before the T-4 platform (see schemaDir.ts)
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CASES, findCase, type ParityCase } from "./cases.js";
import { countLeaves, normalize } from "./normalize.js";
import { formatDiffs, structuralDiff, type DiffEntry } from "./diff.js";
import { produce as nodeProduce } from "./nodeProducer.js";
import { resolvePython, runPythonProducer } from "./pythonProducer.js";
import { seedAndDiff } from "./selfTest.js";

/** The parity root (…/packages/collectors/parity): the dir holding py/ and
 * fixtures/, whether running from source (vitest) or from parity/dist. */
export function parityRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [here, resolve(here, "..", ".."), resolve(here, "..")]) {
    if (existsSync(join(candidate, "py", "produce.py"))) return candidate;
  }
  throw new Error(`cannot locate the parity root from ${here}`);
}

export interface RunCaseOptions {
  /** Base output dir (default <parityRoot>/out). */
  outBase?: string;
  /** Inject a deliberate mismatch into the node side before diffing. */
  seed?: boolean;
}

export interface RunCaseResult {
  name: string;
  status: "ok" | "fail" | "error";
  diffs: DiffEntry[];
  /** Scalar fields compared after normalization. */
  leaves: number;
  error?: string;
  seededPath?: string;
}

export function runCase(
  c: ParityCase,
  root: string,
  opts: RunCaseOptions = {},
): RunCaseResult {
  const outBase = opts.outBase ?? join(root, "out");
  const fixturePath = join(root, "fixtures", c.fixture);
  const pyDir = join(outBase, "py", c.name);
  const nodeDir = join(outBase, "node", c.name);
  const fail = (error: string): RunCaseResult => ({
    name: c.name,
    status: "error",
    diffs: [],
    leaves: 0,
    error,
  });
  if (!existsSync(fixturePath)) return fail(`fixture missing: ${fixturePath}`);
  const python = resolvePython(root);
  if (python === null) {
    return fail(
      "no Python interpreter with llm_telemetry found " +
        "(set LLM_TELEMETRY_PARITY_PYTHON or LLM_TELEMETRY_MAIN_REPO)",
    );
  }
  try {
    runPythonProducer(python, root, fixturePath, pyDir, c.artifact, c.tag);
  } catch (err) {
    return fail(String(err));
  }
  try {
    nodeProduce(fixturePath, nodeDir, c.artifact, c.tag);
  } catch (err) {
    return fail(`node producer (T-4 platform writeArtifact) failed: ${String(err)}`);
  }

  const pyNorm = normalize(JSON.parse(readFileSync(join(pyDir, c.artifact), "utf8")) as unknown);
  const nodeNorm = normalize(JSON.parse(readFileSync(join(nodeDir, c.artifact), "utf8")) as unknown);
  const leaves = countLeaves(pyNorm);

  if (!opts.seed) {
    const diffs = structuralDiff(pyNorm, nodeNorm);
    return {
      name: c.name,
      status: diffs.length === 0 ? "ok" : "fail",
      diffs,
      leaves,
    };
  }
  const { seed, diffs } = seedAndDiff(pyNorm, nodeNorm);
  return {
    name: c.name,
    status: diffs.length === 0 ? "ok" : "fail",
    diffs,
    leaves,
    seededPath: seed.path,
  };
}

export interface RunParityOptions {
  out?: (line: string) => void;
  outBase?: string;
}

const USAGE = `usage: npm run parity -- [options] [case…]

cases: ${CASES.map((c) => c.name).join(", ")} (default: all)

Runs the Python producer (.venv/bin/python of the main checkout, read-only) and
the Node producer (T-4 collector platform) on the same fixture, then normalizes
(strip run-stamp timestamps, sort keys, round floats to documented precision)
and diffs both artifacts structurally. Exits 1 on any field-level difference.

options:
  --self-test       seed a deliberate mismatch and verify the harness detects
                    exactly that field (exit 0 = detected)
  --seed-mismatch   run with the seeded mismatch injected; a correct harness
                    reports it and exits 1 (testing hook)
  -h, --help        this text
`;

/** Dispatch. Returns the process exit code (0 ok, 1 diffs/error, 2 usage). */
export function runParity(argv: string[], opts: RunParityOptions = {}): number {
  const out = opts.out ?? ((line: string) => console.log(line));
  const selfTest = argv.includes("--self-test");
  const seed = argv.includes("--seed-mismatch");
  const names = argv.filter((a) => !a.startsWith("--"));
  if (argv.includes("-h") || argv.includes("--help")) {
    out(USAGE);
    return 0;
  }
  const selected: ParityCase[] = [];
  for (const name of names) {
    const c = findCase(name);
    if (!c) {
      console.error(`parity: unknown case '${name}' (see --help)`);
      return 2;
    }
    selected.push(c);
  }
  const cases = selected.length ? selected : [...CASES];
  const root = parityRoot();

  if (selfTest) {
    let ok = true;
    for (const c of cases) {
      const res = runCase(c, root, { outBase: opts.outBase, seed: true });
      if (res.status !== "fail" || res.diffs.length !== 1) {
        out(
          `self-test FAIL ${c.name}: seeded mismatch at ${res.seededPath ?? "?"} ` +
            `was NOT detected as exactly one field diff ` +
            `(${res.diffs.length} diffs, status ${res.status}${res.error ? `: ${res.error}` : ""})`,
        );
        ok = false;
        continue;
      }
      const d = res.diffs[0] as DiffEntry;
      const exact = d.kind === "value" && d.path === res.seededPath;
      out(
        `self-test ${exact ? "OK" : "FAIL"} ${c.name}: seeded mismatch detected ` +
          `at ${res.seededPath} (${d.path}, kind ${d.kind})`,
      );
      ok = ok && exact;
    }
    return ok ? 0 : 1;
  }

  let failed = 0;
  for (const c of cases) {
    const res = runCase(c, root, { outBase: opts.outBase, seed });
    if (res.status === "error") {
      out(`parity ${c.name}: ERROR — ${res.error ?? "unknown"}`);
      failed += 1;
      continue;
    }
    const label = seed ? " (seeded mismatch injected)" : "";
    if (res.status === "ok") {
      out(
        `parity ${c.name}: PARITY OK${label} — 0 differences ` +
          `(${res.leaves} fields compared: py vs node on ${c.fixture})`,
      );
      continue;
    }
    failed += 1;
    out(
      `parity ${c.name}: PARITY FAIL${label} — ${res.diffs.length} difference(s) ` +
        `(${res.leaves} fields compared: expected=py actual=node)`,
    );
    for (const line of formatDiffs(res.diffs)) out(`  ${line}`);
  }
  return failed === 0 ? 0 : 1;
}

const self = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? resolve(process.argv[1]) : null;
if (invoked && invoked === self) {
  process.exit(runParity(process.argv.slice(2)));
}
