// LLMTELEMET-293 (T-22 RUN A): one server-only snapshot loader for both
// artifacts the Usage view reads. No network and no collectors: the files are
// the ones collect_analytics and build_costs already wrote. A missing file is
// a null section (n/a downstream); a wrong schema_version is refused loudly,
// matching the Python boot guard and the T-20 Home loader.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { reportsDir } from "../live-feed/artifacts";
import { checkSchemaVersion } from "../home-board/schema";
import type {
  AnalyticsData,
  Artifact,
  CostsData,
  UsageSnapshot,
} from "./types";

const FILES = {
  analytics: "analytics-data.json",
  costs: "costs-data.json",
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
  checkSchemaVersion(file, (parsed as Artifact).schema_version);
  return parsed as T;
}

/** Resolve the reports dir once, then load analytics and costs in parallel. */
export async function loadUsageSnapshot(
  dir: string = reportsDir(),
): Promise<UsageSnapshot> {
  const [analytics, costs] = await Promise.all([
    readArtifact<AnalyticsData>(dir, "analytics"),
    readArtifact<CostsData>(dir, "costs"),
  ]);
  return { analytics, costs, dir };
}
