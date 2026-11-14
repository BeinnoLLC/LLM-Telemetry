/** Normalize step of the parity harness — T-5 (LLMTELEMET-284).
 *
 * Migration plan §7.3: "Normalize (drop `generated`/`at` timestamps, sort
 * object keys)". Two stacks writing the same numbers must still differ in the
 * fields that describe the RUN (wall-clock stamps) rather than the DATA, so
 * those are dropped before the structural diff. Documented rules, applied at
 * every depth:
 *
 *  1. Run-stamp keys are dropped (RUN_STAMP_KEYS, case-insensitive). These are
 *     keys whose value is produced from the clock at run time (`generated`,
 *     `ts`, `as_of`, `fetched`, `age`, …) — see the list below. Values under
 *     any other key (event dates, quota windows, model names) are NEVER
 *     touched: they come from the same fixtures on both sides and must match.
 *  2. Object keys are sorted lexicographically, so Python dict order vs Node
 *     object order cannot produce noise ("ordering", plan §7.3).
 *  3. Floats are rounded to FLOAT_DIGITS decimals — the one documented float
 *     formatting tolerance of plan §7.3 ("no tolerances except documented
 *     formatting"). Integers (tokens, USD scaled, counts) are compared EXACTLY
 *     and never rounded. -0 normalizes to 0.
 *  4. Array order is preserved: ordering is data (rows, series, chains). A
 *     producer that reorders an array is a parity failure, not noise.
 *
 * The result is a plain JSON value with deterministic key order, safe to
 * JSON.stringify-compare across runs and stacks.
 */

/** Keys dropped at every depth, matched case-insensitively. Wall-clock /
 * run-stamp fields only — see rule 1 above. */
export const RUN_STAMP_KEYS: readonly string[] = [
  "generated",
  "generated_at",
  "collected_at",
  "updated_at",
  "written_at",
  "as_of",
  "at",
  "ts",
  "timestamp",
  "now",
  "fetched",
  "age",
  "reset_at",
  "expires_at",
  "seen_at",
  "last_seen",
  "started_at",
  "finished_at",
];

/** The documented float formatting tolerance (plan §7.3). */
export const FLOAT_DIGITS = 6;

export interface NormalizeOptions {
  /** Override the dropped-key list (defaults to RUN_STAMP_KEYS). */
  dropKeys?: readonly string[];
  /** Override the float rounding precision (defaults to FLOAT_DIGITS). */
  floatDigits?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function roundFloat(n: number, digits: number): number {
  if (Number.isInteger(n)) return n === 0 ? 0 : n; // exact; also folds -0 to 0
  const rounded = Number(n.toFixed(digits));
  return rounded === 0 ? 0 : rounded;
}

function walk(
  value: unknown,
  drop: ReadonlySet<string>,
  digits: number,
): unknown {
  if (typeof value === "number") return roundFloat(value, digits);
  if (Array.isArray(value)) return value.map((v) => walk(v, drop, digits));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (drop.has(key.toLowerCase())) continue;
      out[key] = walk(value[key], drop, digits);
    }
    return out;
  }
  return value; // string | boolean | null
}

/** Normalize a parsed JSON value. Pure: the input is never mutated. */
export function normalize(value: unknown, opts: NormalizeOptions = {}): unknown {
  const drop = new Set((opts.dropKeys ?? RUN_STAMP_KEYS).map((k) => k.toLowerCase()));
  return walk(value, drop, opts.floatDigits ?? FLOAT_DIGITS);
}

/** Parse JSON text and normalize it in one step. */
export function normalizeText(text: string, opts: NormalizeOptions = {}): unknown {
  return normalize(JSON.parse(text) as unknown, opts);
}

/** Number of scalar leaves (strings, numbers, booleans, nulls) — the "fields
 * compared" count the harness reports. */
export function countLeaves(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce<number>((n, v) => n + countLeaves(v), 0);
  }
  if (isRecord(value)) {
    return Object.values(value).reduce<number>((n, v) => n + countLeaves(v), 0);
  }
  return 1;
}
