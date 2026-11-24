// LLMTELEMET-292 (T-21 RUN A1): server-rendered Life tab. The card reads the
// same one-shot snapshot as Home; no live polling, no fabricated quota rows.
import LifeQuota from "@/components/life-flow/LifeQuota";
import { loadLife } from "@/lib/life-flow/load-life";

export const dynamic = "force-dynamic";

export default async function LifePage() {
  const view = await loadLife();
  return (
    <main className="view life-view">
      <h1>Life</h1>
      <LifeQuota
        name={view.name}
        profile={view.profile}
        quota={view.snapshot.quota}
      />
    </main>
  );
}
