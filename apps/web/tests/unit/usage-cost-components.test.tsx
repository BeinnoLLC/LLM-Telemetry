// LLMTELEMET-293 (T-22 RUN C) review fixes: component-level guards for the
// Cost table's token units, the inline stale chip, dollar chart labels, and
// the Prices tab/search interaction. Tokens only; no invented fixture values.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import ChartCard from "../../components/ChartCard";
import CostTables, { StalePriceChip } from "../../components/usage-cost/CostTables";
import PriceSheet from "../../components/usage-cost/PriceSheet";
import { deriveCost } from "../../lib/usage-cost/cost";
import type { AnalyticsRow, CostsData } from "../../lib/usage-cost/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const render = (element: ReactElement): void => {
  act(() => root.render(element));
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const tokenRow: AnalyticsRow = {
  date: "2026-11-20",
  task: "chat",
  model: "claude-sonnet-4",
  provider: "anthropic",
  calls: 7,
  inp: 1500,
  outp: 1500,
  cread: 1500,
  up_bytes: 2048,
  down_bytes: 4096,
  market_value_usd: 1.5,
};

const model = () => deriveCost({
  analytics: { profiles: { default: { rows: [tokenRow] } } },
  costs: {
    models: [],
    generated: "2026-11-25T10:00:00",
    freshness: { generated: "2026-11-25T10:00:00", age_s: 3 * 24 * 3600, state: "stale" },
  },
  dir: "/artifacts",
});

describe("Cost table token units (views.js:895-896)", () => {
  it("formats in/out/cache as tokens and up/down as bytes", () => {
    render(createElement(CostTables, { model: model() }));
    const tr = host.querySelector<HTMLTableRowElement>('table[data-table-id="tbl"] tr[data-model="claude-sonnet-4"]');
    expect(!!tr).toBe(true);
    const cells = [...(tr?.cells ?? [])].map((cell) => cell.textContent?.trim() ?? "");
    expect(cells.slice(3, 6)).toEqual(["1.5K", "1.5K", "1.5K"]);
    expect(cells[3]).not.toBe("1.46 KB");
    expect(cells.slice(6, 8)).toEqual(["2.00 KB", "4.00 KB"]);
  });
});

describe("inline stale chip (views.js:2590-2614)", () => {
  it("renders a small status span, not a page-wide red banner", () => {
    const cost = model();
    render(createElement(StalePriceChip, { chip: cost.stale }));
    const chip = host.querySelector<HTMLElement>(".uc-stale-chip");
    expect(chip?.tagName).toBe("SPAN");
    expect(chip?.getAttribute("role")).toBe("status");
    expect(chip?.dataset.freshState).toBe("stale");
    expect(chip?.textContent).toContain("Rates last refreshed 3d ago");
    expect(host.querySelector(".stale-banner")).toBeNull();

    // The chip's styling lives in the token-only stylesheet, never a red band.
    const css = readFileSync(join(process.cwd(), "styles", "usage-cost-charts.css"), "utf8");
    const rule = css.match(/\.uc-stale-chip\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("display: inline-block");
    expect(rule).toContain("var(--z-warn)");
    expect(rule).not.toContain("red");
  });

  it("renders nothing when the artifact is fresh", () => {
    render(createElement(StalePriceChip, { chip: { visible: false, state: "fresh", text: "" } }));
    expect(host.querySelector(".uc-stale-chip")).toBeNull();
  });
});

describe("cost chart dollar labels (views.js:797-800)", () => {
  it("shows currency only for opted-in points", () => {
    render(createElement(ChartCard, {
      id: "cModelCost",
      title: "Cost by model",
      kind: "hbar",
      points: [{ key: "m", label: "m", value: 1.5, color: "var(--chart-1)", valueText: "$1.50" }],
    }));
    expect(host.querySelector(".uc-value")?.textContent).toBe("$1.50");

    render(createElement(ChartCard, {
      id: "cCalls",
      title: "Calls",
      kind: "hbar",
      points: [{ key: "m", label: "m", value: 1500, color: "var(--chart-1)" }],
    }));
    expect(host.querySelector(".uc-value")?.textContent).toBe("1,500");
  });

  it("exposes the dollar value as an opt-in SVG point tooltip", () => {
    const dollarPoint = { key: "m", label: "m", value: 1.5, color: "var(--chart-1)", valueText: "$1.50" };
    for (const kind of ["hbar", "bar"] as const) {
      render(createElement(ChartCard, {
        id: "cModelCost",
        title: "Cost by model",
        kind,
        points: [dollarPoint],
      }));
      const point = host.querySelector<SVGGElement>(".uc-point");
      expect(point?.querySelector("title")?.textContent).toContain("$");
      expect(point?.querySelector("title")?.textContent).toBe("$1.50");
    }

    render(createElement(ChartCard, {
      id: "cCalls",
      title: "Calls",
      kind: "hbar",
      points: [{ key: "m", label: "m", value: 1500, color: "var(--chart-1)" }],
    }));
    const plain = host.querySelector<SVGGElement>(".uc-point");
    expect(plain?.querySelector("title")).toBeNull();
  });
});

describe("Prices tabs and search interaction (views.js:3424-3453)", () => {
  const data: CostsData = {
    generated: "2026-11-25T10:00:00",
    catalog_source: "openrouter",
    catalog_size: 3,
    freshness: { age_s: 3600 },
    models: [
      { model: "vendor/claude", short: "claude", source: "vendor", calls: 10, cost: 2, in_1m: 1, out_1m: 2 },
      { model: "local/qwen", short: "qwen", source: "local", calls: 4, cost: 0.01, in_1m: 0, out_1m: 0 },
      { model: "openrouter/gpt", short: "gpt", source: "openrouter", calls: 0, cost: 0, in_1m: 1, out_1m: 2 },
    ],
  };

  const shown = (): string[] =>
    [...host.querySelectorAll<HTMLTableRowElement>(".pv-tbl tbody tr[data-model]")]
      .map((tr) => tr.dataset.model ?? "");

  const search = (input: HTMLInputElement, value: string): void => {
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("exposes an accessible name, toggles aria-pressed and filters rows", () => {
    render(createElement(PriceSheet, { data }));
    const input = host.querySelector<HTMLInputElement>('[data-testid="priceSearch"]');
    expect(input?.getAttribute("aria-label")).toBe("Search models, providers and sources");
    expect(shown()).toHaveLength(3);

    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[data-testid="priceTabs"] button')];
    const tab = (key: string): HTMLButtonElement => tabs.find((button) => button.dataset.tab === key)!;
    expect(tab("all").getAttribute("aria-pressed")).toBe("true");
    act(() => tab("local").click());
    expect(tab("local").getAttribute("aria-pressed")).toBe("true");
    expect(tab("all").getAttribute("aria-pressed")).toBe("false");
    expect(tabs.filter((button) => button.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    expect(shown()).toEqual(["local/qwen"]);

    act(() => tab("all").click());
    expect(shown()).toHaveLength(3);
    search(input!, "CLAUDE");
    expect(shown()).toEqual(["vendor/claude"]);
    search(input!, "no-such-model");
    expect(shown()).toEqual([]);
    expect(host.querySelector(".pv-tbl .uc-nodata")?.textContent).toBe("No models match.");
  });
});
