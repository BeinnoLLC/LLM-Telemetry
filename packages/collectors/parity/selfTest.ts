/** Seeded-mismatch self-test helpers — T-5 (LLMTELEMET-284).
 *
 * Acceptance: "Self-testing: seeded mismatch detected". The harness mutates a
 * known field of one side's normalized payload, and the diff MUST report
 * exactly that field. A harness that cannot see a deliberate perturbation
 * cannot be trusted to see a real one.
 */

import { structuralDiff, type DiffEntry } from "./diff.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

interface Found {
  holder: Record<string, unknown> | unknown[];
  key: string | number;
  path: string;
}

/** First numeric leaf in a normalized document (deterministic: normalized
 * objects have sorted keys, arrays keep their order). */
function findFirstNumber(value: unknown, base: string): Found | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const child = value[i];
      const at = `${base}/${String(i)}`;
      if (typeof child === "number") return { holder: value, key: i, path: at };
      const deeper = findFirstNumber(child, at);
      if (deeper) return deeper;
    }
    return null;
  }
  if (isRecord(value)) {
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      const at = `${base}/${escapeToken(key)}`;
      if (typeof child === "number") return { holder: value, key, path: at };
      const deeper = findFirstNumber(child, at);
      if (deeper) return deeper;
    }
    return null;
  }
  return null;
}

export interface SeedResult {
  /** The seeded document (deep copy of the input, one number changed). */
  value: unknown;
  /** JSON Pointer of the perturbed field. */
  path: string;
  before: number;
  after: number;
}

/** Deep-copy `normalized` and perturb its first numeric leaf by +1. */
export function seedMismatch(normalized: unknown): SeedResult {
  const copy: unknown = structuredClone(normalized);
  const found = findFirstNumber(copy, "");
  if (!found) {
    throw new Error("seedMismatch: no numeric leaf to perturb");
  }
  const container = found.holder as unknown as Record<string | number, unknown>;
  const before = container[found.key] as number;
  const after = before + 1;
  container[found.key] = after;
  return { value: copy, path: found.path, before, after };
}

/** Seed a perturbation into `challenger` and return the diff the harness sees
 * for it — expected to be exactly the one seeded entry. */
export function seedAndDiff(reference: unknown, challenger: unknown): {
  seed: SeedResult;
  diffs: DiffEntry[];
} {
  const seed = seedMismatch(challenger);
  return { seed, diffs: structuralDiff(reference, seed.value) };
}
