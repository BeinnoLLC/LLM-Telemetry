// T-23 RUN D: the provider-split derivation is a pure port of
// views.js:2048-2140. These tests pin the order, shares and legend labels that
// the Python dashboard's live Chart.js config exposes.
import { describe, expect, it } from "vitest";

import {
  PROV_GLYPHS,
  buildProjectDistribution,
  provLegendLabel,
} from "../../lib/sessions-logs/aggregate";
import type { SessionRow } from "../../lib/sessions-logs/types";

const row = (over: Partial<SessionRow>): SessionRow => ({ ...over });

const rows: readonly SessionRow[] = [
  row({ project: "atlas", model: "alpha", provider: "anthropic", act: 80, calls: 4 }),
  row({ project: "atlas", model: "beta", provider: "local", act: 20, calls: 7 }),
  row({ project: "nova", model: "alpha", provider: "anthropic", act: 40, calls: 2 }),
  row({ project: "orphan", provider: "nous", est: 10, calls: 1 }),
];

describe("buildProjectDistribution", () => {
  it("reports an explicit empty state with no rows", () => {
    const empty = buildProjectDistribution([], "cost");
    expect(empty.empty).toBe(true);
    expect(empty.bars).toEqual([]);
    expect(empty.providers).toEqual([]);
    expect(empty.axisTitle).toBe("Cost ($)");
    expect(buildProjectDistribution([], "cost", true).axisTitle).toBe("% of project total");
  });

  it("sorts providers by global weight and keeps Unattributed last", () => {
    const dist = buildProjectDistribution(rows, "cost");
    expect(dist.providers.map((provider) => provider.key)).toEqual(["anthropic", "local", "nous"]);
    expect(dist.bars.map((bar) => bar.project)).toEqual(["atlas", "nova", "orphan"]);
    const atlas = dist.bars[0]!;
    expect(atlas.segments.map((segment) => segment.key)).toEqual(["anthropic", "local", "nous"]);
    expect(atlas.segments.map((segment) => segment.raw)).toEqual([80, 20, 0]);
  });

  it("normalises every project bar to 100 percent with the oracle axis title", () => {
    const dist = buildProjectDistribution(rows, "cost", true);
    expect(dist.axisTitle).toBe("% of project total");
    dist.bars.forEach((bar) => {
      expect(bar.total).toBeCloseTo(100);
      expect(bar.segments.every((segment) => Math.abs(segment.raw) >= 0)).toBe(true);
    });
    const atlas = dist.bars[0]!;
    expect(atlas.segments[0]!.share).toBeCloseTo(80);
    expect(atlas.segments[0]!.value).toBeCloseTo(80);
    // data-value stays the raw measurement so parity can inspect both modes.
    expect(atlas.segments[0]!.raw).toBe(80);
  });

  it("drives the same bars from the shared weight axis", () => {
    const cost = buildProjectDistribution(rows, "cost");
    const calls = buildProjectDistribution(rows, "calls");
    expect(cost.axisTitle).toBe("Cost ($)");
    expect(calls.axisTitle).toBe("Calls");
    expect(calls.providers.map((provider) => provider.key)).toEqual(["local", "anthropic", "nous"]);
    expect(calls.bars[0]!.segments.map((segment) => segment.raw)).toEqual([7, 4, 0]);
  });

  it("uses the Python glyph table for legend labels without adding letters to balls", () => {
    expect(PROV_GLYPHS.anthropic).toBe("✳");
    expect(PROV_GLYPHS.local).toBe("▣");
    expect(provLegendLabel("anthropic")).toBe("✳ anthropic");
    expect(provLegendLabel("unknown-provider")).toBe("○ unknown-provider");
    const dist = buildProjectDistribution(rows, "cost");
    expect(dist.providers.map((provider) => provider.label)).toEqual([
      "✳ anthropic",
      "▣ local",
      "◆ nous",
    ]);
  });

  it("hides a series by changing totals only, never the stored data-value", () => {
    const all = buildProjectDistribution(rows, "cost");
    const hidden = buildProjectDistribution(rows, "cost", false, new Set(["anthropic"]));
    expect(hidden.bars[0]!.visibleTotal).toBe(20);
    expect(all.bars[0]!.visibleTotal).toBe(100);
    expect(hidden.bars[0]!.segments.map((segment) => segment.raw)).toEqual(
      all.bars[0]!.segments.map((segment) => segment.raw),
    );
  });
});
