import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { resolvePython } from "../../parity/pythonProducer.js";
import { writeArtifact } from "../../src/artifactWriter.js";
import { Config } from "../../src/config.js";
import {
  aggregate, collectRankings, collectRankingsAsync, parseTokens, window, type SyncFetcher,
} from "../../src/collectRankings.js";
import { parsePy } from "../../src/pyJson.js";
import { makeTmpDir } from "./helpers.js";
import { pyCall } from "./pyOracle.js";

let rows: Array<Record<string, unknown>> = [];
let responsePath = "";

beforeAll(() => {
  const dir = makeTmpDir("rankings-fixture-");
  const py = resolvePython(process.cwd());
  if (py === null) throw new Error("no python");
  const res = spawnSync(py, ["parity/py/make_rankings_fixture.py", dir], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(res.stderr);
  responsePath = join(dir, "rankings-response.json");
  rows = (parsePy(fs.readFileSync(responsePath, "utf8")) as { data: typeof rows }).data;
});

/** Run a Python snippet (`result` is JSON-dumped) against collect_rankings as C. */
function py(body: string): unknown {
  const p = resolvePython(process.cwd());
  const code = "import sys,json,datetime\nfrom llm_telemetry import collect_rankings as C\n" +
    body + "\nsys.stdout.write(json.dumps(result,default=str))\n";
  const res = spawnSync(p as string, ["-I", "-c", code], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(res.stderr);
  return JSON.parse(res.stdout) as unknown;
}

describe("collect_rankings pieces vs Python", () => {
  it("parse_tokens", () => {
    for (const v of ["123", " 42 ", "1_000", "+5", "-3", "abc", "", "5.0", null, true]) {
      expect(parseTokens(v), String(v)).toBe(pyCall("collect_rankings", "parse_tokens", [v]));
    }
    expect(parseTokens(parsePy("5.0"))).toBe(0); // float: str() is "5.0", int() raises
    expect(parseTokens(parsePy("5"))).toBe(5);
  });
  it("window clamps to the dataset floor", () => {
    expect(window("2026-11-17")).toEqual(["2026-10-18", "2026-11-16"]);
    expect(window("2025-01-10")).toEqual(["2025-01-01", "2025-01-09"]);
    expect(window("2025-01-01")).toEqual(["2025-01-01", "2024-12-31"]);
    expect(py("s,e=C.window(datetime.date(2025,1,10))\nresult=[str(s),str(e)]")).toEqual(window("2025-01-10"));
    expect(py("s,e=C.window(datetime.date(2025,1,1))\nresult=[str(s),str(e)]")).toEqual(window("2025-01-01"));
  });
  it("aggregate for day/week/month and an empty series", () => {
    for (const days of [1, 7, 30]) {
      expect(aggregate(rows, days), String(days)).toEqual(pyCall("collect_rankings", "aggregate", [rows, days]));
    }
    expect(aggregate([], 7)).toEqual({ days: 0, start: null, end: null, total: 0, top: [], other: null });
  });
});

describe("collect_rankings failure handling", () => {
  const fetcher: SyncFetcher = () => ({ resp: parsePy(fs.readFileSync(responsePath, "utf8")), reason: null });
  const today = "2026-11-17";
  it("no key -> unavailable, never fetches", () => {
    let called = false;
    const got = collectRankings({ today, env: {}, fetcher: () => { called = true; return { resp: null, reason: "x" }; } });
    expect(called).toBe(false);
    expect(got["status"]).toBe("unavailable");
    expect(got["reason"]).toBe("OPENROUTER_API_KEY is not set");
    const want = py("result=C.collect(today=datetime.date(2026,11,17),env={},fetcher=lambda *a:(None,'x'),previous=None)") as Record<string, unknown>;
    expect(got).toEqual(want);
  });
  it("network failure with no previous payload -> unavailable with the reason", () => {
    const got = collectRankings({ today, env: { OPENROUTER_API_KEY: "k" }, fetcher: () => ({ resp: null, reason: "HTTP 503 from OpenRouter rankings API" }) });
    expect(got["reason"]).toBe("HTTP 503 from OpenRouter rankings API");
  });
  it("a body without a data list is reported as such", () => {
    const got = collectRankings({ today, env: { OPENROUTER_API_KEY: "k" }, fetcher: () => ({ resp: { nope: 1 }, reason: null }) });
    expect(got["reason"]).toBe("response had no data list");
  });
  it("keeps the previous good payload with last_error when the refetch fails", () => {
    const good = collectRankings({ today, env: { OPENROUTER_API_KEY: "k", LLM_TELEMETRY_RANKINGS_TTL: "0" }, fetcher });
    expect(good["status"]).toBe("ok");
    const kept = collectRankings({
      today, env: { OPENROUTER_API_KEY: "k", LLM_TELEMETRY_RANKINGS_TTL: "0" }, previous: good,
      fetcher: () => ({ resp: null, reason: "boom" }),
    });
    expect(kept["status"]).toBe("ok");
    expect((kept["last_error"] as { reason: string }).reason).toBe("boom");
    expect(kept["rows"]).toEqual(good["rows"]);
  });
  it("a fresh previous payload short-circuits the fetch (TTL)", () => {
    const good = collectRankings({ today, env: { OPENROUTER_API_KEY: "k" }, fetcher });
    let called = false;
    const again = collectRankings({
      today, env: { OPENROUTER_API_KEY: "k" }, previous: good,
      fetcher: () => { called = true; return { resp: null, reason: "x" }; },
    });
    expect(called).toBe(false);
    expect(again).toBe(good);
  });
  it("async variant uses the injected fetcher and never leaks the key", async () => {
    const got = await collectRankingsAsync({
      today, env: { OPENROUTER_API_KEY: "sk-or-secret" },
      fetcher: async () => ({ resp: null, reason: "network error (URLError)" }),
    });
    expect(JSON.stringify(got)).not.toContain("sk-or-secret");
  });
});

describe("integral floats survive the writer", () => {
  it("writes 5.0 for a float read as 5.0, 5 for an int", () => {
    const dir = makeTmpDir("rankings-writer-");
    const payload = { a: parsePy("5.0"), b: parsePy("5"), c: parsePy("1e16") } as Record<string, unknown>;
    const res = writeArtifact("x.json", payload, { cfg: new Config(), outDir: dir });
    const text = fs.readFileSync(res.path, "utf8");
    expect(text).toContain('"a":5.0');
    expect(text).toContain('"b":5,');
    expect(text).toContain('"c":1e+16');
  });
});
