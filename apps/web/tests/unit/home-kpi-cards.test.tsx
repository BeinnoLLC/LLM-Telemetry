// LLMTELEMET-291 (T-20 RUN C2): DOM contract for the Home KPI components.
// Testing Library is not a dependency here, so these use React's server
// renderer into jsdom and assert the real markup (not component internals).
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import AnalyticsKpis from "../../components/home-board/AnalyticsKpis";
import LiveKpis from "../../components/home-board/LiveKpis";
import StatCard from "../../components/home-board/StatCard";
import type { HomeSnapshot } from "../../lib/home-board/types";

function render(node: ReactElement): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToString(node);
  return host;
}

const snapshot: HomeSnapshot = {
  analytics: null,
  live: {
    profiles: {
      work: {
        live: [{ id: "s1", models: [{ calls: 3, in_tok: 10, out_tok: 2 }] }],
        agents: [{ state: "alive" }],
        alerts: [],
      },
    },
  },
  router: null,
  quota: null,
};

describe("Home KPI cards (RUN C2)", () => {
  it("renders the four live cards in the required key order", () => {
    const host = render(createElement(LiveKpis, { initial: snapshot, name: "work" }));
    const cards = [...host.querySelectorAll("[data-kpi]")];
    expect(cards.map((card) => card.getAttribute("data-kpi"))).toEqual([
      "sessions", "agents", "throughput", "alerts",
    ]);
    for (const card of cards) {
      expect(card.classList.contains("stat")).toBe(true);
      expect(card.querySelector(".stat-label")).not.toBeNull();
      expect(card.querySelector(".stat-value")).not.toBeNull();
      expect(card.querySelector(".stat-sub")).not.toBeNull();
    }
  });

  it("renders six totals inside #kpis", () => {
    const host = render(createElement(AnalyticsKpis, { profile: null }));
    expect(host.querySelector("#kpis")).not.toBeNull();
    expect(host.querySelectorAll("#kpis .stat-value")).toHaveLength(6);
  });

  it("shows n/a markers, not zeroes, when analytics is missing", () => {
    const host = render(createElement(AnalyticsKpis, { profile: null }));
    const values = [...host.querySelectorAll("#kpis .stat-value")].map(
      (node) => node.textContent?.trim(),
    );
    expect(values).toEqual(Array(6).fill("—"));
    expect(values).not.toContain("0");
  });

  it("gives a long label the wrapping class and keeps the full title", () => {
    const host = render(
      createElement(StatCard, {
        label: "Cache hit rate and unpriced models",
        display: "—",
        sub: "no data",
      }),
    );
    const label = host.querySelector(".stat-label");
    expect(label?.classList.contains("stat-label-wrap")).toBe(true);
    expect(label?.getAttribute("title")).toBe("Cache hit rate and unpriced models");
    expect(host.querySelector(".stat-value")?.textContent).toBe("—");
  });
});
