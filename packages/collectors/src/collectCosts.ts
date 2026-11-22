import { Config, get as getConfig } from "./config.js";
import * as P from "./pricing.js";
import { stamp } from "./schema.js";
import { localRates as energyLocalRates, PREFILL_SPEEDUP, CACHE_SPEEDUP, tariff } from "./energy.js";
import { pyRound } from "./pySemantics.js";

export function localRates(model: string | null): [number, number, number, number] {
  const cfg = getConfig();
  const r = energyLocalRates(model, cfg);
  return [r.rates[0], r.rates[1], r.rates[2], r.tps];
}

export function rateSource(model: string | null, catalog: any): string {
  if (P.isLocal(model)) return "local";
  if (P.isFreeTier(model)) return "free-tier";
  const rr = P.rateOrigin(model, catalog, getConfig()) as any; const origin = rr?.[0]; const rt = rr?.[1];
  if (!rt) return "unpriced";
  return origin === "catalog" ? "openrouter" : "vendor";
}

export function rateOriginTag(model: string | null, catalog: any): string {
  if (P.isLocal(model)) return "local";
  if (P.isFreeTier(model)) return "free-tier";
  const rr = P.rateOrigin(model, catalog, getConfig()) as any; const origin = rr?.[0]; const rt = rr?.[1];
  return rt ? (origin || "") : "";
}

export function installedLocalModels(ollama: any): Set<string> {
  const out = new Set<string>();
  for (const h of (ollama?.hosts ?? [])) {
    for (const c of (h?.catalog ?? [])) {
      if (c?.name) out.add(c.name);
    }
  }
  return out;
}

export function resolveServingProvider(row: any): string {
  const url = String(row?.base_url ?? "").toLowerCase();
  if (url.includes("fireworks.ai") || url.includes("openrouter.ai")) {
    return url.includes("fireworks.ai") ? "fireworks" : "openrouter";
  }
  if (url.includes("opencode.ai")) return "opencode-go";
  if (url.includes("api.anthropic.com")) return "anthropic";
  if (url.includes("nousresearch.com")) return "nous";
  if (url.includes("ollama.com")) return "ollama-cloud";
  const model = String(row?.model ?? "").trim().toLowerCase();
  if (model.startsWith("gpt-")) return "openai-codex";
  if (model.startsWith("stepfun/") || model.startsWith("step-") || model.includes("hermes-")) return "nous";
  if (model.includes("claude")) return "anthropic";
  if (model.includes("glm") || model.includes("kimi") || model.includes("minimax")) return "opencode-go";
  return "";
}

export function inferCatalogProvider(model: string | null, catalog: any): string {
  try {
    return P.servingProviderHint(model, catalog) ?? "";
  } catch {
    return "";
  }
}

export function observedTraffic(data: any): Record<string, any> {
  const seen: Record<string, any> = {};
  const get = (m: string) => {
    if (!seen[m]) seen[m] = { calls: 0, inp: 0, outp: 0, cache: 0, cost: 0.0, providers: new Set(), profiles: new Set(), local: false };
    return seen[m];
  };
  for (const [pname, prof] of Object.entries(data?.profiles ?? {})) {
    for (const r of (prof as any)?.rows ?? []) {
      if (P.isDeadEndpoint(r?.base_url)) continue;
      const e = get(r?.model ?? "");
      e.calls += r?.calls ?? 0;
      e.inp += r?.inp ?? 0;
      e.outp += r?.outp ?? 0;
      e.cache += r?.cread ?? 0;
      e.cost += r?.market_value_usd ?? 0.0;
      if (r?.provider) e.providers.add(r.provider);
      else if (e.providers.size === 0) {
        const fb = resolveServingProvider(r);
        if (fb) e.providers.add(fb);
      }
      if (r?.cost_class === "local") e.local = true;
      e.profiles.add(pname);
    }
  }
  return seen;
}

export function assemble(data: any, catalog: any, installed: Set<string> | string[] = []): any[] {
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
    const oid = (P.ALIASES as any)?.[m] || P.resolveCatalogId(m, catalog);
    if (oid && oid !== m) universe.delete(oid);
  }
  for (const w of [...Object.keys(P.WEB_RATES ?? {}), ...Object.keys(P.RATE_OVERRIDES ?? {})]) {
    const oid = (P.ALIASES as any)?.[w];
    if (oid && oid !== w && !P.isLocal(w)) universe.delete(oid);
  }
  universe.delete("");

  const models: any[] = [];
  for (const model of universe) {
    const agg: any = seen[model];
    const used = !!(agg && agg.calls);
    const local = localNames.has(model) || P.isLocal(model);
    let source = local ? "local" : rateSource(model, catalog);
    let nousRt: any = null;
    if (!local && agg && new Set(agg.providers).size === 1 && agg.providers.has("nous")) {
      nousRt = P.nousRatesFor ? P.nousRatesFor(model, catalog) : null;
      if (nousRt) source = nousRt.some((x: any) => x) ? "nous" : "free-tier";
    }
    let tps: any = null;
    let energy: any = null;
    let ri: any = null, ro: any = null, rc: any = null;
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
    const a = agg || { calls: 0, inp: 0, outp: 0, cache: 0, cost: 0.0, providers: new Set(), profiles: new Set() };
    let hint = "";
    if (!agg) {
      if (installedSet.has(model)) hint = "local";
      else if (!local) hint = inferCatalogProvider(model, catalog) || "";
    }
    models.push({
      model, short: model.split("/").pop(),
      oid: local ? "" : ((P.ALIASES as any)?.[model] || P.resolveCatalogId(model, catalog) || ""),
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
    return (-(y.out_1m || 0)) - (-(x.out_1m || 0)) || String(x.model).localeCompare(String(y.model));
  });
  return models;
}

export async function build(): Promise<any> {
  const cfg = getConfig();
  // analytics collection skipped in node port (data provided by caller typically); read existing
  const dataPath = (cfg as any).reports_dir ? (cfg as any).reports_dir + "/analytics-data.json" : "";
  let data: any = {};
  try { const fs = require("fs"); data = JSON.parse(fs.readFileSync(dataPath, "utf8")); } catch (e) { data = {}; }
  const catalog = P.cachedCatalog(cfg); const src = "cache";
  // pricingFetch should be used by caller; here use cachedCatalog
  let ollama: any = {};
  const op = cfg.reports_dir + "/ollama-data.json";
  try { ollama = JSON.parse(require("fs").readFileSync(op, "utf8")); } catch {}
  const models = assemble(data, catalog, installedLocalModels(ollama));
  const [kwh, gpuW, hostW] = tariff(cfg);
  const d: any = {
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
  if (data?.sample) d.sample = true;
  return stamp(d);
}

export function costsDataPath(env: NodeJS.ProcessEnv = process.env, cfg?: Config): string {
  const p = env.LLM_TELEMETRY_COSTS_DATA;
  if (p) return p;
  const c = cfg ?? getConfig();
  return (c as any).reports_dir + "/costs-data.json";
}

export function writeCostsData(d: any, env: NodeJS.ProcessEnv = process.env, cfg?: Config): string {
  const path = costsDataPath(env, cfg);
  const fs = require("fs");
  const pathMod = require("path");
  fs.mkdirSync(pathMod.dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(d, (k, v) => (v instanceof Set ? [...v] : v)));
  return path;
}
