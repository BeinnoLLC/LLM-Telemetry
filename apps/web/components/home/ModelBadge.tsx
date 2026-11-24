"use client";

// LLMTELEMET-291 (T-20 RUN D2): the model cell from views.js:1124-1211.
// Names arrive already shortened by live-rows.ts (palette.js short(), never a
// letter/glyph proxy). Helper counts and switch notes are fed by that same
// shaped row; this component only lays them out as a two-line cell.
import type { LiveRow } from "../../lib/home/live-rows";

interface ModelBadgeProps {
  row: LiveRow;
}

export default function ModelBadge({ row }: ModelBadgeProps) {
  const name = row.model ?? "—";
  const main = row.models.filter((model) => model.main).length;
  const note = row.modelCount > 1
    ? `${row.modelCount} models used` + (
      main < row.modelCount ? ` (${main} main, ${row.modelCount - main} helper)` : ""
    )
    : row.helperCount > 0
      ? `${row.helperCount} helper${row.helperCount === 1 ? "" : "s"}`
      : null;
  const switched = row.switched && row.initModel && row.initModel !== row.model
    ? `switched from ${row.initModel}`
    : null;

  return (
    <div className="lv-model">
      <span className="lv-model-name" title={name}>{name}</span>
      {note ? <span className="lv-model-note" title={note}>{note}</span> : null}
      {switched ? (
        <span className="lv-model-note" title={switched}>{switched}</span>
      ) : null}
    </div>
  );
}
