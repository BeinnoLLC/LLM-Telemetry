// T-23 RUN A: pure matrix derivation, ported from
// tests/check_project_matrix.js (Python oracle: views.js:1528-1620).
import { describe, expect, it } from "vitest";

import { PROJ_MATRIX_MAX_COLS, buildMatrix } from "../../lib/sessions-logs/aggregate";
import { WEIGHT_LABELS } from "../../lib/sessions-logs/format";
import type { SessionRow } from "../../lib/sessions-logs/types";

const row = (over: Partial<SessionRow>): SessionRow => ({ ...over });

describe("buildMatrix", () => {
  it("renders an explicit empty state for no rows", () => {
    const matrix = buildMatrix([], "cost");
    expect(matrix.empty).toBe(true);
    expect(matrix.rows).toEqual([]);
    expect(matrix.columns).toEqual([]);
    expect(matrix.grandTotal).toBe(0);
  });

  it("keeps a real zero cell clickable and an untouched cell empty", () => {
    const rows = [
      row({ project: "atlas", model: "alpha", act: 0, calls: 7 }),
      row({ project: "nova", model: "beta", act: 5, calls: 3 }),
    ];
    const matrix = buildMatrix(rows, "cost");
    expect(matrix.columns.map((column) => column.model)).toEqual(["beta", "alpha"]);
    const atlas = matrix.rows.find((entry) => entry.project === "atlas")!;
    const alpha = atlas.cells.find((cell) => cell.model === "alpha")!;
    const beta = atlas.cells.find((cell) => cell.model === "beta")!;
    expect(alpha.touched).toBe(true);
    expect(WEIGHT_LABELS.cost.fmt(alpha.value)).toBe("$0.00");
    expect(beta.touched).toBe(false);
    expect(matrix.rows.map((entry) => entry.project)).toEqual(["nova", "atlas"]);
  });

  it("caps the model axis at eight columns and folds the tail", () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      row({
        project: "atlas",
        model: `model-${index}`,
        act: 100 - index,
        session_id: `s${index}`,
      }),
    );
    const matrix = buildMatrix(rows, "cost");
    expect(PROJ_MATRIX_MAX_COLS).toBe(8);
    expect(matrix.columns).toHaveLength(8);
    expect(matrix.hiddenModels).toEqual(["model-8", "model-9"]);
    expect(matrix.rest?.count).toBe(2);
    expect(matrix.rest?.title).toBe("model-8, model-9");
    expect(matrix.rest?.total).toBe(183);
    const atlas = matrix.rows[0];
    expect(atlas.rest).toBe(183);
    expect(atlas.total).toBe(matrix.grandTotal);
    expect(matrix.columns.reduce((sum, column) => sum + column.total, 0) + matrix.rest!.total)
      .toBe(matrix.grandTotal);
  });

  it("sorts projects by current axis total with Unattributed last", () => {
    const rows = [
      row({ project: "Unattributed", model: "a", act: 900, calls: 1 }),
      row({ project: "small-cost", model: "b", act: 1, calls: 50 }),
      row({ project: "big-cost", model: "c", act: 10, calls: 2 }),
    ];
    expect(buildMatrix(rows, "cost").rows.map((entry) => entry.project)).toEqual([
      "big-cost",
      "small-cost",
      "Unattributed",
    ]);
    expect(buildMatrix(rows, "calls").rows.map((entry) => entry.project)).toEqual([
      "small-cost",
      "big-cost",
      "Unattributed",
    ]);
  });

  it("reconciles row and column totals on the sessions axis", () => {
    const rows = [
      row({ project: "atlas", model: "a", session_id: "s1" }),
      row({ project: "atlas", model: "a", session_id: "s1" }),
      row({ project: "atlas", model: "b", session_id: "s2" }),
      row({ project: "nova", model: "c", session_id: "" }),
    ];
    const matrix = buildMatrix(rows, "sessions");
    expect(matrix.grandTotal).toBe(3);
    expect(matrix.rows.reduce((sum, entry) => sum + entry.total, 0)).toBe(matrix.grandTotal);
    expect(matrix.columns.reduce((sum, column) => sum + column.total, 0)).toBe(matrix.grandTotal);
  });
});
