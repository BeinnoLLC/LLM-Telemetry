import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { inputsConfig } from "../../parity/cases.js";
import { resolvePython } from "../../parity/pythonProducer.js";
import {
  appendHistory, collectQuota, historySample, numstr, percent, scrub, text,
} from "../../src/collectQuota.js";
import { floatRepr, parsePy, pyRepr } from "../../src/pyJson.js";
import { makeTmpDir } from "./helpers.js";
import { pyCall } from "./pyOracle.js";

let inputs = "";
let payload: Record<string, unknown>;

beforeAll(() => {
  inputs = makeTmpDir("quota-fixture-");
  const py = resolvePython(process.cwd());
  if (py === null) throw new Error("no python");
  const res = spawnSync(py, ["parity/py/make_quota_fixture.py", inputs], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(res.stderr);
  payload = collectQuota({ cfg: inputsConfig(inputs) });
});

describe("pyJson", () => {
  it("floatRepr matches Python repr", () => {
    const xs = [5, 0.1, 12.5, 1500, 123.456, 1e15, 1e16, 1.5e16, 1e-4, 1e-5, 1.5e-7, -2.5, 0, 100.25, 123456789012345680];
    const py = resolvePython(process.cwd());
    const res = spawnSync(py as string, ["-I", "-c", "import sys,json\nfor x in json.load(sys.stdin): print(repr(float(x)))"],
      { input: JSON.stringify(xs), encoding: "utf8" });
    const want = res.stdout.trim().split("\n");
    xs.forEach((x, i) => expect(floatRepr(x), String(x)).toBe(want[i]));
  });
  it("parsePy keeps integral floats distinguishable", () => {
    const v = parsePy('{"a":5,"b":5.0,"c":1e3,"d":2.5}') as Record<string, unknown>;
    expect(pyRepr(v["a"])).toBe("5");
    expect(pyRepr(v["b"])).toBe("5.0");
    expect(pyRepr(v["c"])).toBe("1000.0");
    expect(pyRepr(v["d"])).toBe("2.5");
  });
});

describe("collect_quota helpers vs the Python oracle", () => {
  const strings = [
    "plain", "sk-abcdefgh1234", "ghp_abcdefghijklmnopqrstu", "Bearer abcdefgh.12-3", "BEARER abcdefghij",
    "api-key: hunter2", "Password=xyz tail", "secret :  s3", "x".repeat(40), "y".repeat(41) + " z", "é".repeat(500),
    "no bearer here", "xbearer abcdefghij",
  ];
  it("scrub agrees", () => {
    for (const s of strings) expect(scrub(s), s.slice(0, 30)).toBe(pyCall("collect_quota", "scrub", [s]));
    expect(scrub(5)).toBeNull();
  });
  const vals: unknown[] = [null, "", "abc", 0, 5, 2.5, true, false, "93.5", " 7 ", "nan", [], {}, "1_0", "1e2"];
  it("_percent agrees", () => {
    for (const v of vals) {
      const want = pyCall("collect_quota", "_percent", [v]);
      const got = percent(v);
      expect(got, JSON.stringify(v)).toBe(want);
    }
  });
  it("_numstr agrees", () => {
    for (const v of [null, "", "12.50", 0, 5, 2.5, true, [], {}, "x".repeat(41)]) {
      expect(numstr(v), JSON.stringify(v)).toBe(pyCall("collect_quota", "_numstr", [v]));
    }
  });
  it("_text agrees", () => {
    for (const v of [null, "", "a", 5, 2.5, true, ["a", 1], { k: "v" }, "sk-abcdefgh1234"]) {
      expect(text(v), JSON.stringify(v)).toBe(pyCall("collect_quota", "_text", [v]));
    }
  });
});

describe("collect_quota payload", () => {
  type Prof = { providers: Record<string, { details: string[]; attention: boolean; accounts: Array<{ id: string }> }>; note: string | null };
  const profiles = (): Record<string, Prof> => payload["profiles"] as Record<string, Prof>;
  const alpha = (): Prof => profiles()["alpha"] as Prof;
  it("drops credential fields and scrubs free text", () => {
    const t = JSON.stringify(payload);
    for (const secret of ["SECRET", "ant-api03", "sk-live", "ghp_", "abcdefghijklmnop123", "refresh_token"]) {
      expect(t).not.toContain(secret);
    }
    expect(alpha().providers["anthropic"]!.details).toContain("Authorization: [REDACTED]");
  });
  it("orders accounts by priority, unset last, stable", () => {
    expect(alpha().providers["anthropic"]!.accounts.map((a) => a.id))
      .toEqual(["acct-a", "acct-e", "acct-b", "acct-c", "acct-d"]);
  });
  it("marks attention at the 90% threshold and counts spent accounts", () => {
    expect(alpha().providers["openrouter"]!.attention).toBe(true);
    const s = payload["summary"] as Record<string, number>;
    expect(s["accounts_spent"]).toBe(2);
  });
  it("missing and unparseable caches degrade to a note", () => {
    const p = profiles();
    expect(p["beta-bot"]!.note).toBe("no-quota-cache");
    expect(p["delta"]!.note).toBe("no-quota-cache");
    expect(p["gamma"]!.note).toBe("no-providers");
  });
});

describe("quota history ledger", () => {
  it("matches Python append_history, prunes by age and count", () => {
    const dir = makeTmpDir("quota-hist-");
    const now = 1_800_000_000;
    const seed = { samples: [
      { t: now - 40 * 86400, providers: {} }, { t: now - 100, providers: { a: 1 } }, "junk", { t: "x" },
    ] };
    const sample = historySample(now, payload);
    fs.writeFileSync(join(dir, "node.json"), JSON.stringify(seed));
    fs.writeFileSync(join(dir, "py.json"), JSON.stringify(seed));
    const kept = appendHistory(join(dir, "node.json"), sample, now);
    pyCall("collect_quota", "append_history", [join(dir, "py.json"), sample, now]);
    expect(kept).toBe(2);
    expect(JSON.parse(fs.readFileSync(join(dir, "node.json"), "utf8"))).toEqual(
      JSON.parse(fs.readFileSync(join(dir, "py.json"), "utf8")));
  });
  it("caps the ledger at 900 samples", () => {
    const dir = makeTmpDir("quota-cap-");
    const now = 1_800_000_000;
    const samples = Array.from({ length: 905 }, (_, i) => ({ t: now - 10 + i * 0.001, providers: {} }));
    fs.writeFileSync(join(dir, "l.json"), JSON.stringify({ samples }));
    expect(appendHistory(join(dir, "l.json"), null, now)).toBe(900);
  });
  it("no providers means no sample", () => {
    expect(historySample(1, { profiles: { a: { providers: {} } } })).toBeNull();
  });
});
