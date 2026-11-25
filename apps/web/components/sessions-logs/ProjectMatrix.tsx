"use client";

// T-23 RUN A: project × model matrix, exact DOM contract from
// views.js:1528-1641. One horizontal scroll wrapper; cells and row labels are
// keyboard-operable. onOpen is the RUN B drawer stub.
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";

import { buildMatrix } from "../../lib/sessions-logs/aggregate";
import { WEIGHT_LABELS, short } from "../../lib/sessions-logs/format";
import { buildModelProviders, providerColorVar, providerPath } from "../../lib/sessions-logs/providers";
import type { SessionRow, WeightAxis } from "../../lib/sessions-logs/types";

export interface ProjectMatrixProps {
  rows: readonly SessionRow[];
  axis: WeightAxis;
  onOpen: (project: string, model?: string) => void;
}

type SortState = { column: number; dir: "asc" | "desc" } | null;

function glyph(sort: SortState, column: number): string {
  if (!sort || sort.column !== column) return "↕";
  return sort.dir === "asc" ? "▲" : "▼";
}

function ariaSort(sort: SortState, column: number): "none" | "ascending" | "descending" {
  if (!sort || sort.column !== column) return "none";
  return sort.dir === "asc" ? "ascending" : "descending";
}

// table.js:36-52 parseNum on the value the cell actually renders. The rest
// cell carries that rendered value in data-v, so a hidden tail is sorted by
// its own figure, never by the grand total.
function parseCellNumber(raw: string | number | null): number | null {
  if (raw === null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const cleaned = raw.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) && cleaned !== "" ? n : null;
}

export default function ProjectMatrix({ rows, axis, onOpen }: ProjectMatrixProps) {
  const providers = useMemo(() => buildModelProviders(rows), [rows]);
  const data = useMemo(() => buildMatrix(rows, axis, (model) => {
    const provider = providers.get(short(model)) ?? "unknown";
    return provider;
  }), [rows, axis, providers]);
  const [sort, setSort] = useState<SortState>(null);
  const fmt = WEIGHT_LABELS[axis].fmt;
  const unit = WEIGHT_LABELS[axis].unit;

  const toggleSort = (column: number): void => {
    setSort((previous) =>
      previous?.column === column
        ? { column, dir: previous.dir === "asc" ? "desc" : "asc" }
        : { column, dir: "asc" },
    );
  };

  const sortedRows = useMemo(() => {
    const pinned = data.rows.filter((row) => row.project === "Unattributed");
    if (!sort) return data.rows;
    // table.js:96-127: pinned rows are removed, the rest is sorted, then the
    // pinned rows are put back before the first pinned anchor (last here).
    const body = data.rows.filter((row) => row.project !== "Unattributed");
    const column = sort.column;
    const totalColumn = data.columns.length + (data.rest ? 2 : 1);
    const restValue = (row: (typeof data.rows)[number]): string | number | null => {
      if (!data.rest) return null;
      const raw = row.rest > 0 ? fmt(row.rest) : "—";
      return parseCellNumber(raw);
    };
    const value = (row: (typeof data.rows)[number]): string | number | null => {
      if (column === 0) return row.project;
      if (column === totalColumn) return row.total;
      if (data.rest && column === data.columns.length + 1) return restValue(row);
      const cell = row.cells[column - 1];
      return cell?.touched ? cell.value : null;
    };
    const keyed = body.map((row, index) => ({ row, index, value: value(row) }));
    keyed.sort((left, right) => {
      const emptyLeft = left.value === null || left.value === "";
      const emptyRight = right.value === null || right.value === "";
      // Empty values end up last in both directions, as in sortValues().
      if (emptyLeft || emptyRight) {
        if (emptyLeft && emptyRight) return left.index - right.index;
        return emptyLeft ? 1 : -1;
      }
      const comparison =
        typeof left.value === "number" && typeof right.value === "number"
          ? left.value - right.value
          : String(left.value).localeCompare(String(right.value), undefined, {
              numeric: true,
              sensitivity: "base",
            });
      return (sort.dir === "asc" ? comparison : -comparison) || left.index - right.index;
    });
    return [...keyed.map((entry) => entry.row), ...pinned];
  }, [data, sort, fmt]);

  const activate = (project: string, model?: string): void => {
    if (model === undefined) onOpen(project);
    else onOpen(project, model);
  };
  const onKey = (
    event: KeyboardEvent<HTMLElement>,
    project: string,
    model?: string,
  ): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate(project, model);
    }
  };

  const headerClass = "sm-pad sm-num";
  const sortable = (column: number, label: ReactNode, extraClass = "") => (
    <th
      className={`${headerClass}${extraClass ? ` ${extraClass}` : ""}`}
      aria-sort={ariaSort(sort, column)}
      data-dt-label={typeof label === "string" ? label : undefined}
      data-dt-sortable="1"
      data-dt-num="1"
    >
      <button type="button" className="dt-sort" onClick={() => toggleSort(column)}>
        {label}
        <span className="dt-ar" aria-hidden="true">{glyph(sort, column)}</span>
      </button>
    </th>
  );

  return (
    <>
      <div id="projmatrixwrap" className="sm-wrap">
        <table id="projmatrix" className="dt sm-table">
          {!data.empty && (
            <>
              <thead>
                <tr>
                  {sortable(
                    0,
                    <>
                      Project <span className="sm-muted sm-normal">({WEIGHT_LABELS[axis].axis})</span>
                    </>,
                    "sm-left",
                  )}
                  {data.columns.map((column, index) => (
                    <th
                      key={column.model}
                      className={`${headerClass} sm-model`}
                      style={{ color: `var(${providerColorVar(column.provider)})` }}
                      aria-sort={ariaSort(sort, index + 1)}
                      data-dt-label={column.label}
                      data-dt-sortable="1"
                      data-dt-num="1"
                      data-provider={column.provider}
                    >
                      <button
                        type="button"
                        className="dt-sort"
                        onClick={() => toggleSort(index + 1)}
                      >
                        <svg className="lvprovlogo" viewBox="0 0 24 24" aria-hidden="true">
                          <path d={providerPath(column.provider)} />
                        </svg>
                        {column.label}
                        <span className="dt-ar" aria-hidden="true">{glyph(sort, index + 1)}</span>
                      </button>
                    </th>
                  ))}
                  {data.rest &&
                    sortable(
                      data.columns.length + 1,
                      `+${data.rest.count} more`,
                      "sm-muted",
                    )}
                  {sortable(data.columns.length + (data.rest ? 2 : 1), "Total")}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr key={row.project}>
                    <td
                      className="sm-pad sm-project"
                      role="button"
                      tabIndex={0}
                      data-project={row.project}
                      onClick={() => activate(row.project)}
                      onKeyDown={(event) => onKey(event, row.project)}
                    >
                      {row.project}
                    </td>
                    {row.cells.map((cell) => (
                      <td
                        key={cell.model}
                        className="sm-pad sm-num"
                        data-key={`${row.project}|${short(cell.model)}`}
                        data-project={cell.touched ? row.project : undefined}
                        data-model={cell.touched ? cell.model : undefined}
                        role={cell.touched ? "button" : undefined}
                        tabIndex={cell.touched ? 0 : undefined}
                        title={
                          cell.touched
                            ? `${row.project} × ${short(cell.model)}: ${fmt(cell.value)} ${unit}`
                            : undefined
                        }
                        onClick={cell.touched ? () => activate(row.project, cell.model) : undefined}
                        onKeyDown={
                          cell.touched
                            ? (event) => onKey(event, row.project, cell.model)
                            : undefined
                        }
                      >
                        {cell.touched ? fmt(cell.value) : "—"}
                      </td>
                    ))}
                    {data.rest && (
                      <td
                        className="sm-pad sm-num sm-muted"
                        data-v={row.rest > 0 ? fmt(row.rest) : "—"}
                      >
                        {row.rest > 0 ? fmt(row.rest) : "—"}
                      </td>
                    )}
                    <td className="sm-pad sm-num sm-strong">{fmt(row.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="sm-foot">
                  <td className="sm-pad sm-muted">Total</td>
                  {data.columns.map((column) => (
                    <td key={column.model} className="sm-pad sm-num sm-strong">
                      {fmt(column.total)}
                    </td>
                  ))}
                  {data.rest && (
                    <td className="sm-pad sm-num sm-strong sm-muted">{fmt(data.rest.total)}</td>
                  )}
                  <td className="sm-pad sm-num sm-strong">{fmt(data.grandTotal)}</td>
                </tr>
              </tfoot>
            </>
          )}
        </table>
      </div>
      <div id="projmatrixempty" className="sm-empty sm-muted" hidden={!data.empty}>
        No session activity in the selected range.
      </div>
    </>
  );
}
