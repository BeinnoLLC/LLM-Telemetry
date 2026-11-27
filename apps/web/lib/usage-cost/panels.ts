// LLMTELEMET-293 (T-22 RUN B): the remaining Usage panels, ported from
// src/llm_telemetry/web/js/views.js (259-348, 973-1012, 1227-1273, 1315-1349,
// 1413-1513). Everything here is a pure derivation of the loaded snapshot: the
// collector's own aggregates are formatted and ordered, never recalculated as
// a new cost/percentile. Bytes, queue depth and latency come only from the
// artifacts; a missing artifact stays hidden/n-a instead of zero-filled.
import { compact, fmtB } from "../home-board/format";
import {
  colorOfModel,
  filterRows,
  inR,
  num,
  providerMark,
  provOf,
  short,
} from "./usage";
import type {
  AnalyticsRow,
  BandwidthDailyRow,
  ConcurrencyRow,
  LatencyBucket,
  LatencyData,
  LatencySlowRow,
  OllamaHost,
  RepoBranchData,
  RepoBranchBucket,
  RepoCostRow,
  UsageFilters,
  UsageSnapshot,
} from "./types";

export const UNATTR_LABEL = "Unattributed";
/** views.js:328 — only the worst dozen re-send offenders get a row. */
export const RESEND_TOP = 12;

const count = (value: unknown): string => Math.round(num(value)).toLocaleString("en-US");

// ---- Transfers (views.js:973-1012) -----------------------------------------

export interface TransferPanel {
  /** True only when THIS payload carried at least one non-zero byte count. */
  seen: boolean;
  /** Mirror of card.hidden. A sticky-empty payload does not hide the card. */
  hidden: boolean;
  /** True when an empty refresh kept the numbers from a previous round. */
  sticky: boolean;
  up: number;
  down: number;
  lanUp: number;
  lanDown: number;
  lan: number;
  ratio: number | null;
  upText: string;
  downText: string;
  lanText: string;
  ratioText: string;
  note: string;
}

const EMPTY_TRANSFER: TransferPanel = {
  seen: false,
  hidden: true,
  sticky: false,
  up: 0,
  down: 0,
  lanUp: 0,
  lanDown: 0,
  lan: 0,
  ratio: null,
  upText: fmtB(0),
  downText: fmtB(0),
  lanText: fmtB(0),
  ratioText: "",
  note: "",
};

/** Sum only the byte columns the collector actually wrote (no invented rate). */
export function deriveTransfer(rows: readonly AnalyticsRow[] = []): TransferPanel {
  let up = 0;
  let down = 0;
  let lanUp = 0;
  let lanDown = 0;
  for (const row of rows) {
    up += num(row.up_bytes);
    down += num(row.down_bytes);
    lanUp += num(row.lan_up_bytes);
    lanDown += num(row.lan_down_bytes);
  }
  if (!(up + down + lanUp + lanDown)) return { ...EMPTY_TRANSFER };
  // LAN is disclosed next to the metered total, never folded into it.
  const lan = lanUp + lanDown;
  const ratio = down > 0 ? up / down : null;
  return {
    seen: true,
    hidden: false,
    sticky: false,
    up,
    down,
    lanUp,
    lanDown,
    lan,
    ratio,
    upText: fmtB(up),
    downText: fmtB(down),
    lanText: fmtB(lan),
    ratioText: ratio == null ? "" : `${Math.round(ratio)}:1`,
    note: lan ? `LAN ${fmtB(lan)} (not metered)` : "",
  };
}

/** Sticky-empty XF_SEEN: a transient byte-less refresh keeps the last
 * real numbers on screen. Only a payload that never had bytes hides the card. */
export function refreshTransfer(
  previous: TransferPanel | null,
  incoming: TransferPanel,
): TransferPanel {
  if (incoming.seen) return incoming;
  if (previous?.seen) return { ...previous, sticky: true, hidden: false };
  return incoming;
}

// ---- Bandwidth (views.js:254-348) ------------------------------------------

/** views.js:254-257: re-send = sent tokens / fresh prompt tokens. */
export function resendOf(row: {
  input_tokens?: unknown;
  cache_read_tokens?: unknown;
  cache_write_tokens?: unknown;
}): { fresh: number; sent: number; x: number | null } {
  const fresh = num(row.input_tokens) + num(row.cache_write_tokens);
  const sent = fresh + num(row.cache_read_tokens);
  return { fresh, sent, x: fresh ? sent / fresh : null };
}

export interface BandwidthKpi {
  key: string;
  label: string;
  value: string;
  sub: string;
}

export interface BandwidthDay {
  date: string;
  label: string;
  up: number;
  down: number;
  lan: number;
}

export interface BandwidthSeries {
  key: string;
  label: string;
  values: number[];
  axis: "left" | "right";
  kind: "bar" | "line";
  dashed: boolean;
  color: string;
}

export interface ResendRow {
  model: string;
  label: string;
  x: number;
  sent: number;
  fresh: number;
  calls: number;
  widthPct: number;
  hot: boolean;
  color: string;
  icon: string;
}

export interface BandwidthPanel {
  /** No bandwidth rows in the artifact at all: views.js hides the card. */
  hidden: boolean;
  /** Artifact has rows but none in this range: keep the card with a note. */
  empty: boolean;
  subtitle: string;
  kpis: BandwidthKpi[];
  days: BandwidthDay[];
  axes: { left: string; right: string };
  trend: BandwidthSeries[];
  resend: ResendRow[];
  median: number;
  shown: number;
  totalModels: number;
  note: string;
}

const EMPTY_BANDWIDTH: BandwidthPanel = {
  hidden: false,
  empty: true,
  subtitle: "",
  kpis: [],
  days: [],
  axes: { left: "upload", right: "download · LAN" },
  trend: [],
  resend: [],
  median: 0,
  shown: 0,
  totalModels: 0,
  note: "",
};

/** Upload owns the left axis; download and LAN share a separate right axis so
 * a ~190:1 ratio cannot render either one as an invisible sliver. */
export function deriveBandwidth(
  all: readonly BandwidthDailyRow[] = [],
  from = "",
  to = "",
): BandwidthPanel {
  if (!all.length) return { ...EMPTY_BANDWIDTH, hidden: true };
  const rows = all.filter((row) => inR(row.date, from, to));
  if (!rows.length) return { ...EMPTY_BANDWIDTH };

  const sum = (key: keyof BandwidthDailyRow, subset: readonly BandwidthDailyRow[] = rows) =>
    subset.reduce((total, row) => total + num(row[key]), 0);
  const days = [...new Set(rows.map((row) => String(row.date ?? "")))].sort();
  const byDay = (day: string) => rows.filter((row) => row.date === day);

  const up = sum("up_bytes");
  const down = sum("down_bytes");
  const lan = sum("lan_up_bytes") + sum("lan_down_bytes");
  const totals = resendOf({
    input_tokens: sum("input_tokens"),
    cache_read_tokens: sum("cache_read_tokens"),
    cache_write_tokens: sum("cache_write_tokens"),
  });
  const ratio = down ? up / down : null;
  const frozen = rows.filter((row) => row.frozen).length;
  const bytesPerToken = [
    ...new Set(
      rows
        .map((row) => Number(row.bytes_per_token))
        .filter((value) => Number.isFinite(value))
        .map((value) => value.toFixed(2)),
    ),
  ].sort();

  const kpis: BandwidthKpi[] = [
    {
      key: "resend",
      label: "context re-send",
      value: totals.x == null ? "—" : `${totals.x.toFixed(1)}×`,
      sub: "each fresh prompt token is sent this many times",
    },
    {
      key: "ratio",
      label: "upload : download",
      value: ratio == null ? "—" : `${count(ratio)}:1`,
      sub: "a whole conversation goes up to get a reply back",
    },
    {
      key: "internet",
      label: "internet upload",
      value: `↑ ${fmtB(up)}`,
      sub: `↓ ${fmtB(down)} download`,
    },
    {
      key: "lan",
      label: "LAN",
      value: fmtB(lan),
      sub: "local models · not metered",
    },
  ];

  const trend: BandwidthSeries[] = [
    {
      key: "upload",
      label: "upload",
      values: days.map((day) => sum("up_bytes", byDay(day))),
      axis: "left",
      kind: "bar",
      dashed: false,
      color: "var(--c-amber)",
    },
    {
      key: "download",
      label: "download",
      values: days.map((day) => sum("down_bytes", byDay(day))),
      axis: "right",
      kind: "line",
      dashed: false,
      color: "var(--c-sky)",
    },
    {
      key: "lan",
      label: "LAN",
      values: days.map(
        (day) => sum("lan_up_bytes", byDay(day)) + sum("lan_down_bytes", byDay(day)),
      ),
      axis: "right",
      kind: "line",
      dashed: true,
      color: "var(--muted)",
    },
  ];

  // Worst-first per-model re-send. The median is of the rows we actually
  // plot; "hot" means at least 2x that fleet median (views.js:332).
  const byModel = new Map<string, {
    model: string;
    input_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    up: number;
    calls: number;
  }>();
  for (const row of rows) {
    const model = String(row.model ?? "");
    const entry = byModel.get(model) ?? {
      model,
      input_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      up: 0,
      calls: 0,
    };
    entry.input_tokens += num(row.input_tokens);
    entry.cache_read_tokens += num(row.cache_read_tokens);
    entry.cache_write_tokens += num(row.cache_write_tokens);
    entry.up += num(row.up_bytes);
    entry.calls += num(row.calls);
    byModel.set(model, entry);
  }
  const sorted = [...byModel.values()]
    .map((entry) => ({ ...entry, ...resendOf(entry) }))
    .filter((entry) => entry.x != null && entry.sent > 0)
    .sort((a, b) => (b.x ?? 0) - (a.x ?? 0));
  const xs = sorted.map((entry) => entry.x ?? 0).sort((a, b) => a - b);
  const mid = xs.length
    ? xs.length % 2
      ? xs[(xs.length - 1) / 2]
      : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2
    : 0;
  const max = sorted.length ? sorted[0].x ?? 1 : 1;
  const resend: ResendRow[] = sorted.slice(0, RESEND_TOP).map((entry) => {
    const x = entry.x ?? 0;
    const label = short(entry.model);
    return {
      model: entry.model,
      label,
      x,
      sent: entry.sent,
      fresh: entry.fresh,
      calls: entry.calls,
      widthPct: Math.max(2, (100 * x) / max),
      hot: Boolean(mid && x >= 2 * mid),
      color: colorOfModel(label),
      icon: providerMark(provOf("", label, "")),
    };
  });

  const note =
    `Estimated from token counts × ${bytesPerToken.join(" / ")} bytes/token, ` +
    `not measured on the wire. ${frozen} of ${rows.length} rows are frozen history: ` +
    `each keeps the constant it was computed with, so recalibrating never restates ` +
    `past days. Re-send = (input + cache read + cache write) ÷ (input + cache write).`;

  return {
    hidden: false,
    empty: false,
    subtitle: `${days.length} day${days.length === 1 ? "" : "s"} · estimated, not measured`,
    kpis,
    days: days.map((date) => ({
      date,
      label: date.slice(5),
      up: sum("up_bytes", byDay(date)),
      down: sum("down_bytes", byDay(date)),
      lan: sum("lan_up_bytes", byDay(date)) + sum("lan_down_bytes", byDay(date)),
    })),
    axes: { left: "upload", right: "download · LAN" },
    trend,
    resend,
    median: mid,
    shown: resend.length,
    totalModels: sorted.length,
    note,
  };
}

// ---- Concurrency (views.js:1227-1273) --------------------------------------

export interface ConcurrencyRowModel {
  hour: string;
  label: string;
  top: number;
  sub: number;
  total: number;
}

export interface ConcurrencySeries {
  key: string;
  label: string;
  values: number[];
  kind: "bar" | "line";
  dashed: boolean;
  stack?: string;
  color: string;
}

export interface ConcurrencyPanel {
  empty: boolean;
  rows: ConcurrencyRowModel[];
  peak: { hour: string; top: number; sub: number; total: number } | null;
  peakText: string;
  /** Queue depth is a live "now" sample, not a fabricated history. */
  queueNow: number;
  series: ConcurrencySeries[];
}

export function queueNowOf(hosts: readonly OllamaHost[] = []): number {
  return hosts.reduce((sum, host) => sum + Math.max(0, num(host.queue)), 0);
}

/** An empty range clears every plotted series — the SVG equivalent of
 * Chart.getChart(canvas).destroy() in views.js:1240-1242. */
export function deriveConcurrency(
  all: readonly ConcurrencyRow[] = [],
  from = "",
  to = "",
  hosts: readonly OllamaHost[] = [],
): ConcurrencyPanel {
  const rows = all
    .filter((row) => inR(String(row.hour ?? "").slice(0, 10), from, to))
    .map((row) => {
      const top = num(row.top);
      const sub = num(row.sub);
      return {
        hour: String(row.hour ?? ""),
        label: String(row.hour ?? "").slice(5),
        top,
        sub,
        total: top + sub,
      };
    })
    .sort((a, b) => (a.hour < b.hour ? -1 : a.hour > b.hour ? 1 : 0));

  if (!rows.length) {
    return { empty: true, rows: [], peak: null, peakText: "", queueNow: 0, series: [] };
  }

  const peak = rows.reduce<(typeof rows)[number] | null>(
    (best, row) => (best === null || row.total > best.total ? row : best),
    null,
  )!;
  const queueNow = queueNowOf(hosts);
  return {
    empty: false,
    rows,
    peak,
    peakText:
      `Peak: ${peak.total} concurrent session${peak.total === 1 ? "" : "s"} ` +
      `(${peak.top} top-level, ${peak.sub} subagent) at ${peak.hour}`,
    queueNow,
    series: [
      {
        key: "top-level",
        label: "top-level",
        values: rows.map((row) => row.top),
        kind: "bar",
        dashed: false,
        stack: "s",
        color: "var(--accent)",
      },
      {
        key: "subagent",
        label: "subagent",
        values: rows.map((row) => row.sub),
        kind: "bar",
        dashed: false,
        stack: "s",
        color: "var(--chart-2)",
      },
      {
        key: "queue-now",
        label: "queue depth (now)",
        values: rows.map(() => queueNow),
        kind: "line",
        dashed: true,
        color: "var(--c-red)",
      },
    ],
  };
}

// ---- Latency (views.js:1315-1349) ------------------------------------------

export interface LatencyRowModel {
  name: string;
  n: number;
  p50: string;
  p90: string;
  p99: string;
  tokS: string;
  icon?: string;
  color: string;
}

export interface LatencySlowModel {
  session: string;
  model: string;
  seconds: number;
  secondsText: string;
  icon: string;
}

export interface LatencyPanel {
  /** No model buckets: the whole card is hidden, like views.js:1320. */
  hidden: boolean;
  byModel: LatencyRowModel[];
  byEndpoint: LatencyRowModel[];
  slowest: LatencySlowModel[];
}

function latencyRow(name: string, bucket: LatencyBucket, isModel: boolean): LatencyRowModel {
  // views.js:1325/1345 resolve the brand from the SHORT model name, not the
  // full "provider/model" slug (which would always land on the generic mark).
  const key = provOf("", short(name), "");
  return {
    name,
    n: num(bucket.n),
    p50: `${num(bucket.p50)}s`,
    p90: `${num(bucket.p90)}s`,
    p99: `${num(bucket.p99)}s`,
    tokS: bucket.tok_s == null ? "" : `${Number(bucket.tok_s).toFixed(1)} tok/s`,
    icon: isModel ? providerMark(key) : undefined,
    color: colorOfModel(short(name)),
  };
}

const byP90 = ([, a]: [string, LatencyBucket], [, b]: [string, LatencyBucket]) =>
  num(b.p90) - num(a.p90);

/** Percentiles are the collector's numbers; this only sorts and formats them. */
export function deriveLatency(lat: LatencyData | undefined = {}): LatencyPanel {
  const byModel = lat.by_model ?? {};
  if (!Object.keys(byModel).length) {
    return { hidden: true, byModel: [], byEndpoint: [], slowest: [] };
  }
  const slowest: LatencySlowRow[] = lat.slowest ?? [];
  return {
    hidden: false,
    byModel: Object.entries(byModel).sort(byP90).map(([name, bucket]) =>
      latencyRow(name, bucket, true),
    ),
    byEndpoint: Object.entries(lat.by_endpoint ?? {})
      .sort(byP90)
      .map(([name, bucket]) => latencyRow(name, bucket, false)),
    slowest: slowest.map((row) => ({
      session: String(row.session ?? ""),
      // A turn without a model is unknown, not unattributed COST (views.js:1345).
      model: String(row.model || "(unknown)"),
      seconds: num(row.s),
      secondsText: `${num(row.s)}s`,
      icon: providerMark(provOf("", short(row.model), "")),
    })),
  };
}

// ---- Unattributed project cost (views.js:1465-1513) -------------------------

export interface UnattributedBucket {
  name: string;
  cost: number;
  costText: string;
  tokens: number;
  sessions: number;
  unattributed: boolean;
  hatch: boolean;
  color: string;
}

export interface UnattributedPanel {
  empty: boolean;
  totalCost: number;
  unattrCost: number;
  unattrPct: number;
  header: string;
  tooltip: string;
  buckets: UnattributedBucket[];
}

const UNATTR_TOOLTIP =
  "No usable session title, no usable working directory, and no parent session that resolves either.";

/** `+r.act || +r.est || 0` from views.js:1468 — the collector's own cost. */
export const rowCost = (row: AnalyticsRow): number => num(row.act) || num(row.est);

/** Unattributed sorts last; every other project sorts by cost descending. */
export function projectSort(a: UnattributedBucket, b: UnattributedBucket): number {
  if (a.name === UNATTR_LABEL) return 1;
  if (b.name === UNATTR_LABEL) return -1;
  return b.cost - a.cost;
}

export function deriveUnattributed(
  rows: readonly AnalyticsRow[] = [],
  exclude = false,
): UnattributedPanel {
  const inRange = [...rows];
  if (!inRange.length) {
    return {
      empty: true,
      totalCost: 0,
      unattrCost: 0,
      unattrPct: 0,
      header: "",
      tooltip: UNATTR_TOOLTIP,
      buckets: [],
    };
  }
  const totalCost = inRange.reduce((sum, row) => sum + rowCost(row), 0);
  const byProject = new Map<string, UnattributedBucket>();
  for (const row of inRange) {
    const name = String(row.project || UNATTR_LABEL);
    const bucket = byProject.get(name) ?? {
      name,
      cost: 0,
      costText: "$0.00",
      tokens: 0,
      sessions: 0,
      unattributed: name === UNATTR_LABEL,
      hatch: name === UNATTR_LABEL,
      color: `var(--chart-${byProject.size % 10})`,
    };
    bucket.cost += rowCost(row);
    bucket.tokens += num(row.inp) + num(row.outp);
    bucket.sessions += num(row.sessions);
    byProject.set(name, bucket);
  }
  const unattrCost = byProject.get(UNATTR_LABEL)?.cost ?? 0;
  const unattrPct = totalCost > 0 ? (100 * unattrCost) / totalCost : 0;
  const buckets = [...byProject.values()]
    .sort(projectSort)
    .filter((bucket) => !exclude || bucket.name !== UNATTR_LABEL)
    .map((bucket) => ({ ...bucket, costText: `$${bucket.cost.toFixed(2)}` }));
  return {
    empty: false,
    totalCost,
    unattrCost,
    unattrPct,
    header: exclude
      ? `${unattrPct.toFixed(0)}% of spend is unattributed (excluded from this chart) — ` +
        `$${unattrCost.toFixed(2)} of $${totalCost.toFixed(2)}`
      : `${unattrPct.toFixed(0)}% of spend unattributed — ` +
        `$${unattrCost.toFixed(2)} of $${totalCost.toFixed(2)}`,
    tooltip: UNATTR_TOOLTIP,
    buckets,
  };
}

// ---- Repo & branch cost (views.js:1413-1441) --------------------------------

export interface RepoBranchRowModel {
  branch: string;
  sessions: number;
  calls: number;
  tokens: number;
  cost: number;
  costText: string;
  tokensText: string;
  unattributed: boolean;
}

export interface RepoRowModel {
  repo: string;
  sessions: number;
  calls: number;
  tokens: number;
  cost: number;
  costText: string;
  tokensText: string;
  unattributed: boolean;
  branches: RepoBranchRowModel[];
}

export interface RepoBranchPanel {
  hidden: boolean;
  repos: RepoRowModel[];
  totalCost: number;
  unattrCost: number;
  unattrPct: number;
  unattrText: string;
}

function costSort<T extends { cost: number }>(name: (row: T) => string) {
  return (a: T, b: T): number => {
    if (name(a) === UNATTR_LABEL) return 1;
    if (name(b) === UNATTR_LABEL) return -1;
    return b.cost - a.cost;
  };
}

function branchRow(branch: RepoBranchBucket): RepoBranchRowModel {
  const cost = num(branch.cost);
  return {
    branch: String(branch.branch ?? UNATTR_LABEL),
    sessions: num(branch.sessions),
    calls: num(branch.calls),
    tokens: num(branch.tokens),
    cost,
    costText: `$${cost.toFixed(2)}`,
    tokensText: `${compact(num(branch.tokens))} tok`,
    unattributed: String(branch.branch ?? UNATTR_LABEL) === UNATTR_LABEL,
  };
}

/** The collector already priced these rows; only order and format them. */
export function deriveRepoBranch(data: RepoBranchData | undefined = {}): RepoBranchPanel {
  const repos: RepoRowModel[] = (data.repos ?? []).map((repo: RepoCostRow) => {
    const cost = num(repo.cost);
    return {
      repo: String(repo.repo ?? UNATTR_LABEL),
      sessions: num(repo.sessions),
      calls: num(repo.calls),
      tokens: num(repo.tokens),
      cost,
      costText: `$${cost.toFixed(2)}`,
      tokensText: `${compact(num(repo.tokens))} tok`,
      unattributed: String(repo.repo ?? UNATTR_LABEL) === UNATTR_LABEL,
      branches: (repo.branches ?? []).map(branchRow).sort(costSort((row) => row.branch)),
    };
  }).sort(costSort((row) => row.repo));
  if (!repos.length) {
    return {
      hidden: true,
      repos: [],
      totalCost: 0,
      unattrCost: 0,
      unattrPct: 0,
      unattrText: "",
    };
  }
  const totalCost = repos.reduce((sum, repo) => sum + repo.cost, 0);
  const unattrCost = repos
    .filter((repo) => repo.repo === UNATTR_LABEL)
    .reduce((sum, repo) => sum + repo.cost, 0);
  const unattrPct = totalCost > 0 ? (100 * unattrCost) / totalCost : 0;
  return {
    hidden: false,
    repos,
    totalCost,
    unattrCost,
    unattrPct,
    unattrText:
      `Unattributed: $${unattrCost.toFixed(2)} of $${totalCost.toFixed(2)} ` +
      `(${unattrPct.toFixed(0)}%)`,
  };
}

/** Stable DOM id for aria-controls; derived from the repo name, never random.
 * Every non-alphanumeric is encoded as `_<base36 code point>_` (including `_`
 * itself), so "a/b", "a-b" and "a b" cannot collapse onto one id. */
export function repoRowId(repo: string): string {
  const encoded = Array.from(repo, (ch) =>
    /[A-Za-z0-9]/.test(ch) ? ch : `_${ch.codePointAt(0)!.toString(36)}_`,
  ).join("");
  return `uc-repo-${encoded}`;
}

export interface FlatRepoRow extends RepoBranchRowModel {
  repoKey: string;
  indent: boolean;
  expandable: boolean;
  expanded: boolean;
  controls: string;
}

/** One flat list for the expandable table: a click toggles one Set key. */
export function flattenRepoRows(
  repos: readonly RepoRowModel[],
  expanded: ReadonlySet<string>,
): FlatRepoRow[] {
  return repos.flatMap((repo) => {
    const row: FlatRepoRow = {
      repoKey: repo.repo,
      branch: repo.repo,
      sessions: repo.sessions,
      calls: repo.calls,
      tokens: repo.tokens,
      cost: repo.cost,
      costText: repo.costText,
      tokensText: repo.tokensText,
      unattributed: repo.unattributed,
      indent: false,
      expandable: true,
      expanded: expanded.has(repo.repo),
      controls: repoRowId(repo.repo),
    };
    const branches = expanded.has(repo.repo)
      ? repo.branches.map((branch) => ({
          ...branch,
          repoKey: repo.repo,
          indent: true,
          expandable: false,
          expanded: false,
          controls: "",
        }))
      : [];
    return [row, ...branches];
  });
}

// ---- One snapshot read for every panel -------------------------------------

export interface PanelsModel {
  profile: string | null;
  transfer: TransferPanel;
  bandwidth: BandwidthPanel;
  concurrency: ConcurrencyPanel;
  latency: LatencyPanel;
  unattributed: UnattributedPanel;
  repos: RepoBranchPanel;
}

/** Profile choice and date bounds match deriveUsage; each panel then applies
 * its own payload's scope (bandwidth/concurrency carry their own dates). */
export function derivePanels(
  snapshot: UsageSnapshot,
  filters: UsageFilters = {},
): PanelsModel {
  const profiles = snapshot.analytics?.profiles ?? {};
  const keys = Object.keys(profiles);
  const profileKey = filters.profile && profiles[filters.profile]
    ? filters.profile
    : keys[0] ?? null;
  const profile = profileKey ? profiles[profileKey] : undefined;
  // Other panels stay cross-filtered; unattributed cost is a date-scoped
  // project roll-up (views.js:622-626,742) and must not shrink when the user
  // filters by model/provider/project.
  const dateRows = filterRows(profile?.rows ?? [], { from: filters.from, to: filters.to });
  const rows = filterRows(dateRows, filters);
  return {
    profile: profileKey,
    transfer: deriveTransfer(rows),
    bandwidth: deriveBandwidth(profile?.bandwidth_daily ?? [], filters.from, filters.to),
    concurrency: deriveConcurrency(
      profile?.concurrency ?? [],
      filters.from,
      filters.to,
      snapshot.ollama?.hosts ?? [],
    ),
    latency: deriveLatency(profile?.latency),
    unattributed: deriveUnattributed(dateRows, filters.exclude),
    repos: deriveRepoBranch(profile?.repo_branch),
  };
}
