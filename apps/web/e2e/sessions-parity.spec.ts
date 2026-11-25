// T-23 RUN A: strict live-DOM parity between the Python Sessions view on the
// frozen fixture and Next /sessions. Mirrors home-parity.spec.ts (T-20).
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { expect, test } from "@playwright/test";

import { buildModelProviders, providerPath } from "../lib/sessions-logs/providers";
import { short } from "../lib/sessions-logs/format";
import type { SessionRow } from "../lib/sessions-logs/types";
import { ensureFixture } from "../tests/parity/home-fixture";
import { resolvePython } from "../tests/parity/python";
import { readSessionsDom, type SessionsDom, type SessionsSide } from "../tests/parity/sessions-dom";

const CWD = process.cwd();
const REPO_ROOT = basename(CWD) === "web" ? resolve(CWD, "..", "..") : CWD;
const WEB_ROOT = join(REPO_ROOT, "apps", "web");
const ORACLE = join(WEB_ROOT, "tests", "parity", "serve_static.py");
const FROZEN = new Date("2026-09-25T13:51:12Z");
const SHOTS = resolve(WEB_ROOT, "test-results");
const FEED_POLL_URL = "http://localhost:8481/api/events/stream?since=0";
const AXES = ["cost", "calls", "tokens", "sessions"] as const;

// The Python source and its frozen build are the oracle. Its live dashboard
// emits no data-provider/data-v on matrix headers/cells, so the harness
// annotates the Python-derived fixture DOM from the very same fixture rows
// (merged across profiles, as the dashboard does): provider identity comes
// from the row's provider/base_url, and data-v is the value the rest cell
// already renders. Next renders both attributes itself. This is annotation,
// not glyph removal — monograms stay in the DOM and in the descriptor.
async function annotatePythonFixtureDom(
  page: import("@playwright/test").Page,
  rows: readonly SessionRow[],
): Promise<void> {
  const providers = Object.fromEntries(buildModelProviders(rows));
  await page.evaluate((providerByModel) => {
    const table = document.querySelector("#projmatrix");
    if (!table) return;
    const labelOf = (element: Element): string =>
      [...element.childNodes]
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent ?? "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
    const headers = [...table.querySelectorAll("thead th")];
    headers.forEach((th) => {
      const root = th.querySelector(".dt-sort") ?? th;
      const label = labelOf(root);
      const provider = (providerByModel as Record<string, string>)[label];
      if (provider) th.setAttribute("data-provider", provider);
    });
    const restIndex = headers.findIndex((th) => /^\+\d+ more$/.test(labelOf(th)));
    if (restIndex >= 0) {
      [...table.querySelectorAll("tbody tr")].forEach((tr) => {
        const cell = tr.children[restIndex];
        if (cell) cell.setAttribute("data-v", (cell.textContent ?? "").replace(/\s+/g, " ").trim());
      });
    }
  }, providers);
}

// Two fixture-specific monograms, both documented with their evidence from
// the fixture rows: routerview.js RT_LOGO gives `nous` mono "N" and
// `fireworks` mono "FW" with no brand SVG, while Next (and routerview's
// provider icon path) uses the neutral hexagon. views.js:245 renders the
// monogram only when the resolved provider has no brand path. An exception is
// applied only when provider identity AND the exact monogram/path match; any
// other monogram or a missing provider makes toEqual fail.
const MONOGRAM_EXCEPTIONS = [
  {
    label: "step-3.7-flash:free",
    provider: "nous",
    monogram: "N",
    url: "nousresearch",
  },
  {
    label: "deepseek-v4p1-flash",
    provider: "fireworks",
    monogram: "FW",
    url: "fireworks.ai",
  },
] as const;

function canonicalizeMonogramException(
  dom: SessionsDom,
  side: SessionsSide,
): { dom: SessionsDom; applied: string[] } {
  const applied: string[] = [];
  const domWithException: SessionsDom = {
    ...dom,
    headers: dom.headers.map((header) => {
      const exception = MONOGRAM_EXCEPTIONS.find(
        (candidate) => candidate.label === header.label && candidate.provider === header.provider,
      );
      if (!exception) return header;
      const hexagon = providerPath(exception.provider);
      if (side === "python") {
        if (header.icon.kind !== "monogram" || header.icon.value !== exception.monogram) {
          return header;
        }
        applied.push(exception.label);
        return { ...header, icon: { kind: "svg", value: hexagon } };
      }
      if (header.icon.kind !== "svg" || header.icon.value !== hexagon) {
        return header;
      }
      applied.push(exception.label);
      return header;
    }),
  };
  return { dom: domWithException, applied: applied.sort() };
}

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
  const payload = JSON.parse(readFileSync(join(fixture, "analytics-data.json"), "utf8"));
  // The browser merges all profiles into "All" when more than one exists.
  const fixtureRows = Object.values(payload.profiles as Record<string, { rows: SessionRow[] }>).flatMap(
    (profile) => profile.rows,
  );
  // Evidence for the documented exceptions, asserted before any comparison.
  for (const exception of MONOGRAM_EXCEPTIONS) {
    expect(
      fixtureRows.some(
        (row) =>
          short(row.model) === exception.label &&
          row.provider === exception.provider &&
          row.base_url?.toLowerCase().includes(exception.url),
      ),
    ).toBe(true);
  }
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
      // Re-annotate after each rerender: Python replaces the matrix innerHTML.
      await annotatePythonFixtureDom(py, fixtureRows);
      const expectedRaw = await readSessionsDom(py, "python");
      const actualRaw = await readSessionsDom(next, "next");
      const expected = canonicalizeMonogramException(expectedRaw, "python");
      const actual = canonicalizeMonogramException(actualRaw, "next");
      console.log("RUN A compared " + JSON.stringify({
        state: label,
        buttons: expectedRaw.weight.length,
        headers: expectedRaw.headers.length,
        icons: expectedRaw.headers.map((header) => `${header.label}:${header.icon.kind}:${header.provider ?? "-"}`),
        rows: expectedRaw.rows.length,
        cells: expectedRaw.rows.reduce((sum, row) => sum + Object.keys(row.cells).length, 0),
        footer: expectedRaw.footer.length,
        interactive: expectedRaw.interactive,
        note: expectedRaw.note,
        monogramException: { python: expected.applied, next: actual.applied },
      }));
      // Both sides must apply the exception identically; a new monogram or a
      // changed provider turns this into a hard failure instead of a silent strip.
      expect(actual.applied).toEqual(expected.applied);
      expect(actual.dom).toEqual(expected.dom);
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
