// LLMTELEMET-291 (T-20 RUN D1): pure ports of the data assertions in
// tests/check_live_table.js, check_live_fanout.js, check_live_models.js and
// check_agent_cost_covered.js. Expected values are the Python oracles; this
// suite never rewrites them to match the implementation. No DOM/CSS here.
import { describe, expect, it } from "vitest";

import {
  STATE_RANK,
  buildLiveRows,
  classifyState,
  costTotals,
  inFlightRows,
  liveFanouts,
  sortRows,
} from "../../lib/home/live-rows";
import type { LiveRow } from "../../lib/home/live-rows";
import type { HomeSnapshot } from "../../lib/home/types";

const home = (
  live: NonNullable<HomeSnapshot["live"]>,
  analytics: HomeSnapshot["analytics"] = null,
): HomeSnapshot => ({ analytics, live, router: null, quota: null });

const rowByKey = (rows: LiveRow[], key: string): LiveRow => {
  const found = rows.find((row) => row.key === key);
  if (!found) throw new Error(`missing row ${key}`);
  return found;
};

// check_live_table.js:24-34 — one Hermes, one PI, two Claude and one Codex.
const tableFixture = (): HomeSnapshot => home({
  profiles: {
    work: {
      live: [{
        id: "h-1", title: "Hermes job", model: "openai/gpt-5", category: "Coding",
        profile: "p1", idle_s: 20, phase: "editing", tools: ["read_file", "terminal"],
        models: [{ model: "openai/gpt-5", in_tok: 900, out_tok: 100, calls: 3 }],
      }],
    },
  },
  pi_live: [{
    session_id: "pi-1", agent: "scout", title: "Pi task", model: "glm-5",
    idle_s: 45, uptime_s: 600, phase: "reading", in_tok: 4000, out_tok: 1000,
    cost_usd: 0.0123,
  }],
  agent_live: [
    { engine: "claude", session_id: "c-1", title: "alpha", model: "claude-opus-4-5",
      idle_s: 12, uptime_s: 2400, phase: "running Bash", cost_usd: 1.5, in_tok: 100, out_tok: 50 },
    { engine: "claude", session_id: "c-2", title: "gamma", model: "claude-sonnet-4-5",
      idle_s: 300, uptime_s: 7200, phase: "idle" },
    { engine: "codex", session_id: "x-1", title: "beta", model: "gpt-5-codex",
      idle_s: 30, uptime_s: 300, phase: "waiting for approval" },
  ],
});

describe("buildLiveRows — live table row shaping", () => {
  it("merges the three sources into one keyed list and dedups by id", () => {
    // check_live_table.js:77: five sessions in -> five rows.
    const rows = buildLiveRows(tableFixture(), "work");
    expect(rows.map((row) => row.key)).toEqual([
      "h-1", "pi:pi-1", "claude:c-1", "claude:c-2", "codex:x-1",
    ]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);

    const dup = home({
      profiles: {
        work: { live: [{ id: "dup", title: "first", model: "m/one" }] },
        other: { live: [{ id: "dup", title: "second", model: "m/two" }] },
      },
      agent_live: [
        { engine: "claude", session_id: "c-1", title: "stale", idle_s: 99 },
        { engine: "claude", session_id: "c-1", title: "fresh", idle_s: 3 },
        { engine: "mystery", session_id: "c-1", title: "fallback", idle_s: 1 },
      ],
    });
    const merged = buildLiveRows(dup); // All: every profile, dedup by id
    expect(merged.filter((row) => row.key === "dup")).toHaveLength(1);
    expect(rowByKey(merged, "dup").title).toBe("first");
    // live.js:130-140: freshest engine:session wins; unknown engine -> claude.
    expect(merged.filter((row) => row.key === "claude:c-1")).toHaveLength(1);
    expect(rowByKey(merged, "claude:c-1").title).toBe("fallback");
  });

  it("ports the live.js:130-149 in-flight engine filter", () => {
    const rows = buildLiveRows(tableFixture(), "work");
    expect(inFlightRows(rows).map((row) => row.key)).toEqual([
      "h-1", "pi:pi-1", "claude:c-1", "codex:x-1",
    ]);
    // phase 'idle' PI/agent rows are not in flight (Hermes stays in the table).
    expect(rowByKey(rows, "claude:c-2").state).toBe("Idle");
    expect(rowByKey(rows, "claude:c-2").inFlight).toBe(false);
  });

  it("ports the check_live_table.js cell values without a DOM", () => {
    const rows = buildLiveRows(tableFixture(), "work");
    const c1 = rowByKey(rows, "claude:c-1");
    const pi = rowByKey(rows, "pi:pi-1");
    const hm = rowByKey(rows, "h-1");
    expect([c1.title, c1.model]).toEqual(["alpha", "claude-opus-4-5"]);
    expect([c1.state, c1.tokens, c1.costUsd, c1.elapsedS]).toEqual(["Running", 150, 1.5, 2400]);
    expect(rowByKey(rows, "codex:x-1").state).toBe("Waiting");
    expect(rowByKey(rows, "claude:c-2").state).toBe("Idle");
    expect([pi.elapsedS, pi.tokens, pi.costUsd, pi.model]).toEqual([600, 5000, 0.0123, "glm-5"]);
    expect([hm.tokens, hm.tools, hm.elapsedS]).toEqual([1000, ["read_file", "terminal"], null]);
    // Missing values are null, never a fabricated zero.
    expect(rowByKey(rows, "claude:c-2").tokens).toBeNull();
    expect(rowByKey(rows, "claude:c-2").costUsd).toBeNull();
    expect(rowByKey(rows, "codex:x-1").tokens).toBeNull();
    expect(rowByKey(rows, "codex:x-1").elapsedS).toBe(300);
    // short() keeps whole names; no letters or glyph proxies.
    expect(rows.map((row) => row.model)).toEqual([
      "gpt-5", "glm-5", "claude-opus-4-5", "claude-sonnet-4-5", "gpt-5-codex",
    ]);
  });

  it("classifies compression, waiting and idle states (live.js:360-369)", () => {
    expect(classifyState("hermes", "compressing", 10)).toBe("Compressing");
    expect(classifyState("hermes", "compression completed", 10)).toBe("Running");
    expect(classifyState("hermes", "editing", 121)).toBe("Idle");
    expect(classifyState("pi", "waiting for approval", 12)).toBe("Waiting");
    expect(classifyState("codex", "blocked on input", 12)).toBe("Waiting");
    expect(classifyState("claude", "idle", 300)).toBe("Idle");
    expect(classifyState("claude", "running Bash", 12)).toBe("Running");
    expect(STATE_RANK).toEqual({ Running: 0, Compressing: 1, Waiting: 2, Idle: 3 });
  });

  it("resolves fan-out parents from recent_sessions titles (check_live_fanout.js)", () => {
    const fixture = home({
      profiles: {
        work: {
          live: [
            { id: "child-1", parent: "sess_fanout_parent", title: "one", model: "m/one" },
            { id: "child-2", parent: "sess_fanout_parent", title: "two", model: "m/two" },
            { id: "child-3", parent: "sess_36533392", title: "three", model: "m/three" },
          ],
        },
      },
    }, {
      profiles: {
        work: {
          recent_sessions: [
            { id: "sess_fanout_parent", title: "Bulk-rename the export columns" },
            { id: "sess_36533392", title: "Single child" },
          ],
        },
      },
    });
    const fanouts = liveFanouts(buildLiveRows(fixture, "work"));
    expect(fanouts).toHaveLength(1); // 2+ children only
    expect(fanouts[0].parentId).toBe("sess_fanout_parent");
    expect(fanouts[0].parentTitle).toBe("Bulk-rename the export columns");
    expect(fanouts[0].running).toBe(2);
    expect(fanouts[0].label).toBe("Bulk-rename the export columns → 2 running");
    expect(fanouts[0].children).toEqual(["child-1", "child-2"]);
    // A live parent row wins over recent_sessions, as in live.js:586-588.
    const withParent = home({
      profiles: { work: {
        live: [
          { id: "parent", title: "Live parent title", model: "m/one" },
          { id: "a", parent: "parent", title: "a" },
          { id: "b", parent: "parent", title: "b" },
        ],
      } },
    }, {
      profiles: { work: { recent_sessions: [{ id: "parent", title: "Stored title" }] } },
    });
    expect(liveFanouts(buildLiveRows(withParent, "work"))[0].parentTitle)
      .toBe("Live parent title");
  });

  it("carries every model and helper from check_live_models.js", () => {
    const fixture = home({
      profiles: { work: { live: [{
        id: "multi", title: "Multi-model", model: "anthropic/claude-opus-5",
        nmodels: 4,
        models: [
          { model: "anthropic/claude-opus-5", main: true, tasks: ["answer"], in_tok: 1000, out_tok: 200, calls: 10 },
          { model: "openai/gpt-5-mini", tasks: ["compression"], in_tok: 300, out_tok: 20, calls: 2 },
          { model: "anthropic/claude-haiku-4-5", tasks: ["title generation"], in_tok: 80, out_tok: 20, calls: 1 },
        ],
      }] } },
    });
    const row = buildLiveRows(fixture, "work")[0];
    expect(row.nmodels).toBe(4); // payload count survives
    expect(row.modelCount).toBe(3); // badge counts every model, helpers included
    expect(row.helperCount).toBe(2); // main vs helper split
    expect(row.models.map((model) => model.name)).toEqual([
      "claude-opus-5", "gpt-5-mini", "claude-haiku-4-5",
    ]);
    expect(row.models.map((model) => model.tasks.join(", "))).toEqual([
      "answer", "compression", "title generation",
    ]);
    expect(row.tokens).toBe(1620); // in_tok + out_tok across all models
  });

  it("labels subscription costs and excludes them from totals (check_agent_cost_covered.js)", () => {
    const agents = [
      { engine: "claude", session_id: "c-1", title: "alpha", model: "claude-opus-4-5",
        idle_s: 12, phase: "running Bash", in_tok: 1500, out_tok: 2100,
        cost_usd: 123.4567, cost_class: "subscription" },
      { engine: "codex", session_id: "x-1", title: "beta", model: "gpt-5.3-codex",
        idle_s: 30, phase: "thinking", in_tok: 6000, out_tok: 500,
        cost_usd: 0.0182, cost_class: "subscription" },
      { engine: "claude", session_id: "c-2", title: "nocost", model: "mystery",
        idle_s: 5, phase: "thinking", in_tok: 70, out_tok: 30,
        cost_usd: null, cost_class: "subscription" },
    ];
    const metered = home({
      pi_live: [{ session_id: "p-1", agent: "a", title: "t", model: "m", idle_s: 1,
        phase: "x", cost_usd: 2, in_tok: 1, out_tok: 1 }],
    });
    const before = costTotals(buildLiveRows(metered));
    const withAgents = home({ ...metered.live!, agent_live: agents });
    const rows = buildLiveRows(withAgents);
    const after = costTotals(rows);
    expect(before).toEqual({ billable: 2, covered: null });
    expect(after.billable).toBe(before.billable); // Est. cost KPI unchanged
    expect(after.covered).toBeCloseTo(123.4749, 4);
    const c1 = rowByKey(rows, "claude:c-1");
    expect([c1.costUsd, c1.subscription, c1.coveredBy, c1.billableCostUsd])
      .toEqual([123.4567, true, "Claude", null]);
    expect(rowByKey(rows, "codex:x-1").coveredBy).toBe("ChatGPT");
    expect(rowByKey(rows, "claude:c-2").costUsd).toBeNull(); // no badge for unpriced
    expect(rowByKey(rows, "pi:p-1").subscription).toBe(false);
    expect(rowByKey(rows, "pi:p-1").billableCostUsd).toBe(2);
    expect(c1.tokens).toBe(3600); // 1500 + 2100
  });

  it("never falls back to Bot Chat", () => {
    const fixture = home({
      pi_live: [
        { session_id: "p-1", title: "Bot Chat", agent: "scout", model: "glm-5", phase: "x" },
        { session_id: "p-2", title: "", model: "openai/gpt-5", phase: "x" },
      ],
      agent_live: [
        { engine: "claude", session_id: "c-1", title: "(untitled)", login: "hazem", phase: "x" },
        { engine: "codex", session_id: "x-1", phase: "x" },
      ],
    });
    const titles = buildLiveRows(fixture).map((row) => row.title);
    expect(titles).toEqual([
      "PI session · scout",
      "PI session · gpt-5",
      "Claude session · hazem",
      "Codex session · x-1",
    ]);
    expect(titles.some((title) => /bot chat/i.test(title))).toBe(false);
  });
});

describe("sortRows — stable, nulls last (live.js:444-456)", () => {
  const sample = (): HomeSnapshot => home({
    profiles: { work: { live: [
      { id: "a", title: "zulu", model: "o/gpt-5", idle_s: 12, uptime_s: 100,
        phase: "x", tools_gauge: 40, models: [{ in_tok: 150, out_tok: 0 }] },
      { id: "b", title: "alpha", model: "a/claude-opus-5", idle_s: 7, uptime_s: 50,
        phase: "compressing", tools_gauge: 80, models: [{ in_tok: 150, out_tok: 0 }] },
      { id: "c", title: "nothing", phase: "x" },
    ] } },
    pi_live: [{ session_id: "p", title: "mike", model: "glm-5", idle_s: 3,
      uptime_s: 20, phase: "waiting for approval", in_tok: 500 }],
  });
  const rows = (): LiveRow[] => buildLiveRows(sample(), "work");

  it("sorts numbers in both directions with nulls last and keeps ties stable", () => {
    const original = rows();
    const asc = sortRows(original, "tokens", "asc");
    const desc = sortRows(original, "tokens", "desc");
    expect(asc.map((row) => row.id)).toEqual(["a", "b", "p", "c"]); // a/b tie keep feed order
    expect(desc.map((row) => row.id)).toEqual(["p", "a", "b", "c"]);
    expect(sortRows(original, "elapsed", "asc").map((row) => row.id)).toEqual(["p", "b", "a", "c"]);
    expect(sortRows(original, "elapsed", "desc").map((row) => row.id)).toEqual(["a", "b", "p", "c"]);
    expect(sortRows(original, "activity", "asc").map((row) => row.id)).toEqual(["p", "b", "a", "c"]);
    expect(sortRows(original, "load", "desc").map((row) => row.id)).toEqual(["b", "a", "c", "p"]);
    expect(original.map((row) => row.id)).toEqual(["a", "b", "c", "p"]); // input untouched
  });

  it("sorts strings and state rank, with elapsed living under State", () => {
    expect(sortRows(rows(), "session", "asc").map((row) => row.id)).toEqual(["b", "p", "c", "a"]);
    expect(sortRows(rows(), "model", "asc").map((row) => row.id)).toEqual(["b", "p", "a", "c"]);
    expect(sortRows(rows(), "state", "asc").map((row) => row.state)).toEqual([
      "Running", "Running", "Compressing", "Waiting",
    ]);
    expect(sortRows(rows(), "state", "desc").map((row) => row.state)).toEqual([
      "Waiting", "Compressing", "Running", "Running",
    ]);
    expect(sortRows(rows(), "kind", "asc").map((row) => row.kind))
      .toEqual(["hermes", "hermes", "hermes", "pi"]);
  });
});
