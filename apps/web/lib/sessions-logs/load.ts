// T-23 RUN A: client-side loaders for the three allowlisted report artifacts.
// Every value comes from /api/data; no invented events and no live ~/.hermes.
import {
  homeProfileName,
  mergedAnalyticsProfile,
} from "../home-board/all-profile";
import type {
  AnalyticsProfileResult,
  SessionAnalyticsData,
  SessionLog,
  SessionLogsData,
  TranscriptData,
} from "./types";

export const ANALYTICS_URL = "/api/data/analytics-data.json";
export const LOGS_URL = "/api/data/logs-data.json";
export const TRANSCRIPTS_URL = "/api/data/transcripts.json";

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** Mirrors main.js buildAll: two or more profiles are merged into "All". */
export async function loadAnalyticsProfile(
  signal?: AbortSignal,
): Promise<AnalyticsProfileResult> {
  const payload = await getJson<SessionAnalyticsData>(ANALYTICS_URL, signal);
  const profileName = homeProfileName(payload);
  const profile = mergedAnalyticsProfile(payload, profileName);
  return {
    rows: (profile?.rows ?? []) as AnalyticsProfileResult["rows"],
    profiles: Object.keys(payload.profiles ?? {}).filter((name) => name !== "All"),
    generated: payload.generated ?? null,
    version: Number(payload.schema_version ?? 0),
    profileName,
    payload: payload as AnalyticsProfileResult["payload"],
  };
}

/** logs.js:lgProfile always picks the first profile key for the drawer. */
export async function loadLogsProfile(signal?: AbortSignal): Promise<{
  rows: SessionLog[];
  profiles: string[];
  version: number;
}> {
  const payload = await getJson<SessionLogsData>(LOGS_URL, signal);
  if (Number(payload.schema_version) !== 2) {
    throw new Error(`logs-data.json: schema_version ${String(payload.schema_version)} does not match 2`);
  }
  const names = Object.keys(payload.profiles ?? {});
  return {
    rows: (payload.profiles?.[names[0]]?.logs ?? []) as SessionLog[],
    profiles: names,
    version: Number(payload.schema_version),
  };
}

/** drawer.js:520-527 — every open refetches the bounded artifact; a closed
 * modal never holds a stale cache. The cache-buster is the only query
 * parameter; the API serves the whole allowlisted artifact, just like the
 * Python static GET. */
export async function loadTranscript(
  profile: string,
  id: string,
  now: number,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const url = `${TRANSCRIPTS_URL}?${new URLSearchParams({ t: String(Math.floor(now)) })}`;
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json()) as TranscriptData;
  const messages =
    (payload.profiles?.[profile]?.[id] ?? payload.sessions?.[id] ?? []) as unknown[];
  return Array.isArray(messages) ? messages : [];
}

interface RecentSession {
  id?: unknown;
  profile?: unknown;
}

type SessionProfiles = Record<string, { recent_sessions?: RecentSession[] }>;

export interface SessionOpener {
  id: string;
  profile: string;
}

export interface SessionOpeners {
  opener?: SessionOpener;
  profiles: Record<string, string>;
}

function recentId(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** main.js:86 — the merge annotates every recent session with the real profile
 * key that owns it (`{...r, profile: n}`). Callers rendering the merged "All"
 * view must use that key, never the synthetic profile name, when opening a
 * transcript or the messages resolve to zero. */
export function sessionOpeners(payload: object, profileName: string): SessionOpeners {
  const source = payload as { profiles?: SessionProfiles };
  const entries = Object.entries(source.profiles ?? {}).filter(([name]) => name !== "All");
  const profiles: Record<string, string> = {};
  for (const [name, profile] of entries) {
    for (const item of profile?.recent_sessions ?? []) {
      const id = recentId(item?.id);
      if (!id) continue;
      profiles[id] =
        typeof item?.profile === "string" && item.profile ? item.profile : name;
    }
  }
  const ordered =
    profileName && profileName !== "All"
      ? [...entries.filter(([name]) => name === profileName), ...entries.filter(([name]) => name !== profileName)]
      : entries;
  for (const [name, profile] of ordered) {
    for (const item of profile?.recent_sessions ?? []) {
      const id = recentId(item?.id);
      if (id) return { opener: { id, profile: profiles[id] ?? name }, profiles };
    }
  }
  return { profiles };
}

/** Real (profile, id) pair shipped to the drawer as its fallback opener. */
export function firstSessionOpener(
  payload: object,
  profileName: string,
): SessionOpener | undefined {
  return sessionOpeners(payload, profileName).opener;
}
