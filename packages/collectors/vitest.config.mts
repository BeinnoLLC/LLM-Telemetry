import { defineConfig } from "vitest/config";

// T-4 (LST-283): node-environment unit tests for the collector platform
// (writer atomicity, schema-check parity, CLI dispatch). The jsdom suites stay
// in apps/web; collectors are Node code.
// T-5 (LLMTELEMET-284): the parity harness suites (normalize, diff, and the
// py-vs-node end-to-end case) run in the same node environment.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "parity/tests/**/*.test.ts"],
  },
});
