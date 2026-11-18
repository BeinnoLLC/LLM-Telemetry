/** Python-runtime semantics the ports must reproduce — T-15 (LLMTELEMET-286).
 *
 * The parity gate compares Python and Node JSON byte for byte in structure,
 * so the places where the runtimes silently disagree are pinned here instead
 * of being sprinkled through the collectors:
 *
 * - `round()` — CPython rounds the EXACT binary value of the double with
 *   ties-to-even (`round(2.675, 2) == 2.67`), and `round(int, n)` returns an
 *   `int`. Math.round is ties-up on the same double and cannot reproduce it.
 * - `int(x)` — truncate toward zero (Math.trunc), not Math.floor for negatives.
 * - `str` slicing / `len()` count CODE POINTS, not UTF-16 code units, so an
 *   emoji is 1 for Python and 2 for `String.length`.
 * - `str.title()` — upper-case the first letter of every maximal ASCII/Unicode
 *   letter run and lower-case the rest (`"they're".title() == "They'Re"`).
 * - `str.rstrip()` with no argument strips Unicode whitespace.
 *
 * Regex note: Python's `re` gives `\w` and `\b` Unicode meaning for `str`
 * patterns while JavaScript's do not. Pattern ports therefore spell word
 * boundaries as `(?<![\p{L}\p{N}_])` / `(?![\p{L}\p{N}_])` and word
 * characters as `[\p{L}\p{N}_]` under the `u` flag.
 */

const F64 = new DataView(new ArrayBuffer(8));

/** Exact decimal expansion of a double: value = digits * 10^(-fracDigits). */
function exactDecimal(x: number): { neg: boolean; digits: bigint; fracDigits: number } {
  F64.setFloat64(0, x);
  const hi = F64.getUint32(0);
  const lo = F64.getUint32(4);
  const neg = (hi >>> 31) === 1;
  let exp = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (exp === 0) {
    exp = 1; // subnormal
  } else {
    mant |= 1n << 52n; // implicit leading bit
  }
  // x = mant * 2^(exp - 1075)
  const shift = exp - 1075;
  if (shift >= 0) {
    return { neg, digits: mant << BigInt(shift), fracDigits: 0 };
  }
  const k = -shift;
  // mant / 2^k == mant * 5^k / 10^k
  return { neg, digits: mant * 5n ** BigInt(k), fracDigits: k };
}

/** Round `digits * 10^-fracDigits` to `places` fractional digits, ties to
 * even, on the exact value (this is what makes 2.675 land on 2.67). The
 * result is built as a decimal STRING and parsed back: multiplying the digit
 * count by 10^-places would round twice and return 1.2345679999999999 for
 * round(1.2345678, 6) where Python returns 1.234568. */
function roundExpansion(neg: boolean, digits: bigint, fracDigits: number, places: number): number {
  let value = digits;
  if (fracDigits > places) {
    const drop = fracDigits - places;
    const base = 10n ** BigInt(drop);
    const q = value / base;
    const r = value % base;
    const half = base / 2n;
    value = r > half || (r === half && q % 2n === 1n) ? q + 1n : q;
  } else {
    value = value * 10n ** BigInt(places - fracDigits);
  }
  const s = value.toString();
  const point = s.length - places;
  const str =
    places === 0
      ? s
      : point <= 0
        ? `0.${"0".repeat(-point)}${s}`
        : `${s.slice(0, point)}.${s.slice(point)}`;
  const out = Number(str);
  return neg ? -out : out;
}

/** `round(x)` — nearest integer, ties to even (Python: `round(2.5) == 2`).
 * Python's no-ndigits round returns an `int`, so -0.5 folds to 0, not -0. */
export function pyRound0(x: number): number {
  return pyRound(x, undefined);
}

/** `round(x, nd)` with CPython tie-to-even on the exact value. */
export function pyRound(x: number, nd?: number): number {
  if (!Number.isFinite(x)) return x;
  const places = nd === undefined ? 0 : nd;
  const { neg, digits, fracDigits } = exactDecimal(x);
  const rounded = roundExpansion(neg, digits, fracDigits, places);
  if (nd === undefined) return rounded === 0 ? 0 : rounded;
  return rounded;
}

/** `int(x)` — truncate toward zero. */
export function pyInt(x: number): number {
  return Math.trunc(x);
}

/** `len(s)` — code points, not UTF-16 units. `null`/`undefined` is `""`. */
export function pyLen(s: string | null | undefined): number {
  return Array.from(s ?? "").length;
}

/** `s[:n]` / `s[a:b]` on code points. */
export function pySlice(s: string | null | undefined, start: number, end?: number): string {
  const chars = Array.from(s ?? "");
  return chars.slice(start, end === undefined ? undefined : end).join("");
}

/** `s.rstrip()` — strip trailing Unicode whitespace. */
export function pyRstrip(s: string): string {
  return s.replace(/\s+$/u, "");
}

/** `str.title()` — capitalise each maximal letter run (Python's title()). */
export function pyTitle(s: string): string {
  return s.replace(
    /\p{L}+/gu,
    (word) => word.slice(0, 1).toUpperCase() + word.slice(1).toLowerCase(),
  );
}

/** POSIX `os.path.basename` — splits on "/" only and strips NO trailing
 * slashes (basename("a/b/") == ""; callers that rstrip first say so). */
export function pyBasename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

/** Python `float(x or 0)`: falsy values are 0, anything unparseable raises. */
export function pyFloatOr0(v: unknown): number {
  if (v === null || v === undefined || v === "" || v === 0 || v === false) return 0;
  const n = Number(v);
  if (Number.isNaN(n)) throw new TypeError(`float() argument: ${String(v)}`);
  return n;
}

/** Python `re.sub` with a global flag and a plain-string replacement: the `$`
 * escapes in JS replacement strings (`$&`, `$'`…) are not Python's, so the
 * replacement is taken literally. */
export function pySub(re: RegExp, replacement: string, s: string): string {
  return s.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`), () => replacement);
}
