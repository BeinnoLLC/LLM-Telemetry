// LLMTELEMET-291 (T-20 RUN C2): the six date-scoped totals. The whole section
// is present even when the analytics artifact is missing; the pure derivation
// then supplies n/a markers, never fabricated zeroes.
import { analyticsTotals } from "../../lib/home/kpis";
import type { AnalyticsProfile } from "../../lib/home/types";
import StatCard from "./StatCard";

export interface AnalyticsKpisProps {
  profile: AnalyticsProfile | null | undefined;
}

export default function AnalyticsKpis({ profile }: AnalyticsKpisProps) {
  const cards = analyticsTotals(profile);
  return (
    <section id="kpis" className="kpi-grid" aria-label="Analytics totals">
      {cards.map((stat) => (
        <StatCard
          key={stat.key}
          label={stat.label}
          display={stat.display}
          sub={stat.sub}
          state={stat.state}
        />
      ))}
    </section>
  );
}
