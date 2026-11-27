import { basename, join, resolve } from "node:path";
import { expect, test } from "@playwright/test";

import { nextDom, pythonDom } from "../tests/parity/home-dom";
import { ensureFixture, warmNextFeed } from "../tests/parity/home-fixture";
import { resolvePython, startParityOracle } from "../tests/parity/python";

const CWD = process.cwd();
const REPO_ROOT = basename(CWD) === "web" ? resolve(CWD, "..", "..") : CWD;
const WEB_ROOT = join(REPO_ROOT, "apps", "web");
const FROZEN = new Date("2026-09-25T13:51:12Z");
const SHOTS = resolve(WEB_ROOT, "test-results");

test("Home numbers match the Python oracle on identical fixtures", async ({ browser }) => {
  test.setTimeout(180_000);
  const python = resolvePython(WEB_ROOT);
  if (!python) throw new Error("set LLM_TELEMETRY_PARITY_PYTHON to the .venv python");
  const fixture = ensureFixture();
  const oracle = startParityOracle(fixture, python, REPO_ROOT, WEB_ROOT);
  const errors: string[] = [];
  try {
    const port = await oracle.port;
    const contexts = await Promise.all([
      browser.newContext({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1920, height: 1080 } }),
      browser.newContext({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1920, height: 1080 } }),
    ]);
    const [py, next] = await Promise.all(contexts.map((context) => context.newPage()));
    for (const [label, page] of [["python", py], ["next", next]] as const) {
      page.on("console", (message) => {
        if (message.type() === "error") {
          errors.push(`${label}: ${message.text()} @ ${message.location().url}`);
        }
      });
      page.on("response", (response) => {
        if (response.status() >= 400) {
          errors.push(`${label}: HTTP ${response.status()} ${response.url()}`);
        }
      });
      page.on("pageerror", (error) => errors.push(`${label}: ${error.message}`));
      await page.clock.install({ time: FROZEN });
    }
    await warmNextFeed();
    await Promise.all([
      py.goto(`http://127.0.0.1:${port}/dashboard.html`),
      next.goto("/"),
    ]);
    await Promise.all([
      py.locator(".lgt-wrap table.lgt tbody tr[data-i]").first().waitFor({ state: "attached" }),
      py.locator("#livelist .liverow").first().waitFor({ state: "attached" }),
      py.locator("#qt-n-running").waitFor({ state: "attached" }),
      next.locator(".series-legend-item").first().waitFor({ state: "attached" }),
      next.locator("#home-live-table .lvrow").first().waitFor({ state: "attached" }),
    ]);
    // One shared five-second tick, then let each fetch/poll settle.
    await Promise.all([py.clock.runFor(5000), next.clock.runFor(5000)]);
    await py.waitForLoadState("networkidle");
    await next.waitForTimeout(1000);

    const expected = await pythonDom(py);
    const actual = await nextDom(next);
    console.log("RUN G compared " + JSON.stringify({
      livekpis: Object.keys(expected.livekpis),
      kpis: expected.kpis.length,
      homecards: expected.homecards.length,
      series: expected.series.length,
      liveRows: expected.live.length,
      queue: Object.keys(expected.queue),
      counts: {
        livekpis: Object.keys(actual.livekpis).length,
        kpis: actual.kpis.length,
        homecards: actual.homecards.length,
        series: actual.series.length,
        liveRows: actual.live.length,
        queue: Object.keys(actual.queue).length,
      },
      values: expected,
    }));
    expect(actual).toEqual(expected);
    expect(errors).toEqual([]);

    for (const [width, height] of [[1920, 1080], [1280, 800]]) {
      await Promise.all([py, next].map((page) => page.setViewportSize({ width, height })));
      await Promise.all([py, next].map((page) => page.waitForTimeout(150)));
      const layout = await next.evaluate(() => {
        const top = (selector: string): number =>
          document.querySelector(selector)?.getBoundingClientRect().top ?? 0;
        return {
          row: document.querySelector("#home-live-table .lvrow")?.getBoundingClientRect().height ?? 0,
          kpis: top("#livekpis"),
          queue: top("#qcard"),
          table: top("#home-live-table"),
        };
      });
      expect(layout.row).toBeGreaterThanOrEqual(48);
      expect(layout.row).toBeLessThanOrEqual(64);
      expect(layout.queue).toBeGreaterThan(layout.kpis);
      expect(layout.table).toBeGreaterThan(layout.queue);
      for (const [label, page] of [["python", py], ["next", next]] as const) {
        await page.screenshot({ path: join(SHOTS, `home-${label}-${width}x${height}.png`) });
      }
    }
    expect(errors).toEqual([]);
  } finally {
    oracle.child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((ok) => oracle.child.once("exit", () => ok())),
      new Promise<void>((ok) => setTimeout(ok, 2000)),
    ]);
    if (oracle.child.exitCode === null) oracle.child.kill("SIGKILL");
  }
});
