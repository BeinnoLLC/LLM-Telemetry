// LLMTELEMET-292 (T-21 RUN C2): DOM contract for the Flow graph, controls
// and tooltip. Rows are taken from the repo's real sample analytics artifact.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import FlowGraph from "../../components/life-flow/FlowGraph";
import FlowTip from "../../components/life-flow/FlowTip";
import type { AnalyticsData } from "../../lib/home-board/types";
import { FLOW_DEPTH_DEFAULT, flowData } from "../../lib/life-flow/flow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const repoRoot = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));
const payload = JSON.parse(
  readFileSync(join(repoRoot, "examples/reports/analytics-data.json"), "utf8"),
) as AnalyticsData;
const rows = payload.profiles?.work?.rows ?? [];
const sessions = (payload.profiles?.work?.node_sessions ?? null) as Record<string, unknown> | null;
const realChatList = Object.values(sessions ?? {}).find(
  (entry) => Array.isArray(entry) && entry.length > 0,
) as unknown[] | undefined;
const realChat = realChatList?.[0] as Record<string, unknown> | undefined;

let host: HTMLDivElement;
let root: Root;

function mount(graphRows = rows): void {
  act(() => {
    root.render(createElement(FlowGraph, { rows: graphRows, sessions }));
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("FlowGraph", () => {
  it("clears the graph and shows the exact empty-range text", () => {
    mount([]);
    expect(host.querySelector("#flowsub")?.textContent).toBe("no data in this range");
    expect(host.querySelectorAll("#flow .nd")).toHaveLength(0);
    expect(host.querySelectorAll("#flow .lnk")).toHaveLength(0);
    // Controls stay available, as flowControls() is wired before renderFlow.
    expect(host.querySelectorAll("#flowctl [data-fd]")).toHaveLength(2);
  });

  it("draws real nodes and links, then honours the depth control", () => {
    mount(rows.slice(0, 28));
    expect(Number(host.querySelector("#flow")?.getAttribute("viewBox")?.split(" ")[3])).toBe(560);
    expect(host.querySelectorAll("#flow .nd").length).toBeGreaterThan(1);
    expect(host.querySelectorAll("#flow .lnk").length).toBeGreaterThan(0);
    expect(host.querySelector('[data-fd="3"]')?.className).toContain("on");

    act(() => {
      host.querySelector<HTMLButtonElement>('[data-fd="2"]')?.click();
    });
    expect(host.querySelectorAll('#flow .nd[data-kind="task"]')).toHaveLength(0);
    expect(host.querySelector('[data-fd="2"]')?.className).toContain("on");

    act(() => {
      host.querySelector<HTMLButtonElement>('[data-fd="3"]')?.click();
    });
    expect(host.querySelectorAll('#flow .nd[data-kind="task"]').length).toBeGreaterThan(0);
    expect(FLOW_DEPTH_DEFAULT).toBe(3);
  });

  it("renders provider SVG marks, never a letter", () => {
    mount(rows.slice(0, 28));
    const marks = [...host.querySelectorAll("#flow .nd-mark path")];
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.every((path) => (path.getAttribute("d") ?? "").length > 20)).toBe(true);
    expect(host.querySelectorAll("#flow .qt-ball")).toHaveLength(0);
  });

  it("keeps colour tokens and no hex literals in the Flow view", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const relative of ["../../components/life-flow/FlowGraph.tsx", "../../styles/life-flow-graph.css"]) {
      const source = readFileSync(join(here, relative), "utf8");
      expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
    const stylesheet = readFileSync(join(here, "../../styles/life-flow-graph.css"), "utf8");
    expect(stylesheet).toContain("var(--accent)");
    expect(stylesheet).toContain("var(--border)");
  });
});

describe("FlowTip", () => {
  it("matches the Python tooltip rows and chat section", () => {
    const rootNode = flowData(rows);
    const node = rootNode.kids[0].kids[0];
    const html = renderToString(createElement(FlowTip, {
      node,
      rootCalls: rootNode.calls,
      chats: [{
        id: String(realChat?.id ?? ""),
        title: String(realChat?.title ?? ""),
        calls: Number(realChat?.calls ?? 0),
      }],
    }));
    const hostEl = document.createElement("div");
    hostEl.innerHTML = html;
    expect(hostEl.querySelector("#flowtip")?.className).toContain("on");
    expect(hostEl.querySelector(".ft-h")?.textContent).toBe(node.name);
    expect([...hostEl.querySelectorAll(".ft-r span")].map((n) => n.textContent))
      .toEqual(["calls", "est. cost", "tasks"]);
    expect(realChat?.title, "sample artifact must carry a real chat").toBeTruthy();
    expect(hostEl.querySelector(".ft-s")?.textContent).toBe("chats");
    expect(hostEl.querySelector(".ft-c span")?.textContent).toBe(String(realChat?.title));
    expect(hostEl.querySelector(".ft-c b")?.textContent).toBe(Number(realChat?.calls).toLocaleString());
  });

  it("leaves an empty tooltip when no node is hovered", () => {
    const hostEl = document.createElement("div");
    hostEl.innerHTML = renderToString(createElement(FlowTip, { node: null, rootCalls: 0 }));
    expect(hostEl.querySelector("#flowtip")?.className).toBe("flowtip");
    expect(hostEl.querySelector(".ft-r")).toBeNull();
  });
});
