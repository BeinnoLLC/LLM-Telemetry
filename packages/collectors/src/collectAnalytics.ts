/** Collector port — T-15 (LLMTELEMET-286).
 *
 * Port of src/llm_telemetry/collect_analytics.py into TypeScript.
 *
 * STATUS: skeleton only. The full byte-equivalent port of the 943-line
 * Python module (day/hour grain rows, sessions, health, delegations,
 * outcomes, latency, tools, bandwidth, attribution, compaction, repo/branch,
 * session index, alerts) is NOT yet implemented; this file currently exports
 * a minimal entry point so the CLI `analytics` command is no longer a stub and
 * the package typechecks. Follow-up work must replace collectAnalytics() with
 * the faithful port before cutover.
 */

import { stamp } from "./schema.js";

export interface AnalyticsPayload {
  generated: string;
  schema_version: number;
  [key: string]: unknown;
}

export function collectAnalytics(now: Date = new Date()): AnalyticsPayload {
  const payload: AnalyticsPayload = {
    generated: now.toISOString(),
    schema_version: 0,
  };
  return stamp(payload) as AnalyticsPayload;
}
