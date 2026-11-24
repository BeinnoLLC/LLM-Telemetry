// LLMTELEMET-291 (T-20 RUN C2): the 6h Home series as a small inline SVG.
// Only the hour buckets from the pure home6h() derivation are plotted; no
// Chart.js canvas and no state/model breakdown charts.
import { fmt } from "../../lib/home/format";
import { home6h } from "../../lib/home/kpis";
import type { AnalyticsProfile } from "../../lib/home/types";

export interface HomeSeriesProps {
  profile: AnalyticsProfile | null | undefined;
  now?: number;
}

const WIDTH = 300;
const HEIGHT = 90;
const PAD = 6;

function points(values: number[]): string {
  const max = Math.max(1, ...values);
  const last = Math.max(1, values.length - 1);
  return values
    .map((value, index) => {
      const x = PAD + (index / last) * (WIDTH - 2 * PAD);
      const y = HEIGHT - PAD - (value / max) * (HEIGHT - 2 * PAD);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export default function HomeSeries({ profile, now }: HomeSeriesProps) {
  const hasData = Array.isArray(profile?.hour_rows);
  const series = home6h(profile, now);
  return (
    <section className="home-section home-series" aria-labelledby="home-series-title">
      <h2 id="home-series-title">Last 6 hours</h2>
      <figure>
        <svg
          id="cHome6h"
          className="series-svg"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={hasData ? "Calls and tokens per hour" : "No 6h data"}
        >
          <polyline className="series-calls" points={points(series.calls)} fill="none" />
          <polyline className="series-tokens" points={points(series.tokens)} fill="none" />
        </svg>
        <figcaption className="series-legend">
          {series.labels.map((label, index) => (
            <span key={label} className="series-legend-item">
              <span className="series-hour">{label}</span>
              <span className="series-numbers">
                {hasData
                  ? `${fmt(series.calls[index])} calls · ${fmt(series.tokens[index])} tokens`
                  : "n/a"}
              </span>
            </span>
          ))}
        </figcaption>
      </figure>
    </section>
  );
}
