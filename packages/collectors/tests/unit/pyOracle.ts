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
