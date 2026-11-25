// LLMTELEMET-293 (T-22 RUN C): Cost view. One snapshot read, the same
// cross-filters as Usage, and datasets produced entirely by cost.ts. The
// stale-price notice is an inline chip: it never becomes a red page banner.
import ChartCard from "@/components/ChartCard";
import CostTables from "@/components/usage-cost/CostTables";
import { deriveCost } from "@/lib/usage-cost/cost";
import { loadUsageSnapshot } from "@/lib/usage-cost/load";
import type { UsageFilters } from "@/lib/usage-cost/types";
import "../../styles/usage-cost-charts.css";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function one(params: SearchParams, key: string): string {
  const value = params[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function CostPage({
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
  };
  const snapshot = await loadUsageSnapshot();
  const cost = deriveCost(snapshot, filters);

  return (
    <main
      className="view cost-view"
      data-cost-from={filters.from}
      data-cost-to={filters.to}
      data-cost-source={snapshot.analytics ? "artifact" : "n/a"}
      data-cost-empty={cost.empty ? "true" : "false"}
    >
      <h1>Cost</h1>
      <p className="uc-meta" data-profile={cost.profile ?? "n/a"}>
        {cost.profile
          ? `${cost.profile} · ${cost.rowCount.toLocaleString("en-US")} rows`
          : "n/a — no profile rows in the snapshot"}
      </p>
      {cost.stale.visible && (
        <span className="uc-stale-chip" data-fresh-state={cost.stale.state} role="status">
          {cost.stale.text}
        </span>
      )}
      <div className="cost-grid">
        <ChartCard
          id="cModelCost"
          title="Cost by model"
          kind="hbar"
          points={cost.modelCosts}
          seriesLabel="Est. cost"
          seriesFormat="compact"
          empty={cost.empty}
        />
      </div>
      <CostTables model={cost} />
    </main>
  );
}
