import { defineConfig, devices } from "@playwright/test";

// T-0 (LST-281): Playwright (real Chromium via the system Chrome channel —
// no browser download) wired for the future UI parity checks (plan §7).
// Prod preview port 8481 (plan §4); dev stays on 8480, Python serves :8477.
export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:8481",
    ...devices["Desktop Chrome"],
    channel: "chrome",
  },
  webServer: {
    command: "npm run start",
    url: "http://localhost:8481",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
