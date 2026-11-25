// T-23 RUN A: weighting + project × model aggregation. Exact port of
// charts.js:189-217 and views.js:1528-1620; the Python DOM is the oracle.
import { num, short } from "./format";
import { modelProvider, provOf } from "./providers";
import type {
  DetailBucket,
  DetailSession,
  MatrixColumn,
  MatrixData,
  MatrixRow,
  ProjectDetail,
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

/** views.js:1651-1745 — the drill-down's numbers. Actual and estimated cost
 * stay separate; the denominator is `totalAct || totalEst`, never their sum. */
export function buildProjectDetail(
  rows: readonly SessionRow[],
  project: string,
): ProjectDetail {
  const group = rows.filter((row) => (row.project || "Unattributed") === project);
  const ids = Array.from(
    new Set(
      group
        .map((row) => row.session_id)
        .filter((id) => Boolean(id))
        .map((id) => String(id)),
    ),
  );
  const dates = group
    .map((row) => (row.date == null ? "" : String(row.date)))
    .filter((date) => date.length > 0)
    .sort();
  const sum = (pick: (row: SessionRow) => number): number =>
    group.reduce((total, row) => total + pick(row), 0);
  const totalAct = sum((row) => num(row.act));
  const totalEst = sum((row) => num(row.est));
  const denominator = totalAct || totalEst;
  const cost = (row: SessionRow): number => num(row.act) || num(row.est);
  const pct = (value: number): string =>
    (denominator > 0 ? (100 * value) / denominator : 0).toFixed(0);

  const byModel = new Map<string, number>();
  const byProvider = new Map<string, number>();
  const byTask = new Map<string, number>();
  group.forEach((row) => {
    const model = row.model == null ? "" : String(row.model);
    const provider = provOf(row);
    const task = String(row.task || "unspecified") || "unspecified";
    byModel.set(model, (byModel.get(model) ?? 0) + cost(row));
    byProvider.set(provider, (byProvider.get(provider) ?? 0) + cost(row));
    byTask.set(task, (byTask.get(task) ?? 0) + cost(row));
  });
  const buckets = (map: Map<string, number>, limit?: number): DetailBucket[] => {
    const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
    return (limit === undefined ? entries : entries.slice(0, limit)).map(([key, value]) => ({
      key,
      label: key,
      cost: value,
      pct: pct(value),
    }));
  };
  const models = buckets(byModel, 6).map((bucket) => ({
    ...bucket,
    label: short(bucket.key),
    provider: modelProvider(bucket.key, rows),
  }));
  const recent: DetailSession[] = ids.slice(0, 12).map((id) => {
    const row = group.find((candidate) => String(candidate.session_id ?? "") === id);
    return { id, date: row && row.date != null ? String(row.date) : "" };
  });

  return {
    project,
    sessions: ids.length ? String(ids.length) : "—",
    calls: sum((row) => num(row.calls)),
    inp: sum((row) => num(row.inp)),
    outp: sum((row) => num(row.outp)),
    cread: sum((row) => num(row.cread)),
    cwrite: sum((row) => num(row.cwrite)),
    act: totalAct,
    est: totalEst,
    firstSeen: dates.length ? (dates[0] as string) : "—",
    lastSeen: dates.length ? (dates[dates.length - 1] as string) : "—",
    models,
    providers: buckets(byProvider),
    tasks: buckets(byTask, 6),
    recent,
    hasSessionIds: recent.length > 0,
  };
}
