// LLMTELEMET-291 (T-20 RUN B1): the page/collector shape contract.
// Keep in sync with SCHEMA_VERSION in src/llm_telemetry/schema.py:13 (== 3).
export const EXPECTED_SCHEMA_VERSION = 3;

/** Refuse a shape we do not understand instead of drawing empty cards.
 * Port of the boot-time refusal in src/llm_telemetry/web/js/main.js:26-29. */
export function checkSchemaVersion(section: string, version: unknown): void {
  if (version === EXPECTED_SCHEMA_VERSION) return;
  const got = version === undefined ? "missing" : JSON.stringify(version);
  throw new Error(
    `${section}: schema_version ${got} does not match page version ` +
      `${EXPECTED_SCHEMA_VERSION} (src/llm_telemetry/schema.py:13). ` +
      "Refusing to render a payload shape this page does not understand; " +
      "regenerate the collector artifacts.",
  );
}
