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
  logsOverflowNote,
  logsRenderError,
  logsSchemaProblem,
  logsScope,
  LOGS_FACET_KEYS,
  LOGS_PAYLOAD_SHAPE_VERSION,
  logHaystack,
  logTag,
  logTime,
  requestedLogsProfile,
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
  it("uses views.js's exact stale-payload and version-mismatch wording", () => {
    expect(logsSchemaProblem(null)).toBe("logs-data.json: not a JSON object");
    expect(logsSchemaProblem([])).toBe("logs-data.json: not a JSON object");
    expect(logsSchemaProblem({})).toBe(
      "logs-data.json is a stale payload (no schema_version) — re-run `llm-telemetry dashboard`",
    );
    expect(logsSchemaProblem({ schema_version: 1 })).toBe(
      "logs-data.json has schema_version 1, this page expects 3 — re-run `llm-telemetry dashboard`",
    );
    // Strict !==, like views.js:29: a stringified version is stale too.
    expect(logsSchemaProblem({ schema_version: "3" })).toBe(
      'logs-data.json has schema_version "3", this page expects 3 — re-run `llm-telemetry dashboard`',
    );
    expect(logsSchemaProblem({ schema_version: 3 })).toBeNull();
  });

  it("accepts the version the checked-in fixture and Python oracle render", () => {
    expect(fixture.schema_version).toBe(CURRENT_COLLECTOR_SCHEMA);
    expect(logsSchemaProblem(fixture)).toBeNull();
    expect(LOGS_PAYLOAD_SHAPE_VERSION).toBe(2);
    expect(logsSchemaProblem({ schema_version: 2 })).toBe(
      "logs-data.json has schema_version 2, this page expects 3 — re-run `llm-telemetry dashboard`",
    );
  });

  it("uses the Python outer wrapper for HTTP and every other detail", () => {
    const hint =
      "Run llm-telemetry logs, and note that fetch is blocked when the page is opened from file://.";
    expect(logsLoadError(404)).toBe(`Could not load logs-data.json (HTTP 404). ${hint}`);
    expect(logsRenderError("boom")).toBe(`Could not load logs-data.json (boom). ${hint}`);
    expect(logsRenderError(`HTTP 500`)).toBe(logsLoadError(500));
  });

  it("honours the chosen profile before falling back to the first key", () => {
    expect(Object.keys(fixture.profiles)[0]).toBe("work");
    expect(profile).toBe(fixture.profiles.work);
    expect(requestedLogsProfile("?profile=personal&x=1")).toBe("personal");
    expect(requestedLogsProfile("")).toBeNull();
    expect(firstLogsProfile(fixture, "personal")).toBe(fixture.profiles.personal);
    expect(firstLogsProfile(fixture, "missing")).toBe(fixture.profiles.work);
    expect(firstLogsProfile(fixture, "All")).toBe(fixture.profiles.work);
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

  it("renders every shipped facet value instead of truncating at 24", () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      v: `tool-${index}`,
      n: index + 1,
    }));
    const group = logsFacetGroups({
      ...profile,
      facets: { ...profile.facets, tool: many },
    }).find((item) => item.key === "tool")!;
    expect(group.items).toHaveLength(30);
    expect(group.items[29]).toEqual({ value: "tool-29", label: "tool-29", count: "30" });
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

  it("ORs selected values inside one facet and ANDs across facets", () => {
    const [first, second] = profile.facets.tool!.slice(0, 2).map((facet) => facet.v);
    const both: LogsSelection = { ...EMPTY_SELECTION, tool: [first, second] };
    const union = filteredLogs(profile, both, 24, "");
    const expected = profile.events.filter((event) => event.tool === first || event.tool === second);
    expect(union.length).toBe(expected.length);
    expect(union.length).toBeGreaterThan(
      filteredLogs(profile, select("tool", first), 24, "").length,
    );
    const narrowed = filteredLogs(profile, { ...both, role: ["tool"] }, 24, "");
    expect(narrowed.every((event) => event.tool === first || event.tool === second)).toBe(true);
    expect(narrowed.every((event) => event.role === "tool")).toBe(true);
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
    expect(logsOverflowNote(683)).toBe(
      "Showing the newest 200 of 683 matches — narrow the filters to see more.",
    );
    expect(logsOverflowNote(2340)).toBe(
      "Showing the newest 200 of 2.3K matches — narrow the filters to see more.",
    );
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
