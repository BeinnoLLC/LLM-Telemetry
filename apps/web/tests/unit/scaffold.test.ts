import { describe, expect, it } from "vitest";
import tsconfig from "../../tsconfig.json";

describe("migration scaffold (T-0, LST-281)", () => {
  it("TypeScript strict mode is on", () => {
    expect(tsconfig.compilerOptions.strict).toBe(true);
  });

  it("unit tests run in a real DOM environment (jsdom)", () => {
    expect(typeof document).toBe("object");
    expect(document.createElement("div").tagName).toBe("DIV");
  });
});
