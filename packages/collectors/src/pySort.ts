/** Python-compatible string ordering (by code point, not UTF-16 unit). */
export function cmpStr(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const d = (x[i] as string).codePointAt(0)! - (y[i] as string).codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/** Python `json.dumps(v, separators=(",",":"), sort_keys=True)` incl. the
 * default `ensure_ascii=True` escaping of non-ASCII as \uXXXX. */
export function dumpsSorted(v: unknown): string {
  const esc = (s: string): string =>
    JSON.stringify(s).replace(/[\u007f-￿]/gu, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  const walk = (x: unknown): string => {
    if (x === null || x === undefined) return "null";
    if (typeof x === "string") return esc(x);
    if (typeof x === "number" || typeof x === "boolean") return JSON.stringify(x);
    if (Array.isArray(x)) return "[" + x.map(walk).join(",") + "]";
    const o = x as Record<string, unknown>;
    return "{" + Object.keys(o).sort(cmpStr).map((k) => esc(k) + ":" + walk(o[k])).join(",") + "}";
  };
  return walk(v);
}
