/** Structural-diff unit tests — T-5 (LLMTELEMET-284).
 *
 * Field-level diff contract: one entry per differing scalar / missing key /
 * extra key / type change, RFC 6901 paths, readable formatter. Exact numbers
 * (the float tolerance lives in normalize, not here).
 */

import { describe, expect, it } from "vitest";
import { formatDiffs, structuralDiff, type DiffEntry } from "../diff.js";
import { normalize } from "../normalize.js";

describe("structuralDiff", () => {
  it("returns no entries for equal documents", () => {
    const doc = { a: 1, b: [1, 2, { c: "x" }], d: null };
    expect(structuralDiff(doc, structuredClone(doc))).toEqual([]);
  });

  it("reports value mismatches with JSON Pointer paths (arrays indexed)", () => {
    const py = { profiles: { work: { rows: [{ calls: 21 }, { calls: 2 }] } } };
    const node = { profiles: { work: { rows: [{ calls: 20 }, { calls: 2 }] } } };
    expect(structuralDiff(py, node)).toEqual([
      {
        path: "/profiles/work/rows/0/calls",
        kind: "value",
        expected: 21,
        actual: 20,
      },
    ]);
  });

  it("escapes ~ and / in keys per RFC 6901", () => {
    const py = { "a/b~c": 1 };
    const node = { "a/b~c": 2 };
    expect(structuralDiff(py, node)).toEqual([
      { path: "/a~1b~0c", kind: "value", expected: 1, actual: 2 },
    ]);
  });

  it("reports keys present only in py as missing and only in node as extra", () => {
    const py = { keep: 1, onlyPy: "gone" };
    const node = { keep: 1, onlyNode: "new" };
    const diffs = structuralDiff(py, node);
    expect(diffs).toContainEqual({
      path: "/onlyPy",
      kind: "missing",
      expected: "gone",
    });
    expect(diffs).toContainEqual({
      path: "/onlyNode",
      kind: "extra",
      actual: "new",
    });
    expect(diffs).toHaveLength(2);
  });

  it("reports missing/extra array elements past the shared length", () => {
    const diffs = structuralDiff({ xs: [1, 2, 3] }, { xs: [1, 2] });
    expect(diffs).toEqual([{ path: "/xs/2", kind: "missing", expected: 3 }]);
  });

  it("reports type changes (number vs string, array vs object, null vs object)", () => {
    const py = { n: 1, a: [1], o: null };
    const node = { n: "1", a: { x: 1 }, o: { x: 1 } };
    const kinds = structuralDiff(py, node).map((d) => `${d.kind}@${d.path}`);
    expect(kinds).toEqual(["type@/a", "type@/n", "type@/o"]);
  });

  it("compares root scalars at the empty pointer", () => {
    expect(structuralDiff(1, 2)).toEqual([
      { path: "", kind: "value", expected: 1, actual: 2 },
    ]);
  });

  it("is exact on numbers — the float tolerance lives in normalize", () => {
    expect(structuralDiff({ x: 1 }, { x: 1.0000001 })).toHaveLength(1);
    const py = normalize({ x: 1 + 1e-9 });
    const node = normalize({ x: 1 });
    expect(structuralDiff(py, node)).toEqual([]);
  });
});

describe("formatDiffs", () => {
  it("prints readable field-level lines with both values", () => {
    const diffs: DiffEntry[] = [
      { path: "/profiles/work/active", kind: "value", expected: 2, actual: 3 },
      { path: "/errors/1", kind: "missing", expected: "boom" },
      { path: "/extra", kind: "extra", actual: true },
      { path: "/ollama/hosts", kind: "type", expected: [], actual: {} },
    ];
    expect(formatDiffs(diffs)).toEqual([
      "~ /profiles/work/active: py=2 node=3",
      '- /errors/1: in py only ("boom")',
      "+ /extra: in node only (true)",
      "~ /ollama/hosts: type py=array node=object",
    ]);
  });

  it("honours custom side labels and truncates long values", () => {
    const long = "x".repeat(100);
    const lines = formatDiffs([{ path: "/s", kind: "value", expected: long, actual: "y" }], {
      expected: "expected",
      actual: "actual",
    });
    expect(lines[0]).toContain("expected=");
    expect(lines[0]).toContain("actual=");
    expect((lines[0] ?? "").length).toBeLessThan(120);
  });
});
