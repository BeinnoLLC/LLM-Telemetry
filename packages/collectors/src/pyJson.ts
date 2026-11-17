/** Python-flavoured JSON reading and `str()`/`repr()` for the collector ports
 * (T-16, LLMTELEMET-287).
 *
 * `json.load` keeps `5.0` a float and `5` an int; `JSON.parse` folds both to the
 * number 5, so `repr(5.0)` ("5.0") is lost. Where a collector echoes a value
 * through `str()`/`repr()` (quota `_numstr`/`_text`) that matters, so
 * `parsePy` wraps INTEGRAL floats in `PyFloat` (using the source text that
 * Node 24's `JSON.parse` reviver exposes); every other number is a plain
 * `number`. Consumers unwrap with `num()`.
 */

export class PyFloat {
  constructor(readonly value: number) {}
}

type Src = { source?: string };

/** `json.loads` with integral floats preserved as `PyFloat`. */
export function parsePy(text: string): unknown {
  return JSON.parse(text, function (_k: string, v: unknown, ctx?: Src) {
    if (typeof v === "number" && Number.isInteger(v) && ctx?.source !== undefined && /[.eE]/.test(ctx.source)) {
      return new PyFloat(v);
    }
    return v;
  } as (this: unknown, key: string, value: unknown) => unknown);
}

/** The JS number inside a number / PyFloat, else null. */
export const num = (v: unknown): number | null =>
  v instanceof PyFloat ? v.value : typeof v === "number" ? v : null;

/** `repr(float)`: shortest round-trip digits, Python's exponent thresholds. */
export function floatRepr(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x < 0 ? "-inf" : "inf";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const [mant, expStr] = x.toExponential().split("e") as [string, string];
  const exp = Number(expStr);
  const neg = mant.startsWith("-");
  const digits = mant.replace("-", "").replace(".", "");
  let body: string;
  if (exp >= -4 && exp < 16) {
    if (exp >= 0) {
      const int = digits.padEnd(exp + 1, "0");
      const frac = int.slice(exp + 1) || digits.slice(exp + 1);
      body = int.slice(0, exp + 1) + "." + (frac || "0");
    } else {
      body = "0." + "0".repeat(-exp - 1) + digits;
    }
  } else {
    const m = digits.length > 1 ? `${digits[0] as string}.${digits.slice(1)}` : digits;
    const e = Math.abs(exp).toString().padStart(2, "0");
    body = `${m}e${exp < 0 ? "-" : "+"}${e}`;
  }
  return neg ? "-" + body : body;
}

function strRepr(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (ch === q || ch === "\\") out += "\\" + ch;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (cp < 0x20 || cp === 0x7f) out += "\\x" + cp.toString(16).padStart(2, "0");
    else out += ch;
  }
  return out + q;
}

/** `repr(x)` for JSON-shaped values. */
export function pyRepr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (v instanceof PyFloat) return floatRepr(v.value);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : floatRepr(v);
  if (typeof v === "string") return strRepr(v);
  if (Array.isArray(v)) return "[" + v.map(pyRepr).join(", ") + "]";
  if (typeof v === "object") {
    return "{" + Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${strRepr(k)}: ${pyRepr(x)}`).join(", ") + "}";
  }
  return String(v);
}

/** `str(x)`: like repr except a str is itself. */
export const pyStrOf = (v: unknown): string => (typeof v === "string" ? v : pyRepr(v));

const FLOAT_RE = /^[+-]?(?:(?:\d+(?:_\d+)*)(?:\.(?:\d+(?:_\d+)*)?)?|\.\d+(?:_\d+)*)(?:[eE][+-]?\d+(?:_\d+)*)?$/;

/** `float(str)`, or null where Python raises ValueError. */
export function parseFloatStr(s: string): number | null {
  const t = s.trim();
  if (/^[+-]?(inf|infinity)$/i.test(t)) return t.startsWith("-") ? -Infinity : Infinity;
  if (/^[+-]?nan$/i.test(t)) return NaN;
  if (!FLOAT_RE.test(t)) return null;
  return Number(t.replaceAll("_", ""));
}

/** `float(x)` for a JSON-shaped value; null on TypeError/ValueError. Booleans
 * count (Python `float(True)`), as do numeric strings. */
export function pyFloat(v: unknown): number | null {
  const n = num(v);
  if (n !== null) return n;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") return parseFloatStr(v);
  return null;
}
