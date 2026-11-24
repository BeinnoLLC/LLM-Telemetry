// LLMTELEMET-291 (T-20 RUN B1): server-only loader (node:fs) for the Home
// snapshot. Import only from Server Components / route handlers, never from a
// client component. No network: reads the collectors' artifacts directly.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { reportsDir } from "../live-feed/artifacts";
import { checkSchemaVersion } from "./schema";
import type {
  AnalyticsData,
  Artifact,
  HomeSnapshot,
  LiveData,
  QuotaData,
  RouterData,
} from "./types";

const FILES = {
  analytics: "analytics-data.json",
  live: "live-data.json",
  router: "router-data.json",
  quota: "quota-data.json",
} as const;

async function readArtifact<T extends Artifact>(
  dir: string,
  section: keyof typeof FILES,
): Promise<T | null> {
  const file = FILES[section];
  let text: string;
  try {
    text = await readFile(join(dir, file), "utf8");
  } catch (error) {
    // A missing artifact is a null section with an n/a flag downstream,
    // never a fabricated zero (plan RUN B risk + live.js:265-268).
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file}: invalid JSON (${String(error)})`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${file}: expected a JSON object payload`);
  }
  // A wrong version is loud, like every other malformed artifact.
  checkSchemaVersion(file, (parsed as Artifact).schema_version);
  return parsed as T;
}

/** Resolves the reports dir once via the existing T-3 resolver, then loads
 * all four artifacts in parallel. Callers may override the dir in tests. */
export async function loadHomeSnapshot(
  dir: string = reportsDir(),
): Promise<HomeSnapshot> {
  const [analytics, live, router, quota] = await Promise.all([
    readArtifact<AnalyticsData>(dir, "analytics"),
    readArtifact<LiveData>(dir, "live"),
    readArtifact<RouterData>(dir, "router"),
    readArtifact<QuotaData>(dir, "quota"),
  ]);
  return { analytics, live, router, quota };
}
