// LLMTELEMET-291 (T-20 RUN G): the default Python Home is its merged
// "all profiles" view (main.js:40-141 buildAll). Reproduce the fields Home
// reads, so parity runs against the same rows the oracle paints.
import type {
  AnalyticsData,
  AnalyticsProfile,
  LiveData,
} from "./types";

type Profiles<T> = Record<string, T> | null | undefined;

function namesOf<T>(profiles: Profiles<T>): string[] {
  return Object.keys(profiles ?? {}).filter((name) => name !== "All");
}

export function homeProfileName(data: AnalyticsData | null | undefined): string {
  const names = namesOf(data?.profiles);
  return names.length > 1 ? "All" : names[0] ?? "";
}

/** main.js:40-141 — concatenate rows, cap the two ranked lists, keep alerts
 * for the live KPI cards. Python only builds the merge for 2+ profiles. */
export function mergedAnalyticsProfile(
  data: AnalyticsData | null | undefined,
  name: string,
): AnalyticsProfile | null {
  const profiles = data?.profiles;
  if (name !== "All") return profiles?.[name] ?? null;
  const names = namesOf(profiles);
  if (names.length < 2) return null;
  const each = <K extends keyof AnalyticsProfile>(field: K): NonNullable<AnalyticsProfile[K]> =>
    names.flatMap((n) => (profiles?.[n]?.[field] as unknown[] | undefined) ?? []) as NonNullable<AnalyticsProfile[K]>;
  const fails = each("failures_recent").slice().sort((a, b) =>
    String(b.when ?? "").localeCompare(String(a.when ?? ""))).slice(0, 60);
  const recent = each("recent_sessions").slice().sort((a, b) =>
    Number(b.last_ts ?? 0) - Number(a.last_ts ?? 0)).slice(0, 40);
  return {
    rows: each("rows"),
    hour_rows: each("hour_rows"),
    sessions: each("sessions"),
    health: each("health"),
    alerts: each("alerts"),
    failures_recent: fails,
    recent_sessions: recent,
  };
}

/** live.js:1068-1078 — the merged live profile carries every real profile's
 * live slice. PI/agent feeds are global and stay on the snapshot. */
export function withMergedLiveProfile(
  live: LiveData | null | undefined,
  name: string,
): LiveData | null {
  if (name !== "All" || !live) return live ?? null;
  const profiles = live.profiles;
  const names = namesOf(profiles);
  if (names.length < 2) return live;
  const rows = names.flatMap((n) => profiles?.[n]?.live ?? []);
  return {
    ...live,
    profiles: { ...profiles, All: { ...(profiles?.[names[0]] ?? {}), live: rows } },
  };
}
