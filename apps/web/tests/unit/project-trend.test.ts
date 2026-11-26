// T-23 RUN D: the stacked trend is a pure port of views.js:2173-2263.
import { describe, expect, it } from "vitest";

import { PROJ_TREND_TOP_N, buildProjectTrend } from "../../lib/sessions-logs/aggregate";
import type { SessionRow } from "../../lib/sessions-logs/types";

const row = (over: Partial<SessionRow>): SessionRow => ({ ...over });

const rows: readonly SessionRow[] = [
  row({ project: "p1", model: "m", date: "2026-09-21", act: 60 }),
  row({ project: "p2", model: "m", date: "2026-09-20", act: 50 }),
  row({ project: "p3", model: "m", date: "2026-09-19", act: 40 }),
  row({ project: "p4", model: "m", date: "2026-09-22", act: 30 }),
  row({ project: "p5", model: "m", date: "2026-09-23", act: 20 }),
  row({ project: "p6", model: "m", date: "2026-09-24", act: 10 }),
  row({ project: "p7", model: "m", date: "2026-09-24", act: 5 }),
  row({ project: "", model: "m", date: "2026-09-21", est: 1 }),
];

describe("buildProjectTrend", () => {
  it("reports an explicit empty state with no rows", () => {
    const empty = buildProjectTrend([], "cost");
    expect(empty.empty).toBe(true);
    expect(empty.days).toEqual([]);
    expect(empty.series).toEqual([]);
    expect(empty.axisTitle).toBe("Cost ($)");
    expect(buildProjectTrend([], "cost", true).axisTitle).toBe("% of day total");
  });

  it("sorts days and caps the series at six projects plus an explicit tail", () => {
    expect(PROJ_TREND_TOP_N).toBe(6);
    const trend = buildProjectTrend(rows, "cost");
    expect(trend.days.map((entry) => entry.day)).toEqual([
      "2026-09-19",
      "2026-09-20",
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
    ]);
    expect(trend.series.map((series) => series.label)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
      "Other (+2)",
    ]);
    expect(trend.series[6]!.raw).toBe(6);
  });

  it("normalises each day to 100 percent when stacked", () => {
    const trend = buildProjectTrend(rows, "cost", true);
    expect(trend.axisTitle).toBe("% of day total");
    trend.days.forEach((day) => {
      expect(day.total).toBeCloseTo(100);
      expect(day.segments.reduce((sum, segment) => sum + segment.share, 0)).toBeCloseTo(100);
    });
    const day = trend.days.find((entry) => entry.day === "2026-09-21")!;
    expect(day.segments[0]!.share).toBeCloseTo((60 / 61) * 100);
    expect(day.segments[0]!.raw).toBe(60);
  });

  it("drives the same series from the shared weight axis", () => {
    const cost = buildProjectTrend(rows, "cost");
    const calls = buildProjectTrend(rows, "calls");
    expect(cost.axisTitle).toBe("Cost ($)");
    expect(calls.axisTitle).toBe("Calls");
    expect(cost.days[0]!.segments[2]!.raw).toBe(40);
    expect(calls.days[0]!.segments.every((segment) => segment.raw === 0)).toBe(true);
  });

  it("hides a series by changing visible totals, never the stored data-value", () => {
    const all = buildProjectTrend(rows, "cost");
    const hidden = buildProjectTrend(rows, "cost", false, new Set(["p1"]));
    const day = "2026-09-21";
    const allDay = all.days.find((entry) => entry.day === day)!;
    const hiddenDay = hidden.days.find((entry) => entry.day === day)!;
    expect(allDay.visibleTotal).toBe(61);
    expect(hiddenDay.visibleTotal).toBe(1);
    expect(hiddenDay.segments.map((segment) => segment.raw)).toEqual(
      allDay.segments.map((segment) => segment.raw),
    );
  });
});
