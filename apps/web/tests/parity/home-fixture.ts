import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { resolvePython } from "./python";

// Playwright compiles the config as CJS or ESM depending on the package type;
// cwd is always the repo root for both `npx playwright test -c ...` and the
// workspace npm script, so no import.meta / __dirname assumption is needed.
const CWD = process.cwd();
const REPO_ROOT = basename(CWD) === "web" ? resolve(CWD, "..", "..") : CWD;
const WEB_ROOT = join(REPO_ROOT, "apps", "web");

/** Short deterministic temp path: Chrome fails on long Unix socket paths. */
export const FIX = join(tmpdir(), "lst291-home-fixture");
const READY = join(FIX, ".ready");

/** Copy the privacy-safe sample artifacts and freeze the Python page once.
 * Never writes examples/reports and never reads the live ~/.hermes reports. */
export function ensureFixture(): string {
  if (existsSync(READY) && existsSync(join(FIX, "dashboard.html"))) return FIX;
  rmSync(FIX, { recursive: true, force: true });
  mkdirSync(FIX, { recursive: true });
  const samples = join(REPO_ROOT, "examples", "reports");
  for (const name of readdirSync(samples)) {
    if (name.endsWith(".json")) copyFileSync(join(samples, name), join(FIX, name));
  }
  cpSync(join(samples, "sessions"), join(FIX, "sessions"), { recursive: true });
  writeFileSync(
    join(FIX, "config.json"),
    JSON.stringify({ reports_dir: FIX, profiles: [] }),
  );
  const python = resolvePython(WEB_ROOT);
  if (!python) throw new Error("LLM_TELEMETRY_PARITY_PYTHON is not set");
  const built = spawnSync(
    python,
    ["-m", "llm_telemetry.build_dashboard", join(FIX, "dashboard.html")],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120_000,
      env: {
        ...process.env,
        PYTHONPATH: join(REPO_ROOT, "src"),
        LLM_TELEMETRY_NO_COLLECT: "1",
        LLM_TELEMETRY_CONFIG: "examples/sample-config.json",
        LLM_TELEMETRY_AGENT_HOME: "examples/agent-home",
        LLM_TELEMETRY_CATALOG: "examples/reports/sample-catalog.json",
      },
    },
  );
  if (built.status !== 0) {
    throw new Error(`fixture build failed: ${built.stderr || built.stdout}`);
  }
  writeFileSync(READY, "ok\n");
  return FIX;
}
