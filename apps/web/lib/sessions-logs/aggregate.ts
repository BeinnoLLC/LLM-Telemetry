// T-23 RUN A: weighting + project × model aggregation. Exact port of
// charts.js:189-217 and views.js:1528-1620; the Python DOM is the oracle.
import { WEIGHT_LABELS, num, short } from "./format";
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
export const PROJ_TREND_TOP_N = 6;

/** views.js:149-159 / 216 — the shared PROV glyph table. These are the
 * oracle's chart-legend symbols, not provider-ball letters: jar balls keep
 * using the SVG icons from provider-icons.ts and never use this table. */
export const PROV_GLYPHS: Readonly<Record<string, string>> = {
  anthropic: "✳",
  "opencode-go": "◈",
  fireworks: "✦",
  "openai-codex": "◉",
  local: "▣",
  moa: "⬡",
  cloud: "☁",
  "ollama-cloud": "☁",
  nous: "◆",
};

export function provLegendLabel(provider: string): string {
  return `${PROV_GLYPHS[provider] ?? "○"} ${provider}`;
}

/** One stacked segment. `value` is the number Chart.js would plot (raw in
 * absolute mode, percent in normalised/stacked mode); `raw` stays available
 * so parity can inspect both data-value and data-share at any toggle state. */
export interface ChartSegment {
  key: string;
  label: string;
  raw: number;
  share: number;
  value: number;
}

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

// ---------------------------------------------------------------------------
// T-23 RUN D — distribution / trend derivation, ported line-for-line from
// views.js:2048-2285. The Python dashboard's live Chart.js config is the
// oracle: both charts are driven by the SAME weightValue() as the matrix, so
// a weight change can never make them disagree about their unit.

export interface DistributionBar {
  project: string;
  /** Sum of plotted values across every series (100 when normalised). */
  total: number;
  /** Sum of plotted values for the series still switched on. */
  visibleTotal: number;
  segments: ChartSegment[];
}

export interface DistributionData {
  empty: boolean;
  axis: WeightAxis;
  axisTitle: string;
  normalized: boolean;
  providers: ChartSegment[];
  bars: DistributionBar[];
  grandTotal: number;
}

/** views.js:2048-2140. Provider order is the GLOBAL provider weight under the
 * current axis (the cost axis is the act||est order); this keeps segment order
 * identical across every project bar, exactly as the oracle does. */
export function buildProjectDistribution(
  rows: readonly SessionRow[],
  axis: WeightAxis,
  normalized = false,
  hidden: ReadonlySet<string> = new Set(),
): DistributionData {
  const axisTitle = normalized ? "% of project total" : WEIGHT_LABELS[axis].axis;
  if (!rows.length) {
    return {
      empty: true,
      axis,
      axisTitle,
      normalized,
      providers: [],
      bars: [],
      grandTotal: 0,
    };
  }

  const byProject = new Map<string, Map<string, SessionRow[]>>();
  const providerSeen = new Set<string>();
  rows.forEach((row) => {
    const project = row.project || "Unattributed";
    const provider = provOf(row);
    if (!byProject.has(project)) byProject.set(project, new Map());
    const groups = byProject.get(project)!;
    if (!groups.has(provider)) groups.set(provider, []);
    groups.get(provider)!.push(row);
    providerSeen.add(provider);
  });

  const projectTotal = (project: string): number =>
    weightValue([...byProject.get(project)!.values()].flat(), axis);
  const projects = [...byProject.keys()].sort((a, b) => {
    if (a === "Unattributed") return 1;
    if (b === "Unattributed") return -1;
    return projectTotal(b) - projectTotal(a);
  });
  const providerTotal = (provider: string): number =>
    weightValue(
      projects.flatMap((project) => byProject.get(project)!.get(provider) ?? []),
      axis,
    );
  const providers = [...providerSeen].sort((a, b) => providerTotal(b) - providerTotal(a));
  const grandTotal = projects.reduce((sum, project) => sum + projectTotal(project), 0);

  const providerSegments: ChartSegment[] = providers.map((provider) => {
    const raw = providerTotal(provider);
    const share = grandTotal > 0 ? (100 * raw) / grandTotal : 0;
    return { key: provider, label: provLegendLabel(provider), raw, share, value: normalized ? share : raw };
  });

  const bars: DistributionBar[] = projects.map((project) => {
    const projectRows = [...byProject.get(project)!.values()].flat();
    const total = weightValue(projectRows, axis);
    const segments = providers.map((provider) => {
      const group = byProject.get(project)!.get(provider) ?? [];
      const raw = weightValue(group, axis);
      const share = total > 0 ? (100 * raw) / total : 0;
      return {
        key: provider,
        label: provLegendLabel(provider),
        raw,
        share,
        value: normalized ? share : raw,
      };
    });
    return {
      project,
      total: segments.reduce((sum, segment) => sum + segment.value, 0),
      visibleTotal: segments.reduce(
        (sum, segment) => sum + (hidden.has(segment.key) ? 0 : segment.value),
        0,
      ),
      segments,
    };
  });

  return { empty: false, axis, axisTitle, normalized, providers: providerSegments, bars, grandTotal };
}

export interface TrendData {
  empty: boolean;
  axis: WeightAxis;
  axisTitle: string;
  stacked: boolean;
  series: ChartSegment[];
  days: Array<{ day: string; total: number; visibleTotal: number; segments: ChartSegment[] }>;
}

/** views.js:2173-2263. Top-N ranking uses the current axis total — the same
 * measure that orders the matrix rows — and the remainder is folded into one
 * explicit "Other (+N)" series instead of being silently dropped. */
export function buildProjectTrend(
  rows: readonly SessionRow[],
  axis: WeightAxis,
  stacked = false,
  hidden: ReadonlySet<string> = new Set(),
): TrendData {
  const axisTitle = stacked ? "% of day total" : WEIGHT_LABELS[axis].axis;
  if (!rows.length) {
    return { empty: true, axis, axisTitle, stacked, series: [], days: [] };
  }

  const days = [...new Set(rows.map((row) => String(row.date ?? "")))].sort();
  const byProjDate = new Map<string, Map<string, SessionRow[]>>();
  rows.forEach((row) => {
    const project = row.project || "Unattributed";
    const day = String(row.date ?? "");
    if (!byProjDate.has(project)) byProjDate.set(project, new Map());
    const byDate = byProjDate.get(project)!;
    if (!byDate.has(day)) byDate.set(day, []);
    byDate.get(day)!.push(row);
  });
  const projectTotal = (project: string): number =>
    weightValue([...byProjDate.get(project)!.values()].flat(), axis);
  const allProjects = [...byProjDate.keys()].sort((a, b) => {
    if (a === "Unattributed") return 1;
    if (b === "Unattributed") return -1;
    return projectTotal(b) - projectTotal(a);
  });
  const shown = allProjects.slice(0, PROJ_TREND_TOP_N);
  const rest = allProjects.slice(PROJ_TREND_TOP_N);

  const seriesKeys = [
    ...shown,
    ...(rest.length ? [`Other (+${rest.length})`] : []),
  ];
  const groupFor = (key: string, day: string): SessionRow[] => {
    if (key.startsWith("Other (+") && !byProjDate.has(key)) {
      return rest.flatMap((project) => byProjDate.get(project)!.get(day) ?? []);
    }
    return byProjDate.get(key)?.get(day) ?? [];
  };

  const seriesTotals = seriesKeys.map((key) =>
    days.reduce((sum, day) => sum + weightValue(groupFor(key, day), axis), 0),
  );
  const series: ChartSegment[] = seriesKeys.map((key, index) => {
    const raw = seriesTotals[index] ?? 0;
    const grandTotal = seriesTotals.reduce((sum, value) => sum + value, 0);
    const share = grandTotal > 0 ? (100 * raw) / grandTotal : 0;
    return { key, label: key, raw, share, value: stacked ? share : raw };
  });

  const chartDays = days.map((day) => {
    const rawValues = seriesKeys.map((key) => weightValue(groupFor(key, day), axis));
    const dayTotal = rawValues.reduce((sum, value) => sum + value, 0);
    const segments: ChartSegment[] = seriesKeys.map((key, index) => {
      const raw = rawValues[index] ?? 0;
      const share = dayTotal > 0 ? (100 * raw) / dayTotal : 0;
      return { key, label: key, raw, share, value: stacked ? share : raw };
    });
    return {
      day,
      total: segments.reduce((sum, segment) => sum + segment.value, 0),
      visibleTotal: segments.reduce(
        (sum, segment) => sum + (hidden.has(segment.key) ? 0 : segment.value),
        0,
      ),
      segments,
    };
  });

  return { empty: false, axis, axisTitle, stacked, series, days: chartDays };
}
