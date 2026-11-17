import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { inputsConfig } from "../../parity/cases.js";
import { resolvePython } from "../../parity/pythonProducer.js";
import {
  collectProbe, collectProbeAsync, discover, probe, ProbeError, shortLabel,
  type CapsCache, type HostEnv, type Transport,
} from "../../src/collectProbe.js";
import { makeTmpDir } from "./helpers.js";

let inputs = "";
type Canned = {
  local_ips: string[]; primary_ips: string[]; load: Record<string, unknown>;
  responses: Record<string, { body: string; ms: number } | { error: { reason: string; url_error: boolean } }>;
  caps: Record<string, string[]>;
};
let canned: Canned;
let env: HostEnv;
let transport: Transport;
let gets: string[] = [];
let capsCalls: string[] = [];

beforeAll(() => {
  inputs = makeTmpDir("probe-fixture-");
  const py = resolvePython(process.cwd());
  if (py === null) throw new Error("no python");
  const res = spawnSync(py, ["parity/py/make_probe_fixture.py", inputs], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(res.stderr);
  canned = JSON.parse(readFileSync(join(inputs, "probe-canned.json"), "utf8")) as Canned;
  env = { localIps: () => canned.local_ips, primaryIps: () => canned.primary_ips, machineLoad: () => canned.load };
  transport = {
    get: (url) => {
      gets.push(url);
      const r = canned.responses[url];
      if (!r) throw new ProbeError("no canned response");
      if ("error" in r) throw new ProbeError(r.error.reason, r.error.url_error);
      return r;
    },
    caps: (_b, model) => { capsCalls.push(model); return canned.caps[model] ?? []; },
  };
});

const run = <T>(g: Generator<{ op: string; url?: string; base?: string; model?: string }, T, unknown>): T => {
  let step = g.next();
  while (!step.done) {
    const r = step.value;
    let val: unknown;
    try {
      val = r.op === "get" ? transport.get(r.url as string) : transport.caps(r.base as string, r.model as string);
    } catch (e) {
      step = g.throw(e);
      continue;
    }
    step = g.next(val);
  }
  return step.value;
};

describe("discover", () => {
  it("matches Python: loopback expands to LAN spellings, non-local URLs are skipped", () => {
    const got = discover(inputsConfig(inputs), env);
    const py = resolvePython(process.cwd()) as string;
    const code = "import os,sys,json\nos.environ['HOME']=sys.argv[1]+'/home'\nos.environ['LLM_TELEMETRY_CONFIG']=sys.argv[1]+'/config.json'\n" +
      "os.environ['LLM_TELEMETRY_AGENT_HOME']=sys.argv[1]+'/agent'\nfrom llm_telemetry import probe_hosts as P\n" +
      "c=json.load(open(sys.argv[1]+'/probe-canned.json'))\nclass O(set):\n  def __iter__(s): return iter(c['local_ips'])\n" +
      "P.local_ips=lambda:O(c['local_ips'])\nprint(json.dumps(P.discover()))\n";
    const res = spawnSync(py, ["-I", "-c", code, inputs], { encoding: "utf8" });
    expect(res.status, res.stderr).toBe(0);
    expect(got).toEqual(JSON.parse(res.stdout) as string[]);
    expect(got).toContain("http://192.168.1.50:11434");
    expect(got.some((u) => u.includes("openai"))).toBe(false);
  });
});

describe("probe()", () => {
  it("a refused connection reports the URLError reason and nothing else", () => {
    const e = run(probe("http://192.168.1.13:11434", {}, 1000));
    expect(e).toMatchObject({ up: false, err: "[Errno 111] Connection refused", ms: null, loaded: [] });
  });
  it("a failing /api/ps keeps up=true and records 'ps: ...'; tags are still read", () => {
    const e = run(probe("http://192.168.1.12:11434", {}, 1000));
    expect(e.up).toBe(true);
    expect(e.err).toBe("ps: <urlopen error timed out>");
    expect(e.installed).toBe(1);
    expect(e.fp).toBe("other:7b");
  });
  it("round() is banker's rounding and res is vram share", () => {
    const e = run(probe("http://ollama-lan.local:11434", {}, 1000));
    expect(e.ms).toBe(450); // 450.5 -> even
    expect(e.loaded[0]).toMatchObject({ res: 46, caps: ["completion", "tools"] });
    expect(e.loaded[1]).toMatchObject({ name: "unnamed:latest", res: 0 });
    expect(e.catalog.map((c) => c["name"])).toEqual(["qwen3-coder:30b", "llama3:latest", "tiny:1b"]);
  });
  it("capabilities are cached for 24h and refetched when stale", () => {
    const cache: CapsCache = {};
    capsCalls = [];
    run(probe("http://192.168.1.11:11434", cache, 1000));
    expect(capsCalls).toEqual(["qwen3-coder:30b", ""]);
    capsCalls = [];
    run(probe("http://192.168.1.11:11434", cache, 1000 + 3600));
    expect(capsCalls).toEqual([]);
    run(probe("http://192.168.1.11:11434", cache, 1000 + 25 * 3600));
    expect(capsCalls.length).toBe(2);
  });
});

describe("grouping", () => {
  it("collapses alias spellings, folds this box into one card, drops the phantom LAN twin", () => {
    gets = [];
    const out = collectProbe({ cfg: inputsConfig(inputs), env, transport, now: new Date(1_800_000_000_000) });
    const hosts = out["hosts"] as Array<{ label: string; up: boolean; urls: unknown[]; is_self: boolean }>;
    expect(out["endpoints"]).toBe(8);
    expect(hosts.map((h) => h.label)).toEqual(["192.168.1.11", "192.168.1.12", "192.168.1.50", "192.168.1.13", "gpu-box"]);
    expect(hosts.find((h) => h.label === "192.168.1.50")).toMatchObject({ is_self: true, up: true });
    expect(hosts[0]!.urls.length).toBe(2);
    expect(out["schema_version"]).toBe(3);
  });
  it("shortLabel prefers the primary LAN IP, then a non-loopback IP, then the hostname", () => {
    const mine = new Set(canned.local_ips);
    expect(shortLabel([{ base: "http://172.17.0.1:11434", ms: 1, up: true }, { base: "http://192.168.1.50:11434", ms: 2, up: true }], mine, env)).toBe("192.168.1.50");
    expect(shortLabel([{ base: "http://10.1.2.3:11434", ms: 1, up: true }], new Set(), env)).toBe("10.1.2.3");
    expect(shortLabel([{ base: "http://gpu-box.lan:8080", ms: null, up: false }], new Set(), env)).toBe("gpu-box");
  });
  it("the async driver gives the same answer as the sync one", async () => {
    const a = collectProbe({ cfg: inputsConfig(inputs), env, transport, now: new Date(1_800_000_000_000) });
    const b = await collectProbeAsync({
      cfg: inputsConfig(inputs), env, now: new Date(1_800_000_000_000),
      transport: { get: async (u) => transport.get(u), caps: async (bs, m) => transport.caps(bs, m) },
    });
    expect(b).toEqual(a);
  });
});
