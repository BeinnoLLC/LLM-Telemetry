/** Normalize-step unit tests — T-5 (LLMTELEMET-284).
 *
 * The rules under test are the documented ones (normalize.ts header): drop
 * run-stamp timestamps at any depth, sort object keys ("ordering"), round
 * floats to the documented precision, keep integers exact, preserve array
 * order.
 */

import { describe, expect, it } from "vitest";
import {
  countLeaves,
  FLOAT_DIGITS,
  normalize,
  normalizeText,
  RUN_STAMP_KEYS,
} from "../normalize.js";

describe("normalize: run-stamp timestamps", () => {
  it("drops generated/generated_at/collected_at/ts/as_of/fetched/age at any depth", () => {
    const input = {
      generated: "2026-09-25T13:51:09",
      generated_at: "2026-09-25T13:51:09",
      keep: 1,
      nested: { collected_at: "2026-10-05T14:14:22Z", ts: 1790325506, value: 2 },
      rows: [{ as_of: "2026-10-06T02:00:00Z", fetched: 1790000000, age: 3, calls: 4 }],
      ollama: { ts: 1790325506, age: 0, hosts: [] },
    };
    expect(normalize(input)).toEqual({
      keep: 1,
      nested: { value: 2 },
      rows: [{ calls: 4 }],
      ollama: { hosts: [] },
    });
  });

  it("drops stamp keys case-insensitively and keeps non-stamp fields", () => {
    const input = {
      GENERATED: "x",
      Date: "2026-09-19",
      title: "2026-09-25T13:51:09",
      window: { start: "2026-09-06", end: "2026-10-05", period: "day" },
    };
    expect(normalize(input)).toEqual({
      Date: "2026-09-19",
      title: "2026-09-25T13:51:09",
      window: { end: "2026-10-05", period: "day", start: "2026-09-06" },
    });
  });

  it("documents its dropped-key list", () => {
    expect(RUN_STAMP_KEYS).toContain("generated");
    expect(RUN_STAMP_KEYS).toContain("generated_at");
    expect(RUN_STAMP_KEYS).toContain("ts");
  });

  it("accepts a custom drop list (replacing the default)", () => {
    expect(normalize({ generated: 1, keepme: 2 }, { dropKeys: ["keepme"] })).toEqual({
      generated: 1,
    });
  });
});

describe("normalize: key ordering", () => {
  it("sorts object keys at every depth so dict order cannot produce noise", () => {
    const a = { z: { b: 1, a: 2 }, a: [{ q: 1, p: 2 }] };
    const b = { a: [{ p: 2, q: 1 }], z: { a: 2, b: 1 } };
    expect(JSON.stringify(normalize(a))).toBe(JSON.stringify(normalize(b)));
    expect(JSON.stringify(normalize(a))).toBe(
      '{"a":[{"p":2,"q":1}],"z":{"a":2,"b":1}}',
    );
  });

  it("preserves array order — ordering inside an array is data", () => {
    expect(normalize([3, 1, 2])).toEqual([3, 1, 2]);
    expect(normalize({ rows: [{ v: 1 }, { v: 2 }] })).toEqual({
      rows: [{ v: 1 }, { v: 2 }],
    });
  });
});

describe("normalize: float rounding (documented formatting tolerance)", () => {
  it(`rounds non-integer numbers to FLOAT_DIGITS=${FLOAT_DIGITS} decimals`, () => {
    expect(normalize({ x: 0.1 + 0.2 })).toEqual({ x: 0.3 });
    expect(normalize({ x: 1.23456789 })).toEqual({ x: 1.234568 });
    expect(normalize({ x: 41.500000001 })).toEqual({ x: 41.5 });
  });

  it("compares integer counts/tokens/USD exactly — never rounds them", () => {
    const big = 9_007_199_254_740_991;
    expect(normalize({ calls: 21, outp: 69_325, big })).toEqual({
      calls: 21,
      outp: 69_325,
      big,
    });
  });

  it("folds -0 to 0 so a signed zero cannot fake a mismatch", () => {
    const out = normalize({ x: -0 }) as { x: number };
    expect(Object.is(out.x, 0)).toBe(true);
  });

  it("honours a custom precision", () => {
    expect(normalize({ x: 1.23456 }, { floatDigits: 2 })).toEqual({ x: 1.23 });
  });
});

describe("normalize: misc", () => {
  it("is pure — the input is never mutated", () => {
    const input = { generated: "x", a: { b: 1 } };
    normalize(input);
    expect(input).toEqual({ generated: "x", a: { b: 1 } });
  });

  it("keeps strings, booleans and null as-is", () => {
    expect(normalize({ s: "x", b: false, n: null })).toEqual({
      b: false,
      n: null,
      s: "x",
    });
  });

  it("normalizeText parses and normalizes", () => {
    expect(normalizeText('{"generated":"x","a":1}')).toEqual({ a: 1 });
  });

  it("countLeaves counts scalar fields", () => {
    expect(countLeaves({ a: 1, b: [true, null], c: { d: "x" } })).toBe(4);
  });
});
