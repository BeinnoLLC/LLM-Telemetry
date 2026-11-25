// T-23 RUN C: jsdom coverage for the interactive Logs view. The fixture is
// served through a stubbed fetch, so the test proves the lazy /api/data read,
// every filter control, row expansion, CSV download and the 404 message.
// Only React's own test primitives are used: this workspace has no extra
// testing-library dependency and the gate must run on the pinned lockfile.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LogsView from "../../components/sessions-logs/LogsView";
import { providerIcon } from "../../lib/home-board/provider-icons";
import { EMPTY_SELECTION, filteredLogs, type LogsPayload } from "../../lib/sessions-logs/logs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../../examples/reports/logs-data.json"),
    "utf8",
  ),
) as LogsPayload;

let container: HTMLDivElement;
let root: Root;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

function stubFetch(payload: unknown = fixture, status = 200) {
  const fetchMock = vi.fn(async (input: string | URL) => {
    void input;
    return ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    }) as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderView(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<LogsView />);
  });
  await settle();
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
}

async function waitFor(check: () => boolean, timeout = 3000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) throw new Error("condition did not become true");
    await settle();
  }
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
  });
}

async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const rows = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>("#lglist .lgev"));

function buttonNamed(name: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === name,
  );
  if (!found) throw new Error(`button ${name} not found`);
  return found as HTMLButtonElement;
}

function leafWith(text: string): HTMLElement {
  const found = Array.from(document.querySelectorAll<HTMLElement>("*")).find(
    (element) => element.children.length === 0 && (element.textContent ?? "").includes(text),
  );
  if (!found) throw new Error(`text ${text} not found`);
  return found;
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/logs");
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(() => "blob:logs-test"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

afterEach(async () => {
  if (root) {
    await act(async () => root.unmount());
  }
  container?.remove();
  vi.unstubAllGlobals();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: originalCreate,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: originalRevoke,
  });
});

describe("T-23 RUN C Logs view", () => {
  it("fetches once, renders real events, and discloses the cap", async () => {
    const fetchMock = stubFetch();
    await renderView();

    await waitFor(() => rows().length > 0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^\/api\/data\/logs-data\.json\?t=/);

    const events = fixture.profiles.work.events;
    expect(rows().length).toBeLessThanOrEqual(events.length);
    expect(leafWith("last 24h ·")).toBeTruthy();
    expect(leafWith("filter counts cover the full window")).toBeTruthy();
    for (const label of ["Level:", "Role:", "Tool:", "Model:", "Session:", "Kind:"]) {
      expect(leafWith(label)).toBeTruthy();
    }
    expect(document.querySelector('[data-view="Logs"]')).toBeTruthy();
  });

  it("renders provider SVG marks, never letter glyphs, on model chips and open rows", async () => {
    stubFetch();
    await renderView();
    await waitFor(() => rows().length > 0);

    const modelChip = document.querySelector<HTMLElement>('[data-facet="model"]')!;
    const path = modelChip.querySelector("svg.lgprovlogo path");
    expect(path).toBeTruthy();
    expect(path!.getAttribute("d")).toBe(providerIcon(modelChip.dataset.val ?? ""));

    await click(rows()[0]);
    expect(rows()[0].classList.contains("open")).toBe(true);
    expect(rows()[0].querySelector("svg.lgprovlogo path")).toBeTruthy();
    expect(rows()[0].querySelector(".lgmeta")?.textContent).toContain(" · ");
  });

  it("applies and removes a facet through both the chip and the active strip", async () => {
    stubFetch();
    await renderView();
    await waitFor(() => rows().length > 0);

    const before = rows().length;
    const chip = document.querySelector<HTMLButtonElement>(
      '[data-facet="tool"][data-val="read_file"]',
    )!;
    const tool = chip.dataset.val!;
    expect(tool).not.toBe("");

    await click(chip);
    await waitFor(() => rows().length < before);
    expect(rows().every((row) => row.querySelector(".lgtag")?.textContent === tool)).toBe(true);
    expect(chip.classList.contains("on")).toBe(true);
    expect(leafWith("1 filter active")).toBeTruthy();
    const active = document.querySelector<HTMLElement>("#lgactive")!;
    expect(active.classList.contains("show")).toBe(true);

    const activeChip = active.querySelector<HTMLButtonElement>(".lgactivechip")!;
    expect(activeChip.textContent).toContain("Tool:");
    expect(activeChip.textContent).toContain(tool);
    await click(activeChip);
    await waitFor(() => rows().length === before);
    expect(document.querySelector("#lgcountbadge")?.hasAttribute("hidden")).toBe(true);
  });

  it("filters by search text and by the generated-relative time window", async () => {
    stubFetch();
    await renderView();
    await waitFor(() => rows().length > 0);

    const before = rows().length;
    const search = document.querySelector<HTMLInputElement>("#lgq")!;
    expect(search.placeholder).toBe("Search text, tool, session…");
    await typeInto(search, "timeout");
    await waitFor(() => rows().length < before);
    expect(rows().length).toBeGreaterThan(0);

    await click(buttonNamed("Clear"));
    await waitFor(() => rows().length === before);
    expect(search.value).toBe("");

    await click(document.querySelector<HTMLButtonElement>('[data-win="1"]')!);
    await waitFor(() => rows().length < before);
    expect(document.querySelector('[data-win="1"]')!.classList.contains("on")).toBe(true);
    await click(document.querySelector<HTMLButtonElement>('[data-win="24"]')!);
    await waitFor(() => rows().length === before);
  });

  it("exports the filtered rows as log-events.csv", async () => {
    stubFetch();
    await renderView();
    await waitFor(() => rows().length > 0);

    const chip = document.querySelector<HTMLButtonElement>(
      '[data-facet="tool"][data-val="read_file"]',
    )!;
    await click(chip);
    const expectedRows = rows().length;
    let downloaded = "";
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloaded = this.download;
      });
    await click(buttonNamed("Export CSV"));

    expect(downloaded).toBe("log-events.csv");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.type).toBe("text/csv");
    const text = await blob.text();
    expect(text.split("\n").length).toBe(expectedRows + 1);
    expect(text.startsWith("when,level,role,tool,model,session,title,preview")).toBe(true);
  });

  it("wraps schema failures in the exact Python outer error sentence", async () => {
    stubFetch({ unexpected: true }, 200);
    await renderView();
    await waitFor(() => document.querySelector(".lgerror") !== null);
    expect(document.querySelector(".lgerror")!.textContent).toBe(
      "Could not load logs-data.json (logs-data.json is a stale payload (no schema_version) — re-run `llm-telemetry dashboard`). Run llm-telemetry logs, and note that fetch is blocked when the page is opened from file://.",
    );
  });

  it("rejects a stringified schema_version with the strict mismatch wording", async () => {
    stubFetch({ schema_version: "3", profiles: {} }, 200);
    await renderView();
    await waitFor(() => document.querySelector(".lgerror") !== null);
    expect(document.querySelector(".lgerror")!.textContent).toBe(
      'Could not load logs-data.json (logs-data.json has schema_version "3", this page expects 3 — re-run `llm-telemetry dashboard`). Run llm-telemetry logs, and note that fetch is blocked when the page is opened from file://.',
    );
  });

  it("selects ?profile=personal instead of the first payload profile", async () => {
    window.history.replaceState({}, "", "/logs?profile=personal");
    stubFetch();
    await renderView();
    await waitFor(() => rows().length > 0);

    const modelFacet = (name: string) =>
      fixture.profiles[name].facets.model!.find((facet) => facet.v === "claude-opus-5")!.n;
    expect(modelFacet("personal")).not.toBe(modelFacet("work"));
    const chip = document.querySelector<HTMLElement>(
      '[data-facet="model"][data-val="claude-opus-5"] .n',
    )!;
    expect(chip.textContent).toBe(String(modelFacet("personal")));
  });

  it("uses the real session label as the chip tooltip", async () => {
    stubFetch();
    await renderView();
    await waitFor(() => rows().length > 0);
    const chip = document.querySelector<HTMLElement>(
      '[data-facet="session"][data-val="s_alpha01"]',
    )!;
    expect(chip.textContent).toContain("Billing service");
    expect(chip.getAttribute("title")).toBe("Billing service");
    expect(chip.getAttribute("title")).not.toBe("s_alpha0");
  });

  it("adds two chips in one facet as an OR set and removes them independently", async () => {
    stubFetch();
    await renderView();
    await waitFor(() => rows().length > 0);

    const chips = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-facet="level"]'),
    );
    expect(chips.length).toBeGreaterThan(1);
    const [first, second] = chips;

    await click(first);
    const afterFirst = document.querySelector("#lgcount")!.textContent;
    await click(second);
    expect(first.classList.contains("on")).toBe(true);
    expect(second.classList.contains("on")).toBe(true);
    expect(document.querySelector("#lgcountbadge")?.textContent?.trim()).toBe(
      "2 filters active",
    );
    // The table itself is capped at 200 rows; the matched-count badge proves
    // the two level chips widened the set instead of replacing the first.
    const twoLevels = [first.getAttribute("data-val")!, second.getAttribute("data-val")!];
    const expectedCount = filteredLogs(
      fixture.profiles.work,
      { ...EMPTY_SELECTION, level: twoLevels },
      24,
      "",
    ).length;
    expect(document.querySelector("#lgcount")!.textContent).toBe(
      `${expectedCount} shown`,
    );
    expect(document.querySelector("#lgcount")!.textContent).not.toBe(afterFirst);

    await click(first);
    expect(first.classList.contains("on")).toBe(false);
    expect(second.classList.contains("on")).toBe(true);
    expect(document.querySelector("#lgcountbadge")?.textContent?.trim()).toBe(
      "1 filter active",
    );
  });

  it("shows the exact oracle overflow-note wording when the display cap is passed", async () => {
    stubFetch();
    await renderView();
    await waitFor(() => rows().length > 0);
    expect(document.querySelector("#lgnote")?.textContent).toBe(
      "Showing the newest 200 of 683 matches — narrow the filters to see more.",
    );
  });

  it("shows the exact lazy-load error when the artifact is missing", async () => {
    stubFetch({ error: "not found" }, 404);
    await renderView();
    await waitFor(() => document.querySelector(".lgerror") !== null);
    expect(document.querySelector(".lgerror")!.textContent).toBe(
      "Could not load logs-data.json (HTTP 404). Run llm-telemetry logs, and note that fetch is blocked when the page is opened from file://.",
    );
  });
});
