// LLMTELEMET-291 (T-20 RUN B1): pure display helpers ported from the Python
// dashboard's bundled JS helpers; no invented values or local-time guesses.
import type { NumLike } from "./types";

/** Numeric coercion exactly as `+x || 0` in
 * src/llm_telemetry/web/js/views.js:1030-1035: numeric strings survive,
 * null/NaN/"" become 0. */
export const num = (value: unknown): number => +(value as number) || 0;

/** `generated` is a local, zone-less ISO string written by
 * `datetime.now().isoformat()` (src/llm_telemetry/collect_live.py:295) or a
 * numeric epoch in older artifacts. Port of freshness() in
 * src/llm_telemetry/web/js/palette.js:359-367: plain Date.parse (local time),
 * and values above 1e12 are millisecond epochs divided by 1000 and floored. */
export function parseGenerated(value: unknown): number | null {
  if (typeof value === "number") return epochSeconds(value);
  if (typeof value !== "string" || !value.trim()) return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value.trim())) return epochSeconds(Number(value));
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function epochSeconds(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return value > 1e12 ? Math.floor(value / 1000) : value;
}

/** Port of fmt() in src/llm_telemetry/web/js/palette.js:150. The name
 * `compact` is the T-20 convention; `fmt` keeps parity with the oracle. */
export const fmt = (value: NumLike): string => compact(value);

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

/** Binary byte units: port of fmtB() in
 * src/llm_telemetry/web/js/palette.js:152-156 (its `B` suffix is bytes,
 * not billions; toFixed uses two decimals below 10). */
export function fmtB(value: NumLike): string {
  const n = num(value);
  for (const [unit, divisor] of [
    ["TB", 1099511627776],
    ["GB", 1073741824],
    ["MB", 1048576],
    ["KB", 1024],
  ] as const) {
    if (n >= divisor) return (n / divisor).toFixed(n / divisor < 10 ? 2 : 1) + ` ${unit}`;
  }
  return `${Math.round(n)} B`;
}

/** Exact port of money() in src/llm_telemetry/web/js/palette.js:162:
 * falsy values (including 0) render an em dash, never $0.00. */
export function money(value: NumLike): string {
  if (!value) return "—";
  return (
    "$" +
    num(value).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** Port of short() in src/llm_telemetry/web/js/palette.js:164. */
export const short = (model: unknown): string =>
  model == null ? "" : String(model).split("/").pop() ?? "";

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
