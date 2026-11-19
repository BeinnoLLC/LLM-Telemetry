/** Collector port — T-16 (LLMTELEMET-287).
 *
 * Port of src/llm_telemetry/probe_hosts.py: probe every configured Ollama
 * endpoint, group URLs that are the same physical machine, and attach local
 * task volume, in-flight depth and (for this box only) CPU/GPU load.
 *
 * Network I/O is a seam. The probing logic is written as generators that YIELD
 * requests (`get` a URL, `caps` for a model) and the drivers answer them:
 * `runSync` with a canned/injected transport (parity harness, unit tests) and
 * `runAsync` with the real HTTP + curl/jq transport (CLI). Everything else
 * (discover, group, short_label, loopback-twin collapse, usage SQL, caps cache)
 * is shared code, so the parity run exercises the same logic the CLI runs.
 *
 * Known gaps vs Python (documented, not hidden): error TEXT for failures other
 * than a refused/timed-out connection (e.g. malformed JSON) differs because
 * the runtimes word those errors differently; `round(ms)` uses the real wall
 * clock only in the live transport.
 */

import { execFile, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { Config, get as getConfig } from "./config.js";
import { cmpStr } from "./pySort.js";
import { pyRound, pyRound0, pySlice } from "./pySemantics.js";
import { stamp } from "./schema.js";
import { tuples } from "./sqliteUtil.js";

type Obj = Record<string, unknown>;

export const TIMEOUT_S = 6;
export const CAPS_TTL_S = 24 * 3600;

export const LOCAL_WORK_SQL = `
select u.billing_base_url, coalesce(nullif(u.task,''),'main') task, u.model,
       sum(u.api_call_count), sum(u.input_tokens+u.output_tokens),
       max(u.last_seen)
from session_model_usage u
where u.billing_base_url != '' and u.last_seen > strftime('%s','now') - 86400
group by u.billing_base_url, task, u.model
`;

export const INFLIGHT_SQL = `
select u.billing_base_url, count(*)
from session_model_usage u join sessions s on s.id = u.session_id
where s.ended_at is null and u.billing_base_url != ''
  and u.last_seen > strftime('%s','now') - 90
group by u.billing_base_url
`;

/** A network failure shaped like Python's urllib errors. `urlError` =
 * `urllib.error.URLError` (str() is `<urlopen error REASON>`), otherwise a
 * plain exception whose str() is `message`. */
export class ProbeError extends Error {
  constructor(readonly reason: string, readonly urlError = true) {
    super(urlError ? `<urlopen error ${reason}>` : reason);
  }
}

export type ProbeRequest = { op: "get"; url: string } | { op: "caps"; base: string; model: string };
export interface HttpResult { body: string; ms: number }
export interface Transport {
  get(url: string): HttpResult;
  caps(base: string, model: string): string[];
}
export interface AsyncTransport {
  get(url: string): Promise<HttpResult>;
  caps(base: string, model: string): Promise<string[]>;
}
/** Everything about THIS machine, injectable. */
export interface HostEnv {
  /** `local_ips()`: loopback + `hostname -I`, in iteration order. */
  localIps(): string[];
  /** `_primary_ips()`: `hostname -I` order, real LAN interface first. */
  primaryIps(): string[];
  /** `machine_load()`: cpu/gpu utilisation of the local box. */
  machineLoad(): Obj;
}

type Gen<T> = Generator<ProbeRequest, T, unknown>;

function drive<T>(gen: Gen<T>, answer: (r: ProbeRequest) => unknown): T {
  let step = gen.next();
  while (!step.done) {
    let val: unknown;
    try {
      val = answer(step.value);
    } catch (e) {
      step = gen.throw(e);
      continue;
    }
    step = gen.next(val);
  }
  return step.value;
}

async function driveAsync<T>(gen: Gen<T>, answer: (r: ProbeRequest) => Promise<unknown>): Promise<T> {
  let step = gen.next();
  while (!step.done) {
    let val: unknown;
    try {
      val = await answer(step.value);
    } catch (e) {
      step = gen.throw(e);
      continue;
    }
    step = gen.next(val);
  }
  return step.value;
}

const isRecord = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const truthy = (v: unknown): boolean => !(v === null || v === undefined || v === false || v === 0 || v === "" ||
  (Array.isArray(v) && !v.length) || (isRecord(v) && !Object.keys(v).length));
/** `str(ex)[:n]`. */
const exText = (e: unknown, n: number): string => pySlice(e instanceof Error ? e.message : String(e), 0, n);

export function namedLocal(url: string, cfg: Config): boolean {
  return cfg.local_host_patterns.some((h) => (url || "").includes(h));
}

const splitLines = (t: string): string[] => t.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
const ENDPOINT_RE = /https?:\/\/[\p{L}\p{N}_.-]+(?::\d+)?(?=\/v1|\/?\s*$)/gu;

/** Every distinct Ollama base URL mentioned in any profile config; a loopback
 * URL is also expanded into this box's real LAN spellings. */
export function discover(cfg: Config, env: HostEnv): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const lan = env.localIps().filter((ip) => (ip.split(".").length - 1) === 3 &&
    !ip.startsWith("169.254.") && ip !== "127.0.0.1");
  for (const p of cfg.liveProfiles()) {
    let txt: string;
    try {
      txt = fs.readFileSync(p.config).toString("utf8");
    } catch {
      continue;
    }
    for (const line of splitLines(txt)) {
      if (!line.includes("base_url") && !line.includes("api:")) continue;
      for (const m of line.match(ENDPOINT_RE) ?? []) {
        const base = m.replace(/\/+$/, "");
        if (!base.includes(":11434") && !namedLocal(base, cfg)) continue;
        const variants = [base];
        const lo = /^(https?:\/\/)(?:localhost|127\.0\.0\.1)(:\d+)?/.exec(base);
        if (lo) for (const ip of lan) variants.push(`${lo[1] as string}${ip}${lo[2] ?? ":11434"}`);
        for (const v of variants) {
          if (!seen.has(v)) {
            seen.add(v);
            out.push(v);
          }
        }
      }
    }
  }
  return out;
}

export type CapsCache = Record<string, { ts: number; caps: string[] }>;

function* capsFor(base: string, model: string, cache: CapsCache, nowS: number): Gen<string[]> {
  const hit = cache[model];
  if (hit && nowS - (hit.ts ?? 0) < CAPS_TTL_S) return hit.caps ?? [];
  let caps: string[];
  try {
    caps = (yield { op: "caps", base, model }) as string[];
  } catch {
    caps = [];
  }
  cache[model] = { ts: nowS, caps };
  return caps;
}

/** `jget`: GET + json.loads, via the transport. */
function* jget(url: string): Gen<[Obj, number]> {
  const r = (yield { op: "get", url }) as HttpResult;
  return [JSON.parse(r.body) as Obj, r.ms];
}

export interface Endpoint {
  base: string; up: boolean; err: string | null; ms: number | null; version: unknown;
  loaded: Array<Obj & { vram: number; size: number; expires: unknown }>; installed: number;
  catalog: Obj[]; vram: number; spill: number; fp?: string; [k: string]: unknown;
}

/** One endpoint: liveness, latency, loaded models, installed catalogue. */
export function* probe(base: string, cache: CapsCache, nowS: number): Gen<Endpoint> {
  const e: Endpoint = {
    base, up: false, err: null, ms: null, version: null, loaded: [], installed: 0, catalog: [],
    vram: 0, spill: 0,
  };
  try {
    const [v, ms] = yield* jget(`${base}/api/version`);
    if (!isRecord(v)) throw new Error("'list' object has no attribute 'get'");
    e.up = true;
    e.version = v["version"] ?? null;
    e.ms = pyRound0(ms);
  } catch (ex) {
    e.err = ex instanceof ProbeError && ex.urlError ? pySlice(ex.reason, 0, 80) : exText(ex, 80);
    return e;
  }

  try {
    const [ps, psMs] = yield* jget(`${base}/api/ps`);
    e["ps_ms"] = pyRound0(psMs);
    for (const m of (isRecord(ps) && Array.isArray(ps["models"]) ? ps["models"] : []) as Obj[]) {
      const size = (truthy(m["size"]) ? m["size"] : 0) as number;
      const vram = (truthy(m["size_vram"]) ? m["size_vram"] : 0) as number;
      const name = truthy(m["name"]) ? m["name"] : (m["model"] ?? null);
      e.loaded.push({
        name, size, vram,
        res: size ? pyRound0((vram / size) * 100) : 0,
        ctx: m["context_length"] ?? null,
        expires: m["expires_at"] ?? null,
        caps: yield* capsFor(base, truthy(m["name"]) ? (m["name"] as string) : "", cache, nowS),
      });
    }
    e.vram = e.loaded.reduce((a, x) => a + x.vram, 0);
    e.spill = e.loaded.reduce((a, x) => a + Math.max(0, x.size - x.vram), 0);
  } catch (ex) {
    e.err = `ps: ${exText(ex, 60)}`;
  }

  try {
    const [tags] = yield* jget(`${base}/api/tags`);
    const models = (isRecord(tags) && Array.isArray(tags["models"]) ? tags["models"] : []) as Obj[];
    e.installed = models.length;
    const cat = models.map((m) => {
      if (!("name" in m)) throw new Error("KeyError: 'name'");
      const d = truthy(m["details"]) ? (m["details"] as Obj) : {};
      return { name: m["name"], size: m["size"] ?? 0, par: d["parameter_size"] ?? null, quant: d["quantization_level"] ?? null };
    });
    e.catalog = cat.sort((a, b) => (b.size as number) - (a.size as number)); // stable, like sorted(key=-size)
    e.fp = models.map((m) => m["name"] as string).sort(cmpStr).join(",");
  } catch {
    e.fp = "";
  }
  return e;
}

const urlHost = (base: string): string => {
  const m = /\/\/([^/:]+)/.exec(base);
  return m ? (m[1] as string).toLowerCase() : base;
};

export interface UrlEntry { base: string; ms: number | null; up: boolean }
export interface HostCard extends Obj {
  urls: UrlEntry[]; up: boolean; label: string; ms: number | null;
}

/** Human name for a host: its primary LAN IP if we have one, else the hostname. */
export function shortLabel(urls: UrlEntry[], mine: Set<string> | null, env: HostEnv): string {
  if (mine && mine.size) {
    for (const ip of env.primaryIps()) {
      if (mine.has(ip) && urls.some((u) => urlHost(u.base) === ip)) return ip;
    }
  }
  for (const u of urls) {
    const m = /\/\/(\d+\.\d+\.\d+\.\d+)/.exec(u.base);
    if (m && !(m[1] as string).startsWith("127.")) return m[1] as string;
  }
  const m = /\/\/([\p{L}\p{N}_.-]+)/u.exec((urls[0] as UrlEntry).base);
  return m ? (m[1] as string).split(".")[0] as string : (urls[0] as UrlEntry).base;
}

/** Collapse endpoints that are demonstrably the same machine. */
export function group(endpoints: Endpoint[], env: HostEnv): HostCard[] {
  const mine = new Set(env.localIps().map((ip) => ip.toLowerCase()));
  const hosts = new Map<string, HostCard>();
  for (const e of endpoints) {
    let key: string;
    if (mine.has(urlHost(e.base))) {
      key = "self";
    } else if (e.up) {
      const exp = e.loaded.map((m) => (m.expires === null || m.expires === undefined ? "None" : String(m.expires))).sort(cmpStr).join("|");
      key = `${e.fp ?? ""}##${exp}`;
    } else {
      key = `down::${e.base}`;
    }
    let h = hosts.get(key);
    if (h === undefined || (e.up && !h.up)) {
      const prevUrls = h ? h.urls : [];
      h = { urls: prevUrls, ...e } as unknown as HostCard;
      hosts.set(key, h);
    }
    h.urls.push({ base: e.base, ms: e.ms, up: e.up });
    if (e.up && (h.ms === null || h.ms === undefined || (e.ms || 9e9) < (h.ms as number))) h.ms = e.ms;
  }
  const out: HostCard[] = [];
  for (const h of hosts.values()) {
    delete h["base"];
    h.up = h.urls.some((u) => u.up);
    h.urls.sort((a, b) => (Number(!a.up) - Number(!b.up)) ||
      ((a.ms !== null ? a.ms : 9e9) - (b.ms !== null ? b.ms : 9e9)));
    h.label = shortLabel(h.urls, mine, env);
    out.push(h);
  }
  out.sort((a, b) => (Number(!a.up) - Number(!b.up)) || cmpStr(a.label, b.label));
  return out;
}

function spellings(base: string, lan: Set<string>): Set<string> {
  const m = /^(https?:\/\/)([^/:]+)(:\d+)/.exec(base);
  if (!m) return new Set();
  const [, sch, host, port] = m as unknown as [string, string, string, string];
  if (host === "localhost" || host === "127.0.0.1") return new Set([...lan].map((ip) => `${sch}${ip}${port}`));
  if (lan.has(host)) return new Set([`${sch}localhost${port}`, `${sch}127.0.0.1${port}`]);
  return new Set();
}

/** Fold a fully-down card whose every URL is an alternate spelling of a
 * machine that is already up under another card. */
export function collapseLoopbackTwins(hosts: HostCard[], env: HostEnv): HostCard[] {
  if (hosts.length < 2) return hosts;
  const upUrls = new Set(hosts.filter((h) => h.up).flatMap((h) => h.urls.map((u) => u.base)));
  if (!upUrls.size) return hosts;
  const lan = new Set(env.localIps().filter((ip) => (ip.split(".").length - 1) === 3 &&
    !ip.startsWith("169.254.") && ip !== "127.0.0.1" && ip !== "localhost"));
  const keep: HostCard[] = [];
  for (const h of hosts) {
    if (h.up) {
      keep.push(h);
      continue;
    }
    if (h.urls.every((u) => [...spellings(u.base, lan)].some((s) => upUrls.has(s)))) continue;
    keep.push(h);
  }
  return keep;
}

const hostOf = (url: string): string => (url || "").replace(/\/+$/, "").replace(/\/v1\/?$/, "");

export interface Work {
  calls: number; tokens: number; last: number; tasks: Record<string, number>;
  models: Record<string, number>; profiles: string[];
}

/** Recent local task volume per base URL, straight from the usage tables. */
export function localWork(cfg: Config): Record<string, Work> {
  const out: Record<string, Work & { _p: Set<string> }> = {};
  for (const p of cfg.liveProfiles()) {
    try {
      const con = new DatabaseSync(p.db, { readOnly: true });
      try {
        for (const [url, task, model, calls, toks, last] of tuples(con, LOCAL_WORK_SQL)) {
          const host = hostOf(url as string);
          if (!host.includes(":11434") && !namedLocal(host, cfg)) continue;
          const d = (out[host] ??= { calls: 0, tokens: 0, last: 0, tasks: {}, models: {}, profiles: [], _p: new Set() });
          d.calls += (calls as number) || 0;
          d.tokens += (toks as number) || 0;
          d.last = Math.max(d.last, (last as number) || 0);
          d.tasks[task as string] = (d.tasks[task as string] ?? 0) + ((calls as number) || 0);
          d.models[model as string] = (d.models[model as string] ?? 0) + ((calls as number) || 0);
          d._p.add(p.name);
        }
      } finally {
        con.close();
      }
    } catch {
      continue;
    }
  }
  const res: Record<string, Work> = {};
  for (const [k, d] of Object.entries(out)) {
    const { _p, ...rest } = d;
    res[k] = { ...rest, profiles: [..._p].sort(cmpStr) };
  }
  return res;
}

/** Requests currently in flight per host, from the session tables. */
export function inflight(cfg: Config): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of cfg.liveProfiles()) {
    try {
      const con = new DatabaseSync(p.db, { readOnly: true });
      try {
        for (const [url, n] of tuples(con, INFLIGHT_SQL)) {
          const host = hostOf(url as string);
          out[host] = (out[host] ?? 0) + ((n as number) || 0);
        }
      } finally {
        con.close();
      }
    } catch {
      continue;
    }
  }
  return out;
}

/** The real `hostname -I`-based environment. */
export const realHostEnv: HostEnv = {
  localIps: () => {
    const ips = ["127.0.0.1", "localhost"];
    try {
      for (const ip of execFileSync("hostname", ["-I"], { encoding: "utf8", timeout: 4000 }).split(/\s+/).filter(Boolean)) {
        if (!ips.includes(ip)) ips.push(ip);
      }
    } catch { /* no hostname binary */ }
    return ips;
  },
  primaryIps: () => {
    try {
      return execFileSync("hostname", ["-I"], { encoding: "utf8", timeout: 4000 }).split(/\s+/)
        .filter((ip) => ip && (ip.split(".").length - 1) === 3 && !ip.startsWith("169.254."));
    } catch {
      return [];
    }
  },
  machineLoad: () => {
    const out: Obj = {};
    try {
      const la = Number(fs.readFileSync("/proc/loadavg", "utf8").split(/\s+/)[0]);
      const ncpu = os.cpus().length || 1;
      out["cpu"] = pyRound(Math.min(100.0, (la / ncpu) * 100), 1);
      out["load1"] = la;
      out["ncpu"] = ncpu;
    } catch { /* not linux */ }
    try {
      const r = execFileSync("nvidia-smi", ["--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu",
        "--format=csv,noheader,nounits"], { encoding: "utf8", timeout: 6000 });
      const gpus: Obj[] = [];
      for (const line of r.trim().split(/\r?\n/)) {
        const parts = line.split(",").map((x) => x.trim());
        if (parts.length < 6) continue;
        gpus.push({ i: parseInt(parts[0] as string, 10), name: parts[1], util: Number(parts[2]),
          used: Number(parts[3]), total: Number(parts[4]), temp: Number(parts[5]) });
      }
      if (gpus.length) {
        out["gpus"] = gpus;
        out["gpu"] = pyRound(gpus.reduce((a, g) => a + (g["util"] as number), 0) / gpus.length, 1);
        const tot = gpus.reduce((a, g) => a + (g["total"] as number), 0) || 1;
        out["gpu_mem"] = pyRound((gpus.reduce((a, g) => a + (g["used"] as number), 0) / tot) * 100, 1);
      }
    } catch { /* no nvidia-smi */ }
    return out;
  },
};

const execFileP = promisify(execFile);

/** The real network transport: fetch for /api/*, curl+jq for capabilities (the
 * /api/show body embeds raw newlines, which strict JSON parsers reject). */
export const realTransport: AsyncTransport = {
  async get(url) {
    const t0 = performance.now();
    let res: Response;
    try {
      res = await fetch(url, { headers: { "User-Agent": "hermes-dash" }, signal: AbortSignal.timeout(TIMEOUT_S * 1000) });
    } catch (e) {
      const c = (e as { cause?: { code?: string; message?: string } }).cause;
      const timedOut = (e as Error).name === "TimeoutError";
      throw new ProbeError(timedOut ? "timed out" : (c?.code === "ECONNREFUSED" ? "[Errno 111] Connection refused" : (c?.message ?? (e as Error).message)));
    }
    if (!res.ok) throw new ProbeError(`HTTP Error ${res.status}: ${res.statusText}`, false);
    const body = await res.text();
    return { body, ms: performance.now() - t0 };
  },
  async caps(base, model) {
    const p = await execFileP("curl", ["-s", "-m", String(TIMEOUT_S), `${base}/api/show`, "-d", JSON.stringify({ model })],
      { timeout: (TIMEOUT_S + 3) * 1000, maxBuffer: 64 * 1024 * 1024 });
    const q = await new Promise<string>((resolve, reject) => {
      const child = execFile("jq", ["-c", ".capabilities // []"], { timeout: 10_000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
      child.stdin?.end(p.stdout);
    });
    return JSON.parse(q || "[]") as string[];
  },
};

export interface CollectProbeOptions {
  cfg?: Config;
  env?: HostEnv;
  cache?: CapsCache;
  now?: Date;
}

function assemble(
  cfg: Config, env: HostEnv, eps: Endpoint[], nowS: number,
): Obj {
  const hosts = collapseLoopbackTwins(group(eps, env), env);
  const work = localWork(cfg);
  for (const h of hosts) {
    const agg: Work = { calls: 0, tokens: 0, last: 0, tasks: {}, models: {}, profiles: [] };
    for (const u of h.urls) {
      const w = work[u.base];
      if (!w) continue;
      agg.calls += w.calls;
      agg.tokens += w.tokens;
      agg.last = Math.max(agg.last, w.last);
      for (const [k, v] of Object.entries(w.tasks)) agg.tasks[k] = (agg.tasks[k] ?? 0) + v;
      for (const [k, v] of Object.entries(w.models)) agg.models[k] = (agg.models[k] ?? 0) + v;
      agg.profiles = [...new Set([...agg.profiles, ...w.profiles])].sort(cmpStr);
    }
    h["work"] = agg;
  }
  const flying = inflight(cfg);
  const mine = new Set(env.localIps());
  const load = env.machineLoad();
  for (const h of hosts) {
    h["queue"] = h.urls.reduce((a, u) => a + (flying[u.base] ?? 0), 0);
    const isLocal = h.urls.some((u) => mine.has(u.base.replace(/^https?:\/\//, "").split(":")[0] as string));
    h["is_self"] = isLocal;
    if (isLocal && Object.keys(load).length) h["load"] = load;
  }
  return stamp({ ts: Math.trunc(nowS), hosts, endpoints: eps.length, physical: hosts.length });
}

/** Synchronous collect with an injected transport (parity harness, tests). */
export function collectProbe(opts: CollectProbeOptions & { transport: Transport; env: HostEnv }): Obj {
  const cfg = opts.cfg ?? getConfig();
  const nowS = (opts.now ?? new Date()).getTime() / 1000;
  const cache = opts.cache ?? {};
  const answer = (r: ProbeRequest): unknown => (r.op === "get" ? opts.transport.get(r.url) : opts.transport.caps(r.base, r.model));
  const eps = discover(cfg, opts.env).map((b) => drive(probe(b, cache, nowS), answer));
  return assemble(cfg, opts.env, eps, nowS);
}

/** Collect against the real network (probes run concurrently across hosts). */
export async function collectProbeAsync(
  opts: CollectProbeOptions & { transport?: AsyncTransport } = {},
): Promise<Obj> {
  const cfg = opts.cfg ?? getConfig();
  const env = opts.env ?? realHostEnv;
  const nowS = (opts.now ?? new Date()).getTime() / 1000;
  const cache = opts.cache ?? {};
  const t = opts.transport ?? realTransport;
  const answer = (r: ProbeRequest): Promise<unknown> => (r.op === "get" ? t.get(r.url) : t.caps(r.base, r.model));
  const eps: Endpoint[] = [];
  for (const b of discover(cfg, env)) eps.push(await driveAsync(probe(b, cache, nowS), answer));
  return assemble(cfg, env, eps, nowS);
}
