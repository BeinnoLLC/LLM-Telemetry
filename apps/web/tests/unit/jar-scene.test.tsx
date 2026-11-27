// LLMTELEMET-292 (T-21 RUN B1/B2): DOM contract for the Life/Flow jar scene.
// TaskQueue supplies the T-20 Jar/QueueBall composition; these assertions
// cover bucket names and counts, exact empty states, and the un-loosened
// provider-SVG guard for every ball and the legend.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import JarScene from "../../components/life-flow/JarScene";
import {
  HEXAGON_PATH,
  RT_LOGO,
  RT_SVG,
} from "../../lib/home-board/provider-icons";
import type { HomeSnapshot } from "../../lib/home-board/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class StubEventSource {
  onerror: ((event: Event) => void) | null = null;
  addEventListener(): void {}
  close(): void {}
}

function fixture(): HomeSnapshot {
  return {
    analytics: {
      profiles: {
        work: {
          recent_sessions: [
            { id: "d1", title: "done one", model: "qwen3-coder:30b", last_ts: 200 },
            { id: "d2", title: "done two", model: "mystery-model", last_ts: 100 },
          ],
        },
      },
    },
    live: {
      profiles: {
        work: {
          live: [
            { id: "t1", model: "claude-opus-5", title: "one", idle_s: 1 },
            { id: "t2", model: "totally-unknown-model", title: "two", idle_s: 2 },
            { id: "t3", title: "three", idle_s: 3 },
          ],
        },
      },
      ollama: { hosts: [{ label: "box-a", up: true, queue: 3, loaded: [], urls: [] }] },
    },
    router: null,
    quota: null,
  };
}

function emptyFixture(): HomeSnapshot {
  return {
    analytics: { profiles: { work: { recent_sessions: [] } } },
    live: { profiles: { work: { live: [] } }, ollama: { hosts: [] } },
    router: null,
    quota: null,
  };
}

let host: HTMLDivElement;
let root: Root;

function mount(snapshot: HomeSnapshot = fixture()): void {
  act(() => {
    root.render(createElement(JarScene, {
      initial: snapshot, name: "work", boxWidth: 320, boxHeight: 260,
    }));
  });
}

const balls = (id: string): HTMLElement[] =>
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

describe("Life/Flow jar scene", () => {
  it("reuses one three-jar grid and the real bucket counts", () => {
    mount();
    expect(host.querySelectorAll(".lf-jar-scene")).toHaveLength(1);
    expect(host.querySelectorAll(".qtrain")).toHaveLength(1);
    expect([...host.querySelectorAll(".qt-sec .qt-name")].map((n) => n.textContent))
      .toEqual(["Depot", "On the line", "Yard"]);
    expect([...host.querySelectorAll(".qt-sec")].map((n) => n.getAttribute("aria-label")))
      .toEqual(["Depot: waiting", "On the line: running", "Yard: done"]);
    expect([...host.querySelectorAll(".qt-cars")].map((n) => n.getAttribute("aria-label")))
      .toEqual(["Waiting tasks", "Running tasks", "Finished tasks"]);
    expect([...host.querySelectorAll(".qt-n")].map((n) => n.textContent))
      .toEqual(["3", "3", "2"]);
    expect(host.querySelector("#qsub")?.textContent).toBe("backed up on box-a");
    expect(balls("queued")).toHaveLength(3);
    expect(balls("running")).toHaveLength(3);
    expect(balls("done")).toHaveLength(2);
  });

  it("shows exactly the Python empty states when no data is loaded", () => {
    mount(emptyFixture());
    expect([...host.querySelectorAll(".qt-cars")].map((n) => n.getAttribute("data-empty")))
      .toEqual(["Nothing queued", "No live sessions", "No finished sessions"]);
    expect(host.querySelectorAll(".qt-ball")).toHaveLength(0);
    expect([...host.querySelectorAll(".qt-n")].map((n) => n.textContent))
      .toEqual(["0", "0", "0"]);
  });

  it("puts a provider SVG in every ball and never a single-letter glyph", () => {
    mount();
    const all = [...balls("queued"), ...balls("running"), ...balls("done")];
    expect(all).toHaveLength(8);
    expect(all.every((ball) => !!ball.querySelector(".qt-gl svg path"))).toBe(true);
    for (const ball of all) {
      expect((ball.textContent ?? "").trim().length).not.toBe(1);
      const size = Number((ball.style.getPropertyValue("--sz") || "0").replace("px", ""));
      expect(size).toBeGreaterThanOrEqual(18);
    }
  });

  it("uses Ollama for no-model depot balls and a hexagon for unknown providers", () => {
    mount();
    expect(balls("queued").map(pathOf)).toEqual(Array(3).fill(RT_SVG.ollama));
    const unknown = [...balls("running"), ...balls("done")]
      .find((ball) => ball.dataset.model === "mystery-model");
    expect(!!unknown).toBe(true);
    expect(pathOf(unknown)).toBe(HEXAGON_PATH);
    const brand = balls("running")
      .find((ball) => ball.dataset.model === "claude-opus-5");
    expect(pathOf(brand)).toBe(RT_SVG[RT_LOGO.anthropic]);
  });

  it("keeps the Ollama SVG in the jar legend", () => {
    mount();
    const legend = host.querySelector<HTMLElement>(".qt-legend .qt-gl");
    expect(!!legend?.querySelector("svg path")).toBe(true);
    expect(pathOf(legend)).toBe(RT_SVG.ollama);
    expect((legend?.textContent ?? "").trim().length).not.toBe(1);
  });

  it("adds no nested scroll container and no hex colour literals", () => {
    const cssPath = join(
      dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
      "styles/life-flow-jars.css",
    );
    const css = readFileSync(cssPath, "utf8");
    expect(css).toMatch(/\.lf-jar-scene/);
    expect(css).not.toMatch(/overflow\s*:\s*(auto|scroll)/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("no letter-table source under apps/web", () => {
  const banned = ["QT_" + "GLYPH", "qtGlyph" + "Key"];
  const here = dirname(fileURLToPath(import.meta.url));
  const web = join(here, "..", "..");

  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.name !== "node_modules" && entry.name !== ".next")
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return files(path);
      return [".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", ".html"].includes(extname(path))
        ? [path] : [];
    });

  it("has no family-letter mapper anywhere in the web app", () => {
    const sources = files(web);
    expect(sources.length).toBeGreaterThan(20);
    for (const token of banned) {
      const hits = sources.filter((path) => readFileSync(path, "utf8").includes(token));
      expect(hits, `letter-table token found in ${hits.join(", ")}`).toEqual([]);
    }
  });
});
