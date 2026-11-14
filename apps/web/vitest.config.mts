import { defineConfig } from "vitest/config";

// T-0 (LST-281): vitest + jsdom wired for the future ported suites
// (plan §3 — the tests/check_*.js and tests/test_*.py ports land with the
// pages/collectors they cover, T-26 accounts for the full mapping).
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.ts"],
  },
});
