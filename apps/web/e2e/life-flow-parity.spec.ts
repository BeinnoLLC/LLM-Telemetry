// LLMTELEMET-292 T-21 RUN D: Life and Flow read from the same frozen sample
// as the T-20 Home parity spec. Python is the oracle; nothing is filtered,
// relaxed or synthesised. Strict toEqual on both DOM extracts and errors.
import { basename, join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

import {
  ensureLifeFlowFixture,
  warmNextFeed,
} from "../tests/parity/home-fixture";
import { resolvePython, startParityOracle } from "../tests/parity/python";

const CWD = process.cwd();
const REPO_ROOT = basename(CWD) === "web" ? resolve(CWD, "..", "..") : CWD;
const WEB_ROOT = join(REPO_ROOT, "apps", "web");
const FROZEN = new Date("2026-09-25T13:51:12Z");

interface LifeDom {
  quota: { sub: string; body: string };
  jars: { counts: string[]; names: string[]; empty: Array<string | null> };
}

interface FlowNodeDom {
  name: string;
  calls: string;
}

function pythonLifeDom(page: Page): Promise<LifeDom> {
  return page.evaluate(() => {
    const t = (el: Element | null | undefined): string =>
      (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    // innerText keeps the CSS flex/grid separators between KPI and provider
    // cells; React emits no whitespace between adjacent elements.
    const rendered = (el: Element | null | undefined): string =>
      ((el as HTMLElement | null)?.innerText ?? "").replace(/\s+/g, " ").trim();
    const jars = document.querySelector("#qtrain");
    return {
      quota: {
        sub: t(document.querySelector("#lifequotasub")),
        body: rendered(document.querySelector("#lifequotabody")),
      },
      jars: {
        counts: [...(jars?.querySelectorAll(".qt-n") ?? [])].map(t),
        names: [...(jars?.querySelectorAll(".qt-name") ?? [])].map(t),
        empty: [...(jars?.querySelectorAll(".qt-cars") ?? [])]
          .map((el) => el.getAttribute("data-empty")),
      },
    };
  });
}

const nextLifeDom = pythonLifeDom;

/** Python paints its Flow tooltip on a direct mouseenter listener. */
function pythonFlowDom(page: Page): Promise<FlowNodeDom[]> {
  return page.evaluate(() => {
    const t = (el: Element | null | undefined): string =>
      (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const tip = document.querySelector("#flowtip");
    return [...document.querySelectorAll("#flowwrap svg .nd")]
      .map((node) => {
        node.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
        return {
          name: t(tip?.querySelector(".ft-h")),
          calls: t(tip?.querySelector(".ft-r b")).split(" (")[0],
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.calls.localeCompare(b.calls));
  });
}

/** The Next node's accessible name carries the same label and call total as
 * Python's hover tooltip, without depending on React's event synthesis. */
function nextFlowDom(page: Page): Promise<FlowNodeDom[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("#flowwrap svg .nd")]
      .map((node) => {
        const label = node.getAttribute("aria-label") ?? "";
        const match = /^(.*): ([\d,]+) calls$/.exec(label);
        return { name: match?.[1] ?? label, calls: match?.[2] ?? "" };
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.calls.localeCompare(b.calls)),
  );
}

/** T-21 keeps the permanent rule: every jar ball and the legend show an SVG
 * provider mark, never a letter. Checked on both pages, not just the oracle. */
function providerMarks(page: Page) {
  return page.evaluate(() => {
    const balls = [...document.querySelectorAll("#qtrain .qt-ball[data-key]")];
    return {
      balls: balls.length,
      missingSvg: balls.filter((ball) => !ball.querySelector("svg")).length,
      letters: balls
        .filter((ball) => /^\s*[A-Za-z]\s*$/.test(ball.textContent ?? ""))
        .map((ball) => ball.getAttribute("data-key") ?? ""),
      legendSvg: !!document.querySelector("#qt-leg-ico svg"),
    };
  });
}

test("Life and Flow match the Python oracle on identical fixtures", async ({ browser }) => {
  test.setTimeout(120_000);
  const python = resolvePython(WEB_ROOT);
  if (!python) throw new Error("set LLM_TELEMETRY_PARITY_PYTHON to the .venv python");
  const fixture = ensureLifeFlowFixture();
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
      next.goto("/life"),
    ]);
    // The vtab strip is collapsed at desktop widths; the rail link is the
    // visible control that calls the same pickView() handler.
    await py.locator('[data-nav="Life"]').click();
    await Promise.all([
      py.locator("#lifequotabody .qv-liferow").first().waitFor({ state: "attached" }),
      next.locator("#lifequotabody .qv-liferow").first().waitFor({ state: "attached" }),
      py.locator("#qt-n-running").waitFor({ state: "attached" }),
      next.locator("#qt-n-running").waitFor({ state: "attached" }),
    ]);
    await Promise.all([py.clock.runFor(5000), next.clock.runFor(5000)]);
    await py.waitForLoadState("networkidle");
    await next.waitForTimeout(1000);

    const expectedLife = await pythonLifeDom(py);
    const actualLife = await nextLifeDom(next);
    console.log("RUN D Life compared " + JSON.stringify({ expected: expectedLife, actual: actualLife }));
    expect(actualLife).toEqual(expectedLife);
    expect(errors).toEqual([]);

    for (const [label, page] of [["python", py], ["next", next]] as const) {
      const marks = await providerMarks(page);
      expect(marks.legendSvg, `${label} legend SVG`).toBe(true);
      expect(marks.missingSvg, `${label} balls without SVG`).toBe(0);
      expect(marks.letters, `${label} letter glyphs`).toEqual([]);
    }

    await Promise.all([
      py.locator('[data-nav="Flow"]').click(),
      next.goto("/flow"),
    ]);
    await py.clock.runFor(100);
    await Promise.all([
      py.locator("#flowwrap svg .nd").first().waitFor({ state: "attached" }),
      next.locator("#flowwrap svg .nd").first().waitFor({ state: "attached" }),
    ]);
    await next.waitForTimeout(500);

    const expectedFlow = await pythonFlowDom(py);
    const actualFlow = await nextFlowDom(next);
    console.log("RUN D Flow compared " + JSON.stringify({
      expectedCount: expectedFlow.length,
      actualCount: actualFlow.length,
      values: expectedFlow,
    }));
    expect(actualFlow).toEqual(expectedFlow);
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
