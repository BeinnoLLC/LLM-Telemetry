/** Pin the shared JSON-schema dir BEFORE any T-4 platform module loads — T-5
 * (LLMTELEMET-284).
 *
 * `src/schemaCheck.ts` resolves `src/llm_telemetry/schema/` relative to its own
 * file (two levels up from the module). That is correct from `src/` under
 * vitest and from the flat T-4 `dist/`, but the parity build nests the shared
 * modules under `parity/dist/…`, where the heuristic walks off into the woods.
 *
 * This module is imported FIRST (ESM evaluates imports in declaration order,
 * so this runs before schemaCheck's module-initialiser) and exports the schema
 * dir through `LLM_TELEMETRY_SCHEMA_DIR`, the documented override in
 * schemaCheck.ts. An explicitly set env var always wins; this never guesses —
 * it only accepts a directory that actually contains the schemas.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function resolveSchemaDir(): string | null {
  if (process.env["LLM_TELEMETRY_SCHEMA_DIR"]) return null; // explicit wins
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, "src", "llm_telemetry", "schema");
    if (existsSync(join(candidate, "live.schema.json"))) return resolve(candidate);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const found = resolveSchemaDir();
if (found !== null) {
  process.env["LLM_TELEMETRY_SCHEMA_DIR"] = found;
}
