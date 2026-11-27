// T-23 RUN C: pure Logs-page derivations. Ported one-for-one from the read-only
// Python oracle (drawer.js:lgProfile/lgMatch/lgWindow/lgChips/lgFilter/lgRows
// and js/main.js:loadLogs). Nothing here invents an event: every row, count and
// label comes from logs-data.json's first profile.
import { short } from "./format";

/**
 * palette.js:150 — the Python dashboard's `fmt` uses compact K/M/B suffixes.
 * Reimplementing it here keeps scope, cap and facet counts identical to the
 * oracle rather than swapping in Intl grouping.
 */
export function fmtLogsCount(value: number): string {
  const n = Number(value) || 0;
  for (const [suffix, divisor] of [["B", 1e9], ["M", 1e6], ["K", 1e3]] as const) {
    if (n >= divisor) return (n / divisor).toFixed(1) + suffix;
  }
  return String(Math.round(n));
}

export const LOGS_FACET_KEYS = [
  "level",
  "role",
  "tool",
  "model",
  "session",
  "kind",
] as const;
export type LogsFacetKey = (typeof LOGS_FACET_KEYS)[number];

/** drawer.js:132 — the failure row is labelled "Failure", not "kind". */
export const LOGS_FACET_LABELS: Readonly<Record<LogsFacetKey, string>> = Object.freeze({
  level: "Level",
  role: "Role",
  tool: "Tool",
  model: "Model",
  session: "Session",
  kind: "Kind",
});
export type LogsWindow = 0 | 1 | 6 | 24;

/**
 * The RUN C spec calls this the "logs v2" payload shape; the collector stamps
 * every artifact with schema.py:SCHEMA_VERSION. When the spec was written that
 * stamp was 2, while the checked-in fixture (and the Python oracle) now stamp
 * 3. `logsSchemaProblem` takes the expected stamp explicitly so the pure check
 * stays strict and the page can name the version its oracle actually renders.
 */
export const LOGS_PAYLOAD_SHAPE_VERSION = 2;
export const CURRENT_COLLECTOR_SCHEMA = 3;
/** T-23 display cap; disclosed with the oracle's overflow-note wording. */
export const LOGS_ROW_CAP = 200;

export interface LogEvent {
  ts: number;
  session: string;
  title: string;
  role: string;
  tool: string;
  model: string;
  level: string;
  kind: string;
  preview: string;
}

export interface LogFacet {
  v: string;
  label?: string;
  n: number;
}

export interface LogsProfile {
  events: LogEvent[];
  window_h: number;
  events_total: number;
  events_shown: number;
  errors_shown: number;
  capped: boolean;
  cap: number;
  facets: Partial<Record<LogsFacetKey, LogFacet[]>>;
  generated: number;
}

export interface LogsPayload {
  schema_version: number | string;
  profiles: Record<string, LogsProfile>;
}

export type LogsSelection = Readonly<Record<LogsFacetKey, readonly string[]>>;

export const EMPTY_SELECTION: LogsSelection = Object.freeze({
  level: [],
  role: [],
  tool: [],
  model: [],
  session: [],
  kind: [],
});

/** views.js:25-31 — strict schema guard, with the oracle's exact wording. */
export function logsSchemaProblem(
  payload: unknown,
  expected: number = CURRENT_COLLECTOR_SCHEMA,
): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "logs-data.json: not a JSON object";
  }
  const record = payload as Partial<LogsPayload>;
  if (!("schema_version" in record)) {
    return "logs-data.json is a stale payload (no schema_version) — re-run `llm-telemetry dashboard`";
  }
  // Strict identity, not Number() coercion: a string "3" is stale too.
  if (record.schema_version !== expected) {
    return `logs-data.json has schema_version ${JSON.stringify(
      record.schema_version,
    )}, this page expects ${expected} — re-run \`llm-telemetry dashboard\``;
  }
  return null;
}

/** drawer.js:162-163 — the one outer wrapper around every load failure. */
export function logsRenderError(detail: string): string {
  return `Could not load logs-data.json (${detail}). Run llm-telemetry logs, and note that fetch is blocked when the page is opened from file://.`;
}

/** HTTP/non-OK fetch message, identical to drawer.js:loadLogs(). */
export function logsLoadError(status: number | string): string {
  return logsRenderError(`HTTP ${status}`);
}

/**
 * drawer.js:92-97 — `LOGS.profiles[current]` wins when the page names a
 * profile; the first real key is only the fallback for the merged "All" tab.
 */
export function requestedLogsProfile(search: string): string | null {
  if (typeof search !== "string") return null;
  return new URLSearchParams(search).get("profile");
}

export function firstLogsProfile(
  payload: LogsPayload | null,
  requested?: string | null,
): LogsProfile | null {
  if (!payload) return null;
  const profiles = payload.profiles ?? {};
  if (requested && Object.prototype.hasOwnProperty.call(profiles, requested)) {
    return profiles[requested] ?? null;
  }
  const names = Object.keys(profiles);
  if (names.length === 0) return null;
  return profiles[names[0]] ?? null;
}

/** drawer.js:246-252 — chip captions. Model and session values stay shortened. */
export function facetLabel(key: LogsFacetKey, facet: Pick<LogFacet, "v" | "label">): string {
  if (key === "model") return short(facet.v);
  if (key === "session") return facet.label || facet.v.slice(0, 8);
  return facet.v;
}

/** The active-strip label uses the same derivation as the source chip. */
export function activeLabel(profile: LogsProfile, key: LogsFacetKey, value: string): string {
  if (key === "model") return short(value);
  if (key === "session") {
    const facet = (profile.facets.session ?? []).find((item) => item.v === value);
    return facet ? facetLabel("session", facet) : value.slice(0, 8);
  }
  return value;
}

export interface LogsFacetGroup {
  key: LogsFacetKey;
  label: string;
  items: ReadonlyArray<{ value: string; label: string; count: string }>;
}

/**
 * drawer.js:220-253. Level counts come from the shipped events (the oracle's
 * `counts(p.events, "level")`); the other five come from `p.facets`, whose counts
 * already cover the full window. Never fabricate a missing facet row: `kind` is
 * hidden when the collector shipped no failure-kind values.
 */
export function logsFacetGroups(profile: LogsProfile): LogsFacetGroup[] {
  const levelCounts = new Map<string, number>();
  profile.events.forEach((event) => {
    const value = event.level || "info";
    levelCounts.set(value, (levelCounts.get(value) ?? 0) + 1);
  });
  const levels = [...levelCounts.entries()]
    .map(([v, n]) => ({ v, n }))
    .sort((a, b) => b.n - a.n || a.v.localeCompare(b.v));

  return LOGS_FACET_KEYS.flatMap((key): LogsFacetGroup[] => {
    const raw = key === "level"
      ? levels
      : ((profile.facets[key] ?? []) as LogFacet[]);
    if (key === "kind" && raw.length === 0) return [];
    return [{
      key,
      label: LOGS_FACET_LABELS[key],
      // drawer.js:121-125 renders every shipped facet value; no silent 24-item cut.
      items: raw.map((facet) => ({
        value: facet.v,
        label: facetLabel(key, facet),
        count: fmtLogsCount(facet.n),
      })),
    }];
  });
}

/** drawer.js:263 — one lowercase haystack per event. */
export function logHaystack(event: LogEvent): string {
  return [
    event.preview ?? "",
    event.tool ?? "",
    event.title ?? "",
    event.model ?? "",
    event.session ?? "",
  ].join(" ").toLowerCase();
}

/**
 * drawer.js:262-267. The window is relative to the payload's own `generated`
 * stamp, never to wall-clock time — the fixture is frozen and must stay stable.
 */
export function matchesLogs(
  event: LogEvent,
  selection: LogsSelection,
  windowHours: LogsWindow,
  query: string,
  generated: number,
): boolean {
  // drawer.js:105 — the "All loaded" window has no cutoff at all.
  if (windowHours > 0) {
    const cutoff = (generated || Date.now() / 1000) - windowHours * 3600;
    if (event.ts < cutoff) return false;
  }
  for (const key of LOGS_FACET_KEYS) {
    const chosen = selection[key];
    if (chosen.length === 0) continue;
    const value = key === "level"
      ? (event.level || "info")
      : key === "kind"
        ? (event.kind || "")
        : String(event[key] ?? "");
    // drawer.js:100-105 — each facet is a Set: selected values are OR, so an
    // event matches when it carries any one of them. Facets themselves AND.
    if (chosen.length > 0 && !chosen.some((selected) => selected === value)) return false;
  }
  const needle = query.trim().toLowerCase();
  return needle === "" || logHaystack(event).includes(needle);
}

/** drawer.js:275-276 — newest first, capped only for display. */
export function filteredLogs(
  profile: LogsProfile,
  selection: LogsSelection,
  windowHours: LogsWindow,
  query: string,
): LogEvent[] {
  return profile.events
    .filter((event) => matchesLogs(event, selection, windowHours, query, profile.generated))
    .sort((a, b) => b.ts - a.ts);
}

/** drawer.js:69-78 — tag, CSS class and the second line of a row. */
export function logTag(event: LogEvent): string {
  return event.level === "error" ? (event.kind || "error") : (event.tool || event.role);
}

export function logRowClass(event: LogEvent): string {
  return event.level === "error" ? "error" : event.role;
}

export function logMeta(event: LogEvent): string {
  return [event.title, short(event.model ?? "")].filter(Boolean).join(" · ");
}

/** drawer.js:43-49 — timestamp caption. Locale/timezone come from the browser. */
export function logTime(event: LogEvent): string {
  return new Date(event.ts * 1000).toLocaleTimeString();
}

/** drawer.js:389-390 — scope, including the disclosed shipment cap. */
export function logsScope(profile: LogsProfile): string {
  return `last ${profile.window_h || 24}h · ${fmtLogsCount(profile.events_total)} events`;
}

export function logsCapNote(profile: LogsProfile): string {
  if (!profile.capped) return "";
  return `· newest ${fmtLogsCount(profile.events_shown)} of ${fmtLogsCount(
    profile.events_total,
  )} in the last ${profile.window_h || 24}h — filter counts cover the full window`;
}

/** drawer.js:213-215 — the oracle's sentence, with this page's 200-row cap. */
export function logsOverflowNote(matched: number): string {
  return `Showing the newest ${fmtLogsCount(LOGS_ROW_CAP)} of ${fmtLogsCount(
    matched,
  )} matches — narrow the filters to see more.`;
}

/**
 * drawer.js:239-248 — the CSV header and column order are part of the oracle
 * contract. Every cell is quoted; the timestamp is ISO, never a local guess.
 */
export const LOGS_CSV_HEADER = [
  "when",
  "level",
  "role",
  "tool",
  "model",
  "session",
  "title",
  "preview",
] as const;

export function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function buildLogsCsv(events: readonly LogEvent[]): string {
  const lines = [LOGS_CSV_HEADER.join(",")];
  events.forEach((event) => {
    lines.push([
      new Date(event.ts * 1000).toISOString(),
      event.level,
      event.role,
      event.tool,
      event.model,
      event.session,
      event.title,
      event.preview,
    ].map(csvCell).join(","));
  });
  return lines.join("\n");
}
