// @vitest-environment node
// LLMTELEMET-291 (T-20 RUN B1): the Home loader reads the repo's real sample
// artifacts from a temp reports dir; no collector runs and no live :8477 data.
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { compact, num, parseGenerated } from "../../lib/home/format";
import { loadHomeSnapshot } from "../../lib/home/load";
import { EXPECTED_SCHEMA_VERSION } from "../../lib/home/schema";
import type { HomeSnapshot } from "../../lib/home/types";

const repoRoot = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));
const samples = join(repoRoot, "examples/reports");
const files = [
  "analytics-data.json",
  "live-data.json",
  "router-data.json",
  "quota-data.json",
];
const savedDir = process.env.LLM_TELEMETRY_REPORTS_DIR;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lst-291-home-"));
  for (const file of files) copyFileSync(join(samples, file), join(dir, file));
  process.env.LLM_TELEMETRY_REPORTS_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (savedDir === undefined) delete process.env.LLM_TELEMETRY_REPORTS_DIR;
  else process.env.LLM_TELEMETRY_REPORTS_DIR = savedDir;
});

const callsTotal = (snap: HomeSnapshot): number =>
  Object.values(snap.analytics?.profiles ?? {}).reduce(
    (total, profile) =>
      total + (profile.rows ?? []).reduce((sum, row) => sum + num(row.calls), 0),
    0,
  );

describe("loadHomeSnapshot", () => {
  it("loads all four sample artifacts through the existing reportsDir resolver", async () => {
    const snap = await loadHomeSnapshot();
    for (const key of ["analytics", "live", "router", "quota"] as const) {
      expect(snap[key]).not.toBeNull();
      expect(snap[key]?.schema_version).toBe(EXPECTED_SCHEMA_VERSION);
    }
    expect(callsTotal(snap)).toBeGreaterThan(0);
  });

  it("derives identical numbers from two successive loads", async () => {
    const first = callsTotal(await loadHomeSnapshot());
    const second = callsTotal(await loadHomeSnapshot());
    expect(first).toBe(second);
  });

  it("throws a clear error on a wrong schema_version", async () => {
    const file = join(dir, "analytics-data.json");
    const payload = JSON.parse(readFileSync(file, "utf8"));
    payload.schema_version = 99;
    writeFileSync(file, JSON.stringify(payload));
    await expect(loadHomeSnapshot()).rejects.toThrow(
      /analytics-data\.json: schema_version 99 does not match page version 3/,
    );
  });

  it("gives a null section when an artifact is absent, never zeros", async () => {
    rmSync(join(dir, "quota-data.json"));
    const snap = await loadHomeSnapshot();
    expect(snap.quota).toBeNull();
    expect(snap.analytics).not.toBeNull();
    expect(snap.live).not.toBeNull();
    expect(snap.router).not.toBeNull();
  });
});

describe("format helpers", () => {
  it("coerces numeric strings exactly like +x || 0", () => {
    expect(num("123")).toBe(123);
    expect(num(" 7 ")).toBe(7);
    expect(num("-4")).toBe(-4);
    for (const value of [null, undefined, "", "abc", NaN]) expect(num(value)).toBe(0);
    expect(compact("2500")).toBe("2.5K");
  });

  it("parses both ISO and numeric epoch generated values", () => {
    expect(parseGenerated("2026-09-25T13:51:09")).toBe(
      Date.parse("2026-09-25T13:51:09Z") / 1000,
    );
    expect(parseGenerated(1790000000)).toBe(1790000000);
    expect(parseGenerated("1790000000")).toBe(1790000000);
    expect(parseGenerated(null)).toBeNull();
  });
});
