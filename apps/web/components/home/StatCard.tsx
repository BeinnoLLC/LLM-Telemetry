// LLMTELEMET-291 (T-20 RUN C2): the single KPI card anatomy ported from
// src/llm_telemetry/web/js/live.js:167-192. Every card owns the same four
// fixed slots so CSS can keep baselines aligned and heights equal.
import type { ReactNode } from "react";

import type { KpiState } from "../../lib/home/kpis";

export interface StatCardProps {
  label: string;
  display: string;
  sub: string;
  unit?: string;
  kpi?: string;
  state?: KpiState;
  title?: string;
  detail?: string;
  viz?: ReactNode;
}

export default function StatCard({
  label,
  display,
  sub,
  unit,
  kpi,
  state,
  title,
  detail,
  viz,
}: StatCardProps) {
  // LST-252: long uppercase titles must wrap inside the card, never escape it.
  const wrap = label.trim().length > 11 ? " stat-label-wrap" : "";
  return (
    <article
      className={`card stat${state ? ` is-${state}` : ""}`}
      data-kpi={kpi}
      data-state={state}
      title={title ?? label}
    >
      <div className={`stat-label${wrap}`} title={label}>{label}</div>
      <div className="stat-value">
        {display}
        {unit ? <span className="stat-unit">{unit}</span> : null}
      </div>
      <div className="stat-sub">{sub}</div>
      <div className="stat-viz">
        {viz ?? (detail ? <span className="stat-detail">{detail}</span> : null)}
      </div>
    </article>
  );
}
