import * as fs from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { load } from "../../src/config.js";
import { fetchCatalog, fetchNous, fetchOpenRouter, type FetchFn } from "../../src/pricingFetch.js";
import { SCHEMA_VERSION } from "../../src/schema.js";
import { makeTmpDir } from "./helpers.js";
import { spawnSync } from "node:child_process";
import { resolvePython } from "../../parity/pythonProducer.js";

function setup() {
  const dir = makeTmpDir("pf-");
  const reports = join(dir, "reports");
  const cfgPath = join(dir, "config.json");
  fs.writeFileSync(cfgPath, JSON.stringify({ agent_home: join(dir, "agent"), profiles: [], reports_dir: reports }));
  const saved = process.env["LLM_TELEMETRY_AGENT_HOME"];
  process.env["LLM_TELEMETRY_AGENT_HOME"] = join(dir, "agent");
  try { return { dir, reports, cacheDir: join(dir, "node-reports"), cfg: load(cfgPath) }; } finally {
    if (saved === undefined) delete process.env["LLM_TELEMETRY_AGENT_HOME"]; else process.env["LLM_TELEMETRY_AGENT_HOME"] = saved;
  }
}

const ok = (body: unknown): FetchFn => async () => ({ ok: true, status: 200, statusText: "OK", json: async () => body });
const down: FetchFn = async () => { throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND openrouter.ai") }); };
const OR = { data: [{ id: "a/b", pricing: { prompt: "1", completion: "2" } }, { id: "c/d" }] };
const NOUS = { data: [{ id: "x", pricing: { prompt: "3" }, aliases: ["x-dated"] }, { id: "y", aliases: ["x"] }] };
const both: FetchFn = async (url) => ({
  ok: true, status: 200, statusText: "OK", json: async () => (url.includes("nousresearch") ? NOUS : OR),
});

describe("pricing catalogue fetch (mocked network)", () => {
  it("live fetch merges Nous over OpenRouter, writes both caches stamped", async () => {
    const { cacheDir, cfg } = setup();
    const now = Date.now() / 1000;
    const [models, src] = await fetchCatalog(cfg, { cacheDir, fetchFn: both, now, env: {} });
    expect(src).toBe("live");
    expect(models).toEqual({
      "a/b": { prompt: "1", completion: "2" }, "c/d": {},
      "nous:x": { prompt: "3" }, "nous:x-dated": { prompt: "3" }, "nous:y": {},
    });
    const cache = JSON.parse(fs.readFileSync(join(cacheDir, "pricing-cache.json"), "utf8"));
    expect(cache).toMatchObject({ fetched: now, status: "ok", last_error: null, ttl_s: 21600, schema_version: SCHEMA_VERSION });
    expect(Object.keys(cache)).toEqual(["fetched", "fetched_at", "source", "ttl_s", "status", "last_error", "models", "schema_version"]);
    expect(fs.existsSync(join(cacheDir, "nous-pricing-cache.json"))).toBe(true);
  });

  it("a fresh cache is served without calling fetch; force and expiry refetch", async () => {
    const { cacheDir, cfg } = setup();
    const now = Date.now() / 1000;
    await fetchOpenRouter(cfg, { cacheDir, fetchFn: ok(OR), now });
    let calls = 0;
    const counting: FetchFn = async (...a) => { calls++; return ok(OR)(...a); };
    expect((await fetchOpenRouter(cfg, { cacheDir, fetchFn: counting, now: now + 60 }))[1]).toBe("cache");
    expect(calls).toBe(0);
    expect((await fetchOpenRouter(cfg, { cacheDir, fetchFn: counting, now: now + 60, force: true }))[1]).toBe("live");
    expect((await fetchOpenRouter(cfg, { cacheDir, fetchFn: counting, now: now + 7 * 3600 }))[1]).toBe("live");
    expect(calls).toBe(2);
  });

  it("network down with a cache: stale, models kept, error recorded", async () => {
    const { cacheDir, cfg } = setup();
    const now = Date.now() / 1000;
    await fetchOpenRouter(cfg, { cacheDir, fetchFn: ok(OR), now });
    const [models, src] = await fetchOpenRouter(cfg, { cacheDir, fetchFn: down, now: now + 8 * 3600 });
    expect(src).toBe("stale (URLError)");
    expect(models).toEqual({ "a/b": { prompt: "1", completion: "2" }, "c/d": {} });
    const c = JSON.parse(fs.readFileSync(join(cacheDir, "pricing-cache.json"), "utf8"));
    expect(c.status).toBe("stale");
    expect(c.last_error).toBe("URLError: <urlopen error getaddrinfo ENOTFOUND openrouter.ai>");
    expect(c.fetched).toBe(now); // staleness is visible: the fetch time is not bumped
  });

  it("HTTP error labels and no-cache fallback", async () => {
    const { cacheDir, cfg } = setup();
    const bad: FetchFn = async () => ({ ok: false, status: 503, statusText: "Service Unavailable", json: async () => ({}) });
    expect(await fetchOpenRouter(cfg, { cacheDir, fetchFn: bad })).toEqual([{}, "unavailable (HTTPError)"]);
    expect(await fetchOpenRouter(cfg, { cacheDir, fetchFn: down })).toEqual([{}, "unavailable (URLError)"]);
  });

  it("corrupt cache while offline degrades to unavailable, never throws", async () => {
    const { cacheDir, cfg } = setup();
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(join(cacheDir, "pricing-cache.json"), "{not json");
    expect(await fetchOpenRouter(cfg, { cacheDir, fetchFn: down })).toEqual([{}, "unavailable (URLError)"]);
  });

  it("pinned catalogue is read as-is and fetch is never called", async () => {
    const { dir, cacheDir, cfg } = setup();
    const pin = join(dir, "pin.json");
    fs.writeFileSync(pin, JSON.stringify({ models: { "p/q": { prompt: "9" } } }));
    const boom: FetchFn = async () => { throw new Error("network must not be used"); };
    expect(await fetchCatalog(cfg, { cacheDir, fetchFn: boom, env: { LLM_TELEMETRY_CATALOG: pin } }))
      .toEqual([{ "p/q": { prompt: "9" } }, "pinned"]);
  });

  it("matches Python on the same cache file: fresh -> cache, same models", async () => {
    const { dir, reports, cacheDir, cfg } = setup();
    const now = Date.now() / 1000;
    await fetchCatalog(cfg, { cacheDir, fetchFn: both, now, env: {} });
    // Python reads its own reports dir: seed it with a copy (test-side only).
    fs.mkdirSync(reports, { recursive: true });
    for (const f of fs.readdirSync(cacheDir)) fs.copyFileSync(join(cacheDir, f), join(reports, f));
    const py = resolvePython(process.cwd());
    if (py === null) throw new Error("no python");
    const env: NodeJS.ProcessEnv = {
      PATH: process.env["PATH"], HOME: join(dir, "home"),
      LLM_TELEMETRY_CONFIG: join(dir, "config.json"), LLM_TELEMETRY_AGENT_HOME: join(dir, "agent"),
    };
    // A fresh cache means Python makes no network call either.
    const res = spawnSync(py, ["-I", "-c",
      "import json,sys;from llm_telemetry import pricing;sys.stdout.write(json.dumps(pricing.fetch_catalog()))"],
    { encoding: "utf8", env, timeout: 60_000 });
    if (res.status !== 0) throw new Error(res.stderr);
    const [models, src] = JSON.parse(res.stdout) as [Record<string, unknown>, string];
    expect(src).toBe("cache");
    expect(models).toEqual((await fetchCatalog(cfg, { cacheDir, fetchFn: both, now: now + 5, env: {} }))[0]);
  });

  it("a fresh cache without `models` is refetched like Python's KeyError path", async () => {
    const { cacheDir, cfg } = setup();
    const now = Date.now() / 1000;
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(join(cacheDir, "pricing-cache.json"), JSON.stringify({ fetched: now, status: "ok" }));
    const [models, src] = await fetchOpenRouter(cfg, { cacheDir, fetchFn: ok(OR), now });
    expect(src).toBe("live");
    expect(models).toEqual({ "a/b": { prompt: "1", completion: "2" }, "c/d": {} });
  });

  it("error labels: TimeoutError, JSONDecodeError, KeyError 'id' with no cache", async () => {
    const { cacheDir, cfg } = setup();
    const timeout: FetchFn = async () => { throw new DOMException("timed out", "TimeoutError"); };
    const badJson: FetchFn = async () => ({
      ok: true, status: 200, statusText: "OK", json: async () => { throw new SyntaxError("Unexpected token"); },
    });
    const noId = ok({ data: [{ pricing: {} }] });
    expect((await fetchOpenRouter(cfg, { cacheDir, fetchFn: timeout }))[1]).toBe("unavailable (TimeoutError)");
    expect((await fetchOpenRouter(cfg, { cacheDir, fetchFn: badJson }))[1]).toBe("unavailable (JSONDecodeError)");
    expect(await fetchOpenRouter(cfg, { cacheDir, fetchFn: noId })).toEqual([{}, "unavailable (KeyError)"]);
  });

  it("Nous: stale fallback keeps models, no cache is unavailable", async () => {
    const { cacheDir, cfg } = setup();
    const now = Date.now() / 1000;
    expect(await fetchNous(cfg, { cacheDir, fetchFn: down, now })).toEqual([{}, "unavailable (URLError)"]);
    expect((await fetchNous(cfg, { cacheDir, fetchFn: ok(NOUS), now }))[1]).toBe("live");
    const [models, src] = await fetchNous(cfg, { cacheDir, fetchFn: down, now: now + 8 * 3600 });
    expect(src).toBe("stale (URLError)");
    expect(models).toMatchObject({ "nous:x": { prompt: "3" }, "nous:x-dated": { prompt: "3" } });
    const c = JSON.parse(fs.readFileSync(join(cacheDir, "nous-pricing-cache.json"), "utf8"));
    expect(c).toMatchObject({ status: "stale", last_error: expect.stringContaining("URLError") });
  });

  it("never writes into cfg.reports_dir (single-writer rule), leaves no .tmp", async () => {
    const { reports, cacheDir, cfg } = setup();
    await expect(fetchOpenRouter(cfg, { cacheDir: reports, fetchFn: ok(OR) })).rejects.toThrow(/single-writer/);
    await expect(fetchCatalog(cfg, { cacheDir: reports, fetchFn: both, env: {} })).rejects.toThrow(/single-writer/);
    expect(fs.existsSync(reports)).toBe(false);
    await fetchCatalog(cfg, { cacheDir, fetchFn: both, env: {} });
    expect(fs.readdirSync(cacheDir).sort()).toEqual(["nous-pricing-cache.json", "pricing-cache.json"]);
  });
});
