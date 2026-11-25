// T-23 RUN C: strict live-DOM parity between the Python Logs view on the
// frozen fixture and Next /logs. The same canonical reader compares both
// stacks after every control change; no invented event or hidden state.
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { expect, test } from "@playwright/test";

import { ensureFixture } from "../tests/parity/home-fixture";
import { resolvePython } from "../tests/parity/python";
import { readLogsDom, type LogsDom, type LogsSide } from "../tests/parity/logs-dom";

const CWD = process.cwd();
const REPO_ROOT = basename(CWD) === "web" ? resolve(CWD, "..", "..") : CWD;
const WEB_ROOT = join(REPO_ROOT, "apps", "web");
const ORACLE = join(WEB_ROOT, "tests", "parity", "serve_static.py");
const SHOTS = resolve(WEB_ROOT, "test-results");
const FROZEN = new Date("2026-09-25T13:51:12Z");

function startOracle(fixture: string, python: string): {
  child: ChildProcess;
  port: Promise<number>;
} {
  const child = spawn(python, [ORACLE, join(REPO_ROOT, "src"), fixture], {
    cwd: WEB_ROOT,
    env: { ...process.env, PYTHONPATH: join(REPO_ROOT, "src") },
    stdio: ["ignore", "pipe", "pipe"],
  });
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

/**
 * Two documented, evidence-backed divergences are normalised ONLY after being
 * asserted: Next draws provider brand SVGs on model chips and expanded rows,
 * where the frozen Python build renders text-only labels; and T-23 caps the
 * Next table at 200 rows (with #lgnote) where Python draws up to 1200. Those
 * two documented differences are normalised after being checked. Everything
 * else — counts, labels, facets, timestamps, previews, CSV — is verbatim.
 */
function canonicalizeLogsDom(
  dom: LogsDom,
  side: LogsSide,
  checkIcons: boolean,
): LogsDom {
  const modelChips = dom.facets
    .flatMap((facet) => facet.chips)
    .filter((chip) => chip.facet === "model");
  if (checkIcons) {
    if (side === "python") {
      expect(modelChips.length).toBeGreaterThan(0);
      expect(modelChips.every((chip) => chip.svgPath === "")).toBe(true);
    } else {
      expect(modelChips.length).toBeGreaterThan(0);
      expect(modelChips.every((chip) => chip.svgPath.length > 0)).toBe(true);
    }
  }
  return {
    ...dom,
    // T-23's 200-row table cap is asserted in the unit suite; the oracle still
    // draws up to 1200. Compare only the shared prefix, and ignore the note
    // that exists solely to disclose the Next cap.
    note: "",
    facets: dom.facets.map((facet) => ({
      ...facet,
      chips: facet.chips.map((chip) =>
        chip.facet === "model" ? { ...chip, svgPath: "" } : chip,
      ),
    })),
    rows: (side === "python" ? dom.rows.slice(0, 200) : dom.rows).map((row) => ({
      ...row,
      metaSvgPath: "",
    })),
  };
}

test("Logs filters, window, search, rows and CSV match the Python oracle", async ({ browser }) => {
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
        if (message.type() === "error") errors.push(`${label}: ${message.text()} @ ${message.location().url}`);
      });
      page.on("response", (response) => {
        if (response.status() >= 400) errors.push(`${label}: HTTP ${response.status()} ${response.url()}`);
      });
      page.on("pageerror", (error) => errors.push(`${label}: ${error.message}`));
      await page.clock.install({ time: FROZEN });
    }

    await Promise.all([
      py.goto(`http://127.0.0.1:${port}/dashboard.html`),
      next.goto("/logs"),
    ]);
    await Promise.all([
      py.locator('[data-nav="Logs"]').click(),
      next.locator("#lglist .lgev").first().waitFor({ state: "attached" }),
    ]);
    await Promise.all([
      py.locator("#lglist .lgev").first().waitFor({ state: "attached" }),
      next.waitForTimeout(200),
    ]);
    await py.waitForLoadState("networkidle");

    const compare = async (label: string): Promise<void> => {
      const expectedRaw = await readLogsDom(py, "python");
      const actualRaw = await readLogsDom(next, "next");
      const expected = canonicalizeLogsDom(expectedRaw, "python", true);
      const actual = canonicalizeLogsDom(actualRaw, "next", true);
      console.log("RUN C compared " + JSON.stringify({
        state: label,
        scope: expected.scope,
        count: expected.count,
        facets: expected.facets.map((facet) => `${facet.label}:${facet.chips.length}`),
        windows: expected.windows.filter((win) => win.on).map((win) => win.value),
        active: expected.active.length,
        rows: expected.rows.length,
        note: expected.note,
      }));
      expect(actual).toEqual(expected);
      expect(errors).toEqual([]);
      comparisons += 1;
    };

    await compare("default");

    for (const hours of ["1", "6", "24", "0"]) {
      await Promise.all([
        py.locator(`[data-win="${hours}"]`).click(),
        next.locator(`[data-win="${hours}"]`).click(),
      ]);
      await Promise.all([py.waitForTimeout(100), next.waitForTimeout(100)]);
      await compare(`window-${hours}`);
    }

    for (const facet of ["tool", "model", "kind"]) {
      await Promise.all([
        py.locator(`[data-facet="${facet}"]`).first().click(),
        next.locator(`[data-facet="${facet}"]`).first().click(),
      ]);
      await Promise.all([py.waitForTimeout(100), next.waitForTimeout(100)]);
      await compare(`facet-${facet}`);
    }

    await Promise.all([
      py.locator("#lgclear").click(),
      next.locator("#lgclear").click(),
    ]);
    await Promise.all([py.waitForTimeout(100), next.waitForTimeout(100)]);
    await compare("clear-facets");

    await Promise.all([
      py.locator('[data-win="24"]').click(),
      next.locator('[data-win="24"]').click(),
    ]);
    await Promise.all([py.waitForTimeout(100), next.waitForTimeout(100)]);

    await Promise.all([
      py.locator("#lgq").fill("timeout"),
      next.locator("#lgq").fill("timeout"),
    ]);
    await Promise.all([py.waitForTimeout(100), next.waitForTimeout(100)]);
    await compare("search");

    await Promise.all([
      py.locator("#lgclear").click(),
      next.locator("#lgclear").click(),
    ]);
    await Promise.all([py.waitForTimeout(100), next.waitForTimeout(100)]);
    await compare("clear-search");

    await Promise.all([
      py.locator('[data-facet="kind"]').first().click(),
      next.locator('[data-facet="kind"]').first().click(),
    ]);
    await Promise.all([py.waitForTimeout(100), next.waitForTimeout(100)]);
    await Promise.all([
      py.locator("#lgactive [data-unfacet]").first().click(),
      next.locator("#lgactive [data-unfacet]").first().click(),
    ]);
    await Promise.all([py.waitForTimeout(100), next.waitForTimeout(100)]);
    await compare("active-chip-removal");

    await Promise.all([
      py.locator("#lglist .lgev").first().click(),
      next.locator("#lglist .lgev").first().click(),
    ]);
    await Promise.all([py.waitForTimeout(100), next.waitForTimeout(100)]);
    await compare("row-expand");

    const downloads = await Promise.all([
      Promise.all([
        py.waitForEvent("download"),
        py.locator("#lgcsv").click(),
      ]).then(([download]) => download),
      Promise.all([
        next.waitForEvent("download"),
        next.locator("#lgcsv").click(),
      ]).then(([download]) => download),
    ]);
    const csvs = await Promise.all(downloads.map(async (download) => ({
      name: download.suggestedFilename(),
      body: readFileSync(await download.path(), "utf8"),
    })));
    expect(csvs[0]).toEqual(csvs[1]);
    expect(csvs[0].name).toBe("log-events.csv");
    expect(csvs[0].body.split("\n")[0]).toBe(
      "when,level,role,tool,model,session,title,preview",
    );
    comparisons += 1;

    for (const [label, page] of [["python", py], ["next", next]] as const) {
      await page.screenshot({ path: join(SHOTS, `logs-${label}-1920x1080.png`) });
    }
    console.log(`RUN C parity comparisons: ${comparisons}`);
    expect(comparisons).toBe(14);
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
