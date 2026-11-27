// @vitest-environment node
// LLMTELEMET-293 (T-22 RUN A): the Usage datasets are pure, so the edge cases
// the legacy charts handled in the browser are asserted here. The loader test
// uses the committed sample artifacts; no collector and no live :8477 data.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import ChartCard from "../../components/ChartCard";
import { HEXAGON_PATH, RT_SVG } from "../../lib/home-board/provider-icons";
import { loadUsageSnapshot } from "../../lib/usage-cost/load";
import {
  deriveUsage,
  filterRows,
  inR,
  providerMark,
  seriesStats,
  type ChartPoint,
} from "../../lib/usage-cost/usage";
import type {
  AnalyticsData,
  AnalyticsProfile,
  AnalyticsRow,
  HourRow,
  UsageSnapshot,
} from "../../lib/usage-cost/types";

const unitDir = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(unitDir, "../..");
const repoRoot = resolve(webRoot, "../..");
const samples = join(repoRoot, "examples/reports");

function row(
  date: string,
  model: string,
  provider: string,
  calls: number,
  inp = 0,
  outp = 0,
  extra: Record<string, unknown> = {},
): AnalyticsRow {
  return { date, model, provider, calls, inp, outp, cread: 0, cwrite: 0, ...extra };
}

function snapshot(rows: AnalyticsRow[], hours: HourRow[] = []): UsageSnapshot {
  const profile: AnalyticsProfile = {
    rows,
    hours,
    min_date: rows[0]?.date ?? "",
    max_date: rows[rows.length - 1]?.date ?? "",
  };
  const analytics: AnalyticsData = { schema_version: 3, profiles: { work: profile } };
  return { analytics, costs: { schema_version: 3, models: [] }, dir: "" };
}

const day1 = "2026-09-19";
const day2 = "2026-09-20";

describe("Usage cross-filters and derivations", () => {
  it("keeps the date test inclusive and drops empty dates", () => {
    expect(inR(day1, day1, day1)).toBe(true);
    expect(inR("2026-09-18", day1, day2)).toBe(false);
    expect(inR("2026-09-21", day1, day2)).toBe(false);
    expect(inR("", "", "")).toBe(false);
  });

  it("composes project, provider and model filters in the legacy order", () => {
    const rows = [
      row(day1, "claude-opus-5", "anthropic", 2),
      row(day1, "qwen3-coder", "custom", 5, 10, 20, {
        project: "team/a",
        base_url: "http://gpu-01.example.internal:11434/v1/",
      }),
    ];
    expect(filterRows(rows, { project: "team/a" })).toHaveLength(1);
    expect(filterRows(rows, { project: "team/a", provider: "custom" })[0].model).toBe("qwen3-coder");
    expect(filterRows(rows, { provider: "custom", model: "claude-opus-5" })).toHaveLength(0);
  });

  it("shows n/a datasets for an empty range instead of previous numbers", () => {
    const snap = snapshot(
      [row(day1, "claude-opus-5", "anthropic", 4, 10, 20)],
      [{ date: day1, hour: 3, calls: 6 }],
    );
    const out = deriveUsage(snap, { from: "2026-10-01", to: "2026-10-31" });
    expect(out.rowCount).toBe(0);
    expect(out.calls).toBe(0);
    expect(out.providers).toEqual([]);
    expect(out.models).toEqual([]);
    expect(out.share).toEqual([]);
    expect(out.daily.labels).toEqual([]);
    expect(out.daily.series.map((s) => s.values)).toEqual([[], []]);
    expect(out.hours).toHaveLength(24);
    expect(out.hours.every((h) => h.value === 0)).toBe(true);
  });

  it("resolves one provider with a brand SVG, never a letter fallback", () => {
    const out = deriveUsage(snapshot([row(day1, "claude-opus-5", "anthropic", 4, 10, 20)]));
    expect(out.providers).toHaveLength(1);
    expect(out.providers[0]).toMatchObject({ key: "anthropic", label: "Anthropic", value: 4 });
    expect(out.providers[0].icon).toBe(RT_SVG.anthropic);
    expect(providerMark("not-a-brand")).toBe(HEXAGON_PATH);
  });

  it("keeps tied providers in first-seen order", () => {
    const out = deriveUsage(snapshot([
      row(day1, "gemini-3", "gemini", 2),
      row(day1, "gpt-6", "openai-codex", 2),
      row(day1, "claude-opus-5", "anthropic", 2),
    ]));
    expect(out.providers.map((p) => p.key)).toEqual(["gemini", "openai-codex", "anthropic"]);
    expect(out.providers.map((p) => p.value)).toEqual([2, 2, 2]);
  });

  it("cuts model calls at 10 and token share at 8", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row(day1, `m${i}`, `p${i}`, 12 - i, (12 - i) * 100, 0),
    );
    const out = deriveUsage(snapshot(rows));
    expect(out.providers.map((p) => p.value)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(out.models.map((p) => p.key)).toEqual(Array.from({ length: 10 }, (_, i) => `m${i}`));
    expect(out.share.map((p) => p.key)).toEqual(Array.from({ length: 8 }, (_, i) => `m${i}`));
    expect(out.share.map((p) => p.value)).toEqual([1200, 1100, 1000, 900, 800, 700, 600, 500]);
  });

  it("builds the two daily series from the same sorted dates", () => {
    const out = deriveUsage(snapshot([
      row(day1, "a", "anthropic", 2, 10, 20),
      row(day1, "b", "anthropic", 3, 1, 2),
      row(day2, "a", "anthropic", 4, 100, 200),
      row(day2, "b", "anthropic", 6, 50, 50),
    ]));
    expect(out.daily.labels).toEqual([day1, day2]);
    expect(out.daily.series.map((s) => s.label)).toEqual(["calls", "tokens"]);
    expect(out.daily.series[0].values).toEqual([5, 10]);
    expect(out.daily.series[1].values).toEqual([33, 400]);
    expect(seriesStats(out.daily.series[0].values)).toEqual({ max: 10, mean: 7.5, last: 10 });
    expect(seriesStats([])).toBeNull();
  });

  it("zero-pads all 24 hourly buckets", () => {
    const out = deriveUsage(
      snapshot([row(day1, "a", "anthropic", 4)], [
        { date: day1, hour: 0, calls: 2 },
        { date: day1, hour: 23, calls: 7 },
      ]),
    );
    expect(out.hours.map((h) => h.key)).toEqual(
      Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")),
    );
    expect(out.hours[0].value).toBe(2);
    expect(out.hours[23].value).toBe(7);
    expect(out.hours.slice(1, 23).every((h) => h.value === 0)).toBe(true);
  });
});

describe("Usage snapshot loader", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lst-293-usage-"));
    for (const file of ["analytics-data.json", "costs-data.json"]) {
      copyFileSync(join(samples, file), join(dir, file));
    }
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads both artifacts through one reports-dir resolution", async () => {
    const snap = await loadUsageSnapshot(dir);
    expect(snap.analytics?.schema_version).toBe(3);
    expect(snap.costs?.schema_version).toBe(3);
    expect(snap.dir).toBe(dir);
  });

  it("refuses a costs payload with an unknown schema version", async () => {
    const file = join(dir, "costs-data.json");
    const payload = JSON.parse(readFileSync(file, "utf8"));
    payload.schema_version = 99;
    writeFileSync(file, JSON.stringify(payload));
    await expect(loadUsageSnapshot(dir)).rejects.toThrow(
      /costs-data\.json: schema_version 99 does not match page version 3/,
    );
  });

  it("keeps a missing artifact null, never zero-filled", async () => {
    rmSync(join(dir, "costs-data.json"));
    const snap = await loadUsageSnapshot(dir);
    expect(snap.costs).toBeNull();
    expect(snap.analytics).not.toBeNull();
  });
});

describe("ChartCard rendering", () => {
  it("exposes the plotted value and legend stats, with an SVG provider mark", () => {
    const point: ChartPoint = {
      key: "anthropic",
      label: "Anthropic",
      value: 7,
      color: "var(--prov-anthropic-fg)",
      icon: providerMark("anthropic"),
    };
    const markup = renderToStaticMarkup(
      createElement(ChartCard, {
        id: "cProvDist",
        title: "Provider distribution",
        kind: "hbar",
        points: [point],
        seriesLabel: "Calls",
        seriesFormat: "count",
      }),
    );
    expect(markup).toContain('id="cProvDist"');
    expect(markup).toContain('data-value="7"');
    expect(markup).toContain('data-max="7"');
    expect(markup).toContain(RT_SVG.anthropic);
    expect(markup).not.toMatch(/<text[^>]*>\s*[A-Za-z]\s*<\/text>/);
  });

  it("uses tokens only in the Usage stylesheet", () => {
    const css = readFileSync(join(webRoot, "styles/usage-cost-charts.css"), "utf8");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).toContain("var(--card)");
  });
});
