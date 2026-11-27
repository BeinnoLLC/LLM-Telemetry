// LLMTELEMET-293 (T-22 RUN C): Prices derivations. Fixtures mirror the
// shapes emitted by build_costs.write_costs_data; missing rates stay missing.
import { describe, expect, it } from "vitest";
import {
  cacheMix,
  defaultWhatIfIndex,
  fmtMoney,
  priceFreshness,
  priceRows,
  priceShell,
  provenanceTitle,
  rateText,
  servedBy,
  sourceLabel,
  whatIfCalculate,
  whatIfGroups,
  wiMoney,
  wiParseTokens,
} from "../../lib/usage-cost/prices";
import type { CostModel, CostsData } from "../../lib/usage-cost/types";

const model = (values: Partial<CostModel>): CostModel => ({
  model: "vendor/model",
  short: "model",
  source: "openrouter",
  in_1m: 1,
  out_1m: 2,
  ...values,
});

describe("price-sheet freshness (views.js:3201-3211)", () => {
  it("cuts at 24h and 72h", () => {
    expect(priceFreshness({ age_s: 3600 }).state).toBe("fresh");
    expect(priceFreshness({ age_s: 24 * 3600 }).state).toBe("old");
    expect(priceFreshness({ age_s: 72 * 3600 - 1 }).state).toBe("old");
    expect(priceFreshness({ age_s: 72 * 3600 }).state).toBe("stale");
    expect(priceFreshness({ age_s: 5 * 86400 }).state).toBe("stale");
  });

  it("never invents an age", () => {
    const unknown = priceFreshness(undefined);
    expect(unknown.state).toBe("unknown");
    expect(unknown.age_s).toBeNull();
    expect(unknown.label).toBe("age unknown");
    expect(priceFreshness({ state: "pinned" }).label).toBe("pinned");
  });
});

describe("tabs and search (views.js:3424-3453)", () => {
  const models = [
    model({ model: "anthropic/claude", short: "claude", source: "vendor", calls: 10, cost: 2, providers: ["anthropic"] }),
    model({ model: "local/qwen", short: "qwen", source: "local", calls: 4, cost: 0.01 }),
    model({ model: "openrouter/gpt", short: "gpt", source: "openrouter", calls: 0, cost: 0, inferred_by: "openai-codex" }),
    model({ model: "nope/unknown", short: "unknown", source: "unpriced", calls: 2, cost: 0 }),
  ];

  it("filters by tab and sorts by calls then spend", () => {
    expect(priceRows(models).map((entry) => entry.short)).toEqual(["claude", "qwen", "unknown", "gpt"]);
    expect(priceRows(models, "used").map((entry) => entry.short)).toEqual(["claude", "qwen", "unknown"]);
    expect(priceRows(models, "local").map((entry) => entry.short)).toEqual(["qwen"]);
    expect(priceRows(models, "vendor").map((entry) => entry.short)).toEqual(["claude"]);
    expect(priceRows(models, "openrouter").map((entry) => entry.short)).toEqual(["gpt"]);
    expect(priceRows(models, "unpriced").map((entry) => entry.short)).toEqual(["unknown"]);
  });

  it("searches model, provider, served-by and source labels", () => {
    expect(priceRows(models, "all", "CLAUDE").map((entry) => entry.short)).toEqual(["claude"]);
    expect(priceRows(models, "all", "anthropic").map((entry) => entry.short)).toEqual(["claude"]);
    expect(priceRows(models, "all", "Local (electricity)").map((entry) => entry.short)).toEqual(["qwen"]);
    expect(priceRows(models, "all", "openai-codex").map((entry) => entry.short)).toEqual(["gpt"]);
    expect(priceRows(models, "all", "unpriced on record").map((entry) => entry.short)).toEqual(["unknown"]);
  });

  it("labels rates with a dash, never $0, and tags provenance", () => {
    expect(rateText(null)).toBe("—");
    expect(rateText(0.0004)).toBe("$0.0004");
    expect(rateText(1.5)).toBe("$1.5");
    expect(sourceLabel("web")).toBe("Vendor page");
    expect(sourceLabel("free-tier")).toBe("Free tier");
    expect(provenanceTitle({ rate_origin: "override" }, 3600)).toMatch(/manual override.*sheet fetched 1h ago/);
    expect(provenanceTitle(model({}), null)).toBe("no rate on record");
  });

  it("shows observed, inferred or dash served-by", () => {
    expect(servedBy(model({ calls: 3, providers: ["anthropic"] }))).toEqual([{ label: "anthropic", inferred: false }]);
    expect(servedBy(model({ calls: 0, inferred_by: "openai-codex" }))).toEqual([{ label: "openai-codex", inferred: true }]);
    expect(servedBy(model({ calls: 0 }))).toEqual([]);
  });
});

describe("what-if calculator (views.js:3304-3396)", () => {
  it("parses 100k and 1.5m shorthands", () => {
    expect(wiParseTokens("100k")).toBe(100000);
    expect(wiParseTokens("1.5m")).toBe(1500000);
    expect(wiParseTokens("1,000")).toBe(1000);
    expect(wiParseTokens("-4")).toBe(0);
    expect(wiMoney(0.0000123)).toBe("$0.00001");
  });

  it("bills cached input at the published cache rate and multiplies runs", () => {
    const priced = model({ in_1m: 10, out_1m: 20, cache_1m: 1, calls: 5 });
    const result = whatIfCalculate(priced, { input: "100k", cached: "40k", output: "1.5m", runs: "3" });
    expect(result.kind).toBe("metered");
    expect(result.noCacheRate).toBe(false);
    // 60k fresh * $10/M + 40k cached * $1/M + 1.5M out * $20/M, x3 runs.
    expect(result.totalText).toBe("$91.92 billed");
    expect(result.breakdown).toMatch(/× 3 runs/);
  });

  it("falls back to the fresh rate when the cache rate is absent", () => {
    const result = whatIfCalculate(
      model({ in_1m: 2, cache_1m: null, calls: 3 }),
      { input: "100k", cached: "100k", output: "0", runs: "1" },
    );
    expect(result.noCacheRate).toBe(true);
    expect(result.totalText).toBe("$0.200 billed");
    expect(result.breakdown).toMatch(/no published cache rate/);
  });

  it("labels local electricity, free tier and unpriced without a fake $0", () => {
    const inputs = { input: "10k", cached: "0", output: "5k", runs: "1" };
    const local = whatIfCalculate(model({ source: "local", in_1m: 1, out_1m: 1 }), inputs);
    expect(local.kind).toBe("local");
    expect(local.totalText).toBe("≈ $0.015 electricity");
    expect(local.breakdown).toMatch(/not billed by anyone/);

    const free = whatIfCalculate(model({ source: "free-tier", in_1m: 0, out_1m: 0 }), inputs);
    expect(free.totalText).toBe("$0.00 free tier");
    expect(free.breakdown).toMatch(/OpenRouter free tier/);

    const unpriced = whatIfCalculate(model({ source: "unpriced", in_1m: 0, out_1m: 0 }), inputs);
    expect(unpriced.totalText).toBe("no rate available");
    expect(unpriced.totalText).not.toContain("$0");
  });

  it("groups used models first and defaults to the priciest metered model", () => {
    const models = [
      model({ model: "x/local", short: "local", source: "local", calls: 0 }),
      model({ model: "x/metered-a", short: "a", source: "openrouter", calls: 0, out_1m: 99 }),
      model({ model: "x/metered-b", short: "b", source: "vendor", calls: 2, out_1m: 3, served_by: "anthropic" }),
      model({ model: "x/unpriced", short: "u", source: "unpriced", calls: 4 }),
    ];
    const groups = whatIfGroups(models);
    expect(groups.map((group) => group.key)).toEqual(["local", "metered", "unpriced"]);
    expect(groups[1].options.map((option) => option.label)).toEqual([
      "b  · anthropic  • used", "a",
    ]);
    expect(cacheMix(model({ inp: 900, cache: 100 }))).toBeCloseTo(0.1, 5);
    expect(cacheMix(model({ inp: 0, cache: 0 }))).toBeNull();
    expect(defaultWhatIfIndex(models)).toBe(2);
  });

  it("shows catalogue counts and a missing payload as n/a", () => {
    const data: CostsData = {
      catalog_size: 345,
      catalog_source: "openrouter",
      generated: "2026-11-25T10:00:00",
      freshness: { age_s: 3600 },
      models: [model({ calls: 2 }), model({ calls: 0 })],
    };
    const shell = priceShell(data);
    expect(shell.catalogSize).toBe("345");
    expect(shell.usedCount).toBe(1);
    expect(shell.sourceLabel).toBe("OpenRouter");
    expect(shell.fresh.state).toBe("fresh");
    expect(fmtMoney(0.0004)).toBe("$0.0004");
    expect(priceShell(null).missing).toBe(true);
  });
});
