// LLMTELEMET-291 (T-20 RUN C2): Home composition. The server loads one
// snapshot; every number below comes from the RUN C1 pure derivations. RUN D
// replaces only the final placeholder section.
import AnalyticsKpis from "@/components/home/AnalyticsKpis";
import ExploreCards from "@/components/home/ExploreCards";
import HomeSeries from "@/components/home/HomeSeries";
import LiveKpis from "@/components/home/LiveKpis";
import LiveTable from "@/components/home/LiveTable";
import TaskQueue from "@/components/home/TaskQueue";
import { loadHomeSnapshot } from "@/lib/home/load";

function pickName(profiles: Record<string, unknown> | undefined): string {
  if (!profiles) return "";
  return "All" in profiles ? "All" : Object.keys(profiles)[0] ?? "";
}

export default async function HomePage() {
  const snapshot = await loadHomeSnapshot();
  const name = pickName(snapshot.live?.profiles ?? snapshot.analytics?.profiles);
  const profile = snapshot.analytics?.profiles?.[name] ?? null;

  return (
    <main className="view home-view">
      <h1>Home</h1>
      <LiveKpis initial={snapshot} name={name} />
      <AnalyticsKpis profile={profile} />
      <TaskQueue initial={snapshot} name={name} />
      <ExploreCards
        profile={profile}
        name={name}
        router={snapshot.router}
        quota={snapshot.quota}
      />
      <HomeSeries profile={profile} />
      <LiveTable initial={snapshot} name={name} />
    </main>
  );
}
