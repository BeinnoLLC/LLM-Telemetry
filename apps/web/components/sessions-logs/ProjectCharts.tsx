"use client";

// T-23 RUN D — presentational SVG port of the Python dashboard's two project
// charts (views.js:2048-2285). The oracle draws with Chart.js on <canvas>;
// there is no Canvas API in the Next.js parity harness, so pixel/canvas
// comparison is impossible. Parity therefore compares the legend text, every
// chart value exposed as data-* attributes, the axis title and the empty-state
// text against the oracle's live Chart.js config, which is reachable in the
// browser. Geometry below is deliberately simple; it carries no extra data.
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  buildProjectDistribution,
  buildProjectTrend,
  type ChartSegment,
} from "../../lib/sessions-logs/aggregate";
import type { SessionRow, WeightAxis } from "../../lib/sessions-logs/types";

interface ProjectChartsProps {
  rows: readonly SessionRow[];
  axis: WeightAxis;
}

const TREND_COLORS = [
  "var(--kind-hermes)",
  "var(--kind-pi)",
  "var(--kind-claude)",
  "var(--kind-codex)",
  "var(--prov-openrouter)",
  "var(--prov-moa)",
  "var(--muted)",
];

const attr = (value: number): string => (Number.isFinite(value) ? String(value) : "0");

/** Provider key -> the CSS token used by the Python chart legend (fg variant).
 * No literal colours live in this component or its stylesheet. */
const providerFill = (key: string): string => `var(--prov-${key}-fg, var(--prov-unknown))`;

const seriesFill = (key: string, index: number): string =>
  key === "Unattributed" || key.startsWith("Other (+")
    ? "var(--muted)"
    : (TREND_COLORS[index % TREND_COLORS.length] ?? "var(--muted)");

function SeriesLegend({
  series,
  hidden,
  id,
  field,
  onToggle,
}: {
  series: readonly ChartSegment[];
  hidden: ReadonlySet<string>;
  id: string;
  field: "provider" | "series";
  onToggle: (key: string) => void;
}) {
  if (!series.length) return null;
  return (
    <div id={id} className="pc-legend" aria-label={id === "projdistlegend" ? "Provider series" : "Project series"}>
      {series.map((segment, index) => (
        <button
          key={segment.key}
          type="button"
          className="pc-legend-item"
          data-idx={index}
          {...(field === "provider" ? { "data-provider": segment.key } : { "data-series": segment.key })}
          aria-pressed={!hidden.has(segment.key)}
          onClick={() => onToggle(segment.key)}
        >
          <span
            className="pc-swatch"
            aria-hidden="true"
            style={{ background: field === "provider" ? providerFill(segment.key) : seriesFill(segment.key, index) }}
          />
          {segment.label}
        </button>
      ))}
    </div>
  );
}

export default function ProjectCharts({ rows, axis }: ProjectChartsProps) {
  const [distNormalized, setDistNormalized] = useState(false);
  const [trendStacked, setTrendStacked] = useState(false);
  const [hiddenProviders, setHiddenProviders] = useState<ReadonlySet<string>>(() => new Set());
  const [hiddenSeries, setHiddenSeries] = useState<ReadonlySet<string>>(() => new Set());

  // views.js:1784 + router.js:1485-1492 destroy and recreate both Chart.js
  // charts on a weight-axis or toggle change, then renderProjDistLegend and
  // renderProjTrendLegend (views.js:2157, :2276) rebuild every button with
  // aria-pressed="true". Hidden legend state must reset on exactly those
  // events (and when the rows change); a legend click alone must still hide
  // and show its dataset.
  useEffect(() => {
    setHiddenProviders(new Set<string>());
    setHiddenSeries(new Set<string>());
  }, [rows, axis, distNormalized, trendStacked]);

  const distribution = useMemo(
    () => buildProjectDistribution(rows, axis, distNormalized, hiddenProviders),
    [rows, axis, distNormalized, hiddenProviders],
  );
  const trend = useMemo(
    () => buildProjectTrend(rows, axis, trendStacked, hiddenSeries),
    [rows, axis, trendStacked, hiddenSeries],
  );

  const toggle = (setter: Dispatch<SetStateAction<ReadonlySet<string>>>, key: string) =>
    setter((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const distHeight = Math.max(140, distribution.bars.length * 44 + 56);
  const distBarX = 160;
  const distBarW = 520;
  const distMax = distNormalized
    ? 100
    : Math.max(1, ...distribution.bars.map((bar) => bar.total));

  const trendHeight = 320;
  const plotX = 56;
  const plotW = 636;
  const plotH = 218;
  const baseline = 264;
  const band = trend.days.length ? plotW / trend.days.length : plotW;
  const trendMax = trend.stacked
    ? 100
    : Math.max(1, ...trend.days.flatMap((day) => day.segments.map((segment) => segment.value)));

  return (
    <div className="pc-grid">
      <section id="projdistcard" className="pc-card" aria-labelledby="projdisttitle">
        <div className="pc-head">
          <h3 id="projdisttitle" className="pc-title">
            Project × provider <span className="pc-sub">— vendor exposure per project</span>
          </h3>
          <label className="pc-toggle">
            <input
              type="checkbox"
              id="projdistnorm"
              checked={distNormalized}
              onChange={(event) => setDistNormalized(event.target.checked)}
            />{" "}
            normalise to 100%
          </label>
        </div>
        <svg
          id="cProjDist"
          className="pc-svg"
          viewBox={`0 0 720 ${distHeight}`}
          width="100%"
          height={distHeight}
          role="img"
          aria-label="Provider distribution by project"
          aria-hidden={distribution.empty}
          data-axis-title={distribution.axisTitle}
        >
          <text className="pc-axis" x="12" y="18" data-axis-title={distribution.axisTitle}>
            {distribution.axisTitle}
          </text>
          {distribution.bars.map((bar, rowIndex) => {
            let offset = 0;
            return (
              <g
                key={bar.project}
                className="pc-bar"
                data-project={bar.project}
                data-total={attr(bar.total)}
                data-visible-total={attr(bar.visibleTotal)}
              >
                <text className="pc-label" x="8" y={44 + rowIndex * 44 + 14}>
                  {bar.project}
                </text>
                <rect className="pc-track" x={distBarX} y={44 + rowIndex * 44} width={distBarW} height="22" rx="3" />
                {bar.segments.map((segment, index) => {
                  const hidden = hiddenProviders.has(segment.key);
                  const width = (segment.value / distMax) * distBarW;
                  const x = distBarX + offset;
                  if (!hidden) offset += width;
                  return (
                    <rect
                      key={segment.key}
                      className={hidden ? "pc-seg pc-hidden" : "pc-seg"}
                      data-project={bar.project}
                      data-provider={segment.key}
                      data-value={attr(segment.raw)}
                      data-share={attr(segment.share)}
                      data-hidden={hidden ? "true" : "false"}
                      data-idx={index}
                      x={x}
                      y={44 + rowIndex * 44}
                      width={hidden ? 0 : width}
                      height="22"
                      fill={providerFill(segment.key)}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
        <p id="projdistempty" className="pc-empty" hidden={!distribution.empty}>
          No session activity in the selected range.
        </p>
        <SeriesLegend
          series={distribution.providers}
          hidden={hiddenProviders}
          id="projdistlegend"
          field="provider"
          onToggle={(key) => toggle(setHiddenProviders, key)}
        />
      </section>

      <section id="projtrendcard" className="pc-card" aria-labelledby="projtrendtitle">
        <div className="pc-head">
          <h3 id="projtrendtitle" className="pc-title">
            Project trend <span className="pc-sub">— burn over time</span>
          </h3>
          <label className="pc-toggle">
            <input
              type="checkbox"
              id="projtrendstack"
              checked={trendStacked}
              onChange={(event) => setTrendStacked(event.target.checked)}
            />{" "}
            stacked share of total
          </label>
        </div>
        <svg
          id="cProjTrend"
          className="pc-svg"
          viewBox={`0 0 720 ${trendHeight}`}
          width="100%"
          height={trendHeight}
          role="img"
          aria-label="Daily project trend"
          aria-hidden={trend.empty}
          data-axis-title={trend.axisTitle}
        >
          <text className="pc-axis" x="12" y="18" data-axis-title={trend.axisTitle}>
            {trend.axisTitle}
          </text>
          <line className="pc-baseline" x1={plotX} y1={baseline} x2={plotX + plotW} y2={baseline} />
          {trend.days.map((day, dayIndex) => {
            const visible = day.segments.filter((segment) => !hiddenSeries.has(segment.key));
            const barW = Math.min(44, band * 0.7);
            let stacked = 0;
            return (
              <g
                key={day.day}
                className="pc-day"
                data-day={day.day}
                data-total={attr(day.total)}
                data-visible-total={attr(day.visibleTotal)}
              >
                {day.segments.map((segment, index) => {
                  const hidden = hiddenSeries.has(segment.key);
                  const value = trend.stacked ? (segment.value / 100) * plotH : (segment.value / trendMax) * plotH;
                  let x = plotX + band * dayIndex + (band - barW) / 2;
                  let y = baseline - value;
                  if (trend.stacked) {
                    x = plotX + band * dayIndex + (band - barW) / 2;
                    if (hidden) {
                      y = baseline - value;
                    } else {
                      y = baseline - stacked - value;
                      stacked += value;
                    }
                  } else if (!hidden) {
                    const slot = (barW / Math.max(1, visible.length));
                    x = plotX + band * dayIndex + (band - barW) / 2 + visible.findIndex((v) => v.key === segment.key) * slot;
                    y = baseline - value;
                  }
                  const width = hidden ? 0 : trend.stacked ? barW : barW / Math.max(1, visible.length);
                  return (
                    <rect
                      key={segment.key}
                      className={hidden ? "pc-trend-seg pc-hidden" : "pc-trend-seg"}
                      data-day={day.day}
                      data-series={segment.key}
                      data-value={attr(segment.raw)}
                      data-share={attr(segment.share)}
                      data-hidden={hidden ? "true" : "false"}
                      data-idx={index}
                      x={x}
                      y={y}
                      width={width}
                      height={hidden ? 0 : value}
                      fill={seriesFill(segment.key, index)}
                    />
                  );
                })}
                <text className="pc-tick" x={plotX + band * (dayIndex + 0.5)} y={baseline + 18} textAnchor="middle">
                  {day.day}
                </text>
              </g>
            );
          })}
        </svg>
        <p id="projtrendempty" className="pc-empty" hidden={!trend.empty}>
          No session activity in the selected range.
        </p>
        <SeriesLegend
          series={trend.series}
          hidden={hiddenSeries}
          id="projtrendlegend"
          field="series"
          onToggle={(key) => toggle(setHiddenSeries, key)}
        />
      </section>
    </div>
  );
}
