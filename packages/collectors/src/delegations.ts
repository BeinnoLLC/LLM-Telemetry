/** Port of `delegations.py`: per-CHILD outcomes of `delegate_task` fan-outs,
 * from `async_delegations.result_json` (measured, not inferred). */

import type { DatabaseSync } from "node:sqlite";
import { pyFloatOr0, pyRound, pySlice } from "./pySemantics.js";
import { cmpStr } from "./pySort.js";

export const OK_STATUS = "completed";

/** (delegation_id, state, dispatched_at, completed_at, result_json, task_json) */
export type DelegationRow = [unknown, unknown, number | null, number | null, string | null, string | null];

type Entry = Record<string, unknown>;
const isDict = (v: unknown): v is Entry => typeof v === "object" && v !== null && !Array.isArray(v);

/** Python `int(x or 0)` for the shapes JSON can carry; unparseable -> throws. */
function intOr0(v: unknown): number {
  if (!v) return 0;
  if (typeof v === "string") {
    if (!/^\s*[+-]?\d+\s*$/u.test(v)) throw new TypeError(`int(): ${v}`);
    return Number(v);
  }
  return Math.trunc(Number(v));
}

function tokensOf(entry: Entry): number {
  const tk = entry["tokens"];
  if (isDict(tk)) return intOr0(tk["input"]) + intOr0(tk["output"]);
  try {
    return intOr0(tk);
  } catch {
    return 0;
  }
}

function children(resultJson: string | null): Entry[] {
  if (!resultJson) return [];
  let doc: unknown;
  try {
    doc = JSON.parse(resultJson);
  } catch {
    return [];
  }
  if (!isDict(doc)) return [];
  const results = doc["results"];
  return Array.isArray(results) ? results.filter(isDict) : [];
}

const orStr = (v: unknown, d: string): string => (v ? String(v) : d);

export function summarize(rows: Iterable<DelegationRow>) {
  const byModel = new Map<string, { model: string; n: number; ok: number; cost_usd: number; tokens: number; seconds: number; wasted_s: number }>();
  const reasons = new Map<string, number>();
  const exits = new Map<string, number>();
  const tools = new Map<string, { tool: string; calls: number; fail: number }>();
  const recent: Array<Record<string, unknown> & { at: number | null }> = [];
  let n = 0;
  let ok = 0;
  let wastedS = 0;
  let totalCost = 0;

  for (const [did, , dispAt, compAt, resultJson, taskJson] of rows) {
    let goal = "";
    if (taskJson) {
      try {
        const t: unknown = JSON.parse(taskJson);
        goal = isDict(t) ? String(t["goal"] || "") : "";
      } catch {
        goal = "";
      }
    }
    for (const entry of children(resultJson)) {
      n += 1;
      const status = orStr(entry["status"], "unknown");
      const good = status === OK_STATUS;
      if (good) ok += 1;
      const model = orStr(entry["model"], "(unknown)");
      const dur = pyFloatOr0(entry["duration_seconds"]);
      const cost = pyFloatOr0(entry["cost_usd"]);
      totalCost += cost;
      if (!good) wastedS += dur;

      let m = byModel.get(model);
      if (!m) byModel.set(model, (m = { model, n: 0, ok: 0, cost_usd: 0, tokens: 0, seconds: 0, wasted_s: 0 }));
      m.n += 1;
      if (good) m.ok += 1;
      m.cost_usd += cost;
      m.tokens += tokensOf(entry);
      m.seconds += dur;
      if (!good) m.wasted_s += dur;

      if (!good) {
        const why = orStr(entry["failure_reason"] || entry["exit_reason"], status);
        reasons.set(why, (reasons.get(why) ?? 0) + 1);
      }
      const ex = orStr(entry["exit_reason"], "unknown");
      exits.set(ex, (exits.get(ex) ?? 0) + 1);

      const trace = entry["tool_trace"];
      for (const call of Array.isArray(trace) ? trace : []) {
        if (!isDict(call)) continue;
        const name = orStr(call["tool"], "(unknown)");
        let t = tools.get(name);
        if (!t) tools.set(name, (t = { tool: name, calls: 0, fail: 0 }));
        t.calls += 1;
        if (call["status"] !== "ok") t.fail += 1;
      }

      recent.push({
        id: did,
        goal: pySlice(goal, 0, 160),
        status,
        model,
        failure_reason: entry["failure_reason"] ?? null,
        exit_reason: entry["exit_reason"] ?? null,
        seconds: pyRound(dur, 1),
        cost_usd: pyRound(cost, 4),
        cost_status: entry["cost_status"] ?? null,
        api_calls: entry["api_calls"] ?? null,
        at: compAt || dispAt,
      });
    }
  }
  if (!n) return null;

  const modelsOut = [...byModel.values()].map((m) => ({
    model: m.model, n: m.n, ok: m.ok, cost_usd: pyRound(m.cost_usd, 4), tokens: m.tokens,
    rate: pyRound((100.0 * m.ok) / m.n, 1),
    hours: pyRound(m.seconds / 3600.0, 2),
    wasted_hours: pyRound(m.wasted_s / 3600.0, 2),
  }));
  const toolsOut = [...tools.values()].map((t) => ({
    ...t, rate: pyRound((100.0 * (t.calls - t.fail)) / t.calls, 1),
  }));
  const countDesc = (m: Map<string, number>): Record<string, number> =>
    Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
  recent.sort((a, b) => (b.at || 0) - (a.at || 0));

  return {
    children: n,
    ok,
    failed: n - ok,
    rate: pyRound((100.0 * ok) / n, 1),
    wasted_hours: pyRound(wastedS / 3600.0, 2),
    cost_usd: pyRound(totalCost, 4),
    by_model: modelsOut.sort((a, b) => b.n - a.n || cmpStr(a.model, b.model)),
    reasons: countDesc(reasons),
    exits: countDesc(exits),
    tools: toolsOut.sort((a, b) => b.calls - a.calls),
    tools_measured: true,
    recent: recent.slice(0, 40),
  };
}

export const SQL = `
select delegation_id, state, dispatched_at, completed_at, result_json, task_json
  from async_delegations
`;

/** Read one profile's state.db -> payload, or null (no table / no rows). */
export function collect(db: DatabaseSync) {
  let rows: DelegationRow[];
  try {
    rows = db.prepare(SQL).all().map((r) => Object.values(r) as DelegationRow);
  } catch (e) {
    if (String((e as Error).message).toLowerCase().includes("no such table")) return null;
    throw e;
  }
  return summarize(rows);
}
