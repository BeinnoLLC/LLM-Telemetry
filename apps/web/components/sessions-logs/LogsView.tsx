"use client";

// T-23 RUN C: read-only Logs page. Every value is derived from logs-data.json;
// the payload is fetched once from the same allowlisted /api/data route the
// Python oracle uses. No live ~/.hermes read, no invented event, no editor.
import { useEffect, useMemo, useState } from "react";

import { LOGS_URL } from "../../lib/sessions-logs/load";
import { providerIcon } from "../../lib/home-board/provider-icons";
import {
  activeLabel,
  buildLogsCsv,
  EMPTY_SELECTION,
  LOGS_FACET_KEYS,
  LOGS_FACET_LABELS,
  LOGS_ROW_CAP,
  filteredLogs,
  firstLogsProfile,
  fmtLogsCount,
  logMeta,
  logRowClass,
  logsCapNote,
  logsFacetGroups,
  logsOverflowNote,
  logsRenderError,
  logsSchemaProblem,
  logsScope,
  logTag,
  logTime,
  requestedLogsProfile,
  type LogsFacetKey,
  type LogsPayload,
  type LogsProfile,
  type LogsSelection,
  type LogsWindow,
  type LogEvent,
} from "../../lib/sessions-logs/logs";
import "../../styles/logs-view.css";

const WINDOWS: ReadonlyArray<{ value: LogsWindow; label: string }> = [
  { value: 1, label: "1h" },
  { value: 6, label: "6h" },
  { value: 24, label: "24h" },
  { value: 0, label: "All loaded" },
];

const SEARCH_PLACEHOLDER = "Search text, tool, session…";

/** SVG-only provider mark; never a letter or two-letter monogram. */
function ProviderMark({ model, className }: { model: string; className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d={providerIcon(model)} />
    </svg>
  );
}

/** drawer.js:221-226 — a chip is a Set toggle: click again to remove it. */
function toggleValue(
  selection: LogsSelection,
  key: LogsFacetKey,
  value: string,
): LogsSelection {
  const current = selection[key];
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
  return { ...selection, [key]: next };
}

function activeCount(selection: LogsSelection): number {
  return Object.values(selection).reduce((total, values) => total + values.length, 0);
}

export default function LogsView() {
  const [payload, setPayload] = useState<LogsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<LogsSelection>(EMPTY_SELECTION);
  const [windowHours, setWindowHours] = useState<LogsWindow>(24);
  const [query, setQuery] = useState("");
  const [openRows, setOpenRows] = useState<ReadonlySet<number>>(new Set());
  // Python's drawer reads LOGS.profiles[current]; the merged "All" analytics
  // tab has no logs profile, so an absent/unknown ?profile= falls back to the
  // first real key. The query is the only profile choice this read-only page
  // needs — no profile editor and no second fetch.
  const [requestedProfile] = useState<string | null>(() =>
    typeof window === "undefined" ? null : requestedLogsProfile(window.location.search),
  );

  useEffect(() => {
    const controller = new AbortController();
    const url = `${LOGS_URL}?t=${Date.now()}`;
    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as LogsPayload;
        const problem = logsSchemaProblem(data);
        if (problem) throw new Error(problem);
        if (!firstLogsProfile(data, requestedProfile)) {
          throw new Error("logs-data.json: no profile to display");
        }
        setPayload(data);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        const detail = caught instanceof Error ? caught.message : String(caught);
        setError(logsRenderError(detail));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [requestedProfile]);

  const profile: LogsProfile | null = useMemo(
    () => firstLogsProfile(payload, requestedProfile),
    [payload, requestedProfile],
  );
  const groups = useMemo(() => (profile ? logsFacetGroups(profile) : []), [profile]);
  const rows: readonly LogEvent[] = useMemo(
    () => (profile ? filteredLogs(profile, selection, windowHours, query) : []),
    [profile, selection, windowHours, query],
  );
  const visible = rows.slice(0, LOGS_ROW_CAP);
  const filters = activeCount(selection);

  const activeChips = LOGS_FACET_KEYS.flatMap((key) =>
    selection[key].map((value) => ({ key, value })),
  );

  const clearAll = (): void => {
    setQuery("");
    setSelection(EMPTY_SELECTION);
  };

  const exportCsv = (): void => {
    const csv = buildLogsCsv(rows);
    const url = window.URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "log-events.csv";
    anchor.click();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  };

  const toggleRow = (index: number): void => {
    setOpenRows((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <main className="view lg-view" data-view="Logs">
      <h1>Logs</h1>

      <section className="card p-4 mb-3 lg-card lg-controls">
        <div className="lg-head">
          <span className="lbl">Log events</span>
          <span id="lgscope" className="muted lg-xs">
            {profile ? logsScope(profile) : "—"}
          </span>
          <span id="lgcountbadge" className="lg-badge" hidden={filters === 0}>
            {filters} filter{filters === 1 ? "" : "s"} active
          </span>
          <span className="lg-tools">
            <input
              id="lgq"
              className="lg-search"
              type="search"
              placeholder={SEARCH_PLACEHOLDER}
              aria-label="Search logs"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button id="lgclear" className="chip" type="button" onClick={clearAll}>
              Clear
            </button>
          </span>
        </div>

        <div id="lgactive" className={`lg-active${activeChips.length ? " show" : ""}`}>
          <span className="lbl">Active</span>
          {activeChips.map(({ key, value }) => {
            const label = profile ? activeLabel(profile, key, value) : value;
            return (
              <button
                key={`${key}:${value}`}
                className="lgactivechip"
                type="button"
                data-unfacet={key}
                data-val={value}
                onClick={() => setSelection((previous) => toggleValue(previous, key, value))}
              >
                <span className="lbl">{LOGS_FACET_LABELS[key]}:</span>{" "}
                {label}
                <span className="x">×</span>
              </button>
            );
          })}
        </div>

        <div className="lgfacets">
          {groups.map((group) => (
            <div key={group.key} className="lgfacet">
              <span className="lglbl">{group.label}:</span>
              <div className="lgchips">
                {group.items.length === 0 ? (
                  <span className="muted lg-xs">none</span>
                ) : (
                  group.items.map((item) => {
                    const on = selection[group.key].includes(item.value);
                    return (
                      <button
                        key={item.value}
                        className={`lgchip${on ? " on" : ""}`}
                        type="button"
                        data-facet={group.key}
                        data-val={item.value}
                        title={item.label}
                        onClick={() =>
                          setSelection((previous) =>
                            toggleValue(previous, group.key, item.value),
                          )
                        }
                      >
                        {group.key === "model" ? (
                          <ProviderMark model={item.value} className="lgprovlogo" />
                        ) : null}
                        <span>{item.label}</span>
                        <span className="n">{item.count}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ))}
          <div className="lgfacet">
            <span className="lglbl">Window</span>
            <div id="lgwin" className="lgchips lgwin">
              {WINDOWS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`lgchip${windowHours === value ? " on" : ""}`}
                  data-win={String(value)}
                  onClick={() => setWindowHours(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="card p-4 lg-card">
        <div className="lg-listhead">
          <span id="lgcount" className="muted lg-xs">
            {profile ? `${fmtLogsCount(rows.length)} shown` : "—"}
          </span>
          <span id="lgcap" className="muted lg-xs" hidden={!profile || !profile.capped}>
            {profile ? logsCapNote(profile) : ""}
          </span>
          <button id="lgcsv" className="chip" type="button" onClick={exportCsv}>
            Export CSV
          </button>
        </div>

        <div id="lglist" className="lglist">
          {loading ? (
            <div className="muted lg-xs">Loading log events…</div>
          ) : error ? (
            <div className="lgerror">{error}</div>
          ) : !profile ? (
            <div className="muted lg-xs">No log events in this window.</div>
          ) : rows.length === 0 ? (
            <div className="muted lg-xs">Nothing matches these filters.</div>
          ) : (
            <>
              {visible.map((event, index) => {
                const open = openRows.has(index);
                const tag = logTag(event);
                return (
                  <div
                    key={`${event.ts}:${event.session}:${index}`}
                    className={`lgev${open ? " open" : ""}`}
                    data-i={String(index)}
                    onClick={() => toggleRow(index)}
                  >
                    <span className="lgts">{logTime(event)}</span>
                    <span className={`lgtag ${logRowClass(event)}`} title={tag}>
                      {tag}
                    </span>
                    <span className="lgmsg">
                      {event.preview}
                      {open ? (
                        <span className="lgmeta">
                          <ProviderMark model={event.model} className="lgprovlogo" />
                          {logMeta(event)}
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
              {rows.length > LOGS_ROW_CAP ? (
                <div id="lgnote" className="muted lg-xs">
                  {logsOverflowNote(rows.length)}
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
