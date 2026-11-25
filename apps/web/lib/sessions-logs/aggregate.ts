// T-23 RUN A: weighting + project × model aggregation. Exact port of
// charts.js:189-217 and views.js:1528-1620; the Python DOM is the oracle.
import { num, short } from "./format";
import type {
  MatrixColumn,
  MatrixData,
  MatrixRow,
  SessionRow,
  WeightAxis,
} from "./types";
import { WEIGHT_AXES, WEIGHT_KEY } from "./types";

export const PROJ_MATRIX_MAX_COLS = 8;

/** charts.js:203-217. Sessions count DISTINCT non-empty ids; rows without an
 * id still contribute one anonymous unit each. Tokens include cache read and
 * write, matching the oracle (not inp+outp alone). */
export function weightValue(rowsGroup: readonly SessionRow[], axis: WeightAxis): number {
  if (axis === "sessions") {
    const ids = new Set(
      rowsGroup.map((row) => row.session_id).filter((id) => Boolean(id)),
    );
    const anonymous = rowsGroup.filter((row) => !row.session_id).length;
    return ids.size + anonymous;
  }
  if (axis === "calls") {
    return rowsGroup.reduce((sum, row) => sum + num(row.calls), 0);
  }
  if (axis === "tokens") {
    return rowsGroup.reduce(
      (sum, row) =>
        sum + num(row.inp) + num(row.outp) + num(row.cread) + num(row.cwrite),
      0,
    );
  }
  return rowsGroup.reduce((sum, row) => sum + (num(row.act) || num(row.est)), 0);
}

/** localStorage is best-effort, exactly like installProjWeight (views.js:1777). */
export function readWeight(): WeightAxis {
  try {
    const saved = localStorage.getItem(WEIGHT_KEY);
    return WEIGHT_AXES.includes(saved as WeightAxis) ? (saved as WeightAxis) : "cost";
  } catch {
    return "cost";
  }
}

export function saveWeight(axis: WeightAxis): void {
  try {
    localStorage.setItem(WEIGHT_KEY, axis);
  } catch {
    // Private mode: the in-memory choice still drives this render.
  }
}

/** Stable descending numeric sort: equal totals keep insertion order, as JS's
 * sort does in the Python bundle. */
function byTotalDesc<T>(items: T[], total: (item: T) => number): T[] {
  return items.sort((a, b) => total(b) - total(a));
}

/** views.js:1528-1620. Both axes come entirely from the rows; no hard-coded
 * project or model list. */
export function buildMatrix(
  rows: readonly SessionRow[],
  axis: WeightAxis,
  providerOfModel: (model: string) => string = () => "unknown",
): MatrixData {
  if (!rows.length) {
    return {
      empty: true,
      axis,
      columns: [],
      hiddenModels: [],
      rest: null,
      rows: [],
      grandTotal: 0,
    };
  }

  const byProject = new Map<string, Map<string, SessionRow[]>>();
  const modelGroups = new Map<string, SessionRow[]>();
  rows.forEach((row) => {
    const project = row.project || "Unattributed";
    const model = row.model ?? "";
    if (!byProject.has(project)) byProject.set(project, new Map());
    const models = byProject.get(project)!;
    if (!models.has(model)) models.set(model, []);
    models.get(model)!.push(row);
    if (!modelGroups.has(model)) modelGroups.set(model, []);
    modelGroups.get(model)!.push(row);
  });

  const projectTotal = (project: string): number =>
    weightValue([...byProject.get(project)!.values()].flat(), axis);
  const projects = [...byProject.keys()].sort((a, b) => {
    if (a === "Unattributed") return 1;
    if (b === "Unattributed") return -1;
    return projectTotal(b) - projectTotal(a);
  });

  const modelTotal = (model: string): number => weightValue(modelGroups.get(model)!, axis);
  const allModels = byTotalDesc([...modelGroups.keys()], modelTotal);
  const shown = allModels.slice(0, PROJ_MATRIX_MAX_COLS);
  const hidden = allModels.slice(PROJ_MATRIX_MAX_COLS);
  const columns: MatrixColumn[] = shown.map((model) => ({
    model,
    label: short(model),
    total: modelTotal(model),
    provider: providerOfModel(model),
  }));
  const rest = hidden.length
    ? {
        count: hidden.length,
        total: weightValue(hidden.flatMap((model) => modelGroups.get(model)!), axis),
        title: hidden.map(short).join(", "),
      }
    : null;

  const matrixRows: MatrixRow[] = projects.map((project) => {
    const models = byProject.get(project)!;
    const cells = shown.map((model) => {
      const group = models.get(model);
      if (group === undefined) {
        return { model, value: 0, touched: false };
      }
      return { model, value: weightValue(group, axis), touched: true };
    });
    return {
      project,
      cells,
      rest: rest ? weightValue(hidden.flatMap((model) => models.get(model) ?? []), axis) : 0,
      total: projectTotal(project),
    };
  });

  return {
    empty: false,
    axis,
    columns,
    hiddenModels: hidden,
    rest,
    rows: matrixRows,
    grandTotal: weightValue([...rows], axis),
  };
}
