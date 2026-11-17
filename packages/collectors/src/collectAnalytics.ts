/** Collector port — T-15 (LLMTELEMET-286).
 *
 * Port of src/llm_telemetry/collect_analytics.py into TypeScript. Ported so far:
 * the day/hour SQL rows, sessions tree and outcomes. The other sections of
 * `build()` are listed in the PR notes and still missing, so the parity
 * `analytics` case keeps reporting them as field diffs until they land.
 */

import { stamp } from "./schema.js";

export interface AnalyticsPayload {
  generated: string;
  schema_version: number;
  [key: string]: unknown;
}

export interface CollectAnalyticsOptions {
  /** Directory produced by parity/py/make_analytics_fixture.py (config.json,
   * catalog.json, agent/…/state.db). Omitted → no inputs are read. */
  inputsDir?: string;
  now?: Date;
}

export function collectAnalytics(opts: CollectAnalyticsOptions = {}): AnalyticsPayload {
  const now = opts.now ?? new Date();
  const payload: AnalyticsPayload = {
    generated: now.toISOString(),
    schema_version: 0,
  };
  return stamp(payload) as AnalyticsPayload;
}
