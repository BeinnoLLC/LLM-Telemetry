"use client";

// LLMTELEMET-291 (T-20 RUN D2): the Home "In progress now" table.
// The live snapshot comes from the T-3 stream through useLiveHome; rows come
// from the RUN D1 pure shapers, so this component never recomputes a cell
// value. React keys are the stable shaped row keys, keeping focus and scroll
// anchors alive across five-second polls.
import { useMemo, useState } from "react";

import { buildLiveRows, sortRows } from "../../lib/home/live-rows";
import type { LiveSortKey } from "../../lib/home/live-rows";
import type { HomeSnapshot } from "../../lib/home/types";
import LiveHeader, { type LiveSortState } from "./LiveHeader";
import LiveRow from "./LiveRow";
import { useLiveHome } from "./useLiveHome";

interface LiveTableProps {
  initial: HomeSnapshot;
  name: string;
}

export default function LiveTable({ initial, name }: LiveTableProps) {
  const live = useLiveHome(initial);
  const [sort, setSort] = useState<LiveSortState>({ key: null, dir: "asc" });

  const rows = useMemo(() => {
    const built = buildLiveRows(live, name);
    return sort.key ? sortRows(built, sort.key, sort.dir) : built;
  }, [live, name, sort.key, sort.dir]);

  const onSort = (key: LiveSortKey): void => {
    setSort((previous) => {
      if (previous.key !== key) return { key, dir: "asc" };
      if (previous.dir === "asc") return { key, dir: "desc" };
      return { key: null, dir: "asc" };
    });
  };

  return (
    <section
      id="home-live-table"
      className="home-section lv-panel"
      aria-label="In progress now"
    >
      <h2>In progress now</h2>
      <div className="lv-scroll">
        {rows.length > 0 ? <LiveHeader sort={sort} onSort={onSort} /> : null}
        <div className="lv-list" role="rowgroup" data-state={rows.length ? "rows" : "empty"}>
          {rows.length === 0 ? (
            <div className="lv-empty">
              <p className="lv-empty-title">
                <span aria-hidden="true">○</span> Nothing running right now.
              </p>
              <p className="lv-empty-sub">
                Start an agent run and it will appear here within a few seconds.
              </p>
            </div>
          ) : rows.map((row) => <LiveRow key={row.key} row={row} />)}
        </div>
      </div>
    </section>
  );
}
