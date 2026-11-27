// LLMTELEMET-293 (T-22 RUN C): pure Prices derivations ported from
// src/llm_telemetry/web/js/views.js (3169-3524). The price sheet, its tabs,
// its provenance labels and the what-if math all read the same embedded
// catalogue; no rate, source or token count is invented here.
import { ago } from "../home-board/format";
import { num } from "./usage";
import type { CostModel, CostsData } from "./types";

/** PRICE_SRC in views.js:3171-3181. */
export const PRICE_SOURCE_LABELS: Readonly<Record<string, string>> = {
  vendor: "Vendor page",
  web: "Vendor page",
  openrouter: "OpenRouter",
  local: "Local (electricity)",
  "free-tier": "Free tier",
  unpriced: "Unpriced on record",
  pinned: "Pinned catalogue",
};

export function sourceLabel(source: unknown): string {
  const key = String(source ?? "");
  return PRICE_SOURCE_LABELS[key] ?? (key || "n/a");
}

export const PRICE_TABS = [
  ["all", "All"],
  ["used", "Used"],
  ["local", "Local"],
  ["vendor", "Vendor"],
  ["openrouter", "OpenRouter"],
  ["unpriced", "Unpriced"],
] as const;

export type PriceTab = (typeof PRICE_TABS)[number][0];

export function isPriceTab(value: unknown): value is PriceTab {
  return PRICE_TABS.some(([key]) => key === value);
}

export interface PriceFreshness {
  state: "fresh" | "old" | "stale" | "unknown";
  age_s: number | null;
  label: string;
  hint: string;
}

/** views.js:3201-3211 — 24h amber, 72h red, no age -> unknown. */
export function priceFreshness(fresh: Record<string, unknown> | undefined): PriceFreshness {
  const f = fresh ?? {};
  const age = f.age_s == null ? null : Math.max(0, Math.round(num(f.age_s)));
  if (age == null) {
    return {
      state: "unknown",
      age_s: null,
      label: f.state ? String(f.state) : "age unknown",
      hint: "",
    };
  }
  const state = age < 24 * 3600 ? "fresh" : age < 72 * 3600 ? "old" : "stale";
  return {
    state,
    age_s: age,
    label: `${ago(age)} old`,
    hint: `catalogue fetched ${ago(age)} ago · amber past 24h, red past 72h · fed by llm-telemetry-build.timer`,
  };
}

/** views.js:3456 — null rate is an em dash, never $0. */
export function rateText(rate: unknown): string {
  if (rate == null) return "—";
  const r = num(rate);
  return r < 0.01
    ? `$${r.toFixed(4)}`
    : r < 1
      ? `$${r.toFixed(3)}`
      : `$${r.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/** views.js:3454 — compact token count and the spend formatter. */
export function fmtN(value: unknown): string {
  const n = num(value);
  for (const [unit, divisor] of [["B", 1e9], ["M", 1e6], ["K", 1e3]] as const) {
    if (n >= divisor) return (n / divisor).toFixed(1) + unit;
  }
  return String(Math.round(n));
}

export function fmtMoney(value: unknown): string {
  if (value == null) return "—";
  const v = num(value);
  return v < 0.01 ? `$${v.toFixed(4)}` : v < 1 ? `$${v.toFixed(3)}` : `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function passTab(model: CostModel, tab: PriceTab): boolean {
  switch (tab) {
    case "all": return true;
    case "used": return num(model.calls) > 0;
    case "local": return model.source === "local";
    case "vendor": return model.source === "vendor" || model.source === "web";
    case "openrouter": return model.source === "openrouter";
    case "unpriced": return model.source === "unpriced";
  }
}

/** views.js:3424-3443 — tabs then a case-insensitive search over model name,
 * every recorded provider, served_by/inferred_by and the source label. */
export function priceRows(
  models: readonly CostModel[],
  tab: PriceTab = "all",
  query = "",
): CostModel[] {
  const q = query.trim().toLowerCase();
  return models
    .filter((model) => passTab(model, tab))
    .filter((model) => {
      if (!q) return true;
      const haystack = [
        String(model.model ?? ""),
        (model.providers ?? []).join(" "),
        String(model.served_by ?? ""),
        String(model.inferred_by ?? ""),
        sourceLabel(model.source),
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    })
    .slice()
    .sort((a, b) => num(b.calls) - num(a.calls) || num(b.cost) - num(a.cost));
}

/** views.js:3445-3484 — observed providers, an inferred hint (never a guessed
 * brand mark for an unused row), or a muted dash when nothing is knowable. */
export function servedBy(model: CostModel): Array<{ label: string; inferred: boolean }> {
  const used = num(model.calls) > 0;
  const observed = used
    ? model.providers?.length
      ? model.providers
      : model.served_by
        ? [model.served_by]
        : []
    : [];
  if (observed.length) return observed.map((label) => ({ label: String(label), inferred: false }));
  if (!used && !observed.length && model.inferred_by) {
    return [{ label: String(model.inferred_by), inferred: true }];
  }
  return [];
}

const ORIGIN_TIPS: Readonly<Record<string, string>> = {
  catalog: "live OpenRouter catalogue rate",
  override: "manual override from pricing.RATE_OVERRIDES — beats the live catalogue on purpose",
  builtin: "built-in vendor rate table (the catalogue does not list this model)",
  local: "local model — electricity cost, never a vendor rate",
  "free-tier": "free tier — $0 by contract",
};

export function provenanceTitle(model: CostModel, sheetAge: unknown): string {
  const origin = ORIGIN_TIPS[String(model.rate_origin ?? "")] ?? "no rate on record";
  const age = sheetAge == null ? "" : ` · sheet fetched ${ago(Math.round(num(sheetAge)))} ago`;
  return origin + age;
}

export function usedOf(model: CostModel): boolean {
  return num(model.calls) > 0;
}

export interface WhatIfInputs {
  input: string;
  cached: string;
  output: string;
  runs: string;
}

export interface WhatIfResult {
  kind: "local" | "unpriced" | "free" | "metered";
  totalText: string;
  breakdown: string;
  /** True when a metered model has no published cache-read rate. */
  noCacheRate: boolean;
}

/** views.js:3332-3352 — 100k / 1.5m shorthands, commas and underscores. */
export function wiParseTokens(input: unknown): number {
  let s = String(input ?? "").trim().toLowerCase().replace(/[, _]/g, "");
  const mult = s.endsWith("m") ? 1e6 : s.endsWith("k") ? 1e3 : 1;
  if (mult !== 1) s = s.slice(0, -1);
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? n * mult : 0;
}

export function wiMoney(value: number): string {
  return value >= 1
    ? `$${value.toFixed(2)}`
    : value >= 0.01
      ? `$${value.toFixed(3)}`
      : value > 0
        ? `$${value.toFixed(5)}`
        : "$0.00";
}

export function whatIfKind(model: CostModel): WhatIfResult["kind"] {
  const source = String(model.source ?? "");
  if (source === "local") return "local";
  if (source === "unpriced") return "unpriced";
  if (source === "free-tier") return "free";
  return "metered";
}

/** views.js:3313-3330 — observed share of prompt tokens served from cache. */
export function cacheMix(model: CostModel): number | null {
  const inp = num(model.inp);
  const cache = num(model.cache);
  if (!inp || !cache) return null;
  return Math.max(0, Math.min(1, cache / (inp + cache)));
}

export interface WhatIfOption {
  index: number;
  label: string;
  used: boolean;
  detail: string;
}

export interface WhatIfGroup {
  key: WhatIfResult["kind"];
  label: string;
  options: WhatIfOption[];
}

export const WHAT_IF_GROUPS = [
  ["local", "Local (electricity)"],
  ["metered", "Metered (billed per token)"],
  ["free", "Free tier ($0)"],
  ["unpriced", "Unpriced (no rate)"],
] as const;

/** views.js:3304-3327 — groups in a fixed order, used models first inside. */
export function whatIfGroups(models: readonly CostModel[]): WhatIfGroup[] {
  return WHAT_IF_GROUPS.map(([key, label]) => {
    const options = models
      .map((model, index) => ({ model, index }))
      .filter(({ model }) => whatIfKind(model) === key)
      .sort((a, b) => Number(usedOf(b.model)) - Number(usedOf(a.model)) ||
        String(a.model.short || a.model.model || "").localeCompare(String(b.model.short || b.model.model || "")))
      .map(({ model, index }) => {
        const name = String(model.short || model.model || "n/a");
        const served = model.served_by && model.served_by !== "—" ? String(model.served_by) : "";
        return {
          index,
          label: name + (served ? `  · ${served}` : "") + (usedOf(model) ? "  • used" : ""),
          used: usedOf(model),
          detail: served,
        };
      });
    return { key, label: `${label} · ${options.length}`, options };
  }).filter((group) => group.options.length > 0);
}

/** Default: the used metered model with the highest output rate (views.js:3325). */
export function defaultWhatIfIndex(models: readonly CostModel[]): number | null {
  const used = models
    .map((model, index) => ({ model, index }))
    .filter(({ model }) => usedOf(model) && whatIfKind(model) === "metered")
    .sort((a, b) => num(b.model.out_1m) - num(a.model.out_1m));
  return used.length ? used[0].index : null;
}

/** views.js:3354-3396 — cache-aware, run-multiplied, and unpriced never $0. */
export function whatIfCalculate(model: CostModel, inputs: WhatIfInputs): WhatIfResult {
  const kind = whatIfKind(model);
  if (kind === "unpriced") {
    return {
      kind,
      totalText: "no rate available",
      breakdown: "This model has no price in the catalogue or WEB_RATES, so a job on it cannot be costed.",
      noCacheRate: false,
    };
  }
  const input = wiParseTokens(inputs.input);
  const output = wiParseTokens(inputs.output);
  const runs = Math.max(1, Math.round(wiParseTokens(inputs.runs) || 1));
  const cached = Math.min(input, wiParseTokens(inputs.cached));
  const fresh = Math.max(0, input - cached);
  const cin = (fresh / 1e6) * num(model.in_1m);
  const noCacheRate = model.cache_1m == null && kind === "metered";
  const ccin = (cached / 1e6) * num(noCacheRate ? model.in_1m : model.cache_1m);
  const cout = (output / 1e6) * num(model.out_1m);
  const total = (cin + ccin + cout) * runs;
  const what = kind === "local" ? "electricity" : kind === "free" ? "free tier" : "billed";
  const prefix = kind === "local" ? "≈ " : "";
  const per = runs > 1 ? ` × ${runs} runs` : "";
  return {
    kind,
    totalText: `${prefix}${wiMoney(total)} ${what}`,
    breakdown:
      `in ${wiMoney(cin)} + cached ${wiMoney(ccin)} + out ${wiMoney(cout)}${per}` +
      (noCacheRate ? " · no published cache rate — cached tokens billed at the fresh rate" : "") +
      (kind === "local"
        ? "<br>your power cost, not billed by anyone"
        : kind === "free"
          ? "<br>OpenRouter free tier: $0 per token"
          : ""),
    noCacheRate,
  };
}

export interface PriceShellModel {
  catalogSource: string;
  sourceLabel: string;
  catalogSize: string;
  usedCount: number;
  generated: string;
  fresh: PriceFreshness;
  note: string;
  missing: boolean;
}

/** views.js:3240-3261 — the header pill, counts and the one-line caveat. */
export function priceShell(data: CostsData | null): PriceShellModel {
  if (!data || !Array.isArray(data.models)) {
    return {
      catalogSource: "n/a",
      sourceLabel: "n/a",
      catalogSize: "n/a",
      usedCount: 0,
      generated: "n/a",
      fresh: priceFreshness(undefined),
      note: "Prices data not embedded in this build — run scripts/refresh-dashboard.sh.",
      missing: true,
    };
  }
  const catalogSource = PRICE_SOURCE_LABELS[String(data.catalog_source ?? "")]
    ? String(data.catalog_source)
    : "openrouter";
  return {
    catalogSource,
    sourceLabel: sourceLabel(catalogSource),
    catalogSize: num(data.catalog_size).toLocaleString("en-US"),
    usedCount: data.models.filter(usedOf).length,
    generated: String(data.generated ?? "").replace("T", " ") || "n/a",
    fresh: priceFreshness(data.freshness),
    note: "Costs shown at each model’s own rate; local models burn electricity (energy), never the vendor metre.",
    missing: false,
  };
}
