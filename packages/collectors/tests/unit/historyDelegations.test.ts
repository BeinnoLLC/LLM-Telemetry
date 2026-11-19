import * as fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as bh from "../../src/bandwidthHistory.js";
import { collect, summarize, type DelegationRow } from "../../src/delegations.js";
import { makeTmpDir } from "./helpers.js";
import { pyCall } from "./pyOracle.js";

const dayStr = (back: number): string => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
const TODAY = dayStr(0);

const fresh = (extra: Record<string, unknown> = {}) => ({
  date: dayStr(2), provider: "openai", model: "gpt-é", up_bytes: 10, down_bytes: 20,
  lan_up_bytes: 1, lan_down_bytes: 2, inp: 5, outp: 6, cread: 7, cwrite: 8, calls: 2, ...extra,
});
const ROWS = [
  fresh(), fresh({ calls: 3, up_bytes: 1.9 }), fresh({ date: TODAY }), fresh({ date: dayStr(1), model: null, provider: "" }),
];

describe("bandwidth_history parity with Python", () => {
  it("rollup", () => {
    expect(bh.rollup("p1", ROWS)).toEqual(pyCall("bandwidth_history", "rollup", ["p1", ROWS]));
  });

  it("merge: frozen wins, open days recompute, stale open day freezes", () => {
    const existing = [
      { profile: "p1", date: dayStr(2), provider: "openai", model: "gpt-é", calls: 99, frozen: true, bytes_per_token: 4.0 },
      { profile: "p1", date: dayStr(5), provider: "a", model: "b", calls: 1, frozen: false },
    ];
    const fr = bh.rollup("p1", ROWS);
    expect(bh.merge(existing, fr, TODAY)).toEqual(pyCall("bandwidth_history", "merge", [existing, fr, TODAY]));
  });

  it("update writes a byte-identical ledger and returns the same grouping", () => {
    const nd = makeTmpDir("bh-node-");
    const pd = makeTmpDir("bh-py-");
    const per = { p1: ROWS, p2: [fresh({ model: "z" })] };
    for (let i = 0; i < 2; i++) { // second pass exercises load() of the frozen ledger
      const got = bh.update(nd, per, TODAY);
      const want = pyCall("bandwidth_history", "update", [pd, per, TODAY]);
      expect(got).toEqual(want);
      expect(fs.readFileSync(join(nd, bh.LEDGER_NAME), "utf8")).toBe(fs.readFileSync(join(pd, bh.LEDGER_NAME), "utf8"));
    }
  });

  it("load backs up a stale schema version like Python", () => {
    const d = makeTmpDir("bh-old-");
    const p = join(d, bh.LEDGER_NAME);
    fs.writeFileSync(p, JSON.stringify({ schema_version: 1, rows: [{ a: 1 }] }));
    expect(bh.load(p)).toEqual([]);
    expect(fs.existsSync(`${p}.v1.bak`)).toBe(true);
    expect(bh.load(join(d, "nope.json"))).toEqual([]);
  });
});

const now = Date.now() / 1000;
const res = (kids: unknown[]): string => JSON.stringify({ results: kids });
const DROWS: DelegationRow[] = [
  ["d1", "completed", now - 500, now - 400, res([
    { status: "completed", model: "m-a", duration_seconds: 12.34, cost_usd: 0.123456, tokens: { input: 10, output: 5 }, exit_reason: "done", cost_status: "exact", api_calls: 3,
      tool_trace: [{ tool: "terminal", status: "ok" }, { tool: "terminal", status: "error" }, "junk", {}] },
    { status: "failed", model: "m-a", duration_seconds: 3600, cost_usd: 1, tokens: 77, failure_reason: "timeout", exit_reason: "max_iter" },
    { status: "failed", model: "m-b", duration_seconds: "7", tokens: "x" },
    { model: null, tokens: { input: null, output: "4" } },
    "not a dict",
  ]), JSON.stringify({ goal: "g".repeat(200) })],
  ["d2", "completed", now - 300, null, res([{ status: "completed", model: "m-b", duration_seconds: 0, tokens: 1.9 }]), "{bad"],
  ["d3", "failed", now - 100, now - 50, "not json", null],
  ["d4", "completed", now - 90, now - 10, JSON.stringify([1]), JSON.stringify([1])],
  ["d5", "completed", now - 20, now - 5, res([{ status: "completed", model: "m-b", duration_seconds: 1, exit_reason: "done" }]), null],
];

describe("delegations parity with Python", () => {
  it("summarize matches field by field", () => {
    expect(summarize(DROWS)).toEqual(pyCall("delegations", "summarize", [DROWS]));
  });
  it("no children -> null", () => {
    expect(summarize([DROWS[2] as DelegationRow])).toBeNull();
    expect(pyCall("delegations", "summarize", [[DROWS[2]]])).toBeNull();
  });
  it("collect reads async_delegations, null when the table is missing", () => {
    const db = new DatabaseSync(":memory:");
    expect(collect(db)).toBeNull();
    db.exec("create table async_delegations (delegation_id, state, dispatched_at, completed_at, result_json, task_json)");
    const ins = db.prepare("insert into async_delegations values (?,?,?,?,?,?)");
    for (const r of DROWS) ins.run(...(r as [string, string, number, number | null, string, string | null]));
    expect(collect(db)).toEqual(summarize(DROWS));
    db.close();
  });
});
