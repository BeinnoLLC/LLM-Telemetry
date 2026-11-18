import { describe, expect, it } from "vitest";
import {
  pyBasename,
  pyFloatOr0,
  pyInt,
  pyLen,
  pyRound,
  pySlice,
  pyTitle,
} from "../../src/pySemantics.js";

// Every case here has a known CPython answer; the parity gate depends on
// these being exact, so they are pinned as tests (T-15, LLMTELEMET-286).
describe("pyRound (CPython round(), ties-to-even on the exact double)", () => {
  it("rounds the exact binary value, not the printed decimal", () => {
    expect(pyRound(2.675, 2)).toBe(2.67); // Math.round gives 2.68
    expect(pyRound(1.005, 2)).toBe(1.0); // Math.round gives 1.01
    expect(pyRound(0.125, 2)).toBe(0.12); // exact tie -> even
  });

  it("ties to even at nd=0 and nd omitted", () => {
    expect(pyRound(2.5)).toBe(2);
    expect(pyRound(3.5)).toBe(4);
    expect(pyRound(0.5)).toBe(0);
    expect(pyRound(1.5)).toBe(2);
    expect(pyRound(2.5, 0)).toBe(2);
    expect(pyRound(-0.5)).toBe(0); // py int result, no negative zero
  });

  it("keeps plain values unchanged", () => {
    expect(pyRound(1.2345678, 6)).toBe(1.234568);
    expect(pyRound(0, 6)).toBe(0);
  });
});

describe("code-point str semantics", () => {
  it("len and slice count code points like Python", () => {
    expect(pyLen("a😀b")).toBe(3);
    expect(pySlice("a😀b", 0, 2)).toBe("a😀");
    expect(pySlice("hello", 0, 119)).toBe("hello");
    expect(pyLen(null)).toBe(0);
  });

  it("int() truncates toward zero", () => {
    expect(pyInt(1.9)).toBe(1);
    expect(pyInt(-1.9)).toBe(-1);
  });

  it("title() capitalises every letter run (Python str.title)", () => {
    expect(pyTitle("they're here")).toBe("They'Re Here");
    expect(pyTitle("desktop")).toBe("Desktop");
    expect(pyTitle("bot chat")).toBe("Bot Chat");
  });

  it("basename strips nothing (posix basename(\"a/b/\") == \"\")", () => {
    expect(pyBasename("a/b/")).toBe("");
    expect(pyBasename("a/b")).toBe("b");
    expect(pyBasename("/x")).toBe("x");
    expect(pyBasename("plain")).toBe("plain");
  });

  it("float(x or 0) raises on garbage like Python", () => {
    expect(pyFloatOr0(null)).toBe(0);
    expect(pyFloatOr0("")).toBe(0);
    expect(pyFloatOr0("1.5")).toBe(1.5);
    expect(() => pyFloatOr0("abc")).toThrow();
  });
});
