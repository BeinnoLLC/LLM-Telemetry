/** Structural JSON diff with readable, field-level output — T-5
 * (LLMTELEMET-284), migration plan §7.3 ("diff the JSON structurally; the
 * harness prints a field-level diff and exits non-zero on any value mismatch").
 *
 * Both inputs are `normalize()`-ed values. The comparison is exact (numbers
 * already carry the one documented float tolerance from normalize); there are
 * no thresholds here. Paths are RFC 6901 JSON Pointers so a reported field is
 * unambiguous even inside arrays.
 */

export type DiffKind = "value" | "type" | "missing" | "extra";

export interface DiffEntry {
  /** RFC 6901 JSON Pointer into the compared documents ("" = root). */
  path: string;
  kind: DiffKind;
  /** Value on the expected (reference) side — Python, per plan §7. */
  expected?: unknown;
  /** Value on the actual (challenger) side — Node. */
  actual?: unknown;
}

export interface DiffLabels {
  expected: string;
  actual: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** RFC 6901 escaping: ~ -> ~0, / -> ~1. */
function escapeToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

function pointer(base: string, token: string | number): string {
  return `${base}/${typeof token === "number" ? String(token) : escapeToken(token)}`;
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** One entry per differing scalar, missing key, extra key or type change.
 * Array order is compared index by index (ordering is data, see normalize.ts). */
export function structuralDiff(expected: unknown, actual: unknown): DiffEntry[] {
  const out: DiffEntry[] = [];
  walk(expected, actual, "", out);
  return out;
}

function walk(expected: unknown, actual: unknown, path: string, out: DiffEntry[]): void {
  const tE = typeName(expected);
  const tA = typeName(actual);
  const bothObjects = isRecord(expected) && isRecord(actual);
  const bothArrays = Array.isArray(expected) && Array.isArray(actual);
  if (tE !== tA) {
    out.push({ path, kind: "type", expected, actual });
    return;
  }
  if (bothObjects) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of [...keys].sort()) {
      const hasE = Object.prototype.hasOwnProperty.call(expected, key);
      const hasA = Object.prototype.hasOwnProperty.call(actual, key);
      if (hasE && !hasA) {
        out.push({ path: pointer(path, key), kind: "missing", expected: expected[key] });
      } else if (!hasE && hasA) {
        out.push({ path: pointer(path, key), kind: "extra", actual: actual[key] });
      } else {
        walk(expected[key], actual[key], pointer(path, key), out);
      }
    }
    return;
  }
  if (bothArrays) {
    const len = Math.max(expected.length, actual.length);
    for (let i = 0; i < len; i += 1) {
      const hasE = i < expected.length;
      const hasA = i < actual.length;
      if (hasE && !hasA) {
        out.push({ path: pointer(path, i), kind: "missing", expected: expected[i] });
      } else if (!hasE && hasA) {
        out.push({ path: pointer(path, i), kind: "extra", actual: actual[i] });
      } else {
        walk(expected[i], actual[i], pointer(path, i), out);
      }
    }
    return;
  }
  // Same type, scalars (or null): exact equality after normalize's documented
  // float rounding.
  if (!Object.is(expected, actual)) {
    out.push({ path, kind: "value", expected, actual });
  }
}

function show(value: unknown): string {
  const text = value === undefined ? "—" : JSON.stringify(value) ?? String(value);
  return text.length > 64 ? `${text.slice(0, 61)}…` : text;
}

/** Render diff entries as readable field-level lines:
 *     ~ /profiles/work/active: py=2 node=3
 *     - /errors/1: in py only
 *     + /extra: in node only
 *     ~ /ollama/hosts: type array != object            */
export function formatDiffs(
  entries: readonly DiffEntry[],
  labels: DiffLabels = { expected: "py", actual: "node" },
): string[] {
  return entries.map((e) => {
    const at = e.path === "" ? "(root)" : e.path;
    switch (e.kind) {
      case "missing":
        return `- ${at}: in ${labels.expected} only (${show(e.expected)})`;
      case "extra":
        return `+ ${at}: in ${labels.actual} only (${show(e.actual)})`;
      case "type":
        return `~ ${at}: type ${labels.expected}=${typeName(e.expected)} ${labels.actual}=${typeName(e.actual)}`;
      case "value":
        return `~ ${at}: ${labels.expected}=${show(e.expected)} ${labels.actual}=${show(e.actual)}`;
    }
  });
}
