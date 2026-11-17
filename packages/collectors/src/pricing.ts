/** Port of src/llm_telemetry/pricing.py — T-15 (LLMTELEMET-286).
 *
 * OpenRouter pricing catalogue -> per-model rates for Hermes usage rows.
 * Refreshed on the cache TTL. Classifies every billing provider so we never
 * invent a per-token cost for flat-fee or local traffic:
 *
 *   metered      real pay-per-token spend  (fireworks, openrouter, deepseek direct)
 *   subscription flat monthly fee          (anthropic OAuth, opencode-go, openai-codex)
 *   free         local hardware            (custom/ollama)
 *
 * For subscription+free rows we still compute a MARKET-EQUIVALENT value: what
 * the same tokens would have cost at public API rates. Byte-loyal port: rate
 * precedence, provider classification and the arithmetic order of price_row
 * match the Python source exactly. Every function here is a 1:1 port of a
 * pricing.py function of the same name (snake_case kept for parity mapping).
 *
 * Not ported (unused by collect_analytics.py): ttl_label, age_label,
 * catalog_freshness, is_dead_endpoint, serving_provider_hint, __main__ demo.
 */

import * as fs from "node:fs";
import { dirname } from "node:path";
import { get as getConfig } from "./config.js";
import * as E from "./energy.js";
import { SCHEMA_VERSION } from "./schema.js";
import { pyFloatOr0, pyRound } from "./pySemantics.js";

/** One catalogue pricing dict: {"prompt", "completion", "input_cache_read",
 * "overrides"}. The Python caches store the pricing dict directly. */
export type PricingDict = Record<string, unknown>;
export type Catalog = Record<string, PricingDict>;
export type RateTable = Record<string, [number, number, number]>;

function reportsFile(name: string): string {
  return `${String(getConfig().reports_dir).replace(/\/+$/, "")}/${name}`;
}

function localPatterns(): string[] {
  try {
    return getConfig().local_host_patterns;
  } catch {
    return ["127.0.0.1", "localhost", "192.168.", "10.", "172."];
  }
}

export const CACHE = reportsFile("pricing-cache.json");
export const URL = "https://openrouter.ai/api/v1/models";
export const TTL = 6 * 3600;
export const NOUS_URL = "https://inference-api.nousresearch.com/v1/models";
export const NOUS_CACHE = reportsFile("nous-pricing-cache.json");
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

export const LOCAL_HINTS = ["qwen3-coder", "gpt-oss", "qwen3:14b", "qwen3.8:latest",
  "deepseek-r1:14b", "nemotron", "qwen3:30b", "ministral",
  "ornith", "clef", "openjev"];

export const METERED_MODEL_HINTS = [
  "accounts/fireworks/models/",
  "openrouter/",
];

// Cloud-served SKUs whose names contain a LOCAL_HINTS substring ("nemotron").
export const CLOUD_ONLY_MODELS = new Set([
  "nemotron-3-nano", "nemotron-3-super", "nemotron-3-ultra",
]);

export const PRESET_MODELS = new Set(["default"]);

export const FREE_TIER_SUFFIX = ":free";

export const ZEN_FREE_MODELS = new Set([
  "space-bunny-free",
  "longcat-2.5-preview-free",
  "mimo-v2.6-flash-free",
  "mimo-v2.5-free",
  "ling-3.0-flash-fin-free",
  "nemotron-3-ultra-free",
  "nemotron-3.5-lightning-free",
  "muse-spark-1.3-contributor-free",
  "jev-1.13-free",
  "big-pickle",
  "beam-free",
]);

/** True when this model's rate is a published $0, not merely unknown. */
export function isFreeTier(model: string | null): boolean {
  const m = (model ?? "").trim().toLowerCase();
  if (!m) return false;
  if (m.endsWith(FREE_TIER_SUFFIX)) return true;
  if (ZEN_FREE_MODELS.has(m)) return true;
  const base = m.split("/").slice(-1)[0] ?? "";
  return ZEN_FREE_MODELS.has(base);
}

export const MODEL_CLASS_FALLBACK: Record<string, string> = {
  "claude-": "subscription",
  "glm-": "subscription",
  "deepseek-v4.1-flash": "subscription",
  "gpt-5": "subscription",
  "gpt-6": "subscription",
};

/** Billing class inferred from the model name, or null. */
export function classFromModel(model: string | null): string | null {
  const m = (model ?? "").toLowerCase();
  for (const [prefix, cls] of Object.entries(MODEL_CLASS_FALLBACK)) {
    if (m.startsWith(prefix)) return cls;
  }
  return null;
}

/** True when the model name itself proves pay-per-token billing. */
export function meteredByModel(model: string | null): boolean {
  const m = (model ?? "").toLowerCase();
  if (LOCAL_HINTS.some((h) => m.includes(h))) return false;
  return METERED_MODEL_HINTS.some((h) => m.includes(h));
}

// Rate precedence in rates_for(): local-by-name -> RATE_OVERRIDES -> live
// catalogue (OpenRouter) -> WEB_RATES. RATE_OVERRIDES is the one place a
// built-in rate beats a live entry.
export const RATE_OVERRIDES: RateTable = {
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

// Fallback only (see precedence above): models with no live catalogue entry.
export const WEB_RATES: RateTable = {
  "gpt-6-astra": [10.00, 50.00, 1.00],
  "gpt-5.6-luna": [0.20, 1.20, 0.02],
  "gpt-5.6-terra": [2.00, 12.00, 0.20],
  "gpt-5.6-sol": [4.00, 20.00, 0.40],
  "gpt-5.3-codex": [1.75, 14.00, 0.175],
  "deepseek-v4.1-flash": [0.22, 0.66, 0.007],
  "deepseek-v4-flash": [0.22, 0.66, 0.007],
  "deepseek-v4-pro": [0.66, 1.98, 0.022],
  "gemma4": [0.14, 0.40, 0.05],
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
  // Ollama-style cloud tags ("gpt-oss:20b-cloud"); the bare tag is local by name.
  "gpt-oss:20b": "openai/gpt-oss-20b",
  "gpt-oss:120b": "openai/gpt-oss-120b",
  // "gemma4" is deliberately NOT mapped (see pricing.py).
};

/** Local by NAME. A vendor-qualified id is a hosted catalogue model and never
 * local here. A row sent to a LAN host is still classed local by its endpoint
 * in price_row(). */
export function isLocal(model: string | null): boolean {
  const m = (model ?? "").toLowerCase();
  if (m.includes("/")) return false;
  if (m.endsWith(":cloud") || m.endsWith("-cloud")) return false;
  if (CLOUD_ONLY_MODELS.has(m)) return false;
  return LOCAL_HINTS.some((h) => m.includes(h));
}

function toRateTuple(p: PricingDict | undefined): [number, number, number] | null {
  try {
    const r: [number, number, number] = [
      pyFloatOr0(p?.["prompt"]),
      pyFloatOr0(p?.["completion"]),
      pyFloatOr0(p?.["input_cache_read"]),
    ];
    return r.some((x) => x < 0) ? null : r;
  } catch {
    return null;
  }
}

/** -> Nous Portal's own (prompt, completion, cache_read) per token, or null.
 * Exact id or alias only, with the vendor prefix tolerated both ways. */
export function nousRatesFor(
  model: string | null,
  catalog: Catalog,
  promptPerCall?: number | null,
): [number, number, number] | null {
  const p = catalog[NOUS_PREFIX + (model ?? "")];
  if (!p) return null;
  let base = toRateTuple(p);
  if (!base) return null;
  if (promptPerCall) {
    const tiers = ((p["overrides"] ?? []) as unknown[])
      .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
      .slice()
      .sort((a, b) => pyFloatOr0(a["min_prompt_tokens"]) - pyFloatOr0(b["min_prompt_tokens"]));
    for (const o of tiers) {
      if (promptPerCall >= pyFloatOr0(o["min_prompt_tokens"])) {
        const merged: PricingDict = {
          prompt: o["prompt"] ?? p["prompt"],
          completion: o["completion"] ?? p["completion"],
          input_cache_read: o["input_cache_read"] ?? p["input_cache_read"],
        };
        base = toRateTuple(merged) ?? base;
      }
    }
  }
  return base;
}

/** Look a model up in a built-in rate table by id, basename, or
 * cloud-stripped tag. */
export function builtinRate(table: RateTable, model: string | null): [number, number, number] | undefined {
  const base = (model ?? "").split("/").slice(-1)[0]?.toLowerCase() ?? "";
  const bare = base.replace(/(:|-)cloud$/u, "");
  let w = table[model ?? ""] ?? table[base] ?? table[bare];
  if (!w && bare.includes(":")) {
    w = table[bare.split(":").slice(0, -1).join(":")];
  }
  return w;
}

/** Find the OpenRouter id for a model name the ALIASES table does not pin:
 * exact basename first, then the dashed->dotted form, never a ":batch" /
 * ":thinking" variant. */
export function resolveCatalogId(model: string | null, catalog: Catalog): string | null {
  let base = (model ?? "").split("/").slice(-1)[0]?.toLowerCase() ?? "";
  if (!base) return null;
  base = base.replace(/(:|-)cloud$/u, "");
  if (base.includes(":")) {
    base = base.split(":").slice(0, -1).join(":");
  }
  const cands = [base];
  const dotted = base.replace(/-(\d+)-(\d+)$/u, "-$1.$2");
  if (dotted !== base) cands.push(dotted);
  for (const cand of cands) {
    for (const cid of Object.keys(catalog)) {
      if (cid.startsWith(NOUS_PREFIX) || (cid.split("/").slice(-1)[0] ?? "").includes(":")) {
        continue;
      }
      if ((cid.split("/").slice(-1)[0] ?? "").toLowerCase() === cand) return cid;
    }
  }
  return null;
}

/** OpenRouter models in a catalogue, excluding the merged Nous entries. */
export function catalogSize(catalog: Catalog): number {
  return Object.keys(catalog).filter((k) => !k.startsWith(NOUS_PREFIX)).length;
}

/** -> (prompt, completion, cache_read) from the live catalogue, or null. */
export function liveRate(
  model: string | null,
  catalog: Catalog,
): [number, number, number] | null {
  const base = (model ?? "").split("/").slice(-1)[0]?.toLowerCase().replace(/(:|-)cloud$/u, "") ?? "";
  let oid = ALIASES[model ?? ""] ?? ALIASES[base];
  if (!oid) {
    oid = catalog[model ?? ""] ? (model ?? "") : resolveCatalogId(model, catalog) ?? "";
  }
  const p = catalog[oid ?? ""];
  if (!p) return null;
  let r: [number, number, number];
  try {
    r = [
      pyFloatOr0(p["prompt"]),
      pyFloatOr0(p["completion"]),
      pyFloatOr0(p["input_cache_read"]),
    ];
  } catch {
    return null;
  }
  if (r.some((x) => x < 0)) return null;
  if (!r.some((x) => x !== 0) && !isFreeTier(model)) {
    // all-zero on a non-free id is a promo/data error: fall through to the
    // built-in rate rather than pricing the model at $0
    return null;
  }
  return r;
}

/** -> (origin, rates per token) or (null, null). origin is "local",
 * "override", "catalog" or "builtin". */
export function rateOrigin(
  model: string | null,
  catalog: Catalog,
): ["local" | "override" | "catalog" | "builtin" | null, [number, number, number] | null] {
  if (isLocal(model)) {
    const [[ri, ro, rc]] = E.localRates(model);
    return ["local", [ri / 1e6, ro / 1e6, rc / 1e6]];
  }
  let w = builtinRate(RATE_OVERRIDES, model);
  if (w) return ["override", [w[0] / 1e6, w[1] / 1e6, w[2] / 1e6]];
  const r = liveRate(model, catalog);
  if (r) return ["catalog", r];
  w = builtinRate(WEB_RATES, model);
  if (w) return ["builtin", [w[0] / 1e6, w[1] / 1e6, w[2] / 1e6]];
  return [null, null];
}

/** -> (prompt, completion, cache_read) USD per token, or null. */
export function ratesFor(
  model: string | null,
  catalog: Catalog,
): [number, number, number] | null {
  return rateOrigin(model, catalog)[1];
}

export interface UsageRow {
  provider?: string | null;
  base_url?: string | null;
  model?: string | null;
  calls?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read?: number | null;
  cache_write?: number | null;
  [k: string]: unknown;
}

export interface PriceResult {
  cost_class: string;
  market_value_usd: number;
  billed_usd: number;
  energy_usd: number;
  priced: boolean;
  rate_source: string;
}

/** Annotate one usage row with cost_class, real cost and market value. */
export function priceRow(row: UsageRow, catalog: Catalog): PriceResult {
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
    } else if (localPatterns().some((h) => url.includes(h))) {
      prov = "local";
    }
  }
  let cls = PROVIDER_CLASS[prov] ?? "unknown";
  const model = row.model ?? null;
  if (PRESET_MODELS.has((model ?? "").trim().toLowerCase()) || prov === "moa") {
    cls = "preset";
  } else if (isFreeTier(model)) {
    cls = "free";
  } else if (isLocal(model)) {
    cls = "local";
  } else if ((model ?? "").toLowerCase().endsWith(":cloud") || (model ?? "").toLowerCase().endsWith("-cloud")) {
    cls = "metered";
  } else if (meteredByModel(model)) {
    cls = "metered";
  } else if (cls === "unknown") {
    cls = classFromModel(model) ?? "unknown";
  }
  let r: [number, number, number] | null = null;
  let rate_source = "";
  if (prov === "nous" && cls !== "local" && cls !== "preset") {
    const calls = row.calls ?? 0;
    const prompt = (row.input_tokens ?? 0) + (row.cache_read ?? 0);
    const ppc = calls ? prompt / calls : null;
    const nr = nousRatesFor(model, catalog, ppc);
    if (nr) {
      r = nr;
      rate_source = "nous";
    }
  }
  if (r === null) {
    r = isFreeTier(model) ? null : ratesFor(model, catalog);
    if (r) rate_source = isLocal(model) ? "local" : "catalog";
  }
  if (cls === "local" && !isLocal(model)) {
    const [[ri, ro, rc]] = E.localRates(model);
    r = [ri / 1e6, ro / 1e6, rc / 1e6];
    rate_source = "energy";
  }
  let value = 0.0;
  if (r) {
    const [pin, pout, pcache] = r;
    const cwrite_mult = row.cache_write ? 1.25 : 0.0;
    value =
      (row.input_tokens ?? 0) * pin +
      (row.output_tokens ?? 0) * pout +
      (row.cache_read ?? 0) * pcache +
      (row.cache_write ?? 0) * cwrite_mult * pin;
  }
  const energy = cls === "local" ? value : 0.0;
  return {
    cost_class: cls,
    market_value_usd: pyRound(value, 6),
    billed_usd: cls === "metered" ? pyRound(value, 6) : 0.0,
    energy_usd: pyRound(energy, 6),
    priced: Boolean(r) || cls === "free",
    rate_source,
  };
}

/* ------------------------------------------------------------------ caches */

interface CacheFile {
  fetched: number;
  models: Catalog;
  [k: string]: unknown;
}

function nowSec(): number {
  return Date.now() / 1000;
}

function isoNow(): string {
  return new Date().toISOString().replace("Z", "+00:00");
}

function readJson(path: string): unknown {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function writeStamped(path: string, obj: Record<string, unknown>): void {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify({ schema_version: SCHEMA_VERSION, ...obj }));
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": "hermes-analytics" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** (models, source) for one remote catalogue, cached for TTL seconds, falling
 * back to a stale cache when the network is down. */
async function fetchCached(
  url: string,
  cache: string,
  shape: (raw: unknown) => Catalog,
  force = false,
): Promise<[Catalog, string]> {
  if (!force && fs.existsSync(cache)) {
    try {
      const row = readJson(cache) as Partial<CacheFile>;
      const fetched = Number(row.fetched ?? 0) || fs.statSync(cache).mtimeMs / 1000;
      if (nowSec() - fetched < TTL) {
        return [row.models ?? {}, "cache"];
      }
    } catch {
      // corrupt cache: refetch below
    }
  }
  try {
    const models = shape(await fetchJson(url));
    writeStamped(cache, {
      fetched: nowSec(),
      fetched_at: isoNow(),
      source: url,
      ttl_s: TTL,
      status: "ok",
      last_error: null,
      models,
    });
    return [models, "live"];
  } catch (e) {
    const name = (e as Error).name;
    if (fs.existsSync(cache)) {
      try {
        const prior = readJson(cache) as CacheFile;
        const models = prior.models;
        const merged: Record<string, unknown> = { ...prior };
        merged["ttl_s"] = merged["ttl_s"] ?? TTL;
        merged["status"] = "stale";
        merged["last_error"] = `${name}: ${(e as Error).message}`;
        merged["source"] = url;
        if (url === URL) {
          merged["fetched_at"] = merged["fetched_at"] ?? isoNow();
        }
        writeStamped(cache, merged);
        return [models, `stale (${name})`];
      } catch {
        // corrupt cache while offline: built-in rates take over
      }
    }
    return [{}, `unavailable (${name})`];
  }
}

/** Nous /v1/models -> {"nous:<id>": pricing}, one key per id AND alias. */
export function shapeNous(raw: unknown): Catalog {
  const out: Catalog = {};
  const data = (raw as { data?: unknown })?.data;
  for (const m of Array.isArray(data) ? data : []) {
    if (!m || typeof m !== "object") continue;
    const row = m as Record<string, unknown>;
    const pr = row["pricing"] && typeof row["pricing"] === "object"
      ? (row["pricing"] as PricingDict)
      : {};
    const ids = [row["id"], ...(((row["aliases"] ?? []) as unknown[]) ?? [])];
    for (const mid of ids) {
      if (mid) out[NOUS_PREFIX + String(mid)] ??= pr;
    }
  }
  return out;
}

export function fetchNousCatalog(force = false): Promise<[Catalog, string]> {
  return fetchCached(NOUS_URL, NOUS_CACHE, shapeNous, force);
}

/** OpenRouter /v1/models -> {id: pricing}. */
export function shapeOpenrouter(raw: unknown): Catalog {
  const out: Catalog = {};
  const data = (raw as { data?: unknown })?.data;
  for (const m of Array.isArray(data) ? data : []) {
    if (!m || typeof m !== "object") continue;
    const row = m as Record<string, unknown>;
    const id = row["id"];
    if (typeof id === "string") {
      out[id] = row["pricing"] && typeof row["pricing"] === "object"
        ? (row["pricing"] as PricingDict)
        : {};
    }
  }
  return out;
}

export function fetchOpenrouterCatalog(force = false): Promise<[Catalog, string]> {
  return fetchCached(URL, CACHE, shapeOpenrouter, force);
}

/** Return {openrouter_id: pricing_dict} plus {"nous:<id>": pricing_dict},
 * cached for TTL seconds. LLM_TELEMETRY_CATALOG pins a catalogue file, read
 * as-is: no network, no refresh. The source label is the OpenRouter one. */
export async function fetchCatalog(force = false): Promise<[Catalog, string]> {
  const pinned = process.env["LLM_TELEMETRY_CATALOG"];
  if (pinned) {
    const row = readJson(pinned) as { models?: Catalog };
    return [row.models ?? {}, "pinned"];
  }
  const [models, src] = await fetchOpenrouterCatalog(force);
  const [nous] = await fetchNousCatalog(force);
  return [{ ...models, ...nous }, src];
}

const CAT_MEMO: { k?: [string, number]; v?: Catalog } = {};

/** The catalogue from disk only (pinned file or the OpenRouter cache, stale
 * or not), never the network: for the 5 s live poll. {} when there is none. */
export function cachedCatalog(): Catalog {
  const path = process.env["LLM_TELEMETRY_CATALOG"] ?? CACHE;
  try {
    const mtime = fs.statSync(path).mtimeMs / 1000;
    if (CAT_MEMO.k?.[0] !== path || CAT_MEMO.k?.[1] !== mtime) {
      CAT_MEMO.k = [path, mtime];
      CAT_MEMO.v = (readJson(path) as { models?: Catalog }).models ?? {};
    }
    return CAT_MEMO.v ?? {};
  } catch {
    return {};
  }
}
