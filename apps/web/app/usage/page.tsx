// LLMTELEMET-293 (T-22 RUN A): Usage view. One snapshot read, then five chart
// cards backed by the same datasets the legacy views.js builds. Query params
// mirror the day inputs and the three cross-filters; nothing is invented when
// an artifact or a range is empty.
import ChartCard from "@/components/ChartCard";
import UsagePanels from "@/components/usage-cost/UsagePanels";
import { loadUsageSnapshot } from "@/lib/usage-cost/load";
import { derivePanels } from "@/lib/usage-cost/panels";
import { deriveUsage } from "@/lib/usage-cost/usage";
import type { UsageFilters } from "@/lib/usage-cost/types";
import "../../styles/usage-cost-charts.css";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function one(params: SearchParams, key: string): string {
  const value = params[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = await searchParams;
  const filters: UsageFilters = {
    profile: one(query, "profile"),
    from: one(query, "from"),
    to: one(query, "to"),
    project: one(query, "project"),
    provider: one(query, "provider"),
    model: one(query, "model"),
    exclude: one(query, "exclude") === "1",
  };
  const snapshot = await loadUsageSnapshot();
  const usage = deriveUsage(snapshot, filters);
  const panels = derivePanels(snapshot, filters);
  const empty = usage.rowCount === 0;

  return (
    <main
      className="view usage-view"
      data-usage-from={filters.from}
      data-usage-to={filters.to}
      data-usage-project={filters.project}
      data-usage-provider={filters.provider}
      data-usage-model={filters.model}
      data-usage-source={snapshot.analytics ? "artifact" : "n/a"}
    >
      <h1>Usage</h1>
      <p
        className="uc-meta"
        data-profile={usage.profile ?? "n/a"}
        data-from={usage.bounds.from}
        data-to={usage.bounds.to}
      >
        {usage.profile
          ? `${usage.profile} · ${usage.bounds.from || "n/a"} → ${usage.bounds.to || "n/a"}`
          : "n/a — no profile rows in the snapshot"}
      </p>

      <div className="usage-grid">
        <ChartCard
          id="cProvDist"
          title="Provider distribution"
          kind="hbar"
          points={usage.providers}
          seriesLabel="Calls"
          seriesFormat="count"
          empty={empty}
        />
        <ChartCard
          id="cModels"
          title="Calls by model"
          kind="hbar"
          points={usage.models}
          seriesLabel="Calls"
          seriesFormat="count"
          empty={empty}
        />
        <ChartCard
          id="cShare"
          title="Token share"
          kind="hbar"
          points={usage.share}
          seriesLabel="Tokens"
          seriesFormat="compact"
          empty={empty}
        />
        <ChartCard
          id="cDaily"
          title="Daily activity"
          kind="line"
          series={usage.daily.series}
          labels={usage.daily.labels}
          empty={empty}
        />
        <ChartCard
          id="cHours"
          title="Hourly distribution"
          kind="bar"
          points={usage.hours}
          seriesLabel="Calls"
          seriesFormat="count"
          empty={empty}
        />
      </div>
      <UsagePanels model={panels} />
    </main>
  );
}
