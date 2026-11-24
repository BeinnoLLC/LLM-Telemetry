// LLMTELEMET-291 (T-20 RUN C2): Home composition. The server loads one
// snapshot; every number below comes from the RUN C1 pure derivations. RUN D
// replaces only the final placeholder section.
import AnalyticsKpis from "@/components/home/AnalyticsKpis";
import ExploreCards from "@/components/home/ExploreCards";
import HomeSeries from "@/components/home/HomeSeries";
import LiveKpis from "@/components/home/LiveKpis";
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
      <ExploreCards
        profile={profile}
        name={name}
        router={snapshot.router}
        quota={snapshot.quota}
      />
      <HomeSeries profile={profile} />
      <section id="home-live-table" className="home-section" aria-label="In progress now">
        <h2>In progress now</h2>
        <p>The live session table lands here in RUN D.</p>
      </section>
    </main>
  );
}
