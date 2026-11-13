/** Payload schema version — port of src/llm_telemetry/schema.py (T-4, LST-283).
 *
 * Every JSON payload the collectors write carries `schema_version`. The page
 * compares it against the same constant and refuses to render a shape it does
 * not understand. Bump whenever a payload's shape changes in a way an older
 * page (or an older collector) would misread — and bump the Python side with
 * it: both stacks stamp the SAME number into the SAME shared artifacts
 * (docs/plans/node-nextjs-migration.md §4 "Collectors as Node jobs").
 */

export const SCHEMA_VERSION = 3;

/** Return `payload` with `schema_version` set; mutates in place (parity with
 * Python's `stamp()`), so callers can keep building on the same object. */
export function stamp<T extends Record<string, unknown>>(payload: T): T {
  (payload as Record<string, unknown>)["schema_version"] = SCHEMA_VERSION;
  return payload;
}
