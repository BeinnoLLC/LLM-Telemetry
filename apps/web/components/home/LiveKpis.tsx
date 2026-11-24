"use client";

// LLMTELEMET-291 (T-20 RUN C2): the four above-the-fold live cards. Numbers
// come only from the RUN C1 pure derivations; this file owns subscription and
// the 300s throughput ring, never arithmetic on payload fields.
import { useEffect, useState } from "react";

import { EMPTY_THROUGHPUT, liveKpis, sampleThroughput, throughputFor } from "../../lib/home/kpis";
import type { ThroughputState } from "../../lib/home/kpis";
import type { HomeSnapshot, JsonRecord } from "../../lib/home/types";
import StatCard from "./StatCard";
import { useLiveHome } from "./useLiveHome";

export interface LiveKpisProps {
  initial: HomeSnapshot;
  name: string;
  /** Analytics alerts; the live artifact has no per-profile alert rows. */
  alerts?: JsonRecord[] | null;
}

export default function LiveKpis({ initial, name, alerts = null }: LiveKpisProps) {
  // The KPI subscription is the single sound listener; TaskQueue and
  // LiveTable keep their own view-only subscriptions.
  const live = useLiveHome(initial, { sound: true });
  const [ring, setRing] = useState<ThroughputState>(EMPTY_THROUGHPUT);
  const profiles = live.live?.profiles;

  useEffect(() => {
    // First snapshot lays the baseline; each later poll adds one 300s sample.
    setRing((previous) => sampleThroughput(profiles, previous).state);
  }, [profiles]);

  const cards = liveKpis(
    profiles?.[name] ?? null,
    name,
    profiles,
    live.live?.pi_live,
    live.live?.agent_live,
    throughputFor(name, ring),
    alerts,
  );

  return (
    <section id="livekpis" className="kpi-grid" aria-label="Live KPIs">
      {cards.map((stat) => (
        <StatCard
          key={stat.key}
          kpi={stat.key}
          label={stat.label}
          display={stat.display}
          sub={stat.sub}
          unit={stat.unit}
          state={stat.state}
          title={stat.title}
          detail={stat.detail}
          chips={stat.chips}
        />
      ))}
    </section>
  );
}
