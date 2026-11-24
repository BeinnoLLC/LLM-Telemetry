import { spawn, spawnSync, type ChildProcess } from "node:child_process";
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

/** The one privacy-locked sample env used by Home, Life and Flow fixtures.
 * Never omit NO_COLLECT: a bare build would read the real reports dir. */
export function pythonSampleEnv(repoRoot: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PYTHONPATH: join(repoRoot, "src"),
    LLM_TELEMETRY_NO_COLLECT: "1",
    LLM_TELEMETRY_CONFIG: "examples/sample-config.json",
    LLM_TELEMETRY_AGENT_HOME: "examples/agent-home",
    LLM_TELEMETRY_CATALOG: "examples/reports/sample-catalog.json",
  };
}

/** Serve the frozen fixture through the real NoCacheHandler on an ephemeral
 * port. Shared by Home (T-20) and Life/Flow (T-21) parity specs. */
export function startParityOracle(
  fixture: string,
  python: string,
  repoRoot: string,
  webRoot: string,
): { child: ChildProcess; port: Promise<number> } {
  const oracle = join(webRoot, "tests", "parity", "serve_static.py");
  const child = spawn(python, [oracle, join(repoRoot, "src"), fixture], {
    cwd: webRoot,
    env: { ...process.env, PYTHONPATH: join(repoRoot, "src") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const port = new Promise<number>((ok, fail) => {
    let out = "";
    const timer = setTimeout(() => fail(new Error(`oracle timeout: ${stderr}`)), 15_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`oracle exited ${code}: ${stderr}`));
    });
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const match = /(\d{2,5})/.exec(out);
      if (match) {
        clearTimeout(timer);
        ok(Number(match[1]));
      }
    });
  });
  return { child, port };
}
