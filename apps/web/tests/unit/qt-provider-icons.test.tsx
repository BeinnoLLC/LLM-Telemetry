// LLMTELEMET-291 (T-20 RUN E2): every assertion of the Python guard
// tests/check_qt_ball_provider_icons.js, ported un-loosened to the Next Home
// queue. The source guard covers apps/web instead of flow.js.
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TaskQueue from "../../components/home-board/TaskQueue";
import { HEXAGON_PATH, RT_LOGO, RT_SVG } from "../../lib/home-board/provider-icons";
import type { HomeSnapshot } from "../../lib/home-board/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class StubEventSource {
  onerror: ((event: Event) => void) | null = null;
  addEventListener(): void {}
  close(): void {}
}

const fixture = (): HomeSnapshot => ({
  analytics: { profiles: { work: { recent_sessions: [
    { id: "d1", title: "done one", model: "qwen3-coder:30b", last_ts: 200, dur_s: 42, tokens: 100 },
    { id: "d2", title: "done two", model: "mystery-model", last_ts: 100, dur_s: 7, tokens: 10 },
  ] } } },
  live: {
    profiles: { work: { live: [
      { id: "t1", model: "claude-opus-5", title: "one", idle_s: 1 },
      { id: "t2", model: "totally-unknown-model", title: "two", idle_s: 2 },
      { id: "t3", title: "three", idle_s: 3 },
    ] } },
    ollama: { hosts: [{ label: "box-a", up: true, queue: 3, loaded: [], urls: [] }] },
  },
  router: null,
  quota: null,
});

let host: HTMLDivElement;
let root: Root;

const mount = (): void => {
  act(() => {
    root.render(createElement(TaskQueue, {
      initial: fixture(), name: "work", boxWidth: 320, boxHeight: 260,
    }));
  });
};
/** The guard ignores leaving balls; the ported component has none. */
const cars = (id: string): HTMLElement[] =>
  [...host.querySelectorAll<HTMLElement>(`#qt-${id} .qt-ball[data-key]`)];
const pathOf = (ball: Element | null | undefined): string | null =>
  ball?.querySelector(".qt-gl svg path")?.getAttribute("d") ?? null;

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

describe("queue provider-icon guard (ported from check_qt_ball_provider_icons.js)", () => {
  it("drives 3 depot + 3 running + 2 yard balls from real feeds", () => {
    mount();
    const balls = [...cars("queued"), ...cars("running"), ...cars("done")];
    expect(cars("queued")).toHaveLength(3);
    expect(cars("running")).toHaveLength(3);
    expect(cars("done")).toHaveLength(2);
    expect(balls).toHaveLength(8);
  });

  it("puts an inline svg in every ball and never a single-letter glyph", () => {
    mount();
    const balls = [...cars("queued"), ...cars("running"), ...cars("done")];
    expect(balls.every((ball) => !!ball.querySelector(".qt-gl svg"))).toBe(true);
    expect(balls.every((ball) => (ball.textContent ?? "").trim().length !== 1)).toBe(true);
    for (const ball of balls) {
      const size = Number((ball.style.getPropertyValue("--sz") || "0").replace("px", ""));
      expect(size).toBeGreaterThanOrEqual(18);
    }
  });

  it("gives every no-model depot ball the Ollama path", () => {
    mount();
    expect(cars("queued").map(pathOf)).toEqual(Array(3).fill(RT_SVG.ollama));
  });

  it("gives an unknown provider a neutral hexagon svg, never a letter", () => {
    mount();
    const unknown = [...cars("running"), ...cars("done")]
      .find((ball) => ball.dataset.model === "mystery-model");
    expect(!!unknown).toBe(true);
    expect(!!unknown && !!unknown.querySelector(".qt-gl svg")).toBe(true);
    expect((unknown?.textContent ?? "").trim().length).not.toBe(1);
    expect(pathOf(unknown)).toBe(HEXAGON_PATH);
  });

  it("shows a model's Anthropic brand mark on its ball", () => {
    mount();
    const brand = cars("running")
      .find((ball) => ball.dataset.model === "claude-opus-5");
    const brandPath = pathOf(brand);
    expect(!!brandPath).toBe(true);
    expect(brandPath).toBe(RT_SVG[RT_LOGO.anthropic]);
  });

  it("uses the Ollama SVG in the jar legend, with no letter glyph", () => {
    mount();
    const leg = host.querySelector<HTMLElement>(".qt-legend .qt-gl");
    expect(!!leg && !!leg.querySelector("svg")).toBe(true);
    expect(pathOf(leg)).toBe(RT_SVG.ollama);
    expect((leg?.textContent ?? "").trim().length).not.toBe(1);
  });

  it("keeps the counter and qsub contracts", () => {
    mount();
    expect(host.querySelector("#qt-n-queued")?.className).toContain("qt-n-queued");
    expect(host.querySelector("#qt-n-running")?.className).toContain("qt-n-running");
    expect(host.querySelector("#qt-n-done")?.className).toContain("qt-n-done");
    expect(host.querySelector(".qt-n-queued")?.textContent).toBe("3");
    expect(host.querySelector(".qt-n-running")?.textContent).toBe("3");
    expect(host.querySelector(".qt-n-done")?.textContent).toBe("2");
    expect(host.querySelector("#qsub")?.textContent).toBe("backed up on box-a");
  });
});

describe("no letter-table source under apps/web", () => {
  const banned = ["QT_" + "GLYPH", "qtGlyph" + "Key"];

  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.name !== "node_modules" && entry.name !== ".next")
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return files(path);
      return [".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", ".html"].includes(extname(path))
        ? [path] : [];
    });

  it("has no letter table or family-letter mapper anywhere in the web app", () => {
    const web = process.cwd();
    const sources = files(web);
    expect(sources.length).toBeGreaterThan(20);
    for (const token of banned) {
      expect(token.length).toBeGreaterThan(4);
      const hits = sources.filter((path) => readFileSync(path, "utf8").includes(token));
      expect(hits, `letter-table token found in ${hits.join(", ")}`).toEqual([]);
    }
  });
});
