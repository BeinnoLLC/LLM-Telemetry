// @vitest-environment node
// LLMTELEMET-282 (T-3): the events feed reads the collectors' artifacts
// (examples/reports/live-data.json is the same shape collect_live.py writes).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { collectFromLiveArtifact } from "../../lib/live-feed";

const repoRoot = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));

describe("collectFromLiveArtifact", () => {
  const artifact = JSON.parse(
    readFileSync(join(repoRoot, "examples/reports/live-data.json"), "utf8"),
  ) as Record<string, unknown>;
  const snap = collectFromLiveArtifact(artifact, 1700000000);

  it("keeps the artifact payload and its schema_version on the snapshot", () => {
    expect(snap.schema_version).toBe(artifact.schema_version);
    expect(snap.profiles).toEqual(artifact.profiles);
  });

  it("derives one diffable task row per live session", () => {
    const tasks = snap.tasks ?? {};
    const keys = Object.keys(tasks);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.includes(":"))).toBe(true); // <profile>:<session>
    for (const row of Object.values(tasks)) {
      expect(typeof row.status).toBe("string");
      expect(row.worker).toBe(true); // departures must report "finished"
    }
  });

  it("takes at: from the artifact clock, not wall time", () => {
    expect(snap.at).toBe(Number(artifact.generated) || 1700000000);
  });
});
