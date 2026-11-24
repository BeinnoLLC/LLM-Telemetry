import { defineConfig, devices } from "@playwright/test";

import { ensureFixture } from "./tests/parity/home-fixture";

// T-0 (LST-281): Playwright (real Chromium via the system Chrome channel —
// no browser download) wired for the future UI parity checks (plan §7).
// Prod preview port 8481 (plan §4); Python serves :8477.
// T-20 RUN G: the preview reads the frozen parity fixture, never ~/.hermes.
const fixture = ensureFixture();

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:8481",
    ...devices["Desktop Chrome"],
    channel: "chrome",
  },
  projects: [
    {
      name: "utc-fixed-clock",
      use: { timezoneId: "UTC", locale: "en-US" },
    },
  ],
  webServer: {
    command: "npm run start",
    url: "http://localhost:8481",
    reuseExistingServer: true,
    timeout: 60_000,
    env: { ...process.env, LLM_TELEMETRY_REPORTS_DIR: fixture },
  },
});
