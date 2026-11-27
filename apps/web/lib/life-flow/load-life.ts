// LLMTELEMET-292 (T-21 RUN A1): server-only Life loader. One snapshot from
// the collectors' artifacts, never a live endpoint and never sample rows.
import { homeProfileName } from "../home-board/all-profile";
import { loadHomeSnapshot } from "../home-board/load";
import type { HomeSnapshot } from "../home-board/types";
import type { QuotaProfile } from "./quota";

export interface LifeView {
  /** Quota profile key in the artifact, or "" when there is no quota data. */
  name: string;
  profile: QuotaProfile | null;
  snapshot: HomeSnapshot;
}

/** views.js:731 + quotaview.js:531: keep the current profile when the quota
 * artifact has it, otherwise fall back to the first key. "All" is Home's
 * merged view and never a real quota profile. */
export function resolveLifeView(
  snapshot: HomeSnapshot,
  current: string = homeProfileName(snapshot.analytics),
): LifeView {
  const all = snapshot.quota?.profiles ?? {};
  const name = current && current !== "All" && all[current]
    ? current
    : Object.keys(all)[0] ?? "";
  return {
    name,
    profile: name ? all[name] ?? null : null,
    snapshot,
  };
}

/** Resolves the reports dir through the existing T-3 resolver in tests and
 * production alike. */
export async function loadLife(dir?: string): Promise<LifeView> {
  return resolveLifeView(await loadHomeSnapshot(dir));
}
