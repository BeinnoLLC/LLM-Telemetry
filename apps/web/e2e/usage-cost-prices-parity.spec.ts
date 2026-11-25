// T-22 RUN D: strict Python/Next parity for the Usage, Cost and Prices views.
// The frozen privacy-safe fixture is the oracle; Next is compared against the
// DOM text and data-* values the Python page actually renders.
import { spawn, type ChildProcess } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { expect, test } from "@playwright/test";

import {
  parityLedger,
  requiredAttr,
  requiredText,
  rowFragmentTexts,
  tableRows,
} from "../tests/parity/usage-cost-dom";
import { ensureFixture } from "../tests/parity/home-fixture";
import { resolvePython } from "../tests/parity/python";

const CWD = process.cwd();
const REPO_ROOT = basename(CWD) === "web" ? resolve(CWD, "..", "..") : CWD;
const WEB_ROOT = join(REPO_ROOT, "apps", "web");
const ORACLE = join(WEB_ROOT, "tests", "parity", "serve_static.py");
const FROZEN = new Date("2026-09-25T13:51:12Z");
const SHOTS = resolve(WEB_ROOT, "test-results");
const FEED_POLL_URL = "http://localhost:8481/api/events/stream?since=0";
const ATTR_GROUPS = ["source", "tool", "root", "cron"] as const;

// Same finite ?since=0 feed warm-up as home-parity.spec.ts: the streaming
// endpoint can return a 503 while the collector warms up on a cold start.
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

type AttrGroups = Record<(typeof ATTR_GROUPS)[number], string[][]>;

function emptyGroups(): AttrGroups {
  return { source: [], tool: [], root: [], cron: [] };
}

/** What-if fields shared by both renderers. */
interface WhatIf {
  selected: string;
  input: string;
  cached: string;
  output: string;
  runs: string;
  total: string;
  breakdown: string;
}

test("Usage/Cost/Prices rows and derivation match the Python oracle", async ({ browser }) => {
  test.setTimeout(120_000);
  const python = resolvePython(WEB_ROOT);
  if (!python) throw new Error("set LLM_TELEMETRY_PARITY_PYTHON to the .venv python");
  const fixture = ensureFixture();
  const oracle = startOracle(fixture, python);
  const errors: string[] = [];
  const ledger = parityLedger((actual: unknown, expected: unknown) => {
    expect(actual).toEqual(expected);
  });

  const step = (name: string) => console.log("RUN D step: " + name);
  try {
    const port = await oracle.port;
    step("oracle ready");
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
    step("feed warm");

    // Usage: Python starts on the Usage tab; Next uses the same work profile.
    await Promise.all([
      py.goto(`http://127.0.0.1:${port}/dashboard.html`),
      next.goto("/usage?profile=work"),
    ]);
    await Promise.all([
      py.locator("#cProvDist").waitFor({ state: "attached" }),
      next.locator('[data-chart-id="cProvDist"] .uc-point').first().waitFor({ state: "attached" }),
    ]);
    await Promise.all([py.clock.runFor(5000), next.clock.runFor(5000)]);
    await py.waitForLoadState("networkidle");
    await next.waitForTimeout(1000);
    step("usage loaded");

    // Python defaults to the aggregate "All" profile, which has no attribution.
    // Turn the personal profile off so both renderers show the same work rows.
    await py.evaluate(() => (document.querySelector('.pchip[data-tab="personal"]') as HTMLElement)?.click());
    await py.waitForTimeout(200);
    step("profile work selected");

    const pyProvDist = await py.evaluate(() => {
      const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
      const marks = /[\u2733\u25c8\u2726\u25c9\u25cf\u25a3\u2b21\u2601\u25c6\u25cb]/g;
      const canvas = document.querySelector<HTMLCanvasElement>("#cProvDist");
      if (!canvas) throw new Error("missing #cProvDist");
      const hook = JSON.parse(canvas.dataset.parity || "{}") as {
        labels?: string[]; values?: number[];
      };
      return (hook.labels ?? []).map((label, index) => [
        norm(label.replace(marks, " ")),
        Number((hook.values ?? [])[index]),
      ]) as [string, number][];
    });
    const nxProvDist = await next.evaluate(() =>
      [...document.querySelectorAll('[data-chart-id="cProvDist"] .uc-point')].map((point) => [
        (point as HTMLElement).dataset.provider ?? "",
        Number((point as HTMLElement).dataset.value),
      ]) as [string, number][],
    );
    ledger.compare("usage provider distribution canvas labels/values", pyProvDist, nxProvDist);
    step("usage parity compared");

    // Cost: provider table, re-send table and all four attribution blocks.
    await py.evaluate(() => (document.querySelector('[data-vtab="Cost"]') as HTMLElement)?.click());
    await next.goto("/cost?profile=work");
    step("cost navigation done");
    await Promise.all([
      py.locator("#resendtbl tr.resendrow").first().waitFor({ state: "attached" }),
      py.locator("#attribsource > div").first().waitFor({ state: "attached" }),
      py.locator("#tblProv tr[data-provider]").first().waitFor({ state: "attached" }),
      next.locator('[data-table-id="resendtbl"] tbody tr').first().waitFor({ state: "attached" }),
      next.locator('[data-attr-group="source"] .uc-attrib-row').first().waitFor({ state: "attached" }),
      next.locator('[data-table-id="tblProv"] tbody tr').first().waitFor({ state: "attached" }),
    ]);
    await py.waitForTimeout(250);
    await next.waitForTimeout(500);
    step("cost anchors ready");

    const pyProviders = await py.evaluate(() => {
      const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
      const marks = /[\u2733\u25c8\u2726\u25c9\u25cf\u25a3\u2b21\u2601\u25c6\u25cb]/g;
      return [...document.querySelectorAll("#tblProv tr[data-provider]")].map((row) => {
        const cells = [...row.children].slice(0, -1).map((cell) => norm(cell.textContent));
        return [
          row.getAttribute("data-provider") ?? "",
          ...cells.slice(1).map((cell, index) => (index === 0 ? norm(cell.replace(marks, " ")) : cell)),
        ];
      });
    });
    const nxProviders = await next.evaluate(() =>
      [...document.querySelectorAll('[data-table-id="tblProv"] tbody tr[data-provider]')].map((row) => {
        const cells = [...row.children].slice(0, -1).map((cell) =>
          (cell.textContent ?? "").replace(/\s+/g, " ").trim(),
        );
        return [row.getAttribute("data-provider") ?? "", ...cells.slice(1)];
      }),
    );
    ledger.compare("provider table (metered + LAN bytes, market-cost order)", pyProviders, nxProviders);

    const pyResend = await tableRows(py, "#resendtbl tr.resendrow", 1);
    const nxResend = await tableRows(next, '[data-table-id="resendtbl"] tbody tr', 1);
    ledger.compare("re-send table rows", pyResend, nxResend);
    ledger.compare(
      "re-send sub-total",
      await requiredText(py, "#resendsub"),
      await requiredText(next, '[data-testid="resendsub"]'),
    );

    const pyAttrib: AttrGroups = { ...emptyGroups() };
    const nxAttrib: AttrGroups = { ...emptyGroups() };
    for (const group of ATTR_GROUPS) {
      pyAttrib[group] = await rowFragmentTexts(py, `#attrib${group} > div`);
      nxAttrib[group] = await rowFragmentTexts(next, `[data-attr-group="${group}"] .uc-attrib-row`);
    }
    ledger.compare("cost attribution by source/tool/root/cron", pyAttrib, nxAttrib);
    ledger.compare(
      "cost attribution footer",
      await requiredText(py, "#attribfooter"),
      await requiredText(next, '[data-panel="attribution"] .uc-meta'),
    );
    step("cost parity compared");

    // Prices: shell freshness/source, table rows, tabs/search and what-if.
    await py.evaluate(() => (document.querySelector('[data-vtab="Prices"]') as HTMLElement)?.click());
    await next.goto("/prices");
    await Promise.all([
      py.locator("#pricesTableWrap tbody tr").first().waitFor({ state: "attached" }),
      next.locator('[data-table-id="pv-tbl"] tbody tr').first().waitFor({ state: "attached" }),
    ]);
    step("prices anchors ready");

    ledger.compare(
      "price shell catalogue state",
      await requiredAttr(py, "#view-prices-container div[data-cat-state]", "data-cat-state"),
      await requiredAttr(next, "main.prices-view", "data-cat-state"),
    );
    ledger.compare(
      "price shell freshness/source",
      await requiredText(py, "#view-prices-container .pv-freshpill"),
      await requiredText(next, ".pv-head .pv-freshpill"),
    );
    ledger.compare(
      "price shell counts",
      await requiredText(py, "#view-prices-container .pv-shell-sub"),
      await requiredText(next, '[data-testid="price-shell-sub"]'),
    );
    ledger.compare(
      "price shown count",
      await requiredText(py, '[data-parity="price-shown"]'),
      await requiredText(next, '[data-testid="price-shown"]'),
    );
    ledger.compare(
      "price rate provenance note",
      await requiredText(py, '[data-parity="price-note"]'),
      await requiredText(next, '[data-testid="price-note"]'),
    );

    const pyTabs = await py.evaluate(() =>
      [...document.querySelectorAll("#priceTabs button[data-tab]")].map((button) => [
        (button as HTMLElement).dataset.tab ?? "",
        (button.textContent ?? "").replace(/\s+/g, " ").trim(),
        button.classList.contains("on"),
      ]) as [string, string, boolean][],
    );
    const nxTabs = await next.evaluate(() =>
      [...document.querySelectorAll('[data-testid="priceTabs"] button[data-tab]')].map((button) => [
        (button as HTMLElement).dataset.tab ?? "",
        (button.textContent ?? "").replace(/\s+/g, " ").trim(),
        button.getAttribute("aria-pressed") === "true",
      ]) as [string, string, boolean][],
    );
    ledger.compare("price tab keys, labels and active state", pyTabs, nxTabs);

    // Served-by is a list of provider badges (SVG in Next, glyphs in Python).
    // Compare the badge texts as arrays, not a concatenated string.
    const priceRows = async (page: typeof py, selector: string): Promise<(string | string[])[][]> =>
      page.evaluate(
        ({ sel }) => {
          const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
          const marks = /[\u2733\u25c8\u2726\u25c9\u25cf\u25a3\u2b21\u2601\u25c6\u25cb]/g;
          return [...document.querySelectorAll(sel)].map((row) =>
            [...row.children].map((cell, index) => {
              if (index !== 8) return norm(cell.textContent);
              const badges = [...cell.children];
              return badges.length
                ? badges.map((badge) => norm((badge.textContent ?? "").replace(marks, " ")))
                : [norm(cell.textContent)];
            }),
          );
        },
        { sel: selector },
      );
    ledger.compare(
      "price table rows (all tab)",
      await priceRows(py, "#pricesTableWrap tbody tr"),
      await priceRows(next, '[data-table-id="pv-tbl"] tbody tr'),
    );

    // Switch to Used on both renderers and compare the filtered rows exactly.
    await py.locator('#priceTabs button[data-tab="used"]').click();
    await next.locator('[data-testid="priceTabs"] button[data-tab="used"]').click();
    await py.waitForTimeout(150);
    await next.waitForTimeout(250);
    ledger.compare(
      "price table rows (used tab)",
      await priceRows(py, "#pricesTableWrap tbody tr"),
      await priceRows(next, '[data-table-id="pv-tbl"] tbody tr'),
    );
    ledger.compare(
      "price shown count (used tab)",
      await requiredText(py, '[data-parity="price-shown"]'),
      await requiredText(next, '[data-testid="price-shown"]'),
    );

    // Restore All, then apply the same search string to both.
    await py.locator('#priceTabs button[data-tab="all"]').click();
    await next.locator('[data-testid="priceTabs"] button[data-tab="all"]').click();
    await py.locator("#priceSearch").fill("fireworks");
    await next.locator('[data-testid="priceSearch"]').fill("fireworks");
    await py.waitForTimeout(150);
    await next.waitForTimeout(250);
    ledger.compare(
      "price table rows (search: fireworks)",
      await priceRows(py, "#pricesTableWrap tbody tr"),
      await priceRows(next, '[data-table-id="pv-tbl"] tbody tr'),
    );
    ledger.compare(
      "price shown count (search: fireworks)",
      await requiredText(py, '[data-parity="price-shown"]'),
      await requiredText(next, '[data-testid="price-shown"]'),
    );
    await py.locator("#priceSearch").fill("");
    await next.locator('[data-testid="priceSearch"]').fill("");

    const whatIf = async (page: typeof py): Promise<WhatIf> => ({
      selected: await page.evaluate(() => {
        const select = document.querySelector<HTMLSelectElement>("#cm, [data-testid='whatif-model']");
        return select?.selectedOptions[0]?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      }),
      input: await page.evaluate(() =>
        (document.querySelector<HTMLInputElement>("#ci, [data-testid='whatif-input']")?.value ?? "").trim(),
      ),
      cached: await page.evaluate(() =>
        (document.querySelector<HTMLInputElement>("#cc, [data-testid='whatif-cached']")?.value ?? "").trim(),
      ),
      output: await page.evaluate(() =>
        (document.querySelector<HTMLInputElement>("#co, [data-testid='whatif-output']")?.value ?? "").trim(),
      ),
      runs: await page.evaluate(() =>
        (document.querySelector<HTMLInputElement>("#cr, [data-testid='whatif-runs']")?.value ?? "").trim(),
      ),
      total: await requiredText(page, "#ctot, .pv-whatif-total"),
      breakdown: await requiredText(page, "#cbrk, [data-testid='whatif-breakdown']"),
    });

    ledger.compare("what-if default (cache mix seeded)", await whatIf(py), await whatIf(next));

    // Metered model with explicit tokens/runs exercises the money formatter.
    const meteredValue = await py.evaluate(() =>
      document.querySelector<HTMLOptionElement>('optgroup[label^="Metered"] option')?.value ?? "",
    );
    const nextMeteredValue = await next.evaluate(() =>
      document.querySelector<HTMLOptionElement>('optgroup[label^="Metered"] option')?.value ?? "",
    );
    ledger.compare("what-if metered option index", meteredValue, nextMeteredValue);
    for (const [page, selectorPrefix] of [[py, "#"], [next, "[data-testid='whatif-"]] as const) {
      if (selectorPrefix === "#") {
        await page.locator("#cm").selectOption(meteredValue);
        await page.locator("#ci").fill("100k");
        await page.locator("#cc").fill("40k");
        await page.locator("#co").fill("1.5m");
        await page.locator("#cr").fill("3");
      } else {
        await page.locator('[data-testid="whatif-model"]').selectOption(nextMeteredValue);
        await page.locator('[data-testid="whatif-input"]').fill("100k");
        await page.locator('[data-testid="whatif-cached"]').fill("40k");
        await page.locator('[data-testid="whatif-output"]').fill("1.5m");
        await page.locator('[data-testid="whatif-runs"]').fill("3");
      }
    }
    await py.waitForTimeout(150);
    await next.waitForTimeout(250);
    ledger.compare("what-if explicit tokens and 3 runs", await whatIf(py), await whatIf(next));

    // Unpriced model must say "no rate available", never a silent $0.
    const unpricedValue = await py.evaluate(() =>
      document.querySelector<HTMLOptionElement>('optgroup[label^="Unpriced"] option')?.value ?? "",
    );
    const nextUnpricedValue = await next.evaluate(() =>
      document.querySelector<HTMLOptionElement>('optgroup[label^="Unpriced"] option')?.value ?? "",
    );
    ledger.compare("what-if unpriced option index", unpricedValue, nextUnpricedValue);
    await py.locator("#cm").selectOption(unpricedValue);
    await next.locator('[data-testid="whatif-model"]').selectOption(nextUnpricedValue);
    await py.waitForTimeout(150);
    await next.waitForTimeout(250);
    ledger.compare("what-if unpriced model", await whatIf(py), await whatIf(next));

    console.log("RUN D compared " + JSON.stringify({
      comparisons: ledger.comparisons,
      leaves: ledger.leaves,
      providers: nxProviders.length,
      resendRows: nxResend.length,
      attributionRows: Object.values(nxAttrib).reduce((sum, rows) => sum + rows.length, 0),
      priceRows: (await priceRows(next, '[data-table-id="pv-tbl"] tbody tr')).length,
      tabs: nxTabs.length,
    }));

    for (const [label, page] of [["python", py], ["next", next]] as const) {
      await page.bringToFront();
      await page.screenshot({ path: join(SHOTS, `usage-cost-prices-${label}-1920x1080.png`) });
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
