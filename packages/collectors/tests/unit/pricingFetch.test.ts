import * as fs from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { load } from "../../src/config.js";
import { fetchCatalog, fetchOpenRouter, type FetchFn } from "../../src/pricingFetch.js";
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
  try { return { dir, reports, cfg: load(cfgPath) }; } finally {
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
    const { reports, cfg } = setup();
    const now = Date.now() / 1000;
    const [models, src] = await fetchCatalog(cfg, { fetchFn: both, now, env: {} });
    expect(src).toBe("live");
    expect(models).toEqual({
      "a/b": { prompt: "1", completion: "2" }, "c/d": {},
      "nous:x": { prompt: "3" }, "nous:x-dated": { prompt: "3" }, "nous:y": {},
    });
    const cache = JSON.parse(fs.readFileSync(join(reports, "pricing-cache.json"), "utf8"));
    expect(cache).toMatchObject({ fetched: now, status: "ok", last_error: null, ttl_s: 21600, schema_version: SCHEMA_VERSION });
    expect(Object.keys(cache)).toEqual(["fetched", "fetched_at", "source", "ttl_s", "status", "last_error", "models", "schema_version"]);
    expect(fs.existsSync(join(reports, "nous-pricing-cache.json"))).toBe(true);
  });

  it("a fresh cache is served without calling fetch; force and expiry refetch", async () => {
    const { cfg } = setup();
    const now = Date.now() / 1000;
    await fetchOpenRouter(cfg, { fetchFn: ok(OR), now });
    let calls = 0;
    const counting: FetchFn = async (...a) => { calls++; return ok(OR)(...a); };
    expect((await fetchOpenRouter(cfg, { fetchFn: counting, now: now + 60 }))[1]).toBe("cache");
    expect(calls).toBe(0);
    expect((await fetchOpenRouter(cfg, { fetchFn: counting, now: now + 60, force: true }))[1]).toBe("live");
    expect((await fetchOpenRouter(cfg, { fetchFn: counting, now: now + 7 * 3600 }))[1]).toBe("live");
    expect(calls).toBe(2);
  });

  it("network down with a cache: stale, models kept, error recorded", async () => {
    const { reports, cfg } = setup();
    const now = Date.now() / 1000;
    await fetchOpenRouter(cfg, { fetchFn: ok(OR), now });
    const [models, src] = await fetchOpenRouter(cfg, { fetchFn: down, now: now + 8 * 3600 });
    expect(src).toBe("stale (URLError)");
    expect(models).toEqual({ "a/b": { prompt: "1", completion: "2" }, "c/d": {} });
    const c = JSON.parse(fs.readFileSync(join(reports, "pricing-cache.json"), "utf8"));
    expect(c.status).toBe("stale");
    expect(c.last_error).toBe("URLError: <urlopen error getaddrinfo ENOTFOUND openrouter.ai>");
    expect(c.fetched).toBe(now); // staleness is visible: the fetch time is not bumped
  });

  it("HTTP error labels and no-cache fallback", async () => {
    const { cfg } = setup();
    const bad: FetchFn = async () => ({ ok: false, status: 503, statusText: "Service Unavailable", json: async () => ({}) });
    expect(await fetchOpenRouter(cfg, { fetchFn: bad })).toEqual([{}, "unavailable (HTTPError)"]);
    expect(await fetchOpenRouter(cfg, { fetchFn: down })).toEqual([{}, "unavailable (URLError)"]);
  });

  it("corrupt cache while offline degrades to unavailable, never throws", async () => {
    const { reports, cfg } = setup();
    fs.mkdirSync(reports, { recursive: true });
    fs.writeFileSync(join(reports, "pricing-cache.json"), "{not json");
    expect(await fetchOpenRouter(cfg, { fetchFn: down })).toEqual([{}, "unavailable (URLError)"]);
  });

  it("pinned catalogue is read as-is and fetch is never called", async () => {
    const { dir, cfg } = setup();
    const pin = join(dir, "pin.json");
    fs.writeFileSync(pin, JSON.stringify({ models: { "p/q": { prompt: "9" } } }));
    const boom: FetchFn = async () => { throw new Error("network must not be used"); };
    expect(await fetchCatalog(cfg, { fetchFn: boom, env: { LLM_TELEMETRY_CATALOG: pin } }))
      .toEqual([{ "p/q": { prompt: "9" } }, "pinned"]);
  });

  it("matches Python on the same cache file: fresh -> cache, same models", async () => {
    const { dir, cfg } = setup();
    const now = Date.now() / 1000;
    await fetchCatalog(cfg, { fetchFn: both, now, env: {} });
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
    expect(models).toEqual((await fetchCatalog(cfg, { fetchFn: both, now: now + 5, env: {} }))[0]);
  });
});
