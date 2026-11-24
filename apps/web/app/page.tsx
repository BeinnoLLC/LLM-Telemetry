// LLMTELEMET-291 (T-20 RUN C2): Home composition. The server loads one
// snapshot; every number below comes from the RUN C1 pure derivations. RUN D
// replaces only the final placeholder section.
import AnalyticsKpis from "@/components/home-board/AnalyticsKpis";
import ExploreCards from "@/components/home-board/ExploreCards";
import HomeSeries from "@/components/home-board/HomeSeries";
import LiveKpis from "@/components/home-board/LiveKpis";
import LiveTable from "@/components/home-board/LiveTable";
import SoundToggle from "@/components/home-board/SoundToggle";
import TaskQueue from "@/components/home-board/TaskQueue";
import { homeProfileName, mergedAnalyticsProfile, withMergedLiveProfile } from "@/lib/home-board/all-profile";
import { loadHomeSnapshot } from "@/lib/home-board/load";

// The Home snapshot comes from the runtime reports dir (the parity fixture
// during RUN G), so it must never be frozen into the build output.
export const dynamic = "force-dynamic";
// Python config.py:78 — the sample build has no tariff artifact.
const DEFAULT_TARIFF = 0.047;

export default async function HomePage() {
  const loaded = await loadHomeSnapshot();
  const name = homeProfileName(loaded.analytics);
  const profile = mergedAnalyticsProfile(loaded.analytics, name);
  const snapshot = {
    ...loaded,
    // flow.js:40-41 caps the merged Yard at 40 recent sessions.
    analytics: profile && name === "All"
      ? { ...loaded.analytics, profiles: { ...loaded.analytics?.profiles, All: profile } }
      : loaded.analytics,
    live: withMergedLiveProfile(loaded.live, name),
  };

  return (
    <main className="view home-view">
      <h1>Home</h1>
      <SoundToggle />
      <LiveKpis initial={snapshot} name={name} alerts={profile?.alerts ?? null} />
      <AnalyticsKpis profile={profile} />
      <TaskQueue initial={snapshot} name={name} />
      <ExploreCards
        profile={profile}
        name={name}
        router={snapshot.router}
        quota={snapshot.quota}
        tariff={DEFAULT_TARIFF}
      />
      <HomeSeries profile={profile} />
      <LiveTable initial={snapshot} name={name} />
    </main>
  );
}
