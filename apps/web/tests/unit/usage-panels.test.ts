// LLMTELEMET-293 (T-22 RUN B): pure port checks for the six panels and their
// edge cases. No network, no invented fixture values beyond the snapshot the
// test itself supplies; the renderer assertion checks markup, not pixels.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import UsagePanels from "../../components/usage-cost/UsagePanels";
import {
  deriveBandwidth,
  deriveConcurrency,
  deriveLatency,
  derivePanels,
  deriveRepoBranch,
  deriveTransfer,
  deriveUnattributed,
  flattenRepoRows,
  refreshTransfer,
  repoRowId,
  resendOf,
  UNATTR_LABEL,
} from "../../lib/usage-cost/panels";
import type {
  AnalyticsProfile,
  AnalyticsRow,
  BandwidthDailyRow,
  OllamaHost,
  UsageSnapshot,
} from "../../lib/usage-cost/types";

const DAY = {
  up_bytes: 2026,
  down_bytes: 1000,
  lan_up_bytes: 40,
  lan_down_bytes: 60,
};

function rows(): AnalyticsRow[] {
  return [
    {
      date: "2026-11-01",
      model: "ollama/qwen3:8b",
      provider: "ollama",
      project: "work",
      calls: 10,
      inp: 100,
      outp: 50,
      act: 1.25,
      ...DAY,
    },
    {
      date: "2026-11-02",
      model: "ollama/qwen3:8b",
      provider: "ollama",
      project: "work",
      calls: 5,
      inp: 80,
      outp: 25,
      est: 0.75,
      up_bytes: 0,
      down_bytes: 0,
    },
    {
      date: "2026-11-02",
      project: "",
      calls: 1,
      inp: 10,
      outp: 2,
      est: 0.3,
      up_bytes: 0,
      down_bytes: 0,
    },
  ];
}

function bandwidth(): BandwidthDailyRow[] {
  return [
    {
      date: "2026-11-01",
      model: "A",
      up_bytes: 1000,
      down_bytes: 3000,
      lan_up_bytes: 100,
      lan_down_bytes: 200,
      input_tokens: 100,
      cache_read_tokens: 900,
      cache_write_tokens: 100,
      calls: 5,
      bytes_per_token: 4,
      frozen: false,
    },
    {
      date: "2026-11-02",
      model: "A",
      up_bytes: 2000,
      down_bytes: 4000,
      lan_up_bytes: 200,
      lan_down_bytes: 400,
      input_tokens: 200,
      cache_read_tokens: 1800,
      cache_write_tokens: 200,
      calls: 6,
      bytes_per_token: 4,
      frozen: true,
    },
    {
      date: "2026-11-02",
      model: "B",
      up_bytes: 300,
      down_bytes: 900,
      input_tokens: 100,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      calls: 2,
      bytes_per_token: 5,
    },
  ];
}

function concurrency() {
  return [
    { hour: "2026-11-02T09:00", top: 3, sub: 1 },
    { hour: "2026-11-01T09:00", top: 2, sub: 0 },
  ];
}

function hosts(): OllamaHost[] {
  return [{ queue: 2, name: "a" }, { queue: 3, name: "b" }];
}

function snapshot(overrides: Partial<AnalyticsProfile> = {}): UsageSnapshot {
  return {
    analytics: {
      schema_version: 3,
      profiles: {
        work: {
          rows: rows(),
          bandwidth_daily: bandwidth(),
          concurrency: concurrency(),
          latency: {
            by_model: {
              "ollama/qwen3:8b": { n: 120, p50: 1.2, p90: 3.4, p99: 8.9, tok_s: 42.35 },
              "ollama/llama3.1": { n: 30, p50: 0.4, p90: 1.1, p99: 2.2, tok_s: 55 },
            },
            by_endpoint: { "/v1/chat": { n: 150, p50: 1, p90: 3, p99: 8 } },
            slowest: [{ session: "s-1", model: "ollama/qwen3:8b", s: 91 }],
          },
          repo_branch: {
            repos: [
              {
                repo: "zeta",
                sessions: 3,
                calls: 12,
                tokens: 4000,
                cost: 2.5,
                branches: [
                  { branch: "main", sessions: 2, calls: 9, tokens: 3000, cost: 2 },
                  { branch: UNATTR_LABEL, sessions: 1, calls: 3, tokens: 1000, cost: 0.5 },
                ],
              },
              {
                repo: UNATTR_LABEL,
                sessions: 1,
                calls: 2,
                tokens: 500,
                cost: 0.3,
                branches: [],
              },
            ],
          },
          ...overrides,
        },
      },
    },
    costs: null,
    ollama: { schema_version: 3, hosts: hosts() },
    dir: "/fixture",
  };
}

describe("transfer panel (views.js:973-1012)", () => {
  it("sums byte columns, keeps LAN separate and shows the round-trip ratio", () => {
    const panel = deriveTransfer(rows());
    expect(panel.seen).toBe(true);
    expect(panel.hidden).toBe(false);
    expect(panel.up).toBe(2026);
    expect(panel.down).toBe(1000);
    expect(panel.lan).toBe(100);
    expect(panel.lanUp).toBe(40);
    expect(panel.lanDown).toBe(60);
    expect(panel.upText).toBe("1.98 KB");
    expect(panel.downText).toBe("1000 B");
    expect(panel.lanText).toBe("100 B");
    expect(panel.ratioText).toBe("2:1");
    expect(panel.note).toContain("not metered");
  });

  it("sticky-empty XF_SEEN: a byte-less refresh keeps the last real totals", () => {
    const real = deriveTransfer(rows());
    const empty = deriveTransfer([]);
    const sticky = refreshTransfer(real, empty);
    expect(empty.hidden).toBe(true);
    expect(sticky.hidden).toBe(false);
    expect(sticky.sticky).toBe(true);
    expect(sticky.upText).toBe(real.upText);
    expect(sticky.ratioText).toBe(real.ratioText);
    // A later payload WITH bytes resets the sticky flag.
    expect(refreshTransfer(sticky, real).sticky).toBe(false);
  });
});

describe("bandwidth panel (views.js:259-357)", () => {
  it("computes re-send from prompt tokens the collector supplied", () => {
    expect(resendOf({ input_tokens: 100, cache_write_tokens: 100, cache_read_tokens: 900 }))
      .toEqual({ fresh: 200, sent: 1100, x: 5.5 });
    expect(resendOf({ input_tokens: 0 }).x).toBeNull();
  });

  it("builds four KPIs, a dual-axis trend, a ranked re-send list and frozen note", () => {
    const panel = deriveBandwidth(bandwidth());
    expect(panel.hidden).toBe(false);
    expect(panel.empty).toBe(false);
    expect(panel.subtitle).toBe("2 days · estimated, not measured");
    expect(panel.kpis.map((kpi) => kpi.key)).toEqual(["resend", "ratio", "internet", "lan"]);
    expect(panel.kpis[0].value).toBe("4.9×");
    expect(panel.kpis[2].value).toBe("↑ 3.22 KB");
    expect(panel.kpis[3].sub).toBe("local models · not metered");
    expect(panel.days.map((day) => day.date)).toEqual(["2026-11-01", "2026-11-02"]);
    expect(panel.trend.find((s) => s.key === "upload")?.axis).toBe("left");
    expect(panel.trend.find((s) => s.key === "download")?.axis).toBe("right");
    expect(panel.trend.find((s) => s.key === "lan")?.dashed).toBe(true);
    expect(panel.resend.map((row) => row.model)).toEqual(["A", "B"]);
    expect(panel.resend[0].x).toBeCloseTo(5.5);
    expect(panel.note).toContain("4.00 / 5.00 bytes/token");
    expect(panel.note).toContain("1 of 3 rows are frozen history");
    expect(panel.note).toContain("Re-send = (input + cache read + cache write)");
  });

  it("flags a model at least 2x the fleet median and caps the list at 12", () => {
    const rows = [10, 1.5, 1, 1].map((x, i) => ({
      date: "2026-11-01",
      model: `m${i}`,
      input_tokens: 100,
      cache_read_tokens: (x - 1) * 100,
      cache_write_tokens: 0,
      up_bytes: 1,
    }));
    const many = Array.from({ length: 14 }, (_, i) => ({
      date: "2026-11-01",
      model: `z${i}`,
      input_tokens: 100,
      cache_read_tokens: 0,
      up_bytes: 1,
    }));
    const panel = deriveBandwidth([...rows, ...many]);
    expect(panel.median).toBe(1);
    expect(panel.resend[0].hot).toBe(true);
    expect(panel.resend[1].hot).toBe(false);
    expect(panel.shown).toBe(12);
    expect(panel.totalModels).toBe(18);
  });
});

describe("concurrency panel (views.js:1227-1279)", () => {
  it("stacks top-level and subagent, then overlays queue-now as a dashed line", () => {
    const panel = deriveConcurrency(concurrency(), "", "", hosts());
    expect(panel.empty).toBe(false);
    expect(panel.rows.map((row) => row.hour)).toEqual([
      "2026-11-01T09:00",
      "2026-11-02T09:00",
    ]);
    expect(panel.peak?.total).toBe(4);
    expect(panel.peakText).toContain("Peak: 4 concurrent sessions (3 top-level, 1 subagent)");
    expect(panel.queueNow).toBe(5);
    expect(panel.series.map((s) => s.key)).toEqual(["top-level", "subagent", "queue-now"]);
    expect(panel.series.find((s) => s.key === "queue-now")?.dashed).toBe(true);
    expect(panel.series.find((s) => s.key === "queue-now")?.values).toEqual([5, 5]);
  });

  it("destroys the stale chart when no row is left in range", () => {
    const panel = deriveConcurrency(concurrency(), "2026-12-01", "2026-12-31", hosts());
    expect(panel.empty).toBe(true);
    expect(panel.peak).toBeNull();
    expect(panel.peakText).toBe("");
    expect(panel.queueNow).toBe(0);
    expect(panel.series).toEqual([]);
  });
});

describe("latency panel (views.js:1315-1352)", () => {
  it("sorts collector percentiles worst-first and never recomputes them", () => {
    const panel = deriveLatency(snapshot().analytics?.profiles?.work.latency);
    expect(panel.hidden).toBe(false);
    expect(panel.byModel.map((row) => row.name)).toEqual([
      "ollama/qwen3:8b",
      "ollama/llama3.1",
    ]);
    expect(panel.byModel[0].p90).toBe("3.4s");
    expect(panel.byModel[0].p99).toBe("8.9s");
    expect(panel.byModel[0].tokS).toBe("42.4 tok/s");
    expect(panel.byEndpoint[0].name).toBe("/v1/chat");
    expect(panel.slowest[0].secondsText).toBe("91s");
    expect(panel.byModel[0].icon?.length).toBeGreaterThan(1);
  });

  it("hides the whole card when the collector wrote no model buckets", () => {
    const panel = deriveLatency({ by_endpoint: { "/v1/chat": { p90: 1 } } });
    expect(panel.hidden).toBe(true);
    expect(panel.byModel).toEqual([]);
  });
});

describe("unattributed cost and repo/branch rows (views.js:1413-1527)", () => {
  it("keeps Unattributed last in both charts and reports its share", () => {
    const panel = deriveUnattributed(rows());
    expect(panel.unattrCost).toBeCloseTo(0.3);
    expect(panel.totalCost).toBeCloseTo(2.3);
    expect(panel.unattrPct).toBeGreaterThan(0);
    expect(panel.buckets[panel.buckets.length - 1].name).toBe(UNATTR_LABEL);
    expect(panel.buckets[panel.buckets.length - 1].hatch).toBe(true);
    expect(panel.header).toContain("of spend unattributed");
    expect(panel.tooltip).toContain("No usable session title");
    expect(deriveUnattributed(rows(), true).buckets).toHaveLength(1);
  });

  it("orders repos/branches, flattens only expanded rows and carries aria ids", () => {
    const panel = deriveRepoBranch(snapshot().analytics?.profiles?.work.repo_branch);
    expect(panel.hidden).toBe(false);
    expect(panel.repos.map((repo) => repo.repo)).toEqual(["zeta", UNATTR_LABEL]);
    expect(panel.repos[0].branches.map((branch) => branch.branch)).toEqual([
      "main",
      UNATTR_LABEL,
    ]);
    expect(panel.repos[0].costText).toBe("$2.50");
    expect(panel.unattrText).toContain("Unattributed: $0.30 of $2.80");
    expect(repoRowId("zeta/repo")).toBe("uc-repo-zeta-repo");
    expect(flattenRepoRows(panel.repos, new Set())).toHaveLength(2);
    const expanded = flattenRepoRows(panel.repos, new Set(["zeta"]));
    expect(expanded).toHaveLength(4);
    expect(expanded[1]).toMatchObject({
      branch: "main",
      indent: true,
      expandable: false,
      repoKey: "zeta",
    });
    expect(expanded[0].controls).toBe(repoRowId("zeta"));
  });
});

describe("snapshot integration and the six edge cases", () => {
  it("derives every panel from the loaded snapshot only", () => {
    const model = derivePanels(snapshot());
    expect(model.profile).toBe("work");
    expect(model.transfer.up).toBe(2026);
    expect(model.bandwidth.days).toHaveLength(2);
    expect(model.concurrency.queueNow).toBe(5);
    expect(model.latency.byModel).toHaveLength(2);
    expect(model.unattributed.totalCost).toBeCloseTo(2.3);
    expect(model.repos.repos).toHaveLength(2);
    // A different profile picks different data; nothing leaks across profiles.
    const other = derivePanels(snapshot(), { profile: "missing" });
    expect(other.profile).toBe("work");
  });

  it("1. an empty snapshot hides every artifact-backed card", () => {
    const model = derivePanels({ analytics: null, costs: null, dir: "/empty" });
    expect(model.profile).toBeNull();
    expect(model.transfer.hidden).toBe(true);
    expect(model.bandwidth.hidden).toBe(true);
    expect(model.concurrency.empty).toBe(true);
    expect(model.latency.hidden).toBe(true);
    expect(model.unattributed.empty).toBe(true);
    expect(model.repos.hidden).toBe(true);
  });

  it("2. no bandwidth artifact and 3. out-of-range bandwidth are different states", () => {
    const missing = deriveBandwidth([], "2026-11-01", "2026-11-30");
    expect(missing.hidden).toBe(true);
    const outside = deriveBandwidth(bandwidth(), "2026-12-01", "2026-12-31");
    expect(outside.hidden).toBe(false);
    expect(outside.empty).toBe(true);
    expect(outside.trend).toEqual([]);
  });

  it("4. bandwidth rows with no prompt tokens render no re-send rows", () => {
    const panel = deriveBandwidth([
      { date: "2026-11-01", up_bytes: 100, down_bytes: 50 },
    ]);
    expect(panel.resend).toEqual([]);
    expect(panel.kpis[0].value).toBe("—");
  });

  it("5. a transient empty transfer payload is sticky, 6. stale concurrency series are gone", () => {
    const real = deriveTransfer(rows());
    const sticky = refreshTransfer(real, deriveTransfer([]));
    expect(sticky.sticky).toBe(true);
    expect(sticky.hidden).toBe(false);
    const cleared = deriveConcurrency(concurrency(), "2026-12-01", "2026-12-31");
    expect(cleared.series).toHaveLength(0);
  });

  it("renders provider marks, aria controls and panel markers without literal hex", () => {
    const markup = renderToStaticMarkup(createElement(UsagePanels, { model: derivePanels(snapshot()) }));
    for (const name of ["transfer", "bandwidth", "concurrency", "latency", "unattributed", "repo-branch"]) {
      expect(markup).toContain(`data-panel="${name}"`);
    }
    expect(markup).toContain('data-axis="right"');
    expect(markup).toContain('data-series="queue-now"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain(`aria-controls="${repoRowId("zeta")}"`);
    expect(markup).toContain("M12 2.6 20.2 7.1v9.8L12 21.4 3.8 16.9V7.1z");
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
