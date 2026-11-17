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

import { collectAnalytics } from "../src/collectAnalytics.js";
import { collectRouter } from "../src/collectRouter.js";
import { Config, loadWithAgentHome } from "../src/config.js";
import { join } from "node:path";
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
  /** When set, the node side runs this real collector instead of copying the
   * fixture, so a stub/incomplete port FAILS parity instead of passing. For a
   * `dbInputs` case it receives the generated inputs dir. */
  nodeCollector?: (inputsDir: string, nowS: number) => Record<string, unknown>;
  /** When set, BOTH producers read generated DB inputs (the analytics fixture
   * generator under py/) instead of the JSON fixture: the Python side runs its
   * real collector (py/produce_analytics.py), the Node side `nodeCollector`. */
  dbInputs?: boolean;
  /** Generated-inputs case for a collector other than analytics (T-16): the
   * `py/` scripts that build the inputs dir and run the real Python collector
   * on it (`<generator> OUT`, `<producer> INPUTS OUT ARTIFACT`). */
  inputs?: { generator: string; producer: string };
}

/** Config for a generated inputs dir (profiles under <inputs>/agent). */
export function inputsConfig(inputsDir: string): Config {
  return loadWithAgentHome(join(inputsDir, "config.json"), join(inputsDir, "agent"));
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
    dbInputs: true,
    nodeCollector: (inputsDir, nowS) => collectAnalytics({ inputsDir, now: new Date(nowS * 1000) }),
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
    inputs: { generator: "make_router_fixture.py", producer: "produce_router.py" },
    nodeCollector: (inputsDir, nowS) =>
      collectRouter({ cfg: inputsConfig(inputsDir), now: new Date(nowS * 1000) }),
  },
];

export function findCase(name: string): ParityCase | undefined {
  return CASES.find((c) => c.name === name);
}
