// T-23 RUN A: strict live-DOM parity between the Python Sessions view on the
// frozen fixture and Next /sessions. Mirrors home-parity.spec.ts (T-20).
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { buildModelProviders, providerPath } from "../lib/sessions-logs/providers";
import { short } from "../lib/sessions-logs/format";
import type { SessionRow } from "../lib/sessions-logs/types";
import { ensureFixture } from "../tests/parity/home-fixture";
import {
  armTranscriptOpener,
  readDrawerDom,
  readModalDom,
  type TranscriptOpener,
} from "../tests/parity/modal-dom";
import { resolvePython } from "../tests/parity/python";
import {
  readProjectChartsDom,
  readSessionsDom,
  type SessionsDom,
  type SessionsSide,
} from "../tests/parity/sessions-dom";

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
  const analyticsProfiles = payload.profiles as Record<
    string,
    { rows: SessionRow[]; recent_sessions?: Array<{ id?: unknown }> }
  >;
  const fixtureRows = Object.values(analyticsProfiles).flatMap((profile) => profile.rows);
  const transcriptPayload = JSON.parse(readFileSync(join(fixture, "transcripts.json"), "utf8"));
  const transcriptProfiles = transcriptPayload.profiles as Record<
    string,
    Record<string, unknown[]>
  >;
  const transcriptCandidates = Object.entries(transcriptProfiles).flatMap(
    ([profile, sessions]) =>
      Object.entries(sessions).map(([id, messages]) => ({ profile, id, messages })),
  );
  const messagePick = transcriptCandidates.find(
    (candidate) => Array.isArray(candidate.messages) && candidate.messages.length > 0,
  );
  expect(messagePick, "frozen transcript fixture needs a message-bearing session").toBeTruthy();
  const messageSession = messagePick as {
    profile: string;
    id: string;
    messages: unknown[];
  };
  const transcriptIds = new Set(transcriptCandidates.map((candidate) => candidate.id));
  const missingIds = Object.values(analyticsProfiles)
    .flatMap((profile) => profile.recent_sessions ?? [])
    .map((session) => (session && session.id ? String(session.id) : ""))
    .filter((id) => id && !transcriptIds.has(id));
  expect(missingIds.length, "need real ids for empty/error states").toBeGreaterThan(1);
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
  // The intentional HTTP 503 for the error-state comparison is suppressed
  // only inside that one window; every other failure still fails the test.
  let expectHttpError = false;
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
        if (message.type() === "error" && !expectHttpError) {
          errors.push(`${label}: ${message.text()} @ ${message.location().url}`);
        }
      });
      page.on("response", (response) => {
        if (response.status() >= 400 && !expectHttpError) {
          errors.push(`${label}: HTTP ${response.status()} ${response.url()}`);
        }
      });
      page.on("pageerror", (error) => {
        if (!expectHttpError) errors.push(`${label}: ${error.message}`);
      });
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

    const compareCharts = async (label: string): Promise<void> => {
      const expected = await readProjectChartsDom(py, "python");
      const actual = await readProjectChartsDom(next, "next");
      console.log(
        "RUN D compared " +
          JSON.stringify({
            state: label,
            providers: expected.distribution.providers.map((entry) => entry.label),
            projects: expected.distribution.bars.map((bar) => bar.project),
            days: expected.trend.days.map((day) => day.day),
            series: expected.trend.series.map((entry) => entry.label),
            distAxis: expected.distribution.axisTitle,
            trendAxis: expected.trend.axisTitle,
          }),
      );
      expect(actual.distribution, `${label}: project distribution`).toEqual(expected.distribution);
      expect(actual.trend, `${label}: project trend`).toEqual(expected.trend);
      expect(errors, label).toEqual([]);
      comparisons += 1;
      console.log(`PASS parity: ${label} charts (#${comparisons})`);
    };

    // The oracle destroys/recreates both Chart.js charts on a weight-axis or
    // toggle change and rebuilds each legend with aria-pressed="true". The
    // derived DOM above already compares those values; this extra read hits
    // Next's literal aria-pressed and data-visible-total attributes so a
    // hidden series surviving a reset cannot pass by accident.
    const readVisibleTotals = (page: Page) =>
      page.evaluate(() => {
        const round = (value: number): number => Math.round(value * 1000) / 1000;
        return {
          distribution: [...document.querySelectorAll("#cProjDist .pc-bar")].map((group) => ({
            project: group.getAttribute("data-project"),
            visibleTotal: round(Number(group.getAttribute("data-visible-total"))),
          })),
          trend: [...document.querySelectorAll("#cProjTrend .pc-day")].map((group) => ({
            day: group.getAttribute("data-day"),
            visibleTotal: round(Number(group.getAttribute("data-visible-total"))),
          })),
        };
      });

    const compareChartsAfterReset = async (label: string): Promise<void> => {
      await compareCharts(label);
      const pressed = async (page: Page, selector: string) =>
        page
          .locator(`${selector} button`)
          .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-pressed")));
      for (const [selector, name] of [
        ["#projdistlegend", "provider"],
        ["#projtrendlegend", "series"],
      ] as const) {
        expect(await pressed(next, selector), `${label}: ${name} aria-pressed`).toEqual(
          await pressed(py, selector),
        );
      }
      const expected = await readProjectChartsDom(py, "python");
      const actual = await readVisibleTotals(next);
      const expectedDistribution = expected.distribution.bars.map((bar) => ({
        project: bar.project,
        visibleTotal: bar.visibleTotal,
      }));
      const expectedTrend = expected.trend.days.map((day) => ({
        day: day.day,
        visibleTotal: day.visibleTotal,
      }));
      // The derived DOM comparison above is exact after its 3-decimal
      // rounding; the raw SVG attribute carries unrounded percentage noise
      // (Python sums rounded shares to 99.999/100.001 where Next sums to
      // 100). Allow only that noise, never a hidden dataset's full weight.
      const compareTotals = <T extends { visibleTotal: number }>(
        received: readonly T[],
        wanted: readonly T[],
        name: string,
      ): void => {
        expect(received.length, `${label}: ${name} row count`).toBe(wanted.length);
        received.forEach((row, index) => {
          expect(
            Math.abs(row.visibleTotal - wanted[index]!.visibleTotal),
            `${label}: ${name} data-visible-total row ${index}`,
          ).toBeLessThanOrEqual(0.002);
        });
      };
      expect(actual.distribution.map((row) => row.project)).toEqual(
        expectedDistribution.map((row) => row.project),
      );
      expect(actual.trend.map((row) => row.day)).toEqual(expectedTrend.map((row) => row.day));
      compareTotals(actual.distribution, expectedDistribution, "distribution");
      compareTotals(actual.trend, expectedTrend, "trend");
    };

    await compare("default");
    await compareCharts("default charts");
    for (const axis of AXES) {
      await Promise.all([
        py.locator(`#projweight button[data-w="${axis}"]`).click(),
        next.locator(`#projweight button[data-w="${axis}"]`).click(),
      ]);
      await Promise.all([py.waitForTimeout(100), next.waitForTimeout(100)]);
      await compare(axis);
      await compareCharts(`${axis} charts`);
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

    // RUN D hardening: one scroll container only, keyboard-operable legend
    // buttons with visible focus rings, and aria-hidden kept in sync with the
    // empty state. These are next-side invariants, not oracle comparisons.
    const hardening = await next.evaluate(() => {
      const dist = document.querySelector("#cProjDist");
      const trend = document.querySelector("#cProjTrend");
      const legend = [...document.querySelectorAll(".pc-legend-item")];
      const scrollers = [
        ...document.querySelectorAll("#projdistcard *, #projtrendcard *"),
      ].filter((node) => {
        const overflow = getComputedStyle(node).overflowX;
        return overflow === "auto" || overflow === "scroll";
      });
      return {
        scrollers: scrollers.length,
        distHidden: dist?.getAttribute("aria-hidden"),
        trendHidden: trend?.getAttribute("aria-hidden"),
        legendButtons: legend.length,
        keyboard: legend.every(
          (button) =>
            button.tagName === "BUTTON" &&
            button.getAttribute("aria-pressed") !== null &&
            button.getAttribute("tabindex") !== "-1",
        ),
      };
    });
    expect(hardening.scrollers).toBe(0);
    expect(hardening.distHidden).toBe("false");
    expect(hardening.trendHidden).toBe("false");
    expect(hardening.legendButtons).toBeGreaterThan(0);
    expect(hardening.keyboard).toBe(true);
    const ring = await next.evaluate(() =>
      [...document.styleSheets].some((sheet) => {
        try {
          return [...sheet.cssRules].some(
            (rule) => rule.cssText.includes(":focus-visible") && rule.cssText.includes("outline"),
          );
        } catch {
          return false;
        }
      }),
    );
    expect(ring, "legend buttons need a focus-visible outline rule").toBe(true);

    // Reset to cost, then exercise the two chart toggles and both legends.
    await Promise.all([
      py.locator('#projweight button[data-w="cost"]').click(),
      next.locator('#projweight button[data-w="cost"]').click(),
    ]);
    await Promise.all([py.waitForTimeout(100), next.waitForTimeout(100)]);
    await compareCharts("cost charts restored");

    const toggleBoth = async (selector: string): Promise<void> => {
      await Promise.all([py.locator(selector).check(), next.locator(selector).check()]);
      await Promise.all([py.waitForTimeout(150), next.waitForTimeout(150)]);
    };
    const untoggleBoth = async (selector: string): Promise<void> => {
      await Promise.all([py.locator(selector).uncheck(), next.locator(selector).uncheck()]);
      await Promise.all([py.waitForTimeout(150), next.waitForTimeout(150)]);
    };
    await toggleBoth("#projdistnorm");
    await compareCharts("distribution normalised");
    await untoggleBoth("#projdistnorm");
    await compareCharts("distribution absolute again");
    await toggleBoth("#projtrendstack");
    await compareCharts("trend stacked");
    await untoggleBoth("#projtrendstack");
    await compareCharts("trend absolute again");

    const hideFirst = async (selector: string): Promise<void> => {
      await Promise.all([
        py.locator(`${selector} button`).first().click(),
        next.locator(`${selector} button`).first().click(),
      ]);
      await Promise.all([py.waitForTimeout(150), next.waitForTimeout(150)]);
    };
    await hideFirst("#projdistlegend");
    await compareCharts("distribution legend hidden");
    await hideFirst("#projdistlegend");
    await compareCharts("distribution legend shown");
    await hideFirst("#projtrendlegend");
    await compareCharts("trend legend hidden");
    await hideFirst("#projtrendlegend");
    await compareCharts("trend legend shown");

    // Review finding: a hidden legend must not survive an axis or toggle
    // change. The oracle destroys/recreates its charts on each of those
    // events and rebuilds the legends with aria-pressed="true"; Next must do
    // the same. Legend clicks themselves still hide/show (asserted above).
    const changeAxisBoth = async (weight: string): Promise<void> => {
      await Promise.all([
        py.locator(`#projweight button[data-w="${weight}"]`).click(),
        next.locator(`#projweight button[data-w="${weight}"]`).click(),
      ]);
      await Promise.all([py.waitForTimeout(200), next.waitForTimeout(200)]);
    };
    await hideFirst("#projdistlegend");
    await hideFirst("#projtrendlegend");
    await changeAxisBoth("calls");
    await compareChartsAfterReset("hidden legends then calls axis");

    await hideFirst("#projdistlegend");
    await toggleBoth("#projdistnorm");
    await compareChartsAfterReset("hidden provider then distribution normalised");
    await untoggleBoth("#projdistnorm");

    await hideFirst("#projtrendlegend");
    await toggleBoth("#projtrendstack");
    await compareChartsAfterReset("hidden series then trend stacked");
    await untoggleBoth("#projtrendstack");

    await changeAxisBoth("cost");
    await compareCharts("cost charts restored after legend resets");

    // RUN B: one drawer text comparison, then three modal states. The frozen
    // artifacts supply every id — no stand-in session is invented.
    const openDrawer = async (): Promise<void> => {
      await Promise.all([
        py.locator('#projmatrix tbody tr:first-child td:first-child[role="button"]').click(),
        next.locator('#projmatrix tbody tr:first-child td:first-child[role="button"]').click(),
      ]);
      await Promise.all([
        py.locator("#pdrawer.open").waitFor({ state: "attached" }),
        next.locator("#pdrawer.open").waitFor({ state: "attached" }),
      ]);
    };
    const closeDrawer = async (): Promise<void> => {
      await Promise.all([py.keyboard.press("Escape"), next.locator("#pdclose").click()]);
      await Promise.all([
        py.locator("#pdrawer:not(.open)").waitFor({ state: "attached" }),
        next.locator("#pdrawer:not(.open)").waitFor({ state: "attached" }),
      ]);
      // Both sides hide a closed drawer with a delayed visibility transition;
      // wait for the computed state instead of racing the duration.
      await Promise.all(
        [py, next].map((page) =>
          expect
            .poll(() =>
              page.evaluate(() => getComputedStyle(document.querySelector("#pdrawer")!).visibility),
            )
            .toBe("hidden"),
        ),
      );
    };
    const compareDrawer = async (label: string): Promise<void> => {
      const expected = await readDrawerDom(py);
      const actual = await readDrawerDom(next);
      // A closed drawer keeps its last HTML in Python but unmounts in Next;
      // only the user-visible open state is comparable when closed.
      const comparable = <T extends typeof expected>(value: T) =>
        value.open
          ? value
          : {
              hidden: value.hidden,
              open: value.open,
              visibility: value.visibility,
              scrimOpen: value.scrimOpen,
            };
      if (expected.open) {
        expect(actual.visibility, `${label}: open drawer must be visible`).toBe("visible");
        expect(expected.visibility, `${label}: oracle open drawer`).toBe("visible");
      }
      expect(comparable(actual), label).toEqual(comparable(expected));
      expect(errors, label).toEqual([]);
      comparisons += 1;
      console.log(`PASS parity: ${label} (#${comparisons})`);
    };
    const compareModal = async (label: string): Promise<void> => {
      const expected = await readModalDom(py);
      const actual = await readModalDom(next);
      expect(actual, label).toEqual(expected);
      expect(errors, label).toEqual([]);
      comparisons += 1;
      console.log(`PASS parity: ${label} (#${comparisons})`);
    };
    const closeModal = async (): Promise<void> => {
      await Promise.all([py.keyboard.press("Escape"), next.locator("#tclose").click()]);
      await Promise.all([
        py.locator("#tmodal:not(.open)").waitFor({ state: "attached" }),
        next.locator("#tmodal:not(.open)").waitFor({ state: "attached" }),
      ]);
    };
    const clickOpener = async (opener: TranscriptOpener): Promise<void> => {
      await Promise.all([
        armTranscriptOpener(py, opener, "python"),
        armTranscriptOpener(next, opener, "next"),
      ]);
      await Promise.all([
        py.locator("#pdbody .ttitlebtn[data-tsession]").click(),
        next.locator("#pdbody .ttitlebtn[data-tsession]").click(),
      ]);
      await Promise.all([
        py.locator("#tmodal.open").waitFor({ state: "attached" }),
        next.locator("#tmodal.open").waitFor({ state: "attached" }),
      ]);
    };
    // The page renders the synthetic "All" profile but the frozen artifact has
    // two real profiles. The Next transcript opener must resolve the owning
    // profile from the loaded sessions data — never the merged name — or the
    // message lookup would return nothing.
    const assertMergedProfile = async (
      opener: Pick<TranscriptOpener, "id" | "profile">,
    ): Promise<void> => {
      const shipped = await next.locator("#ttimelinebtn").getAttribute("data-tprofile");
      expect(shipped, "Next opened the transcript with the owning profile").toBe(opener.profile);
      expect(opener.profile, "fixture must exercise a merged profile").not.toBe("All");
      expect(analyticsProfiles).toHaveProperty("work");
      expect(analyticsProfiles).toHaveProperty("personal");
      comparisons += 1;
      console.log(`PASS parity: merged profile resolves ${shipped} (#${comparisons})`);
    };

    await openDrawer();
    await compareDrawer("drawer open");
    await closeDrawer();
    await compareDrawer("drawer closed");

    await openDrawer();
    await clickOpener({
      id: messageSession.id,
      profile: messageSession.profile,
      text: messageSession.id,
    });
    await Promise.all([
      py.locator("#tbody .tmsg").first().waitFor({ state: "attached" }),
      next.locator("#tbody .tmsg").first().waitFor({ state: "attached" }),
    ]);
    await assertMergedProfile(messageSession);
    await compareModal("transcript messages");
    await closeModal();
    await closeDrawer();

    await openDrawer();
    await clickOpener({
      id: missingIds[0],
      profile: messageSession.profile,
      text: missingIds[0],
    });
    await Promise.all([
      py.locator("#tbody .e-msg").waitFor({ state: "attached" }),
      next.locator("#tbody .e-msg").waitFor({ state: "attached" }),
    ]);
    await compareModal("transcript empty state");
    await closeModal();
    await closeDrawer();

    await openDrawer();
    const fail = async (route: {
      fulfill: (options: object) => Promise<void>;
      continue: () => Promise<void>;
    }): Promise<void> => {
      if (expectHttpError) {
        await route.fulfill({
          status: 503,
          contentType: "text/plain",
          body: "Service Unavailable",
        });
      } else {
        await route.continue();
      }
    };
    await py.route("**/transcripts.json*", fail);
    await next.route("**/api/data/transcripts.json*", fail);
    expectHttpError = true;
    await clickOpener({
      id: missingIds[1],
      profile: messageSession.profile,
      text: missingIds[1],
    });
    await Promise.all([
      py.locator("#tbody .e-hint").waitFor({ state: "attached" }),
      next.locator("#tbody .e-hint").waitFor({ state: "attached" }),
    ]);
    await compareModal("transcript error state");
    expectHttpError = false;
    await closeModal();
    await closeDrawer();
    await py.unroute("**/transcripts.json*", fail);
    await next.unroute("**/api/data/transcripts.json*", fail);

    // Final screenshots: the drawer and message modal, on both sides, at 1280x800.
    const shots = [
      ["py", py, "#projmatrix", "sessions-matrix-python.png"],
      ["next", next, "#projmatrix", "sessions-matrix-next.png"],
    ] as const;
    for (const [side, page, selector, name] of shots) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForTimeout(1200);
      await page.locator(selector).screenshot({ path: join(fixture, name) });
      await page.screenshot({ path: join(fixture, name.replace(".png", "-page.png")), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(1000);
      await page.screenshot({ path: join(fixture, name.replace(".png", "-mobile.png")), fullPage: true });
      console.log(`saved ${side} screenshot: ${name}`);
    }

    // RUN D empty states, last: shrink the frozen fixture to zero rows on the
    // Next side and move the oracle's date window off the fixture range. Only
    // the empty-state copy/visibility is compared — Python keeps a stale
    // distribution legend at zero rows while Next clears it, which is a
    // known oracle quirk, not a data difference.
    const emptyPayload = JSON.parse(JSON.stringify(payload)) as {
      profiles: Record<string, { rows: unknown[] }>;
    };
    Object.values(emptyPayload.profiles).forEach((profile) => {
      profile.rows = [];
    });
    await next.route("**/api/data/analytics-data.json*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(emptyPayload),
      }),
    );
    await py.evaluate(() => {
      for (const id of ["#from", "#to"]) {
        const input = document.querySelector<HTMLInputElement>(id);
        if (input) {
          input.value = "1999-01-01";
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    });
    await next.reload();
    await Promise.all([
      py.locator("#projdistempty:not([hidden])").waitFor({ state: "attached" }),
      py.locator("#projtrendempty:not([hidden])").waitFor({ state: "attached" }),
      next.locator("#projdistempty:not([hidden])").waitFor({ state: "attached" }),
      next.locator("#projtrendempty:not([hidden])").waitFor({ state: "attached" }),
    ]);
    const expectedEmpty = await readProjectChartsDom(py, "python");
    const actualEmpty = await readProjectChartsDom(next, "next");
    expect(actualEmpty.distribution.empty, "distribution empty state").toEqual(
      expectedEmpty.distribution.empty,
    );
    expect(actualEmpty.trend.empty, "trend empty state").toEqual(expectedEmpty.trend.empty);
    expect(
      await next.locator("#cProjDist").getAttribute("aria-hidden"),
      "empty chart must be aria-hidden",
    ).toBe("true");
    expect(
      await next.locator("#cProjTrend").getAttribute("aria-hidden"),
      "empty chart must be aria-hidden",
    ).toBe("true");
    expect(errors, "empty states").toEqual([]);
    comparisons += 1;
    console.log(`PASS parity: chart empty states (#${comparisons})`);

    expect(errors, "No browser console/network errors on either side").toEqual([]);
    expect(comparisons, "matrix + weight + charts + legend resets + drawer + merged profile + 3 modal states").toBe(30);
    console.log(`PARITY_COMPARISONS=${comparisons}`);
  } finally {
    oracle.child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((ok) => oracle.child.once("exit", () => ok())),
      new Promise<void>((ok) => setTimeout(ok, 2000)),
    ]);
    if (oracle.child.exitCode === null) oracle.child.kill("SIGKILL");
  }
});
