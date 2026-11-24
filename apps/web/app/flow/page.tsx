// LLMTELEMET-292 (T-21 RUN C1): server-rendered Flow tab. One snapshot comes
// from the RUN A loader; the graph never calls a live endpoint or invents rows.
import FlowGraph from "@/components/life-flow/FlowGraph";
import { homeProfileName, mergedAnalyticsProfile } from "@/lib/home-board/all-profile";
import { loadLife } from "@/lib/life-flow/load-life";
import { flowRows, flowSessions } from "@/lib/life-flow/flow";

export const dynamic = "force-dynamic";

export default async function FlowPage() {
  const view = await loadLife();
  const name = homeProfileName(view.snapshot.analytics);
  const profile = mergedAnalyticsProfile(view.snapshot.analytics, name);
  return (
    <main className="view flow-view">
      <h1>Flow</h1>
      <FlowGraph rows={flowRows(profile)} sessions={flowSessions(profile)} />
    </main>
  );
}
