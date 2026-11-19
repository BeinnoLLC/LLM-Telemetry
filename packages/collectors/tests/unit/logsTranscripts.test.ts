import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import { inputsConfig } from "../../parity/cases.js";
import { resolvePython } from "../../parity/pythonProducer.js";
import { collect, collectLogs } from "../../src/collectLogs.js";
import { collectTranscripts, messagesFor } from "../../src/collectTranscripts.js";
import { makeTmpDir } from "./helpers.js";

let inputs = "";
let dbPath = "";

beforeAll(() => {
  inputs = makeTmpDir("logs-fixture-");
  const py = resolvePython(process.cwd());
  if (py === null) throw new Error("no python");
  const res = spawnSync(py, ["parity/py/make_logs_fixture.py", inputs], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(res.stderr);
  dbPath = join(inputs, "agent", "profiles", "alpha", "state.db");
});

const open = (): DatabaseSync => new DatabaseSync(dbPath, { readOnly: true });

describe("collect_logs", () => {
  it("caps the event list but counts facets over the full window", () => {
    const con = open();
    const p = collect(con, { cfg: inputsConfig(inputs), cap: 10, profile: "alpha" })!;
    con.close();
    expect(p["capped"]).toBe(true);
    expect((p["events"] as unknown[]).length).toBe(10 + (p["errors_shown"] as number));
    const sess = (p["facets"] as Record<string, Array<{ v: string; n: number }>>)["session"]!;
    expect(sess[0]).toMatchObject({ v: "s-live", n: 221 });
  });
  it("merges errors.log failures as level 'error', newest first", () => {
    const con = open();
    const p = collect(con, { cfg: inputsConfig(inputs), profile: "alpha" })!;
    con.close();
    const events = p["events"] as Array<{ ts: number; level: string; role: string }>;
    expect(events.filter((e) => e.level === "error").length).toBe(p["errors_shown"]);
    for (let i = 1; i < events.length; i++) expect(events[i - 1]!.ts).toBeGreaterThanOrEqual(events[i]!.ts);
  });
  it("preview is capped at 120 code points", () => {
    const con = open();
    const p = collect(con, { cfg: inputsConfig(inputs), profile: "alpha" })!;
    con.close();
    const long = (p["events"] as Array<{ preview: string }>).find((e) => e.preview.startsWith("xxxx"))!;
    expect(Array.from(long.preview).length).toBe(120);
  });
  it("a database without a messages table yields null", () => {
    const con = new DatabaseSync(":memory:");
    expect(collect(con, { cfg: inputsConfig(inputs) })).toBeNull();
    con.close();
  });
  it("collectLogs stamps and keys profiles", () => {
    const out = collectLogs({ cfg: inputsConfig(inputs) });
    expect(out["schema_version"]).toBe(3);
    expect(Object.keys(out["profiles"] as object)).toContain("alpha");
  });
});

describe("collect_transcripts", () => {
  it("windows the newest messages oldest-first and skips inactive rows", () => {
    const con = open();
    const msgs = messagesFor(con, "s-live", 200);
    con.close();
    expect(msgs.length).toBe(200);
    expect(msgs.some((m) => m["content"] === "inactive row")).toBe(false);
    const ids = msgs.map((m) => m["id"] as number);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });
  it("parses tool_calls JSON and keeps unparseable text verbatim", () => {
    const con = open();
    const msgs = messagesFor(con, "s-live", 400);
    con.close();
    expect(msgs.some((m) => Array.isArray(m["tool_calls"]))).toBe(true);
    expect(msgs.some((m) => m["tool_calls"] === "not json {")).toBe(true);
  });
  it("only live sessions with messages appear", () => {
    const out = collectTranscripts({ cfg: inputsConfig(inputs) });
    const alpha = (out["profiles"] as Record<string, Record<string, unknown[]>>)["alpha"]!;
    expect(Object.keys(alpha)).toEqual(["s-live"]);
    expect(out["window"]).toBe(200);
  });
});
