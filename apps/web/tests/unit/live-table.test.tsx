// LLMTELEMET-291 (T-20 RUN D2): DOM contract for the roomy live table.
// The component is mounted into jsdom so header clicks exercise real React
// state; EventSource is stubbed because useLiveHome only needs it for I/O.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LiveTable from "../../components/home/LiveTable";
import type { HomeSnapshot } from "../../lib/home/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class StubEventSource {
  onerror: ((event: Event) => void) | null = null;
  addEventListener(): void {}
  close(): void {}
}

const home = (live: Partial<NonNullable<HomeSnapshot["live"]>>): HomeSnapshot => ({
  analytics: null,
  live: { profiles: {}, ...live },
  router: null,
  quota: null,
});

let host: HTMLDivElement;
let root: Root;

const mount = (snapshot: HomeSnapshot, name = "All"): void => {
  act(() => {
    root.render(createElement(LiveTable, { initial: snapshot, name }));
  });
};
const rows = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(".lvrow")];
const titles = (): string[] =>
  rows().map((row) => row.querySelector(".lv-s1")?.textContent ?? "");

beforeEach(() => {
  vi.stubGlobal("EventSource", StubEventSource);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("Home live table (RUN D2)", () => {
  it("renders nine sortable headers over eight grid tracks", () => {
    mount(home({ profiles: { work: { live: [{ id: "s1", title: "one" }] } } }));
    const headers = [...host.querySelectorAll<HTMLElement>(".lvhead [role=columnheader]")];
    expect(headers.map((header) => header.textContent?.trim())).toEqual([
      "Kind", "Session", "Model", "State", "Elapsed",
      "Tokens", "Cost", "Last activity", "Load",
    ]);
    expect(headers.map((header) => header.getAttribute("aria-sort")))
      .toEqual(Array(9).fill("none"));
    expect(host.querySelectorAll(".lvhead > *")).toHaveLength(8);
    expect(host.querySelector(".lvhgrp")?.querySelectorAll("[role=columnheader]"))
      .toHaveLength(2);
    // Header controls are real buttons, so keyboard activation is native.
    expect(host.querySelectorAll(".lvhead button[data-sort]")).toHaveLength(9);
  });

  it("renders one keyed row per deduped session", () => {
    mount(home({
      profiles: {
        work: { live: [
          { id: "s1", title: "first", model: "openai/gpt-5" },
          { id: "s2", title: "second", model: "m/glm-5" },
        ] },
        other: { live: [{ id: "s1", title: "duplicate", model: "m/other" }] },
      },
      pi_live: [{ session_id: "p1", title: "pi task", phase: "working" }],
      agent_live: [{ engine: "claude", session_id: "c1", title: "agent task", phase: "working" }],
    }));
    expect(rows().map((row) => row.getAttribute("data-key"))).toEqual([
      "s1", "s2", "pi:p1", "claude:c1",
    ]);
    expect(titles()).toEqual(["first", "second", "pi task", "agent task"]);
  });

  it("sorts on header click and reports aria-sort", () => {
    mount(home({ profiles: { work: { live: [
      { id: "z", title: "zulu", model: "m/z" },
      { id: "a", title: "alpha", model: "m/a" },
    ] } } }));
    const header = [...host.querySelectorAll<HTMLElement>("[role=columnheader]")]
      .find((node) => node.querySelector("button[data-sort=session]"));
    if (!header) throw new Error("missing Session header");
    const button = header.querySelector("button");
    if (!button) throw new Error("missing Session sort button");
    expect(titles()).toEqual(["zulu", "alpha"]);

    act(() => button.click());
    expect(titles()).toEqual(["alpha", "zulu"]);
    expect(header.getAttribute("aria-sort")).toBe("ascending");

    act(() => button.click());
    expect(titles()).toEqual(["zulu", "alpha"]);
    expect(header.getAttribute("aria-sort")).toBe("descending");
  });

  it("labels subscription rows as covered instead of adding their cost", () => {
    mount(home({ agent_live: [{
      engine: "claude", session_id: "c1", title: "paid by subscription",
      phase: "running", cost_usd: 123.45, cost_class: "subscription",
    }] }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector(".lv-covered")?.textContent)
      .toBe("covered by Claude subscription");
    expect(rows()[0].textContent).toContain("not in total");
    expect(rows()[0].textContent).not.toContain("$123.45");
  });

  it("escapes an HTML title instead of injecting markup", () => {
    const title = '<img src=x onerror=alert(1)>';
    mount(home({ profiles: { work: { live: [{ id: "s1", title }] } } }));
    expect(host.querySelector("img")).toBeNull();
    expect(host.innerHTML).not.toContain("<img");
    expect(rows()[0].querySelector(".lv-s1")?.textContent).toBe(title);
    expect(rows()[0].querySelector(".lvc-sess")?.getAttribute("title"))
      .toContain(title);
  });
});

describe("home-live-table.css contract", () => {
  it("keeps the roomy 52-64px, two-line grid with token-only sizing", () => {
    const web = process.cwd();
    const css = readFileSync(
      resolve(dirname(web), "web", "styles/home-live-table.css"),
      "utf8",
    );
    for (const rule of ["min-height:52px", "max-height:64px", "font-size:var(--fs-sm)", "--lvcols"]) {
      expect(css, `missing ${rule}`).toContain(rule);
    }
  });
});
