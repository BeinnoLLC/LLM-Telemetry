// LLMTELEMET-291 (T-20 RUN C1): pure ports of tests/check_home_above_fold.js
// (95-166) and tests/check_live_kpis_real_shape.js. Expected values stay the
// same as the Python oracles; no UI is involved here.
import { describe, expect, it } from "vitest";

import {
  EMPTY_THROUGHPUT,
  analyticsTotals,
  home6h,
  liveKpis,
  sampleThroughput,
  throughputFor,
} from "../../lib/home-board/kpis";
import type { KpiStat } from "../../lib/home-board/kpis";
import type { LiveProfile } from "../../lib/home-board/types";

const session = (id: string, calls: number, inTok: number, outTok: number) => ({
  id,
  models: [{ calls, in_tok: inTok, out_tok: outTok }],
});
const profile = (callsA: number, tokA: number, callsB: number, tokB: number) => ({
  work: {
    live: [session("s1", callsA, tokA, 0), session("s2", callsB, tokB, 0)],
  },
});
const byKey = (cards: KpiStat[], key: string): KpiStat => {
  const found = cards.find((card) => card.key === key);
  if (!found) throw new Error(`missing ${key}`);
  return found;
};

describe("live KPI derivation", () => {
  it("yields the four cards in the required order", () => {
    const first = sampleThroughput(profile(10, 1100, 5, 200), EMPTY_THROUGHPUT, 1000).state;
    const second = sampleThroughput(profile(40, 3600, 5, 200), first, 1005);
    const tput = throughputFor("work", second.state, 1005);
    const p: LiveProfile = {
      live: [{ id: "s1", idle_s: 1 }, { id: "s2", idle_s: 1 }],
      agents: [{ state: "alive" }, { state: "alive" }, { state: "dead" }],
      alerts: [],
    };
    // tests/check_home_above_fold.js:107-135
    const cards = liveKpis(
      p, "work", { work: p },
      [
        { session_id: "p-1", phase: "running" },
        { session_id: "p-idle", phase: "idle" },
      ],
      [
        { engine: "claude", session_id: "c-1", phase: "running", idle_s: 1 },
        { engine: "codex", session_id: "x-1", phase: "idle", idle_s: 400 },
      ],
      tput,
    );
    expect(cards.map((card) => card.key)).toEqual([
      "sessions", "agents", "throughput", "alerts",
    ]);
    expect(byKey(cards, "sessions").display).toBe("4");
    expect(byKey(cards, "sessions").sub).toBe("2 Hermes · 1 PI · 1 Claude");
    expect(byKey(cards, "agents").display).toBe("2");
    expect(byKey(cards, "agents").unit).toBe("/3");
    expect(byKey(cards, "agents").sub).toBe("1 not heartbeating");
    expect(byKey(cards, "throughput").display).toBe("30");
    expect(byKey(cards, "throughput").sub).toContain("2.5K tokens");
    expect(byKey(cards, "throughput").sub).toContain("last 5s");
    expect(byKey(cards, "alerts").display).toBe("0");
    expect(byKey(cards, "alerts").sub).toBe("All clear");
  });

  it("treats two polls as the first delta and clamps counter resets", () => {
    const baseline = sampleThroughput(profile(40, 4000, 5, 200), EMPTY_THROUGHPUT, 1000);
    expect(baseline.by.work).toEqual({ calls: 0, tokens: 0 });
    expect(throughputFor("work", baseline.state, 1000).window).toBe("measuring…");
    expect(throughputFor("work", baseline.state, 1000).calls).toBeNull();
    const drop = sampleThroughput(profile(5, 100, 5, 200), baseline.state, 1005);
    expect(drop.by.work).toEqual({ calls: 0, tokens: 0 });
    const idle = sampleThroughput({}, EMPTY_THROUGHPUT, 1000);
    const win = throughputFor("work", idle.state, 1000);
    expect(win.calls).toBeNull();
    expect(win.tokens).toBeNull();
  });

  it("splits alert severities and names the worst rule", () => {
    // tests/check_home_above_fold.js:138-156
    const p: LiveProfile = {
      live: [],
      alerts: [
        { rule: "a", severity: "warning", message: "Warn one", why: "because" },
        { rule: "b", severity: "critical", message: "Crit one" },
        { rule: "c", severity: "info", message: "Info one" },
        { rule: "d", severity: "info", message: "Info two" },
      ],
    };
    const cards = liveKpis(p, "work", { work: p }, [], [], throughputFor("work", EMPTY_THROUGHPUT, 1));
    const alerts = byKey(cards, "alerts");
    expect(alerts.display).toBe("4");
    expect(alerts.detail).toBe("B");
    expect(alerts.sub).toBe("1 critical · 3 warning");
    expect(alerts.state).toBe("bad");
    expect(alerts.href).toBe("#/health");
  });

  it("shows an em dash, not 0/0, when no agent heartbeat rows exist", () => {
    // tests/check_live_kpis_real_shape.js:69-96
    const p: LiveProfile = { live: [], agents: [], alerts: [] };
    const cards = liveKpis(p, "work", { work: p }, [], [], throughputFor("work", EMPTY_THROUGHPUT, 1));
    expect(byKey(cards, "agents").display).toBe("—");
    expect(byKey(cards, "agents").sub).toBe("no agent heartbeats reported");
    const merged = liveKpis(
      { agents: [] }, "All", { work: p, other: { live: [] } }, [], [],
      throughputFor("All", EMPTY_THROUGHPUT, 1),
    );
    expect(byKey(merged, "agents").value).toBeNull();
    const unknown = liveKpis({}, "work", { work: {} }, [], [], throughputFor("work", EMPTY_THROUGHPUT, 1));
    expect(byKey(unknown, "sessions").display).toBe("—");
    expect(byKey(unknown, "alerts").display).toBe("—");
  });
});

describe("analytics and 6h derivation", () => {
  it("returns six null totals for an absent profile", () => {
    const cards = analyticsTotals(null);
    expect(cards.map((card) => card.key)).toEqual([
      "calls", "tokens", "cacheHit", "sessions", "successRate", "estCost",
    ]);
    expect(cards.map((card) => card.display)).toEqual(Array(6).fill("—"));
  });

  it("buckets hour rows into six local-time hours", () => {
    // live.js:672-694
    const now = new Date(2026, 8, 25, 13, 51, 12).getTime();
    const day = (hoursBack: number) => {
      const d = new Date(now - hoursBack * 3600e3);
      return {
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        hour: d.getHours(),
      };
    };
    const series = home6h(
      {
        hour_rows: [
          { ...day(2), calls: 7, inp: 100, outp: 20 },
          { ...day(2), calls: 3, inp: 50, outp: 30 },
          { ...day(9), calls: 99, inp: 999, outp: 999 },
        ],
      },
      now,
    );
    expect(series.labels).toHaveLength(6);
    expect(series.labels[5]).toBe("13:00");
    expect(series.calls).toEqual([0, 0, 0, 10, 0, 0]);
    expect(series.tokens).toEqual([0, 0, 0, 200, 0, 0]);
  });
});
