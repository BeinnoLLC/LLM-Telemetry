"use client";

// LLMTELEMET-291 (T-20 RUN D2): nine sortable headers over eight grid tracks.
// Elapsed is a second header inside the State track because its value is the
// second line of every State cell (live.js:349-369, 445-456).
import type { LiveSortKey, SortDir } from "../../lib/home/live-rows";

export interface LiveSortState {
  key: LiveSortKey | null;
  dir: SortDir;
}

export const LIVE_COLUMNS: ReadonlyArray<{
  key: LiveSortKey;
  label: string;
  numeric?: boolean;
}> = [
  { key: "kind", label: "Kind" },
  { key: "session", label: "Session" },
  { key: "model", label: "Model" },
  { key: "state", label: "State" },
  { key: "elapsed", label: "Elapsed", numeric: true },
  { key: "tokens", label: "Tokens", numeric: true },
  { key: "cost", label: "Cost", numeric: true },
  { key: "activity", label: "Last activity" },
  { key: "load", label: "Load", numeric: true },
];

interface LiveHeaderProps {
  sort: LiveSortState;
  onSort: (key: LiveSortKey) => void;
}

export default function LiveHeader({ sort, onSort }: LiveHeaderProps) {
  const header = (index: number) => {
    const column = LIVE_COLUMNS[index];
    const active = sort.key === column.key;
    const ariaSort = active
      ? sort.dir === "desc" ? "descending" : "ascending"
      : "none";
    return (
      <div
        key={column.key}
        className={`lvh${column.numeric ? " lvh-num" : ""}`}
        role="columnheader"
        aria-sort={ariaSort}
      >
        <button
          type="button"
          className="lvh-btn"
          data-sort={column.key}
          title={`Sort by ${column.label.toLowerCase()}`}
          onClick={() => onSort(column.key)}
        >
          <span>{column.label}</span>
          <span className="lv-arr" aria-hidden="true">
            {active ? (sort.dir === "desc" ? "▼" : "▲") : ""}
          </span>
        </button>
      </div>
    );
  };

  return (
    <div className="lvhead" role="row">
      {LIVE_COLUMNS.map((column, index) =>
        column.key === "state" ? (
          <div key="state-elapsed" className="lvhgrp" role="presentation">
            {header(index)}
            {header(index + 1)}
          </div>
        ) : column.key === "elapsed" ? null : header(index),
      )}
    </div>
  );
}
