import { describe, expect, it } from "vitest";
import {
  priceRow,
  builtinRate,
  catalogSize,
  classFromModel,
  isFreeTier,
  isLocal,
  meteredByModel,
  rateOrigin,
  resolveCatalogId,
  WEB_RATES,
  type Catalog,
} from "../../src/pricing.js";
import { localRates } from "../../src/energy.js";
import { Config } from "../../src/config.js";

// Ports of the pricing.py / energy.py rules that decide real money numbers
// (T-15, LLMTELEMET-286). Empty catalogue in these tests: the built-in
// tables and the local path are what they exercise.
const EMPTY: Catalog = {};
const CFG = new Config();
const LOCAL_HINTS = ["localhost", "127.0.0.1", "10.", "192.168."];
const pr = (row: Parameters<typeof priceRow>[0], cat: Catalog) => priceRow(row, cat, CFG, LOCAL_HINTS, {});

describe("pricing classification", () => {
  it("isLocal is name-based and rejects vendor-qualified ids", () => {
    expect(isLocal("qwen3-coder:30b")).toBe(true);
    expect(isLocal("openai/gpt-oss-120b")).toBe(false);
    expect(isLocal("nemotron-3-super")).toBe(false); // CLOUD_ONLY_MODELS
    expect(isLocal("gpt-oss:20b-cloud")).toBe(false); // cloud tag
  });

  it("isFreeTier knows :free and the Zen free SKUs", () => {
    expect(isFreeTier("beam-free")).toBe(true);
    expect(isFreeTier("opencode/beam-free")).toBe(true);
    expect(isFreeTier("x:free")).toBe(true);
    expect(isFreeTier("kimi-k3")).toBe(false);
  });

  it("meteredByModel and classFromModel follow the hint tables", () => {
    expect(meteredByModel("openrouter/x")).toBe(true);
    expect(meteredByModel("qwen3-coder")).toBe(false);
    expect(classFromModel("glm-5.3")).toBe("subscription");
    expect(classFromModel("unknown-model")).toBe(null);
  });

  it("builtinRate strips cloud tags and variant suffixes", () => {
    expect(builtinRate(WEB_RATES, "gpt-oss:20b-cloud")?.[0]).toBe(0.07);
    expect(builtinRate(WEB_RATES, "nemotron-3-super")?.[1]).toBe(2.40);
    expect(builtinRate(WEB_RATES, "no-such-model")).toBeNull();
  });

  it("resolveCatalogId matches exact basename or dashed->dotted, never a variant tag", () => {
    // Python: base, variant = base.rsplit(":", 1) drops the variant, and the
    // dashed->dotted form is tried — "claude-fable-5-1" -> "claude-fable-5.1".
    expect(
      resolveCatalogId("claude-fable-5-1:thinking", {
        "anthropic/claude-fable-5.1": {},
      }),
    ).toBe("anthropic/claude-fable-5.1");
    // a ":batch" variant in the CATALOGUE id is never matched
    expect(
      resolveCatalogId("claude-fable-5-1", { "anthropic/claude-fable-5.1:batch": {} }),
    ).toBe(null);
    expect(
      resolveCatalogId("nemotron-3-super:batch", {
        "nvidia/nemotron-3-super-120b-a12b": {},
      }),
    ).toBe(null); // basename must match exactly
  });

  it("catalogSize excludes the Nous table", () => {
    expect(catalogSize({ "a/b": {}, "nous:x": {} })).toBe(1);
  });
});

describe("priceRow cost split", () => {
  it("built-in fallback rate on an unclassed model", () => {
    const r = pr(
      { model: "nemotron-3-super", input_tokens: 1e6, output_tokens: 0 },
      EMPTY,
    );
    // price_row's blunt label: any non-local rates_for() hit reads "catalog"
    // (rateOrigin() is what says "builtin") — matches pricing.py exactly.
    expect(rateOrigin("nemotron-3-super", EMPTY, CFG)[0]).toBe("builtin");
    expect(r.rate_source).toBe("catalog");
    expect(r.market_value_usd).toBeCloseTo(0.30, 6);
    expect(r.billed_usd).toBe(0);
    expect(r.priced).toBe(true);
  });

  it("RATE_OVERRIDES beats the catalogue and bills nothing for subscription class", () => {
    const r = pr({ model: "glm-5.3", input_tokens: 1e6 }, EMPTY);
    expect(rateOrigin("glm-5.3", EMPTY, CFG)[0]).toBe("override");
    expect(r.rate_source).toBe("catalog"); // blunt label again (pricing.py)
    expect(r.market_value_usd).toBeCloseTo(1.40, 6);
    expect(r.cost_class).toBe("subscription");
    expect(r.billed_usd).toBe(0);
  });

  it("local models are priced in electricity (energy_usd == market value)", () => {
    const r = pr(
      { model: "qwen3-coder:30b", provider: "ollama", output_tokens: 60000 },
      EMPTY,
    );
    expect(r.cost_class).toBe("local");
    expect(r.rate_source).toBe("local");
    expect(r.energy_usd).toBe(r.market_value_usd);
    expect(r.billed_usd).toBe(0);
    const out1m = localRates("qwen3-coder:30b", CFG).rates[1];
    expect(r.market_value_usd).toBeCloseTo((60000 / 1e6) * out1m, 6);
  });

  it("LAN base_url forces the local provider", () => {
    const r = pr(
      {
        model: "whatever-unknown",
        base_url: "http://10.0.0.11:11434/v1",
        output_tokens: 1000,
      },
      EMPTY,
    );
    expect(r.cost_class).toBe("local");
    expect(r.rate_source).toBe("energy"); // URL-local but not local-by-name
  });

  it("a metered provider bills actual spend", () => {
    const catalog: Catalog = {
      "deepseek/deepseek-v4.1-flash": {
        prompt: "0.00000022",
        completion: "0.00000066",
        input_cache_read: "0.000000007",
      },
    };
    const r = pr(
      {
        provider: "deepseek",
        model: "deepseek/deepseek-v4.1-flash",
        input_tokens: 1e6,
      },
      catalog,
    );
    expect(r.cost_class).toBe("metered");
    expect(r.rate_source).toBe("catalog");
    expect(r.market_value_usd).toBeCloseTo(0.22, 6);
    expect(r.billed_usd).toBeCloseTo(0.22, 6);
  });
});

describe("energy.local_rates", () => {
  it("matches the Python power model defaults", () => {
    const { rates: [ri, ro, rc], tps } = localRates("qwen3-coder:30b", CFG);
    expect(tps).toBe(30); // "30b" band
    const usdPerSec = (440 / 1000) * 0.047 / 3600;
    const out1m = usdPerSec * (1e6 / 30);
    expect(ro).toBeCloseTo(out1m, 12);
    expect(ri).toBeCloseTo(out1m / 12, 12);
    expect(rc).toBeCloseTo(out1m / 60, 12);
  });

  it("rate_origin labels the four sources", () => {
    expect(rateOrigin("qwen3-coder", EMPTY, CFG)[0]).toBe("local");
    expect(rateOrigin("glm-5.3", EMPTY, CFG)[0]).toBe("override");
    expect(rateOrigin("minimax-m3", EMPTY, CFG)[0]).toBe("builtin");
    expect(rateOrigin("no-such-model", EMPTY, CFG)[0]).toBe(null);
  });
});
