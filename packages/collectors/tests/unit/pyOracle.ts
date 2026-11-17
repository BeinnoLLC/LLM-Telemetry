import { spawnSync } from "node:child_process";
import { resolvePython } from "../../parity/pythonProducer.js";

/** Python oracle: run `fn(args)` from `llm_telemetry.<module>` in the main
 * checkout's venv and return the JSON result. Used to compare ports field by
 * field. `kwargs` is spread as keyword arguments. */
export function pyCall(module: string, fn: string, args: unknown[], kwargs: Record<string, unknown> = {}): unknown {
  const py = resolvePython(process.cwd());
  if (py === null) throw new Error("no python with llm_telemetry (set LLM_TELEMETRY_PARITY_PYTHON)");
  const code =
    "import sys,json,importlib\n" +
    "a=json.load(sys.stdin)\n" +
    `m=importlib.import_module('llm_telemetry.${module}')\n` +
    `r=getattr(m,'${fn}')(*a['args'],**a['kwargs'])\n` +
    "sys.stdout.write(json.dumps(r,default=str))\n";
  const res = spawnSync(py, ["-I", "-c", code], {
    input: JSON.stringify({ args, kwargs }),
    encoding: "utf8",
    timeout: 60_000,
  });
  if (res.status !== 0) throw new Error(`python oracle failed: ${res.stderr}`);
  return JSON.parse(res.stdout) as unknown;
}

/** Run a Python snippet against a generated analytics inputs dir (see
 * parity/py/make_analytics_fixture.py) with HOME/config/catalogue pointed into
 * it, and return its JSON `result`. `C` is `llm_telemetry.collect_analytics`
 * and `con` a read-only sqlite3 connection on `dbPath`. */
export function pyAnalytics(inputsDir: string, dbPath: string, body: string, agentHome = `${inputsDir}/agent`): unknown {
  const py = resolvePython(process.cwd());
  if (py === null) throw new Error("no python with llm_telemetry (set LLM_TELEMETRY_PARITY_PYTHON)");
  const code =
    "import sys,json,sqlite3\n" +
    `from llm_telemetry import collect_analytics as C, pricing\n` +
    `con=sqlite3.connect('file:${dbPath}?mode=ro',uri=True)\n` +
    `${body}\n` +
    "sys.stdout.write(json.dumps(result,default=str))\n";
  const res = spawnSync(py, ["-I", "-c", code], {
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      HOME: `${inputsDir}/home`,
      LLM_TELEMETRY_CONFIG: `${inputsDir}/config.json`,
      LLM_TELEMETRY_CATALOG: `${inputsDir}/catalog.json`,
      LLM_TELEMETRY_AGENT_HOME: agentHome,
    },
  });
  if (res.status !== 0) throw new Error(`python oracle failed: ${res.stderr}`);
  return JSON.parse(res.stdout) as unknown;
}
