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
import { collectProbe, ProbeError } from "../src/collectProbe.js";
import { collectLogs } from "../src/collectLogs.js";
import { collectTranscripts } from "../src/collectTranscripts.js";
import { readFileSync } from "node:fs";
import { collectRankings } from "../src/collectRankings.js";
import { parsePy } from "../src/pyJson.js";
import { collectSessionTimelines } from "../src/collectSessionTimeline.js";
import { collectQuota } from "../src/collectQuota.js";
import { collectRouter } from "../src/collectRouter.js";
import { build as buildCosts } from "../src/collectCosts.js";
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
  /** null = the artifact has no payload schema (quota). */
  tag: SchemaTag | null;
  /** When set, the node side runs this real collector instead of copying the
   * fixture, so a stub/incomplete port FAILS parity instead of passing. For a
   * `dbInputs` case it receives the generated inputs dir. */
  nodeCollector?: (
    inputsDir: string,
    nowS: number,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /** When set, BOTH producers read generated DB inputs (the analytics fixture
   * generator under py/) instead of the JSON fixture: the Python side runs its
   * real collector (py/produce_analytics.py), the Node side `nodeCollector`. */
  dbInputs?: boolean;
  /** Generated-inputs case for a collector other than analytics (T-16): the
   * `py/` scripts that build the inputs dir and run the real Python collector
   * on it (`<generator> OUT`, `<producer> INPUTS OUT ARTIFACT`). */
  inputs?: { generator: string; producer: string };
  /** Run-stamp keys (see normalize RUN_STAMP_KEYS) that are DATA for this case
   * and must be compared: logs/transcripts `ts` come from the DB / log lines,
   * not from the clock. */
  keepKeys?: readonly string[];
  /** Extra clock-derived keys to drop for this case (rankings `fetched_at`). */
  extraDropKeys?: readonly string[];
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
    inputs: { generator: "make_probe_fixture.py", producer: "produce_probe.py" },
    nodeCollector: (inputsDir, nowS) => {
      const canned = JSON.parse(readFileSync(join(inputsDir, "probe-canned.json"), "utf8")) as {
        local_ips: string[]; primary_ips: string[]; load: Record<string, unknown>;
        responses: Record<string, { body: string; ms: number } | { error: { reason: string; url_error: boolean } }>;
        caps: Record<string, string[]>;
      };
      return collectProbe({
        cfg: inputsConfig(inputsDir),
        now: new Date(nowS * 1000),
        env: { localIps: () => canned.local_ips, primaryIps: () => canned.primary_ips, machineLoad: () => canned.load },
        transport: {
          get: (url) => {
            const r = canned.responses[url];
            if (!r) throw new ProbeError("no canned response");
            if ("error" in r) throw new ProbeError(r.error.reason, r.error.url_error);
            return r;
          },
          caps: (_base, model) => canned.caps[model] ?? [],
        },
      });
    },
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
  {
    name: "quota",
    fixture: "quota-data.json",
    artifact: "quota-data.json",
    tag: null,
    inputs: { generator: "make_quota_fixture.py", producer: "produce_quota.py" },
    nodeCollector: (inputsDir, nowS) =>
      collectQuota({ cfg: inputsConfig(inputsDir), now: new Date(nowS * 1000) }),
  },
  {
    name: "logs",
    fixture: "logs-data.json",
    artifact: "logs-data.json",
    tag: null,
    inputs: { generator: "make_logs_fixture.py", producer: "produce_logs.py" },
    keepKeys: ["ts"],
    nodeCollector: (inputsDir, nowS) =>
      collectLogs({ cfg: inputsConfig(inputsDir), now: new Date(nowS * 1000) }),
  },
  {
    name: "transcripts",
    fixture: "transcripts.json",
    artifact: "transcripts.json",
    tag: null,
    inputs: { generator: "make_logs_fixture.py", producer: "produce_transcripts.py" },
    keepKeys: ["ts"],
    nodeCollector: (inputsDir, nowS) =>
      collectTranscripts({ cfg: inputsConfig(inputsDir), now: new Date(nowS * 1000) }),
  },
  {
    name: "rankings",
    fixture: "rankings-data.json",
    artifact: "rankings-data.json",
    tag: null,
    extraDropKeys: ["fetched_at"],
    inputs: { generator: "make_rankings_fixture.py", producer: "produce_rankings.py" },
    nodeCollector: (inputsDir) =>
      collectRankings({
        today: "2026-11-17",
        env: { OPENROUTER_API_KEY: "dummy" },
        previous: null,
        fetcher: () => ({
          resp: parsePy(readFileSync(join(inputsDir, "rankings-response.json"), "utf8")),
          reason: null,
        }),
      }),
  },
  {
    // The real collector writes sessions/<profile>/<id>.json; the harness diffs
    // the merged build_all() view (fixture is a placeholder, see produce_timeline.py).
    name: "timeline",
    fixture: "session-timelines.json",
    artifact: "session-timelines.json",
    tag: null,
    keepKeys: ["ts"],
    inputs: { generator: "make_timeline_fixture.py", producer: "produce_timeline.py" },
    nodeCollector: (inputsDir, nowS) =>
      collectSessionTimelines({ cfg: inputsConfig(inputsDir), now: new Date(nowS * 1000) }),
  },
  {
    // T-17 (LLMTELEMET-288). Both producers read the same fixed reports dir,
    // pinned catalogue and config. build() is async on the Node side because
    // fetchCatalog() is async; the harness awaits it (see cli.ts / nodeProducer.ts).
    name: "costs",
    fixture: "costs-data.json",
    artifact: "costs-data.json",
    tag: null,
    inputs: { generator: "make_costs_fixture.py", producer: "produce_costs.py" },
    nodeCollector: async (inputsDir) => {
      const keys = [
        "LLM_TELEMETRY_CONFIG",
        "LLM_TELEMETRY_CATALOG",
        "LLM_TELEMETRY_AGENT_HOME",
        "LLM_TELEMETRY_NO_COLLECT",
      ] as const;
      const saved = keys.map((k) => process.env[k]);
      process.env["LLM_TELEMETRY_CONFIG"] = join(inputsDir, "config.json");
      process.env["LLM_TELEMETRY_CATALOG"] = join(inputsDir, "catalog.json");
      process.env["LLM_TELEMETRY_AGENT_HOME"] = join(inputsDir, "agent");
      process.env["LLM_TELEMETRY_NO_COLLECT"] = "1";
      // Read the same generated config the Python producer uses, and fail here
      // if the fixture is malformed rather than deep inside the collector.
      inputsConfig(inputsDir);
      try {
        return await buildCosts();
      } finally {
        keys.forEach((k, i) => {
          const value = saved[i];
          if (value === undefined) delete process.env[k];
          else process.env[k] = value;
        });
      }
    },
  },
];

export function findCase(name: string): ParityCase | undefined {
  return CASES.find((c) => c.name === name);
}
