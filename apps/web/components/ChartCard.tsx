// LLMTELEMET-293 (T-22 RUN A): one SVG chart card for the five Usage charts.
// The page passes datasets produced by lib/usage-cost/usage.ts; this component
// only draws them. Every colour is a CSS token, every provider mark is the
// brand SVG path, and the legend stats are computed from the plotted arrays.
import { compact } from "../lib/home-board/format";
import { HEXAGON_PATH } from "../lib/home-board/provider-icons";
import {
  seriesStats,
  type ChartPoint,
  type ChartSeries,
} from "../lib/usage-cost/usage";

export type ChartKind = "hbar" | "bar" | "line";

export interface ChartCardProps {
  id: string;
  title: string;
  kind: ChartKind;
  points?: readonly ChartPoint[];
  series?: readonly ChartSeries[];
  labels?: readonly string[];
  seriesLabel?: string;
  seriesFormat?: "count" | "compact";
  empty?: boolean;
}

const W = 640;
const H = 220;
const PAD = 24;
const TOP = 16;
const BOTTOM = H - 28;

function peak(values: readonly number[]): number {
  return Math.max(1, ...values.map((v) => (Number.isFinite(v) ? Math.abs(v) : 0)));
}

function statText(value: number | null, format: "count" | "compact" = "compact"): string {
  if (value === null) return "n/a";
  return format === "count" ? Math.round(value).toLocaleString("en-US") : compact(value);
}

function HorizontalBars({ points, empty }: { points: readonly ChartPoint[]; empty: boolean }) {
  if (empty || !points.length) {
    return <text className="uc-empty-text" x={W / 2} y={H / 2} textAnchor="middle">n/a</text>;
  }
  const scale = peak(points.map((p) => p.value));
  const rowH = Math.min(20, (H - 32) / points.length);
  const track = W - PAD - 178;
  return (
    <>
      {points.map((point, i) => {
        const y = TOP + i * rowH + rowH / 2;
        const width = (Math.abs(point.value) / scale) * track;
        return (
          <g
            className="uc-point"
            key={`${point.key}-${i}`}
            data-label={point.label}
            data-value={String(point.value)}
            data-provider={point.icon ? point.key : undefined}
          >
            <svg x={PAD} y={y - 7} width={14} height={14} viewBox="0 0 24 24" aria-hidden="true" style={{ color: point.color }}>
              <path d={point.icon ?? HEXAGON_PATH} fill="currentColor" />
            </svg>
            <text className="uc-label" x={PAD + 20} y={y + 4}>{point.label}</text>
            <rect className="uc-track" x={PAD + 140} y={y - 5} width={track} height={10} rx={3} />
            <rect className="uc-bar" x={PAD + 140} y={y - 5} width={width} height={10} rx={3} style={{ fill: point.color }} />
            <text className="uc-value" x={W - PAD} y={y + 4} textAnchor="end">{point.value.toLocaleString("en-US")}</text>
          </g>
        );
      })}
    </>
  );
}

function VerticalBars({ points, empty }: { points: readonly ChartPoint[]; empty: boolean }) {
  if (empty || !points.length) {
    return <text className="uc-empty-text" x={W / 2} y={H / 2} textAnchor="middle">n/a</text>;
  }
  const scale = peak(points.map((p) => p.value));
  const slot = (W - PAD * 2) / points.length;
  const barW = Math.min(28, slot * 0.62);
  const plot = BOTTOM - TOP;
  return (
    <>
      {points.map((point, i) => {
        const height = (Math.abs(point.value) / scale) * plot;
        const x = PAD + i * slot + (slot - barW) / 2;
        const y = BOTTOM - height;
        return (
          <g
            className="uc-point"
            key={`${point.key}-${i}`}
            data-label={point.label}
            data-value={String(point.value)}
          >
            <rect className="uc-bar" x={x} y={y} width={barW} height={height} rx={2} style={{ fill: point.color }} />
            <text className="uc-axis" x={x + barW / 2} y={H - 10} textAnchor="middle">{point.label}</text>
          </g>
        );
      })}
    </>
  );
}

function MultiLine({
  series,
  labels,
  empty,
}: {
  series: readonly ChartSeries[];
  labels: readonly string[];
  empty: boolean;
}) {
  const values = series.flatMap((s) => [...s.values]);
  if (empty || !values.length) {
    return <text className="uc-empty-text" x={W / 2} y={H / 2} textAnchor="middle">n/a</text>;
  }
  const scale = peak(values);
  const count = Math.max(labels.length, ...series.map((s) => s.values.length));
  const xAt = (i: number): number =>
    count === 1 ? W / 2 : PAD + (i * (W - PAD * 2)) / (count - 1);
  const yAt = (value: number): number => BOTTOM - (Math.abs(value) / scale) * (BOTTOM - TOP);
  return (
    <>
      <line className="uc-axis-line" x1={PAD} y1={BOTTOM} x2={W - PAD} y2={BOTTOM} />
      {series.map((s) => (
        <g
          className="uc-series"
          key={s.key}
          data-name={s.label}
          data-values={s.values.join(",")}
        >
          <polyline
            points={s.values.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ")}
            style={{ stroke: s.color }}
          />
          {s.values.map((v, i) => (
            <circle key={`${s.key}-${i}`} cx={xAt(i)} cy={yAt(v)} r={2} style={{ fill: s.color }} />
          ))}
        </g>
      ))}
      {labels.map((label, i) => (
        <text className="uc-axis" key={`${label}-${i}`} x={xAt(i)} y={H - 8} textAnchor="middle">{label}</text>
      ))}
    </>
  );
}

function Legend({ id, series }: { id: string; series: readonly ChartSeries[] }) {
  return (
    <table className="uc-legend" data-chart-legend={id}>
      <thead>
        <tr><th /><th>Name</th><th>Max</th><th>Mean</th><th>Last</th></tr>
      </thead>
      <tbody>
        {series.map((s, i) => {
          const stats = seriesStats(s.values);
          const format = s.format ?? "compact";
          return (
            <tr
              key={`${s.key}-${i}`}
              data-i={i}
              data-name={s.label}
              data-max={stats ? String(stats.max) : ""}
              data-mean={stats ? String(stats.mean) : ""}
              data-last={stats ? String(stats.last) : ""}
            >
              <td><i style={{ backgroundColor: s.color }} /></td>
              <td>{s.label}</td>
              <td>{statText(stats?.max ?? null, format)}</td>
              <td>{statText(stats?.mean ?? null, format)}</td>
              <td>{statText(stats?.last ?? null, format)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function ChartCard({
  id,
  title,
  kind,
  points = [],
  series = [],
  labels = [],
  seriesLabel = "Values",
  seriesFormat = "compact",
  empty = false,
}: ChartCardProps) {
  const legendSeries: readonly ChartSeries[] = series.length
    ? series
    : [{
        key: `${id}-values`,
        label: seriesLabel,
        values: points.map((p) => p.value),
        color: points[0]?.color ?? "var(--accent2)",
        format: seriesFormat,
      }];

  return (
    <section
      className="uc-card"
      data-chart-id={id}
      data-chart-kind={kind}
      data-point-count={kind === "line" ? series.reduce((n, s) => n + s.values.length, 0) : points.length}
      data-empty={empty ? "true" : "false"}
    >
      <h2>{title}</h2>
      <div className="uc-plot">
        <svg id={id} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} chart`} data-empty={empty ? "true" : "false"}>
          {kind === "hbar" && <HorizontalBars points={points} empty={empty} />}
          {kind === "bar" && <VerticalBars points={points} empty={empty} />}
          {kind === "line" && <MultiLine series={series} labels={labels} empty={empty} />}
        </svg>
      </div>
      <Legend id={id} series={legendSeries} />
    </section>
  );
}
