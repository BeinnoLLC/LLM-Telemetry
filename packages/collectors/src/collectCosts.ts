import * as fs from "node:fs";
import * as nodePath from "node:path";

import { Config, get as getConfig } from "./config.js";
import * as P from "./pricing.js";
import { stamp } from "./schema.js";
import { localRates as energyLocalRates, PREFILL_SPEEDUP, CACHE_SPEEDUP, tariff } from "./energy.js";
import { fetchCatalog } from "./pricingFetch.js";

type Dict = Record<string, unknown>;

interface TrafficRow {
  model?: string | null;
  base_url?: string | null;
  calls?: number | null;
  inp?: number | null;
  outp?: number | null;
  cread?: number | null;
  market_value_usd?: number | null;
  provider?: string | null;
  cost_class?: string | null;
}

interface TrafficProfile {
  rows?: unknown;
}

interface TrafficData {
  profiles?: Record<string, unknown>;
  sample?: boolean;
}

interface Aggregate {
  calls: number;
  inp: number;
  outp: number;
  cache: number;
  cost: number;
  providers: Set<string>;
  profiles: Set<string>;
  local: boolean;
}

interface CostModel {
  model: string;
  short: string | undefined;
  oid: string;
  in_1m: number | null;
  out_1m: number | null;
  cache_1m: number | null;
  source: string;
  tps: number | null;
  used: boolean;
  rate_origin: string;
  calls: number;
  inp: number;
  outp: number;
  cache: number;
  cost: number;
  energy: number | null;
  providers: string[];
  served_by: string;
  inferred_by: string;
  profiles: string[];
}

interface OllamaCatalogEntry {
  name?: string | null;
}

interface OllamaHost {
  catalog?: unknown;
}

interface OllamaData {
  hosts?: unknown;
}

interface CostsData extends Dict {
  models: CostModel[];
}

function asDict(value: unknown): Dict {
  return value !== null && typeof value === "object" ? value as Dict : {};
}

function asIterable(value: unknown): Iterable<unknown> {
  return (value ?? []) as Iterable<unknown>;
}

export function localRates(model: string | null): [number, number, number, number] {
  const cfg = getConfig();
  const r = energyLocalRates(model, cfg);
  return [r.rates[0], r.rates[1], r.rates[2], r.tps];
}

export function rateSource(model: string | null, catalog: Dict): string {
  if (P.isLocal(model)) return "local";
  if (P.isFreeTier(model)) return "free-tier";
  const rr = P.rateOrigin(model, catalog, getConfig());
  const origin = rr?.[0] ?? "";
  const rt = rr?.[1];
  if (!rt) return "unpriced";
  return origin === "catalog" ? "openrouter" : "vendor";
}

export function rateOriginTag(model: string | null, catalog: Dict): string {
  if (P.isLocal(model)) return "local";
  if (P.isFreeTier(model)) return "free-tier";
  const rr = P.rateOrigin(model, catalog, getConfig());
  const origin = rr?.[0] ?? "";
  const rt = rr?.[1];
  return rt ? (origin || "") : "";
}

export function installedLocalModels(ollama: unknown): Set<string> {
  const data = asDict(ollama) as OllamaData;
  const out = new Set<string>();
  for (const h of asIterable(data.hosts)) {
    const host = asDict(h) as OllamaHost;
    for (const c of asIterable(host.catalog)) {
      const entry = asDict(c) as OllamaCatalogEntry;
      if (entry.name) out.add(String(entry.name));
    }
  }
  return out;
}

export function resolveServingProvider(row: unknown): string {
  const r = asDict(row);
  const url = String(r.base_url ?? "").toLowerCase();
  if (url.includes("fireworks.ai") || url.includes("openrouter.ai")) {
    return url.includes("fireworks.ai") ? "fireworks" : "openrouter";
  }
  if (url.includes("opencode.ai")) return "opencode-go";
  if (url.includes("api.anthropic.com")) return "anthropic";
  if (url.includes("nousresearch.com")) return "nous";
  if (url.includes("ollama.com")) return "ollama-cloud";
  const model = String(r.model ?? "").trim().toLowerCase();
  if (model.startsWith("gpt-")) return "openai-codex";
  if (model.startsWith("stepfun/") || model.startsWith("step-") || model.includes("hermes-")) return "nous";
  if (model.includes("claude")) return "anthropic";
  if (model.includes("glm") || model.includes("kimi") || model.includes("minimax")) return "opencode-go";
  return "";
}

export function inferCatalogProvider(model: string | null, catalog: Dict): string {
  try {
    return P.servingProviderHint(model, catalog) ?? "";
  } catch {
    return "";
  }
}

export function observedTraffic(data: unknown): Record<string, Aggregate> {
  const source = asDict(data) as TrafficData;
  const seen: Record<string, Aggregate> = {};
  const get = (m: string): Aggregate => {
    if (!seen[m]) {
      seen[m] = {
        calls: 0,
        inp: 0,
        outp: 0,
        cache: 0,
        cost: 0.0,
        providers: new Set<string>(),
        profiles: new Set<string>(),
        local: false,
      };
    }
    return seen[m] as Aggregate;
  };
  for (const [pname, prof] of Object.entries(source.profiles ?? {})) {
    const profile = asDict(prof) as TrafficProfile;
    for (const item of asIterable(profile.rows)) {
      const r = asDict(item) as TrafficRow;
      if (P.isDeadEndpoint(r.base_url)) continue;
      const e = get(String(r.model ?? ""));
      e.calls += r.calls ?? 0;
      e.inp += r.inp ?? 0;
      e.outp += r.outp ?? 0;
      e.cache += r.cread ?? 0;
      e.cost += r.market_value_usd ?? 0.0;
      if (r.provider) {
        e.providers.add(String(r.provider));
      } else if (e.providers.size === 0) {
        const fb = resolveServingProvider(item);
        if (fb) {
          e.providers.add(fb);
        }
      }
      if (r.cost_class === "local") {
        e.local = true;
      }
      e.profiles.add(pname);
    }
  }
  return seen;
}

export function assemble(data: unknown, catalog: Dict, installed: Set<string> | string[] = []): CostModel[] {
  const installedSet = installed instanceof Set ? installed : new Set(installed);
  const seen = observedTraffic(data);
  const localNames = new Set(installedSet);
  for (const [m, a] of Object.entries(seen)) {
    if (a.local) localNames.add(m);
  }
  const universe = new Set<string>();
  for (const k of Object.keys(catalog ?? {})) universe.add(k);
  for (const k of Object.keys(P.WEB_RATES ?? {})) universe.add(k);
  for (const k of Object.keys(P.RATE_OVERRIDES ?? {})) universe.add(k);
  for (const m of localNames) universe.add(m);
  for (const m of Object.keys(seen)) universe.add(m);

  for (const m of Object.keys(seen)) {
    if (localNames.has(m)) continue;
    const oid = P.ALIASES?.[m] || P.resolveCatalogId(m, catalog);
    if (oid && oid !== m) universe.delete(oid);
  }
  for (const w of [...Object.keys(P.WEB_RATES ?? {}), ...Object.keys(P.RATE_OVERRIDES ?? {})]) {
    const oid = P.ALIASES?.[w];
    if (oid && oid !== w && !P.isLocal(w)) universe.delete(oid);
  }
  universe.delete("");

  const models: CostModel[] = [];
  for (const model of universe) {
    const agg: Aggregate | undefined = seen[model];
    const used = !!(agg && agg.calls);
    const local = localNames.has(model) || P.isLocal(model);
    let source = local ? "local" : rateSource(model, catalog);
    let nousRt: [number, number, number] | null = null;
    if (!local && agg && new Set(agg.providers).size === 1 && agg.providers.has("nous")) {
      nousRt = P.nousRatesFor ? P.nousRatesFor(model, catalog) : null;
      if (nousRt) source = nousRt.some((x) => x) ? "nous" : "free-tier";
    }
    let tps: number | null = null;
    let energy: number | null = null;
    let ri: number | null = null, ro: number | null = null, rc: number | null = null;
    if (source === "local") {
      const lr = localRates(model);
      ri = lr[0]; ro = lr[1]; rc = lr[2]; tps = lr[3];
      if (agg) energy = (agg.inp * ri + agg.outp * ro) / 1e6;
    } else if (source === "free-tier") {
      ri = ro = rc = 0.0;
    } else {
      const rt = nousRt && source === "nous" ? nousRt : P.ratesFor(model, catalog, getConfig());
      if (rt) {
        ri = rt[0] * 1e6; ro = rt[1] * 1e6; rc = rt[2] * 1e6;
      } else {
        ri = ro = rc = null;
        source = "unpriced";
      }
    }
    const a: Aggregate = agg || {
      calls: 0,
      inp: 0,
      outp: 0,
      cache: 0,
      cost: 0.0,
      providers: new Set<string>(),
      profiles: new Set<string>(),
      local: false,
    };
    let hint = "";
    if (!agg) {
      if (installedSet.has(model)) hint = "local";
      else if (!local) hint = inferCatalogProvider(model, catalog) || "";
    }
    models.push({
      model, short: model.split("/").pop(),
      oid: local ? "" : (P.ALIASES?.[model] || P.resolveCatalogId(model, catalog) || ""),
      in_1m: ri, out_1m: ro, cache_1m: rc,
      source, tps, used,
      rate_origin: rateOriginTag(model, catalog),
      calls: a.calls, inp: a.inp, outp: a.outp,
      cache: a.cache, cost: a.cost, energy,
      providers: [...a.providers].sort(),
      served_by: [...a.providers].sort().join(", ") || hint || "—",
      inferred_by: hint,
      profiles: [...a.profiles].sort(),
    });
  }
  models.sort((x, y) => {
    if ((x.out_1m == null) !== (y.out_1m == null)) return x.out_1m == null ? 1 : -1;
    return (Number(y.out_1m ?? 0) - Number(x.out_1m ?? 0))
      || (x.model < y.model ? -1 : (x.model > y.model ? 1 : 0));
  });
  return models;
}

export async function build(): Promise<CostsData> {
  const cfg = getConfig();
  // analytics collection skipped in node port (data provided by caller typically); read existing
  const dataPath = cfg.reports_dir ? cfg.reports_dir + "/analytics-data.json" : "";
  let data: unknown = {};
  try { data = JSON.parse(fs.readFileSync(dataPath, "utf8")); } catch { data = {}; }
  const [catalog, src] = await fetchCatalog(cfg);
  let ollama: unknown = {};
  const op = cfg.reports_dir + "/ollama-data.json";
  try { ollama = JSON.parse(fs.readFileSync(op, "utf8")); } catch {}
  const models = assemble(data, catalog, installedLocalModels(ollama));
  const [kwh, gpuW, hostW] = tariff(cfg);
  const d: CostsData = {
    models,
    catalog_size: P.catalogSize(catalog),
    catalog_source: src || "cache",
    freshness: P.catalogFreshness ? P.catalogFreshness(src || "cache") : null,
    generated: new Date().toISOString().slice(0, 19),
    kwh: kwh,
    watts: gpuW + hostW,
    gpu_w: gpuW,
    host_w: hostW,
    prefill: PREFILL_SPEEDUP,
    cachex: CACHE_SPEEDUP,
  };
  if ((data as TrafficData).sample) d.sample = true;
  return stamp(d);
}

export function costsDataPath(env: NodeJS.ProcessEnv = process.env, cfg?: Config): string {
  const p = env.LLM_TELEMETRY_COSTS_DATA;
  if (p) return p;
  const c = cfg ?? getConfig();
  return c.reports_dir + "/costs-data.json";
}

export function writeCostsData(d: unknown, env: NodeJS.ProcessEnv = process.env, cfg?: Config): string {
  const path = costsDataPath(env, cfg);
  fs.mkdirSync(nodePath.dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(d, (k, v) => (v instanceof Set ? [...v] : v)));
  return path;
}
