import * as fs from "node:fs";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { testScratchRoot } from "../../src/artifactWriter.js";

/** Per-test scratch dir. Honours LLM_TELEMETRY_TEST_TMP so verification runs
 * never spill into /tmp; falls back to the OS temp dir elsewhere (CI). */
export function makeTmpDir(prefix: string): string {
  const root = testScratchRoot();
  fs.mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, prefix));
}

export function listDir(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}
