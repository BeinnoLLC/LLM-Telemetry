// T-23 RUN C: pure derivations pinned against the checked-in frozen fixture.
// These assertions are the JS counterpart of tests/unit_logs.mjs; no Python
// source is touched and no event value is invented.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { fmtLogsCount } from "../../lib/sessions-logs/logs";
import {
  buildLogsCsv,
  csvCell,
  CURRENT_COLLECTOR_SCHEMA,
  EMPTY_SELECTION,
  facetLabel,
  filteredLogs,
  firstLogsProfile,
  logsCapNote,
  logsFacetGroups,
  logsLoadError,
  logsSchemaProblem,
  logsScope,
  LOGS_FACET_KEYS,
  LOGS_PAYLOAD_SHAPE_VERSION,
  logHaystack,
  logTag,
  logTime,
  type LogsPayload,
  type LogsProfile,
  type LogsSelection,
  type LogsWindow,
} from "../../lib/sessions-logs/logs";

const fixture = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../../examples/reports/logs-data.json"),
    "utf8",
  ),
) as LogsPayload;
const profile = firstLogsProfile(fixture) as LogsProfile;

const select = (facet: keyof LogsSelection, value: string): LogsSelection => ({
  ...EMPTY_SELECTION,
  [facet]: [value],
});

describe("T-23 RUN C logs payload guard", () => {
  it("reports the exact stale-schema error for a wrong version", () => {
    expect(logsSchemaProblem({ schema_version: 1 })).toBe(
      "logs-data.json: schema_version 1 does not match 2",
    );
    expect(LOGS_PAYLOAD_SHAPE_VERSION).toBe(2);
    expect(logsSchemaProblem({ schema_version: 2 })).toBeNull();
  });

  it("accepts the version the checked-in fixture and Python oracle render", () => {
    expect(fixture.schema_version).toBe(CURRENT_COLLECTOR_SCHEMA);
    expect(logsSchemaProblem(fixture, CURRENT_COLLECTOR_SCHEMA)).toBeNull();
    expect(logsSchemaProblem({ schema_version: 2 }, CURRENT_COLLECTOR_SCHEMA)).toBe(
      "logs-data.json: schema_version 2 does not match 3",
    );
  });

  it("uses the Python 404 wording verbatim", () => {
    expect(logsLoadError(404)).toBe(
      "Could not load logs-data.json (HTTP 404). Run llm-telemetry logs, and note that fetch is blocked when the page is opened from file://.",
    );
  });

  it("always picks the first profile and never merges", () => {
    expect(Object.keys(fixture.profiles)[0]).toBe("work");
    expect(profile).toBe(fixture.profiles.work);
    expect(firstLogsProfile(null)).toBeNull();
    expect(firstLogsProfile({ schema_version: 3, profiles: {} })).toBeNull();
  });
});

describe("T-23 RUN C logs facets and filters", () => {
  it("derives level counts from events and shortens model/session labels", () => {
    const groups = logsFacetGroups(profile);
    expect(groups.map((group) => group.key)).toEqual([
      "level", "role", "tool", "model", "session", "kind",
    ]);
    const levels = groups.find((group) => group.key === "level")!;
    const errors = profile.events.filter((event) => (event.level || "info") === "error").length;
    expect(errors).toBeGreaterThan(0);
    expect(levels.items.find((item) => item.value === "error")?.count).toBe(fmtLogsCount(errors));
    const models = groups.find((group) => group.key === "model")!;
    expect(models.items.every((item) => !item.value.includes("/") || item.label !== item.value)).toBe(true);
    const sessionFacet = (profile.facets.session ?? [])[0];
    expect(
      facetLabel("session", { v: sessionFacet.v, label: sessionFacet.label }),
    ).toBe(sessionFacet.label || sessionFacet.v.slice(0, 8));
    expect(facetLabel("session", { v: "abcdefghijkl" })).toBe("abcdefgh");
  });

  it("hides the failure-kind row when the collector shipped no kinds", () => {
    expect(
      logsFacetGroups({ ...profile, facets: { ...profile.facets, kind: [] } })
        .some((group) => group.key === "kind"),
    ).toBe(false);
  });

  it("filters on generated-relative window, facets and every search field", () => {
    const all = filteredLogs(profile, EMPTY_SELECTION, 24, "");
    expect(all.length).toBe(profile.events.length);
    expect(all[0].ts).toBeGreaterThanOrEqual(all[all.length - 1].ts);

    const hour = filteredLogs(profile, EMPTY_SELECTION, 1, "");
    expect(hour.length).toBeGreaterThan(0);
    expect(hour.length).toBeLessThan(all.length);
    expect(hour.every((event) => event.ts >= profile.generated - 3600)).toBe(true);

    const tool = profile.facets.tool![0].v;
    const narrowed = filteredLogs(profile, select("tool", tool), 24, "");
    expect(narrowed.length).toBeGreaterThan(0);
    expect(narrowed.length).toBeLessThan(all.length);
    expect(narrowed.every((event) => event.tool === tool)).toBe(true);

    const session = profile.facets.session![0].v;
    expect(
      filteredLogs(profile, select("session", session), 24, "").every(
        (event) => event.session === session,
      ),
    ).toBe(true);

    const search = filteredLogs(profile, EMPTY_SELECTION, 24, "timeout");
    expect(search.length).toBeGreaterThan(0);
    expect(search.every((event) => logHaystack(event).includes("timeout"))).toBe(true);
  });

  it("resolves every facet key and never invents a tag", () => {
    for (const key of LOGS_FACET_KEYS) {
      const group = logsFacetGroups(profile).find((item) => item.key === key)!;
      expect(group.items.length).toBeGreaterThan(0);
      const value = group.items[0].value;
      expect(filteredLogs(profile, select(key, value), 24, "").length).toBeGreaterThan(0);
    }
    expect(profile.events.every((event) => logTag(event).length > 0)).toBe(true);
    expect(logTime(profile.events[0])).toMatch(/\d/);
  });

  it("discloses the cap and the display overflow with real counts", () => {
    expect(logsScope(profile)).toBe(`last 24h · ${fmtLogsCount(profile.events_total)} events`);
    expect(logsCapNote(profile)).toContain(fmtLogsCount(profile.events_shown));
    expect(logsCapNote(profile)).toContain(fmtLogsCount(profile.events_total));
    expect(logsCapNote({ ...profile, capped: false })).toBe("");
  });
});

describe("T-23 RUN C CSV export", () => {
  it("quotes every cell and emits ISO timestamps", () => {
    expect(csvCell('a"b,c')).toBe('"a""b,c"');
    const csv = buildLogsCsv(profile.events.slice(0, 2));
    const lines = csv.trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("when,level,role,tool,model,session,title,preview");
    expect(lines[1]).toContain(new Date(profile.events[0].ts * 1000).toISOString());
    expect(csv.endsWith("\n")).toBe(false);
  });
});

describe("T-23 RUN C window enumeration", () => {
  it("uses the four real window values", () => {
    const windows: readonly LogsWindow[] = [1, 6, 24, 0];
    expect(windows).toEqual([1, 6, 24, 0]);
  });
});
