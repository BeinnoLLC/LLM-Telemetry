import { spawn, type ChildProcess } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { expect, test } from "@playwright/test";

import { nextDom, pythonDom } from "../tests/parity/home-dom";
import { ensureFixture } from "../tests/parity/home-fixture";
import { resolvePython } from "../tests/parity/python";

const CWD = process.cwd();
const REPO_ROOT = basename(CWD) === "web" ? resolve(CWD, "..", "..") : CWD;
const WEB_ROOT = join(REPO_ROOT, "apps", "web");
const ORACLE = join(WEB_ROOT, "tests", "parity", "serve_static.py");
const FROZEN = new Date("2026-09-25T13:51:12Z");
const SHOTS = resolve(WEB_ROOT, "test-results");
const FEED_POLL_URL = "http://localhost:8481/api/events/stream?since=0";

// ?since= selects the finite polling form, not the capped SSE stream. Warm the
// Next feed before the pages subscribe so their first stream cannot race the
// collector's "warming up" 503 window.
async function warmNextFeed(): Promise<void> {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const response = await fetch(FEED_POLL_URL);
    await response.body?.cancel();
    if (response.status !== 503) return;
    if (attempt < 20) await new Promise((ok) => setTimeout(ok, 250));
  }
  throw new Error("Next live feed still returned HTTP 503 after 20 attempts");
}

function startOracle(fixture: string, python: string): {
  child: ChildProcess;
  port: Promise<number>;
} {
  const child = spawn(
    python,
    [ORACLE, join(REPO_ROOT, "src"), fixture],
    {
      cwd: WEB_ROOT,
      env: { ...process.env, PYTHONPATH: join(REPO_ROOT, "src") },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const port = new Promise<number>((ok, fail) => {
    let out = "";
    const timer = setTimeout(() => fail(new Error(`oracle timeout: ${stderr}`)), 15_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`oracle exited ${code}: ${stderr}`));
    });
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const match = /(\d{2,5})/.exec(out);
      if (match) {
        clearTimeout(timer);
        ok(Number(match[1]));
      }
    });
  });
  return { child, port };
}

test("Home numbers match the Python oracle on identical fixtures", async ({ browser }) => {
  test.setTimeout(180_000);
  const python = resolvePython(WEB_ROOT);
  if (!python) throw new Error("set LLM_TELEMETRY_PARITY_PYTHON to the .venv python");
  const fixture = ensureFixture();
  const oracle = startOracle(fixture, python);
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
