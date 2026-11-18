/** Port of the network half of `pricing.py`: `fetch_catalog` and its OpenRouter
 * and Nous helpers. 6 h cache, stale-cache fallback, `LLM_TELEMETRY_CATALOG`
 * pin (read as-is, no network). `fetch` is injectable so tests never touch the
 * real network. Error labels use Python's exception class names so the
 * `pricing_source` string (`stale (URLError)` ...) is unchanged.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Config } from "./config.js";
import type { Catalog } from "./pricing.js";
import { NOUS_PREFIX } from "./pricing.js";
import { stamp } from "./schema.js";
import { assertSafeOutDir, assertSafeTarget } from "./artifactWriter.js";
import { resolveNodeReportsDir } from "./config.js";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";
export const NOUS_URL = "https://inference-api.nousresearch.com/v1/models";
export const TTL_S = 6 * 3600;
const TIMEOUT_MS = 30_000;

export type FetchFn = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  ok: boolean; status: number; statusText: string; json: () => Promise<unknown>;
}>;

export interface FetchOpts {
  force?: boolean;
  fetchFn?: FetchFn;
  /** Seconds since epoch; default Date.now()/1000. */
  now?: number;
  env?: NodeJS.ProcessEnv;
  /** Dir holding `pricing-cache.json` / `nous-pricing-cache.json`. The Node
   * stack passes its own reports dir (never the Python one: single-writer
   * rule). Default: the Node reports dir. A Python reports dir is refused
   * up front (ArtifactWriteError) unless LLM_TELEMETRY_SHARED_REPORTS=1. */
  cacheDir?: string;
}

type Json = Record<string, unknown>;

/** An error carrying the Python class name used in `<Class>: <msg>` labels. */
class PyErr extends Error {
  constructor(readonly pyName: string, msg: string) { super(msg); }
}

function pyName(e: unknown): string {
  if (e instanceof PyErr) return e.pyName;
  const err = e as { name?: string };
  if (err.name === "TimeoutError" || err.name === "AbortError") return "TimeoutError";
  if (err.name === "SyntaxError") return "JSONDecodeError";
  return "URLError";
}

function pyMsg(e: unknown): string {
  if (e instanceof PyErr) return e.message;
  const err = e as { name?: string; message?: string; cause?: { message?: string } };
  const m = err.cause?.message ?? err.message ?? String(e);
  if (pyName(e) === "URLError") return `<urlopen error ${m}>`;
  return m;
}

function readJson(file: string): Json {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Json;
}

/** Single-writer guard + temp file and rename, like artifactWriter. */
function writeCache(file: string, payload: Json, cfg: Config): void {
  assertSafeOutDir(path.dirname(file), cfg);
  assertSafeTarget(file, cfg);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(stamp(payload)));
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* tmp never existed */ }
    throw err;
  }
}

async function getJson(url: string, fetchFn: FetchFn): Promise<unknown> {
  const r = await fetchFn(url, {
    headers: { "User-Agent": "hermes-analytics" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new PyErr("HTTPError", `HTTP Error ${r.status}: ${r.statusText}`);
  return r.json();
}

function isoNow(nowS: number): string {
  return new Date(nowS * 1000).toISOString().replace("Z", "+00:00");
}

/** Shared by both catalogues. `fetchedFresh` decides if a cache is still fresh
 * (OpenRouter honours the `fetched` field, Nous only the file mtime). */
async function fetchCached(
  cfg: Config, url: string, cache: string, shape: (raw: Json) => Catalog, o: FetchOpts,
  freshAge: (cached: Json, mtimeS: number) => number, patchStale: (m: Json, nowS: number) => void,
): Promise<[Catalog, string]> {
  const nowS = o.now ?? Date.now() / 1000;
  assertSafeTarget(cache, cfg); // before any read or network: never a Python dir
  const exists = fs.existsSync(cache);
  if (!o.force && exists) {
    try {
      const cached = readJson(cache);
      const mtimeS = fs.statSync(cache).mtimeMs / 1000;
      // Python: `cached["models"]` raises KeyError inside the try, so a fresh
      // cache without `models` falls through to the network.
      if (nowS - freshAge(cached, mtimeS) < TTL_S && "models" in cached) {
        return [cached["models"] as Catalog, "cache"];
      }
    } catch { /* unreadable cache: fall through to the network */ }
  }
  try {
    const raw = (await getJson(url, o.fetchFn ?? (fetch as unknown as FetchFn))) as Json;
    const models = shape(raw);
    writeCache(cache, {
      fetched: nowS, fetched_at: isoNow(nowS), source: url, ttl_s: TTL_S,
      status: "ok", last_error: null, models,
    }, cfg);
    return [models, "live"];
  } catch (e) {
    const label = pyName(e);
    if (fs.existsSync(cache)) {
      try {
        const prior = readJson(cache);
        const models = prior["models"];
        if (models === undefined) throw new PyErr("KeyError", "'models'");
        const merged: Json = { ...prior };
        if (!("ttl_s" in merged)) merged["ttl_s"] = TTL_S;
        merged["status"] = "stale";
        merged["last_error"] = `${label}: ${pyMsg(e)}`;
        merged["source"] = url;
        patchStale(merged, nowS);
        writeCache(cache, merged, cfg);
        return [models as Catalog, `stale (${label})`];
      } catch { /* corrupt cache while offline: built-in rates take over */ }
    }
    return [{}, `unavailable (${label})`];
  }
}

export function shapeOpenRouter(raw: Json): Catalog {
  const out: Catalog = {};
  for (const m of (raw["data"] as Json[] | undefined) ?? []) {
    if (!("id" in m)) throw new PyErr("KeyError", "'id'");
    out[String(m["id"])] = m["pricing"] ?? {};
  }
  return out;
}

export function shapeNous(raw: Json): Catalog {
  const out: Catalog = {};
  for (const m of (raw["data"] as Json[] | undefined) ?? []) {
    const pr = m["pricing"] || {};
    for (const mid of [m["id"], ...((m["aliases"] as unknown[] | undefined) ?? [])]) {
      if (mid && !(NOUS_PREFIX + String(mid) in out)) out[NOUS_PREFIX + String(mid)] = pr;
    }
  }
  return out;
}

export function fetchOpenRouter(cfg: Config, o: FetchOpts = {}): Promise<[Catalog, string]> {
  return fetchCached(
    cfg, OPENROUTER_URL, path.join(o.cacheDir ?? resolveNodeReportsDir(cfg), "pricing-cache.json"), shapeOpenRouter, o,
    (c, mtimeS) => Number(c["fetched"] || mtimeS),
    (m, nowS) => { m["fetched_at"] = m["fetched_at"] || isoNow(nowS); },
  );
}

export function fetchNous(cfg: Config, o: FetchOpts = {}): Promise<[Catalog, string]> {
  return fetchCached(
    cfg, NOUS_URL, path.join(o.cacheDir ?? resolveNodeReportsDir(cfg), "nous-pricing-cache.json"), shapeNous, o,
    (_c, mtimeS) => mtimeS, () => undefined,
  );
}

/** `[{...openrouter, ...nous}, source]`; the pin short-circuits the network. */
export async function fetchCatalog(cfg: Config, o: FetchOpts = {}): Promise<[Catalog, string]> {
  const pinned = (o.env ?? process.env)["LLM_TELEMETRY_CATALOG"];
  if (pinned) return [readJson(pinned)["models"] as Catalog, "pinned"];
  const [models, src] = await fetchOpenRouter(cfg, o);
  const [nous] = await fetchNous(cfg, o);
  return [{ ...models, ...nous }, src];
}
