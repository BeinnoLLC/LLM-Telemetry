/** Pricing: OpenRouter catalogue -> per-model rates — T-6 (LLMTELEMET-285).
 *
 * Port of the `pricing.py` subset the live collector needs: rate precedence
 * (local-by-name -> RATE_OVERRIDES -> live catalogue -> WEB_RATES) and
 * `price_row` / market-value classification. Subscription and free rows still
 * get a MARKET-EQUIVALENT value ("what the same tokens would have cost at
 * public API rates") without ever pretending it is money spent.
 *
 * Rounding note: Python's round() is ties-to-even on the exact binary value,
 * JS toFixed() is ties-away. The parity fixture uses rate/token values whose
 * products land exactly on representable values, so the two agree; see
 * parity/liveFixtures.ts.
 */
import type { Config } from "./config.js";
import { localRates } from "./energy.js";
import * as fs from "node:fs";
import * as path from "node:path";

export const NOUS_PREFIX = "nous:";

export const PROVIDER_CLASS: Record<string, string> = {
  fireworks: "metered",
  openrouter: "metered",
  deepseek: "metered",
  anthropic: "subscription",
  "opencode-go": "subscription",
  "openai-codex": "subscription",
  copilot: "subscription",
  nous: "subscription",
  "ollama-cloud": "metered",
  custom: "local",
  local: "local",
  ollama: "local",
  "": "unknown",
};

const LOCAL_HINTS = [
  "qwen3-coder", "gpt-oss", "qwen3:14b", "qwen3.8:latest",
  "deepseek-r1:14b", "nemotron", "qwen3:30b", "ministral",
  "ornith", "clef", "openjev",
];
const METERED_MODEL_HINTS = ["accounts/fireworks/models/", "openrouter/"];
const CLOUD_ONLY_MODELS = new Set([
  "nemotron-3-nano", "nemotron-3-super", "nemotron-3-ultra",
]);
const PRESET_MODELS = ["default"];
const FREE_TIER_SUFFIX = ":free";
const ZEN_FREE_MODELS = new Set([
  "space-bunny-free", "longcat-2.5-preview-free", "mimo-v2.6-flash-free",
  "mimo-v2.5-free", "ling-3.0-flash-fin-free", "nemotron-3-ultra-free",
  "nemotron-3.5-lightning-free", "muse-spark-1.3-contributor-free",
  "jev-1.13-free", "big-pickle", "beam-free",
]);
const MODEL_CLASS_FALLBACK: Array<[string, string]> = [
  ["claude-", "subscription"], ["glm-", "subscription"],
  ["deepseek-v4.1-flash", "subscription"], ["gpt-5", "subscription"],
  ["gpt-6", "subscription"],
];

/** Built-in rates that beat the live catalogue (deliberate exceptions). */
export const RATE_OVERRIDES: Record<string, [number, number, number]> = {
  "glm-5.3": [1.40, 4.40, 0.26],
  "kimi-k3": [3.00, 15.00, 0.30],
  "accounts/fireworks/models/deepseek-v4p1-flash": [0.30, 1.20, 0.006],
  "accounts/fireworks/models/deepseek-v4p1-flash-1017": [0.30, 1.20, 0.006],
  "accounts/fireworks/models/deepseek-v4p1-flash-spot": [0.21, 0.84, 0.0042],
  "accounts/fireworks/models/deepseek-v4p1-flash-1017-spot": [0.21, 0.84, 0.0042],
  "accounts/fireworks/models/glm-5p3": [1.40, 4.40, 0.26],
  "accounts/fireworks/models/glm-5p3-spot": [0.98, 3.08, 0.182],
  "accounts/fireworks/models/kimi-k3": [3.00, 15.00, 0.30],
  "accounts/fireworks/models/kimi-k3-spot": [2.10, 10.50, 0.21],
  "accounts/fireworks/models/deepseek-v4-flash-0731": [0.22, 0.66, 0.007],
  "accounts/fireworks/models/deepseek-v4-flash-vision-exp": [0.22, 0.66, 0.007],
  "accounts/fireworks/models/deepseek-v4-pro-0813": [1.32, 3.96, 0.044],
};

/** Fallback for models the live catalogue does not list. */
export const WEB_RATES: Record<string, [number, number, number]> = {
  "gpt-6-astra": [10.00, 50.00, 1.00],
  "gpt-5.6-luna": [0.20, 1.20, 0.02],
  "gpt-5.6-terra": [2.00, 12.00, 0.20],
  "gpt-5.6-sol": [4.00, 20.00, 0.40],
  "gpt-5.3-codex": [1.75, 14.00, 0.175],
  "deepseek-v4.1-flash": [0.22, 0.66, 0.007],
  "deepseek-v4-flash": [0.22, 0.66, 0.007],
  "deepseek-v4-pro": [0.66, 1.98, 0.022],
  gemma4: [0.14, 0.40, 0.05],
  "glm-5.3-flash": [0.15, 0.50, 0.03],
  "gpt-oss:120b": [0.15, 0.60, 0.015],
  "gpt-oss:20b": [0.07, 0.30, 0.035],
  "kimi-k2.7-code": [0.95, 4.00, 0.19],
  "kimi-k2.6": [0.95, 4.00, 0.16],
  "minimax-m3": [0.60, 2.40, 0.12],
  "nemotron-3-nano": [0.06, 0.24, 0.0],
  "nemotron-3-super": [0.30, 2.40, 0.0],
  "nemotron-3-ultra": [0.60, 2.40, 0.0],
  "qwen3.5:397b": [0.60, 3.60, 0.0],
};

export const ALIASES: Record<string, string> = {
  "claude-opus-5": "anthropic/claude-opus-5",
  "claude-opus-4-7": "anthropic/claude-opus-4.7",
  "claude-sonnet-5": "anthropic/claude-sonnet-5",
  "claude-sonnet-4-5-20250929": "anthropic/claude-sonnet-4.5",
  "claude-opus-4-5-20251101": "anthropic/claude-opus-4.5",
  "claude-opus-4-5": "anthropic/claude-opus-4.5",
  "claude-opus-4-6": "anthropic/claude-opus-4.6",
  "claude-opus-4-8": "anthropic/claude-opus-4.8",
  "claude-opus-5-5": "anthropic/claude-opus-5.5",
  "claude-fable-5": "anthropic/claude-fable-5",
  "claude-fable-5-1": "anthropic/claude-fable-5.1",
  "claude-sonnet-4-6": "anthropic/claude-sonnet-4.6",
  "glm-5.3": "z-ai/glm-5.3",
  "glm-5.3-flash": "z-ai/glm-5.3-flash",
  "deepseek-v4.1-flash": "deepseek/deepseek-v4.1-flash",
  "accounts/fireworks/models/deepseek-v4p1-flash": "deepseek/deepseek-v4.1-flash",
  "accounts/fireworks/models/deepseek-v4-pro-0813": "deepseek/deepseek-v4-pro-0813",
  "accounts/fireworks/models/deepseek-v4-flash-0731": "deepseek/deepseek-v4-flash-0731",
  "accounts/fireworks/models/kimi-k3": "moonshotai/kimi-k3",
  "accounts/fireworks/models/glm-5p3-flash": "z-ai/glm-5.3-flash",
  "gpt-5.6-luna": "openai/gpt-5.6-luna",
  "gpt-5.3-codex": "openai/gpt-5.3-codex",
  "gpt-6-astra": "openai/gpt-6-astra",
  "qwen3.8-max": "qwen/qwen3.8-max-0902",
  "qwen3.8-max-prime": "qwen/qwen3.8-max-prime",
  "qwen3.8-flash": "qwen/qwen3.8-flash",
  "kimi-k2.7-code": "moonshotai/kimi-k2.7-code",
  "kimi-k2.6": "moonshotai/kimi-k2.6",
  "kimi-k2.5": "moonshotai/kimi-k2.5",
  "gpt-5.1-codex": "openai/gpt-5.1-codex",
  "minimax-m3": "minimax/minimax-m3",
  "qwen3.7-max": "qwen/qwen3.7-max",
  "qwen3.5:397b": "qwen/qwen3.5-397b-a17b",
  "nemotron-3-nano": "nvidia/nemotron-3-nano-30b-a3b",
  "nemotron-3-super": "nvidia/nemotron-3-super-120b-a12b",
  "nemotron-3-ultra": "nvidia/nemotron-3-ultra-550b-a55b",
  "gpt-oss:20b": "openai/gpt-oss-20b",
  "gpt-oss:120b": "openai/gpt-oss-120b",
};

export function isFreeTier(model: string | null): boolean {
  const m = (model ?? "").trim().toLowerCase();
  if (!m) return false;
  if (m.endsWith(FREE_TIER_SUFFIX)) return true;
  if (ZEN_FREE_MODELS.has(m)) return true;
  const base = m.slice(m.lastIndexOf("/") + 1);
  return ZEN_FREE_MODELS.has(base);
}

export function isLocal(model: string | null): boolean {
  const m = (model ?? "").toLowerCase();
  if (m.includes("/")) return false;
  if (m.endsWith(":cloud") || m.endsWith("-cloud")) return false;
  if (CLOUD_ONLY_MODELS.has(m)) return false;
  return LOCAL_HINTS.some((h) => m.includes(h));
}

export function classFromModel(model: string | null): string | null {
  const m = (model ?? "").toLowerCase();
  for (const [prefix, cls] of MODEL_CLASS_FALLBACK) {
    if (m.startsWith(prefix)) return cls;
  }
  return null;
}

export function meteredByModel(model: string | null): boolean {
  const m = (model ?? "").toLowerCase();
  if (LOCAL_HINTS.some((h) => m.includes(h))) return false;
  return METERED_MODEL_HINTS.some((h) => m.includes(h));
}

export type Catalog = Record<string, unknown>;

const CAT_MEMO: { k: string | null; v: Catalog | null } = { k: null, v: null };

/** The catalogue from disk only (pinned file or the OpenRouter cache), never
 * the network: the 5 s live poll must not block on a fetch. */
export function cachedCatalog(cfg?: Config, env: NodeJS.ProcessEnv = process.env): Catalog {
  const dir = cfg?.reports_dir ?? "";
  const fallback = dir ? path.join(dir, "pricing-cache.json") : "pricing-cache.json";
  const p = env["LLM_TELEMETRY_CATALOG"] || fallback;
  try {
    const mtime = fs.statSync(p).mtimeMs;
    const key = `${p}|${mtime}`;
    if (CAT_MEMO.k !== key) {
      const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as { models?: Catalog };
      if (!parsed || typeof parsed !== "object" || typeof parsed.models !== "object") {
        throw new Error("shape");
      }
      CAT_MEMO.k = key;
      CAT_MEMO.v = parsed.models as Catalog;
    }
    return CAT_MEMO.v ?? {};
  } catch {
    return {};
  }
}

function resolveCatalogId(model: string | null, catalog: Catalog): string | null {
  let base = (model ?? "").split("/").slice(-1)[0]?.toLowerCase() ?? "";
  if (!base) return null;
  base = base.replace(/(:|-)cloud$/, "");
  if (base.includes(":")) base = base.slice(0, base.lastIndexOf(":"));
  const cands = [base];
  const dotted = base.replace(/-(\d+)-(\d+)$/, "-$1.$2");
  if (dotted !== base) cands.push(dotted);
  for (const cand of cands) {
    for (const cid of Object.keys(catalog)) {
      const cb = cid.split("/").slice(-1)[0] ?? "";
      if (cid.startsWith(NOUS_PREFIX) || cb.includes(":")) continue;
      if (cb.toLowerCase() === cand) return cid;
    }
  }
  return null;
}

function builtinRate(
  table: Record<string, [number, number, number]>,
  model: string | null,
): [number, number, number] | null {
  const base = (model ?? "").split("/").slice(-1)[0]?.toLowerCase() ?? "";
  const bare = base.replace(/(:|-)cloud$/, "");
  let w = table[model ?? ""] ?? table[base] ?? table[bare] ?? null;
  if (!w && bare.includes(":")) {
    w = table[bare.slice(0, bare.lastIndexOf(":"))] ?? null;
  }
  return w;
}

function liveRate(model: string | null, catalog: Catalog): [number, number, number] | null {
  const base = ((model ?? "").split("/").slice(-1)[0] ?? "")
    .toLowerCase()
    .replace(/(:|-)cloud$/, "");
  const oid = ALIASES[model ?? ""] ?? ALIASES[base] ??
    ((model ?? "") in catalog ? (model ?? "") : resolveCatalogId(model, catalog));
  const p = oid ? catalog[oid] : undefined;
  if (!p || typeof p !== "object") return null;
  const e = p as Record<string, unknown>;
  let r: [number, number, number];
  try {
    r = [
      Number(e["prompt"] ?? 0) || 0,
      Number(e["completion"] ?? 0) || 0,
      Number(e["input_cache_read"] ?? 0) || 0,
    ];
  } catch {
    return null;
  }
  if (r.some((x) => x < 0)) return null;
  if (!r.some((x) => x !== 0) && !isFreeTier(model)) return null;
  return r;
}

export type RateOrigin = "local" | "override" | "catalog" | "builtin" | null;

export function rateOrigin(
  model: string | null,
  catalog: Catalog,
  cfg: Config,
): [RateOrigin, [number, number, number] | null] {
  if (isLocal(model)) {
    const { rates } = localRates(model, cfg);
    return ["local", [rates[0] / 1e6, rates[1] / 1e6, rates[2] / 1e6]];
  }
  const w = builtinRate(RATE_OVERRIDES, model);
  if (w) return ["override", [w[0] / 1e6, w[1] / 1e6, w[2] / 1e6]];
  const r = liveRate(model, catalog);
  if (r) return ["catalog", r];
  const b = builtinRate(WEB_RATES, model);
  if (b) return ["builtin", [b[0] / 1e6, b[1] / 1e6, b[2] / 1e6]];
  return [null, null];
}

export function ratesFor(
  model: string | null,
  catalog: Catalog,
  cfg: Config,
): [number, number, number] | null {
  return rateOrigin(model, catalog, cfg)[1];
}

export interface PriceRowInput {
  provider?: string | null;
  model?: string | null;
  base_url?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read?: number | null;
  cache_write?: number | null;
  calls?: number | null;
}

export interface PriceRowResult {
  cost_class: string;
  market_value_usd: number;
  billed_usd: number;
  energy_usd: number;
  priced: boolean;
  rate_source: string;
}

/** Annotate one usage row with cost_class, real cost and market value. */
export function priceRow(
  row: PriceRowInput,
  catalog: Catalog,
  cfg: Config,
  localPatterns: readonly string[],
  endpointAliases: Record<string, string>,
): PriceRowResult {
  let prov = (row.provider ?? "").trim();
  const url = (row.base_url ?? "").toLowerCase();
  if (url) {
    if (url.includes("fireworks.ai") || url.includes("openrouter.ai")) {
      prov = url.includes("fireworks.ai") ? "fireworks" : "openrouter";
    } else if (url.includes("opencode.ai")) {
      prov = "opencode-go";
    } else if (url.includes("api.anthropic.com")) {
      prov = "anthropic";
    } else if (url.includes("nousresearch.com")) {
      prov = "nous";
    } else if (url.includes("ollama.com")) {
      prov = "ollama-cloud";
    } else if (localPatterns.some((h) => h !== "" && url.includes(h.toLowerCase()))) {
      prov = "local";
    }
  }
  let cls = PROVIDER_CLASS[prov] ?? "unknown";
  const model = row.model ?? "";
  if (PRESET_MODELS.includes(model.trim().toLowerCase()) || prov === "moa") {
    cls = "preset";
  } else if (isFreeTier(model)) {
    cls = "free";
  } else if (isLocal(model)) {
    cls = "local";
  } else if (model.toLowerCase().endsWith(":cloud") || model.toLowerCase().endsWith("-cloud")) {
    cls = "metered";
  } else if (meteredByModel(model)) {
    cls = "metered";
  } else if (cls === "unknown") {
    cls = classFromModel(model) ?? "unknown";
  }
  let r: [number, number, number] | null = null;
  let rateSource = "";
  if (r === null) {
    r = isFreeTier(model) ? null : ratesFor(model, catalog, cfg);
    if (r) rateSource = isLocal(model) ? "local" : "catalog";
  }
  if (cls === "local" && !isLocal(model)) {
    const { rates } = localRates(model, cfg);
    r = [rates[0] / 1e6, rates[1] / 1e6, rates[2] / 1e6];
    rateSource = "energy";
  }
  void endpointAliases;
  let value = 0.0;
  if (r) {
    const [pin, pout, pcache] = r;
    const cwriteMult = row.cache_write ? 1.25 : 0.0;
    value = (row.input_tokens ?? 0) * pin
      + (row.output_tokens ?? 0) * pout
      + (row.cache_read ?? 0) * pcache
      + (row.cache_write ?? 0) * cwriteMult * pin;
  }
  const energy = cls === "local" ? value : 0.0;
  return {
    cost_class: cls,
    market_value_usd: pyRound(value, 6),
    billed_usd: cls === "metered" ? pyRound(value, 6) : 0.0,
    energy_usd: pyRound(energy, 6),
    priced: Boolean(r) || cls === "free",
    rate_source: rateSource,
  };
}

/** round(x, ndigits) stand-in (toFixed: ties-away vs Python ties-even; the
 * parity fixture avoids exact ties). */
export function pyRound(x: number, digits: number): number {
  return Number(x.toFixed(digits));
}
