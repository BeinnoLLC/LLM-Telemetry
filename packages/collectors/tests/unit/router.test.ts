import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { inputsConfig } from "../../parity/cases.js";
import { resolvePython } from "../../parity/pythonProducer.js";
import {
  collectRouter, decisions, localTimestamp, provOf, routesFor, safeLabel, safeSource,
} from "../../src/collectRouter.js";
import { Config } from "../../src/config.js";
import { pyCall } from "./pyOracle.js";
import { makeTmpDir } from "./helpers.js";

let inputs = "";
let payload: Record<string, unknown>;

beforeAll(() => {
  inputs = makeTmpDir("router-fixture-");
  const py = resolvePython(process.cwd());
  if (py === null) throw new Error("no python");
  const res = spawnSync(py, ["parity/py/make_router_fixture.py", inputs], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(res.stderr);
  payload = collectRouter({ cfg: inputsConfig(inputs) });
});

describe("collect_router helpers vs the Python oracle", () => {
  const labels = [
    "dev@example.com", "ANTHROPIC_API_KEY", "Team Account", "or-1234567890abcdef1234567890ab",
    "x".repeat(41), "weird/label!", "", null, "a@b", "ünï cödé", "key 1",
  ];
  it("_safe_label agrees", () => {
    for (const l of labels) expect(safeLabel(l), String(l)).toBe(pyCall("collect_router", "_safe_label", [l]));
  });
  const sources = ["env:ANTHROPIC_API_KEY", "env:bad name", "env:", "manual", "oauth:claude", "Has Caps", "", null, "a".repeat(25)];
  it("_safe_source agrees", () => {
    for (const s of sources) expect(safeSource(s), String(s)).toBe(pyCall("collect_router", "_safe_source", [s]));
  });
  it("prov_of agrees", () => {
    const cfg = new Config();
    const cases: [string | null, string | null, string | null][] = [
      ["custom", "x", "https://api.anthropic.com/v1"], ["custom", "x", "http://192.168.1.5:11434"],
      ["ollama-cloud", null, null], ["ollama-lan", "llama3", null], ["openrouter", "m", ""],
      ["custom", "qwen3", null], [null, null, null], ["  OpenAI ", "gpt", "https://chatgpt.com/x"],
    ];
    for (const [p, m, u] of cases) {
      expect(provOf(p, m, u, cfg), JSON.stringify([p, m, u])).toBe(pyCall("collect_router", "prov_of", [p, m, u]));
    }
  });
});

describe("collect_router pieces", () => {
  it("routes overlay ignores unknown categories, levels and tiers", () => {
    const r = routesFor({ routes: { coding: { hard: "plan", medium: "nope", ultra: "normal" }, zzz: { easy: "normal" } } });
    expect(r["coding"]).toEqual({ easy: "trivial", medium: "normal", hard: "plan" });
    expect(r["zzz"]).toBeUndefined();
  });
  it("localTimestamp rejects what strptime rejects", () => {
    expect(localTimestamp("9999-99-99 99:99:99")).toBeNull();
    expect(localTimestamp("2026-02-30 10:00:00")).toBeNull();
    expect(localTimestamp("2026-02-28 10:00:00")).toBe(new Date(2026, 1, 28, 10, 0, 0).getTime() / 1000);
  });
  it("no log directory means null decisions", () => {
    expect(decisions(makeTmpDir("no-logs-"))).toBeNull();
  });
  it("decisions aggregate the 7-day window incl. rotated logs", () => {
    const d = decisions(join(inputs, "agent", "profiles", "alpha"))!;
    expect(d.total).toBe(7);
    expect(d.escalations).toBe(1);
    expect(d.failed_open).toBe(1);
    expect(d.budget_exhausted).toBe(1);
    expect(d.classifier_failures).toEqual({ llama3: 2 });
    expect(d.recent.length).toBe(7);
    expect(d.recent[0]!.ts).toBeGreaterThan(d.recent[6]!.ts);
    expect(d.by_model["rot-model@ollama-lan"]).toBe(1);
  });
  it("never leaks a token, key or secret value", () => {
    const text = JSON.stringify(payload);
    for (const secret of ["SECRET", "LEAK", "sk-", "ya29", "fw_secret", "sk-or-v1"]) {
      expect(text).not.toContain(secret);
    }
  });
  it("derives auth kinds the way Python does", () => {
    const auth = (payload["profiles"] as Record<string, { auth: Record<string, { type: string; note: string }> }>)["alpha"]!.auth;
    expect(auth["anthropic"]!.type).toBe("mixed");
    expect(auth["gemini"]!.type).toBe("oauth");
    expect(auth["ollama-lan"]!.type).toBe("none");
    expect(auth["corp"]!.note).toBe("env:CORP_KEY (not set)");
    expect(auth["inline-key"]!.note).toBe("inline in config");
    expect(auth["fireworks"]!.note).toBe("env:FIREWORKS_API_KEY");
  });
  it("beta-bot has no tier router and no decisions", () => {
    const b = (payload["profiles"] as Record<string, Record<string, unknown>>)["beta-bot"]!;
    expect(b["tier_router"]).toBeNull();
    expect(b["decisions"]).toBeNull();
  });
});
