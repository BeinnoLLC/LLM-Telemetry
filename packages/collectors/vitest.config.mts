import { defineConfig } from "vitest/config";

// T-4 (LST-283): node-environment unit tests for the collector platform
// (writer atomicity, schema-check parity, CLI dispatch). The jsdom suites stay
// in apps/web; collectors are Node code.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
