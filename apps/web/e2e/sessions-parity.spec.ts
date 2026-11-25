// T-23 RUN A: strict live-DOM parity between the Python Sessions view on the
// frozen fixture and Next /sessions. Mirrors home-parity.spec.ts (T-20).
import { spawn, type ChildProcess } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { expect, test } from "@playwright/test";

import { ensureFixture } from "../tests/parity/home-fixture";
import { resolvePython } from "../tests/parity/python";
import { readSessionsDom } from "../tests/parity/sessions-dom";

const CWD = process.cwd();
const REPO_ROOT = basename(CWD) === "web" ? resolve(CWD, "..", "..") : CWD;
const WEB_ROOT = join(REPO_ROOT, "apps", "web");
const ORACLE = join(WEB_ROOT, "tests", "parity", "serve_static.py");
const FROZEN = new Date("2026-09-25T13:51:12Z");
const SHOTS = resolve(WEB_ROOT, "test-results");
const FEED_POLL_URL = "http://localhost:8481/api/events/stream?since=0";
const AXES = ["cost", "calls", "tokens", "sessions"] as const;

// Same finite poll warm-up as home-parity.spec.ts: a cold feed returns 503
// while it collects, which would otherwise show up as an HTTP error here.
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

test("Sessions weighting and matrix match the Python oracle on identical fixtures", async ({ browser }) => {
  test.setTimeout(180_000);
  const python = resolvePython(WEB_ROOT);
  if (!python) throw new Error("set LLM_TELEMETRY_PARITY_PYTHON to the .venv python");
  const fixture = ensureFixture();
  const oracle = startOracle(fixture, python);
  const errors: string[] = [];
  let comparisons = 0;
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
      next.goto("/sessions"),
    ]);
    await Promise.all([
      py.locator('[data-nav="Sessions"]').click(),
      next.locator("#projmatrix").waitFor({ state: "attached" }),
    ]);
    await Promise.all([
      py.locator("#projmatrix tbody tr").first().waitFor({ state: "attached" }),
      next.locator("#projmatrix tbody tr td[data-key]").first().waitFor({ state: "attached" }),
    ]);
    await Promise.all([py.clock.runFor(5000), next.clock.runFor(5000)]);
    await py.waitForLoadState("networkidle");
    await next.waitForTimeout(1000);

    const compare = async (label: string): Promise<void> => {
      const expected = await readSessionsDom(py, "python");
      const actual = await readSessionsDom(next, "next");
      console.log("RUN A compared " + JSON.stringify({
        state: label,
        buttons: expected.weight.length,
        headers: expected.headers.length,
        rows: expected.rows.length,
        cells: expected.rows.reduce((sum, row) => sum + Object.keys(row.cells).length, 0),
        footer: expected.footer.length,
        interactive: expected.interactive,
        note: expected.note,
      }));
      expect(actual).toEqual(expected);
      expect(errors).toEqual([]);
      comparisons += 1;
    };

    await compare("default");
    for (const axis of AXES) {
      await Promise.all([
        py.locator(`#projweight button[data-w="${axis}"]`).click(),
        next.locator(`#projweight button[data-w="${axis}"]`).click(),
      ]);
      await Promise.all([py.waitForTimeout(100), next.waitForTimeout(100)]);
      await compare(axis);
    }

    for (const [width, height] of [[1920, 1080], [1280, 800]]) {
      await Promise.all([py, next].map((page) => page.setViewportSize({ width, height })));
      await Promise.all([py, next].map((page) => page.waitForTimeout(150)));
      const layout = await next.evaluate(() => {
        const wrap = document.querySelector("#projmatrixwrap");
        return {
          wrappers: document.querySelectorAll("#projmatrixwrap").length,
          nested: document.querySelectorAll("#projmatrixwrap #projmatrixwrap").length,
          overflowX: wrap ? getComputedStyle(wrap).overflowX : "",
          rows: document.querySelectorAll("#projmatrix tbody tr").length,
        };
      });
      expect(layout.wrappers).toBe(1);
      expect(layout.nested).toBe(0);
      expect(layout.overflowX).toBe("auto");
      expect(layout.rows).toBeGreaterThan(0);
      for (const [label, page] of [["python", py], ["next", next]] as const) {
        await page.screenshot({ path: join(SHOTS, `sessions-${label}-${width}x${height}.png`) });
      }
    }
    console.log(`RUN A parity comparisons: ${comparisons}`);
    expect(comparisons).toBe(5);
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
