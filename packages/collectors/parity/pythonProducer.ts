/** Python-side producer runner — T-5 (LLMTELEMET-284).
 *
 * The Python producer is `parity/py/produce.py`, executed with
 * `.venv/bin/python` of the MAIN repo checkout (read-only: the harness never
 * writes into the main checkout, the Python tree or the running :8477
 * service). That interpreter is the one with `llm_telemetry` installed, so the
 * producer can run the real Python `stamp()` + `schema_check.check()` + the
 * collectors' atomic-write/serialization convention.
 *
 * Interpreter resolution order:
 *   1. $LLM_TELEMETRY_PARITY_PYTHON — explicit interpreter (CI)
 *   2. <main-repo>/.venv/bin/python, where <main-repo> is
 *      $LLM_TELEMETRY_MAIN_REPO or the git common dir of the current checkout
 *      (a worktree resolves to its main checkout, which is where .venv lives).
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function mainRepoRoot(here: string): string | null {
  const envRoot = process.env["LLM_TELEMETRY_MAIN_REPO"];
  if (envRoot) return resolve(envRoot);
  const res = spawnSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: here,
    encoding: "utf8",
  });
  if (res.status !== 0 || !res.stdout.trim()) return null;
  // In a linked worktree this is <main>/.git; in the main checkout it is .git.
  return dirname(resolve(here, res.stdout.trim()));
}

export function resolvePython(here: string): string | null {
  const envPy = process.env["LLM_TELEMETRY_PARITY_PYTHON"];
  if (envPy) return envPy;
  const root = mainRepoRoot(here);
  if (root === null) return null;
  const py = join(root, ".venv", "bin", "python");
  return existsSync(py) ? py : null;
}

export interface PythonProduceResult {
  path: string;
  stdout: string;
}

/** Run parity/py/produce.py: fixture -> stamped, schema-checked artifact in
 * `outDir`, using the Python stack's write path. Throws on any failure. */
export function runPythonProducer(
  python: string,
  parityRoot: string,
  fixturePath: string,
  outDir: string,
  artifact: string,
  tag: string,
): PythonProduceResult {
  const script = join(parityRoot, "py", "produce.py");
  const res = spawnSync(python, [script, fixturePath, outDir, artifact, tag], {
    cwd: parityRoot,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (res.error) {
    throw new Error(`python producer did not run: ${String(res.error)}`);
  }
  if (res.status !== 0) {
    throw new Error(
      `python producer failed (exit ${String(res.status)}): ` +
        `${res.stderr.trim() || res.stdout.trim() || "no output"}`,
    );
  }
  return { path: join(outDir, artifact), stdout: res.stdout.trim() };
}
