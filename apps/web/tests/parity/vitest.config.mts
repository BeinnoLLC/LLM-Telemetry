import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

/** Separate config so `npm test` stays fast and `npm run test:parity` is explicit. */
export default defineConfig({
  root,
  test: {
    environment: "node",
    include: ["tests/parity/**/*.parity.test.ts"],
    testTimeout: 120_000,
  },
});
