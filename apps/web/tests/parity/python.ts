import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** From packages/collectors/parity/pythonProducer.ts — no hardcoded home paths. */
export function resolvePython(here: string): string | null {
  const envPy = process.env["LLM_TELEMETRY_PARITY_PYTHON"];
  if (envPy) return envPy;
  const res = spawnSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: here,
    encoding: "utf8",
  });
  if (res.status !== 0 || !res.stdout.trim()) return null;
  const mainRepo = dirname(resolve(here, res.stdout.trim()));
  const python = join(mainRepo, ".venv", "bin", "python");
  return existsSync(python) ? python : null;
}
