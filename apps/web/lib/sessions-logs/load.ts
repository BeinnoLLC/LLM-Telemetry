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

const transcripts = new Map<string, unknown[]>();

/** drawer.js:504-546 — one on-demand fetch per (profile, id), cached for the
 * drawer session. The cache-buster is the only query parameter; the API serves
 * the whole allowlisted artifact, just like the Python static GET. */
export async function loadTranscript(
  profile: string,
  id: string,
  now: number,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const key = `${profile}|${id}`;
  const cached = transcripts.get(key);
  if (cached) return cached;
  const url = `${TRANSCRIPTS_URL}?${new URLSearchParams({ t: String(Math.floor(now)) })}`;
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json()) as TranscriptData;
  const messages =
    (payload.profiles?.[profile]?.[id] ?? payload.sessions?.[id] ?? []) as unknown[];
  const values = Array.isArray(messages) ? messages : [];
  transcripts.set(key, values);
  return values;
}
