// LLMTELEMET-291 (T-20 RUN B1): pure display helpers ported from the Python
// dashboard's bundled JS helpers; no invented values or local-time guesses.
import type { NumLike } from "./types";

/** Numeric coercion exactly as `+x || 0` in
 * src/llm_telemetry/web/js/views.js:1030-1035: numeric strings survive,
 * null/NaN/"" become 0. */
export const num = (value: unknown): number => +(value as number) || 0;

/** `generated` is ISO in current artifacts and a numeric epoch in older ones
 * (RUN B risks). Timezone-less sample ISO strings are UTC, as in the frozen
 * parity fixture: src/llm_telemetry/web/dashboard.html sample data. */
export function parseGenerated(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const epoch = Number(value);
  if (Number.isFinite(epoch)) return epoch;
  const utc =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) &&
    !/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)
      ? `${value}Z`
      : value;
  const ms = Date.parse(utc);
  return Number.isFinite(ms) ? ms / 1000 : null;
}

/** Compact number: port of fmt() in
 * src/llm_telemetry/web/js/palette.js:150 (B/M/K suffixes, one decimal). */
export function compact(value: NumLike): string {
  const n = num(value);
  for (const [unit, divisor] of [
    ["B", 1e9],
    ["M", 1e6],
    ["K", 1e3],
  ] as const) {
    if (n >= divisor) return (n / divisor).toFixed(1) + unit;
  }
  return String(Math.round(n));
}

/** Short age shown in the UI: port of ago() in
 * src/llm_telemetry/web/js/palette.js:253 (s/m/h/d, rounded). */
export function ago(seconds: NumLike): string {
  const s = num(seconds);
  return s < 60
    ? `${s}s`
    : s < 3600
      ? `${Math.round(s / 60)}m`
      : s < 172800
        ? `${Math.round(s / 3600)}h`
        : `${Math.round(s / 86400)}d`;
}

/** Compact age used by the Python collectors: port of age_label() in
 * src/llm_telemetry/pricing.py:257 (floor, no unit for sub-minute). */
export function ageLabel(seconds: NumLike): string {
  if (seconds == null) return "";
  const s = Math.max(0, Math.trunc(num(seconds)));
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
