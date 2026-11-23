import * as fs from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTmpDir } from "./helpers.js";
import { pyCall } from "./pyOracle.js";

type Costs = typeof import("../../src/collectCosts.js");

// build_costs.py pins its CFG at import, so both stacks must read the same
// temporary config before either module is loaded.
let C: Costs;
let savedConfig: string | undefined;

beforeAll(async () => {
  const dir = makeTmpDir("costs-");
  const configPath = join(dir, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({
    profiles: [],
    agent_home: join(dir, "agent"),
    reports_dir: join(dir, "reports"),
    electricity_rate_kwh: 0.061,
    gpu_draw_watts: 420,
    host_overhead_watts: 80,
  }));
  savedConfig = process.env["LLM_TELEMETRY_CONFIG"];
  process.env["LLM_TELEMETRY_CONFIG"] = configPath;
  C = await import("../../src/collectCosts.js");
});

afterAll(() => {
  if (savedConfig === undefined) delete process.env["LLM_TELEMETRY_CONFIG"];
  else process.env["LLM_TELEMETRY_CONFIG"] = savedConfig;
});

const CATALOG = {
  "vendor/known": { prompt: "0.25", completion: "0.75", input_cache_read: "0.01" },
  "vendor/zero": { prompt: "0", completion: "0", input_cache_read: "0" },
};

const DATA = {
  profiles: {
    alpha: {
      rows: [
        {
          model: "vendor/known", calls: 2, inp: 1000, outp: 500, cread: 100,
          cost: 0.5, provider: "vendor", market_value_usd: 0.25,
        },
        {
          model: "qwen3-coder:30b", calls: 3, inp: 2000, outp: 1000, cread: 0,
          cost_class: "local", market_value_usd: 0,
        },
        {
          model: "glm-5.3", calls: 1, inp: 10, outp: 20, cread: 0,
          provider: "opencode-go", market_value_usd: 0.01,
        },
        {
          model: "no-such-model", calls: 4, inp: 7, outp: 9, cread: 0,
          market_value_usd: 0.02,
        },
        {
          model: "vendor/zero", calls: 1, inp: 1, outp: 1, cread: 0,
          market_value_usd: 0,
        },
        {
          model: "discard-only", calls: 99, inp: 99, outp: 99,
          base_url: "http://127.0.0.1:9/v1", market_value_usd: 1,
        },
      ],
    },
  },
};

interface CostRow {
  model: string;
  in_1m: number | null;
  out_1m: number | null;
  cache_1m: number | null;
  source: string;
  rate_origin: string;
  used: boolean;
  tps: number | null;
  energy: number | null;
}

const row = (models: CostRow[], model: string): CostRow => {
  const found = models.find((m) => m.model === model);
  if (!found) throw new Error(`missing row: ${model}`);
  return found;
};

describe("build_costs port parity", () => {
  it("localRates matches Python's ((in, out, cache), tps)", () => {
    for (const model of ["qwen3-coder:30b", "ornith:latest", "unknown-size"]) {
      const want = pyCall("build_costs", "local_rates", [model]) as [[number, number, number], number];
      expect(C.localRates(model)).toEqual([...want[0], want[1]]);
    }
  });

  it("rateSource labels every price-table origin and unpriced models", () => {
    const cases: [string, string][] = [
      ["qwen3-coder:30b", "local"],
      ["beam-free", "free-tier"],
      ["vendor/known", "openrouter"],
      ["glm-5.3", "vendor"],
      ["minimax-m3", "vendor"],
      ["vendor/zero", "unpriced"],
      ["no-such-model", "unpriced"],
    ];
    for (const [model, expected] of cases) {
      expect(C.rateSource(model, CATALOG)).toBe(expected);
      expect(C.rateSource(model, CATALOG)).toBe(pyCall("build_costs", "rate_source", [model, CATALOG]));
    }
  });

  it("rateOriginTag keeps the fine-grained provenance", () => {
    const cases: [string, string][] = [
      ["qwen3-coder:30b", "local"],
      ["beam-free", "free-tier"],
      ["vendor/known", "catalog"],
      ["glm-5.3", "override"],
      ["minimax-m3", "builtin"],
      ["vendor/zero", ""],
      ["no-such-model", ""],
    ];
    for (const [model, expected] of cases) {
      expect(C.rateOriginTag(model, CATALOG)).toBe(expected);
      expect(C.rateOriginTag(model, CATALOG)).toBe(pyCall("build_costs", "rate_origin_tag", [model, CATALOG]));
    }
  });

  it("assemble matches Python across catalogue, built-in, local and traffic rows", () => {
    const got = C.assemble(DATA, CATALOG, ["qwen3-coder:30b"]) as CostRow[];
    const want = pyCall("build_costs", "assemble", [DATA, CATALOG, ["qwen3-coder:30b"]]);
    expect(got).toEqual(want);

    const known = row(got, "vendor/known");
    expect([known.in_1m, known.out_1m, known.cache_1m]).toEqual([250_000, 750_000, 10_000]);
    expect([known.source, known.rate_origin, known.used]).toEqual(["openrouter", "catalog", true]);

    const override = row(got, "glm-5.3");
    expect([override.in_1m, override.out_1m, override.cache_1m]).toEqual([1.4, 4.4, 0.26]);
    expect([override.source, override.rate_origin]).toEqual(["vendor", "override"]);

    const builtin = row(got, "minimax-m3");
    expect([builtin.in_1m, builtin.out_1m, builtin.cache_1m]).toEqual([0.6, 2.4, 0.12]);
    expect([builtin.source, builtin.rate_origin, builtin.used]).toEqual(["vendor", "builtin", false]);

    const local = row(got, "qwen3-coder:30b");
    expect([local.source, local.tps, local.used]).toEqual(["local", 30, true]);
    expect(local.energy).toBeGreaterThan(0);

    for (const model of ["no-such-model", "vendor/zero"]) {
      const unpriced = row(got, model);
      expect([unpriced.in_1m, unpriced.out_1m, unpriced.cache_1m]).toEqual([null, null, null]);
      expect([unpriced.source, unpriced.rate_origin, unpriced.used]).toEqual(["unpriced", "", true]);
    }

    expect(got.some((m) => m.model === "discard-only")).toBe(false);
  });
});
