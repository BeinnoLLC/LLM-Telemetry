// LLMTELEMET-293 (T-22 RUN C): Cost derivations, exercised with hand-built
// rows that use only fields the collector emits. No page or browser required.
import { describe, expect, it } from "vitest";
import {
  RESEND_MIN,
  attributionPanel,
  costCell,
  deriveCost,
  localDay,
  logScaleHeight,
  modelCostRows,
  providerCostRows,
  sessionResends,
  stalePriceChip,
  taskCosts,
  unpricedModels,
} from "../../lib/usage-cost/cost";
import type { AnalyticsRow, UsageSnapshot } from "../../lib/usage-cost/types";

const row = (values: Partial<AnalyticsRow>): AnalyticsRow => ({
  date: "2026-11-20",
  task: "chat",
  model: "claude-sonnet-4",
  provider: "anthropic",
  calls: 1,
  inp: 100,
  outp: 10,
  market_value_usd: 0,
  ...values,
});

function snapshot(rows: AnalyticsRow[], extra: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    analytics: {
      profiles: { default: { rows } },
    },
    costs: { models: [] },
    dir: "/artifacts",
    ...extra,
  };
}

describe("cost-by-task log axis (views.js:807-816)", () => {
  it("orders tasks by descending cost and keeps calls linear", () => {
    const points = taskCosts([
      row({ task: "cheap", market_value_usd: 0.01, calls: 900 }),
      row({ task: "main", market_value_usd: 3.2, calls: 12 }),
      row({ task: "free", market_value_usd: 0, calls: 40 }),
      row({ task: "mid", market_value_usd: 0.4, calls: 200 }),
    ]);
    expect(points.map((point) => point.label)).toEqual(["main", "mid", "cheap", "free"]);
    expect(points.map((point) => point.calls)).toEqual([12, 200, 900, 40]);
    expect(points.map((point) => point.cost)).toEqual([3.2, 0.4, 0.01, 0]);
  });

  it("raises log heights by decade and gives zero cost no bar", () => {
    expect(logScaleHeight(0)).toBe(0);
    expect(logScaleHeight(-1)).toBe(0);
    expect(logScaleHeight(0.01, 1)).toBeCloseTo(0, 5);
    expect(logScaleHeight(1, 1)).toBeCloseTo(1, 5);
    expect(logScaleHeight(0.1, 1)).toBeGreaterThan(logScaleHeight(0.01, 1));
    expect(logScaleHeight(1, 1)).toBeGreaterThan(logScaleHeight(0.1, 1));
  });
});

describe("provider cost table (views.js:844-872)", () => {
  it("sums metered plus LAN bytes and sorts by market cost", () => {
    const rows = [
      row({
        provider: "local", model: "qwen3", calls: 50,
        up_bytes: 100, down_bytes: 200, lan_up_bytes: 400, lan_down_bytes: 800,
        market_value_usd: 0,
      }),
      row({
        provider: "anthropic", model: "claude-sonnet-4", calls: 8,
        up_bytes: 1000, down_bytes: 2000,
        market_value_usd: 1.5,
      }),
    ];
    const providers = providerCostRows(rows);
    expect(providers.map((entry) => entry.key)).toEqual(["anthropic", "local"]);
    const local = providers.find((entry) => entry.key === "local")!;
    const anthropic = providers.find((entry) => entry.key === "anthropic")!;
    expect(local.up).toBe(500);
    expect(local.down).toBe(1000);
    expect(anthropic.up).toBe(1000);
    expect(anthropic.costText).toBe("$1.50");
    expect(local.models).toBe(1);
    expect(providers.every((entry) => entry.icon.startsWith("M"))).toBe(true);
  });
});

describe("model table labels (views.js:875-910, palette.js:204-211)", () => {
  it("labels local, free-tier and unpriced costs without inventing a price", () => {
    expect(costCell(0.0123, true).text).toBe("~$0.012 electricity");
    expect(costCell(0, false, "freetier").text).toBe("$0 free tier");
    expect(costCell(0, false, "unpriced").text).toBe("unpriced");
    expect(costCell(1.256, false).text).toBe("$1.26");
  });

  it("keeps unpriced models and their call counts", () => {
    const rows = [
      row({ model: "frobnicator-9", calls: 7, market_value_usd: 0 }),
      row({ model: "frobnicator-9", calls: 5, market_value_usd: 0 }),
      row({ model: "qwen3", calls: 30, cost_class: "local" }),
    ];
    expect(unpricedModels(rows)).toEqual([{ label: "frobnicator-9", calls: 12 }]);
    const models = modelCostRows(rows);
    expect(models.find((entry) => entry.model === "frobnicator-9")?.costKind).toBe("unpriced");
    expect(models.find((entry) => entry.model === "qwen3")?.costKind).toBe("local");
  });
});

describe("session re-send (views.js:549-569)", () => {
  const stamp = (day: number) => new Date(2026, 10, day, 12, 0, 0).getTime() / 1000;

  it("drops sessions below RESEND_MIN and outside the range", () => {
    expect(localDay(stamp(21))).toBe("2026-11-21");
    const resend = sessionResends(
      {
        resend: [
          { id: "few", calls: RESEND_MIN - 1, last: stamp(21), resend_usd: 9 },
          { id: "old", calls: 20, last: stamp(1), resend_usd: 8 },
          { id: "keep", calls: RESEND_MIN, last: stamp(21), resend_usd: 0.5, title: "Keep" },
          { id: "undated", calls: 11, resend_usd: 0.25 },
        ],
      },
      "2026-11-20",
      "2026-11-22",
    );
    expect(resend.map((entry) => entry.id)).toEqual(["keep", "undated"]);
    expect(resend[0].costText).toBe("$0.50");
    expect(resend[0].title).toBe("Keep");
  });

  it("labels a local session as electricity, not a vendor bill", () => {
    const resend = sessionResends({
      resend: [{ id: "local", calls: 12, cost_class: "local", resend_usd: 0.003 }],
    });
    expect(resend[0].costText).toBe("~$0.0030 electricity");
    const unpriced = sessionResends({
      resend: [{ id: "u", calls: 12, priced: false, resend_usd: 0 }],
    });
    expect(unpriced[0].costText).toBe("unpriced");
  });
});

describe("attribution and the stale-price chip", () => {
  it("hides collector-only attribution without by_source", () => {
    expect(attributionPanel(undefined).hidden).toBe(true);
    const model = attributionPanel({
      by_source: [{ source: "sessions", cost: 0.1234, sessions: 4 }],
      by_tool: [{ tool: "read", cost: 0.0001, tokens: 1200 }],
      by_root: [{ id: "a", title: "A", own: 1, descendants: 2, total: 3 }],
    });
    expect(model.hidden).toBe(false);
    expect(model.bySource[0].costText).toBe("$0.1234");
    expect(model.byTool[0].tokensText).toBe("1,200 tok");
    expect(model.byRoot[0].totalText).toBe("$3.0000");
  });

  it("uses the collector stale record first and keeps the chip inline", () => {
    const chip = stalePriceChip(
      { age_s: 100, state: "fresh" },
      { prices: { stale: true, age_s: 90000, policy_s: 259200 } },
    );
    expect(chip.visible).toBe(true);
    expect(chip.state).toBe("stale");
    expect(chip.text).toMatch(/Rates last refreshed .* ago \(policy 3d\); costs use the last good price sheet\./);
    expect(stalePriceChip({ age_s: 100 }, { prices: { stale: false, age_s: 100 } }).visible).toBe(false);
  });

  it("falls back to the price-sheet freshness with the 72h cut", () => {
    expect(stalePriceChip({ age_s: 3600 }, undefined).visible).toBe(false);
    const old = stalePriceChip({ age_s: 3 * 24 * 3600 }, undefined);
    expect(old.visible).toBe(true);
    expect(old.state).toBe("stale");
  });

  it("composes one cost model from a snapshot", () => {
    const model = deriveCost(
      snapshot(
        [row({ task: "main", market_value_usd: 2 })],
        { analytics: { profiles: { default: { rows: [row({ market_value_usd: 2 })], resend: [{ id: "session", calls: 12, resend_usd: 1 }] } } } },
      ),
      { profile: "default" },
    );
    expect(model.profile).toBe("default");
    expect(model.rowCount).toBe(1);
    expect(model.taskCosts[0].cost).toBe(2);
    expect(model.resend).toHaveLength(1);
    expect(model.stale.visible).toBe(false);
  });
});
