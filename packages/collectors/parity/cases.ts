/** Parity case registry — T-5 (LLMTELEMET-284).
 *
 * One case per artifact shape both stacks can already produce today (T-4
 * writer + schema check on the Python side, T-4 `writeArtifact` on the Node
 * side). When T-6/T-15/T-16/T-17 land their collectors, each case swaps its
 * generic fixture producer for the real `python -m llm_telemetry.collect_*` /
 * `node cli.js <cmd>` pair without touching the harness.
 *
 * Fixtures are byte-identical copies of `examples/reports/*.json` (the
 * scrubbed sample artifacts), so "the same inputs" is literally true for both
 * producers; run-stamp fields inside them are handled by `normalize()`.
 */

import type { SchemaTag } from "../src/schemaCheck.js";

export interface ParityCase {
  /** CLI name: `npm run parity -- live`. */
  name: string;
  /** Fixture file under parity/fixtures/. */
  fixture: string;
  /** Artifact filename both producers write. */
  artifact: string;
  /** Payload schema tag both stacks validate at write time (T-4 writer). */
  tag: SchemaTag;
}

export const CASES: readonly ParityCase[] = [
  {
    name: "live",
    fixture: "live-data.json",
    artifact: "live-data.json",
    tag: "live",
  },
  {
    name: "analytics",
    fixture: "analytics-data.json",
    artifact: "analytics-data.json",
    tag: "analytics",
  },
  {
    name: "ollama",
    fixture: "ollama-data.json",
    artifact: "ollama-data.json",
    tag: "ollama",
  },
  {
    name: "router",
    fixture: "router-data.json",
    artifact: "router-data.json",
    tag: "router",
  },
];

export function findCase(name: string): ParityCase | undefined {
  return CASES.find((c) => c.name === name);
}
