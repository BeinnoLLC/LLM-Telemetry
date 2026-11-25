// LLMTELEMET-293 (T-22 RUN C): pure Cost derivations ported from
// src/llm_telemetry/web/js/views.js (774-915, 358-385, 549-588, 1354-1411,
// 2590-2614). Every figure comes from the embedded artifacts; a missing value
// is labelled, never invented. No DOM, no chart library, no collectors here.
import { ago, compact, fmtB } from "../home-board/format";
import {
  agg,
  colorOfModel,
  colorOfProvider,
  filterRows,
  inR,
  num,
  providerLabel,
  providerMark,
  provOf,
  short,
  type ChartPoint,
} from "./usage";
import type {
  AnalyticsProfile,
  AnalyticsRow,
  AttributionData,
  ResendSessionRow,
  UsageFilters,
  UsageSnapshot,
} from "./types";

/** Mirrors RESEND_MIN_CALLS in collect_analytics.py (views.js:548). */
export const RESEND_MIN = 10;

const DAY_MS = 24 * 3600;
const LOG_FLOOR = 0.01;

export interface CostTaskPoint {
  key: string;
  label: string;
  /** Cost in USD, already summed from the artifact's market_value_usd. */
  cost: number;
  /** Calls stay on a linear axis while costs use a log axis. */
  calls: number;
  /** 0..1 height on a log axis; zero cost has zero height but keeps its call. */
  logHeight: number;
}

export interface ProviderCostRow {
  key: string;
  label: string;
  icon: string;
  color: string;
  calls: number;
  tokens: number;
  up: number;
  down: number;
  cost: number;
  costText: string;
  models: number;
  widthPct: number;
}

export interface ModelCostRow {
  key: string;
  model: string;
  provider: string;
  icon: string;
  color: string;
  calls: number;
  inp: number;
  outp: number;
  cache: number;
  up: number;
  down: number;
  cost: number;
  costKind: "local" | "freetier" | "unpriced" | "billed";
  costText: string;
  costTitle: string;
  widthPct: number;
  tasks: string[];
}

export interface SessionResendRow {
  id: string;
  title: string;
  model: string;
  label: string;
  icon: string;
  color: string;
  calls: number;
  ctxText: string;
  cachedPct: number;
  cost: number;
  costText: string;
  widthPct: number;
}

export interface AttributionModel {
  hidden: boolean;
  bySource: Array<{ source: string; sessionsText: string; costText: string }>;
  byTool: Array<{ tool: string; tokensText: string; costText: string }>;
  byRoot: Array<{
    id: string;
    title: string;
    ownText: string;
    descendantsText: string;
    totalText: string;
  }>;
  byCron: Array<{
    name: string;
    runsText: string;
    avgText: string;
    monthlyText: string;
  }>;
  footer: string;
}

export interface StaleChip {
  visible: boolean;
  state: "fresh" | "old" | "stale" | "unknown";
  text: string;
}

export interface CostModel {
  profile: string | null;
  rowCount: number;
  empty: boolean;
  taskCosts: CostTaskPoint[];
  modelCosts: ChartPoint[];
  providers: ChartPoint[];
  providerRows: ProviderCostRow[];
  modelRows: ModelCostRow[];
  unpriced: Array<{ label: string; calls: number }>;
  resend: SessionResendRow[];
  resendNote: string;
  attribution: AttributionModel;
  stale: StaleChip;
}

/** palette.js:204-211 without the HTML: the label and its explanation stay
 * separate so the component can render tokens-only markup. */
export function costCell(
  value: unknown,
  local = false,
  state: "" | "freetier" | "unpriced" = "",
): { text: string; title: string } {
  const v = num(value);
  if (state === "unpriced") {
    return {
      text: "unpriced",
      title:
        "No price found for this model: its traffic is counted at $0, so Est. cost is understated. Add it to WEB_RATES or ALIASES in pricing.py.",
    };
  }
  if (state === "freetier") {
    return {
      text: "$0 free tier",
      title: "Published $0 tier: genuinely $0 per token.",
    };
  }
  if (!local) return { text: `$${v.toFixed(2)}`, title: "" };
  const s = v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : v > 0 ? v.toFixed(4) : "0";
  return {
    text: `~$${s} electricity`,
    title: "Electricity at your tariff. Not billed by any provider.",
  };
}

/** views.js:358-385 — a model is unpriced only when no row priced it and it is
 * not local, a published free tier or a router preset. */
export function unpricedModels(rows: readonly AnalyticsRow[]): Array<{ label: string; calls: number }> {
  const by = new Map<string, { calls: number; priced: boolean }>();
  for (const row of rows) {
    const key = short(row.model);
    const entry = by.get(key) ?? { calls: 0, priced: false };
    entry.calls += num(row.calls);
    if (
      row.priced ||
      row.cost_class === "local" ||
      row.cost_class === "free" ||
      row.cost_class === "preset"
    ) {
      entry.priced = true;
    }
    by.set(key, entry);
  }
  return [...by.entries()]
    .filter(([, value]) => !value.priced && value.calls > 0)
    .sort((a, b) => b[1].calls - a[1].calls)
    .map(([label, value]) => ({ label, calls: value.calls }));
}

/** A logarithmic bar cannot draw zero. `ceiling` is the shared axis maximum;
 * values at or below the first decade have no visible bar. */
export function logScaleHeight(value: number, ceiling = 1, floor = LOG_FLOOR): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const base = floor > 0 ? floor : LOG_FLOOR;
  if (value <= base) return 0;
  const top = Math.max(base, ceiling, value);
  return (Math.log10(value) - Math.log10(base)) / (Math.log10(top) - Math.log10(base));
}

/** views.js:807-816 — cost by task desc, calls by task on its own linear axis. */
export function taskCosts(rows: readonly AnalyticsRow[]): CostTaskPoint[] {
  const costs = new Map(agg(rows, (r) => r.task, (r) => r.market_value_usd));
  const calls = new Map(agg(rows, (r) => r.task, (r) => r.calls));
  const ceiling = Math.max(LOG_FLOOR, ...[...costs.values()].map((v) => Math.max(0, v)));
  return [...costs.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, cost]) => {
      const value = Math.max(0, cost);
      return {
        key,
        label: key || "n/a",
        cost: value,
        calls: calls.get(key) ?? 0,
        logHeight: logScaleHeight(value, ceiling),
      };
    });
}

/** views.js:844-872 — provider table: metered + LAN bytes in one column,
 * sorted by market cost, market cost is never used as a bandwidth figure. */
export function providerCostRows(rows: readonly AnalyticsRow[]): ProviderCostRow[] {
  const by = new Map<string, {
    calls: number;
    tokens: number;
    up: number;
    down: number;
    cost: number;
    models: Set<string>;
  }>();
  for (const row of rows) {
    const key = provOf(row.provider, row.model, row.base_url);
    const entry = by.get(key) ?? {
      calls: 0, tokens: 0, up: 0, down: 0, cost: 0, models: new Set<string>(),
    };
    entry.calls += num(row.calls);
    entry.tokens += num(row.inp) + num(row.outp);
    entry.up += num(row.up_bytes) + num(row.lan_up_bytes);
    entry.down += num(row.down_bytes) + num(row.lan_down_bytes);
    entry.cost += num(row.market_value_usd);
    entry.models.add(short(row.model));
    by.set(key, entry);
  }
  const peak = Math.max(0.01, ...[...by.values()].map((entry) => entry.cost));
  return [...by.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([key, entry]) => ({
      key,
      label: providerLabel(key),
      icon: providerMark(key),
      color: colorOfProvider(key),
      calls: entry.calls,
      tokens: entry.tokens,
      up: entry.up,
      down: entry.down,
      cost: entry.cost,
      costText: `$${entry.cost.toFixed(2)}`,
      models: entry.models.size,
      widthPct: Math.max(2, (entry.cost / peak) * 100),
    }));
}

/** views.js:875-910 — the per-model cost table and its costCell states. */
export function modelCostRows(rows: readonly AnalyticsRow[]): ModelCostRow[] {
  const by = new Map<string, {
    model: string;
    provider: string;
    calls: number;
    inp: number;
    outp: number;
    cache: number;
    up: number;
    down: number;
    cost: number;
    local: boolean;
    priced: boolean;
    freetier: boolean;
    tasks: Set<string>;
  }>();
  for (const row of rows) {
    const model = short(row.model);
    const provider = provOf(row.provider, row.model, row.base_url);
    const key = `${model}|${provider}`;
    const entry = by.get(key) ?? {
      model, provider, calls: 0, inp: 0, outp: 0, cache: 0, up: 0, down: 0,
      cost: 0, local: false, priced: false, freetier: false, tasks: new Set<string>(),
    };
    entry.calls += num(row.calls);
    entry.inp += num(row.inp);
    entry.outp += num(row.outp);
    entry.cache += num(row.cread);
    entry.cost += num(row.market_value_usd);
    entry.up += num(row.up_bytes) + num(row.lan_up_bytes);
    entry.down += num(row.down_bytes) + num(row.lan_down_bytes);
    if (row.cost_class === "local") entry.local = true;
    if (row.priced || row.cost_class === "local" || row.cost_class === "preset") entry.priced = true;
    if (row.cost_class === "free") entry.freetier = true;
    if (row.task) entry.tasks.add(String(row.task));
    by.set(key, entry);
  }
  const peak = Math.max(1, ...[...by.values()].map((entry) => entry.calls));
  return [...by.entries()]
    .sort((a, b) => b[1].calls - a[1].calls)
    .map(([key, entry]) => {
      const kind: ModelCostRow["costKind"] = entry.local
        ? "local"
        : entry.freetier
          ? "freetier"
          : !entry.priced
            ? "unpriced"
            : "billed";
      const cell = costCell(
        entry.cost,
        entry.local,
        kind === "freetier" || kind === "unpriced" ? kind : "",
      );
      return {
        key,
        model: entry.model || "n/a",
        provider: entry.provider,
        icon: providerMark(entry.provider),
        color: colorOfModel(entry.model),
        calls: entry.calls,
        inp: entry.inp,
        outp: entry.outp,
        cache: entry.cache,
        up: entry.up,
        down: entry.down,
        cost: entry.cost,
        costKind: kind,
        costText: cell.text,
        costTitle: cell.title,
        widthPct: Math.max(3, (entry.calls / peak) * 100),
        tasks: [...entry.tasks].sort(),
      };
    });
}

/** Epoch seconds -> local calendar day, exactly as views.js:553-556. */
export function localDay(ts: unknown): string {
  const n = num(ts);
  if (!n) return "";
  const date = new Date(n * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return (
    date.getFullYear() +
    "-" + String(date.getMonth() + 1).padStart(2, "0") +
    "-" + String(date.getDate()).padStart(2, "0")
  );
}

/** views.js:549-569 — collector rows, filtered at RESEND_MIN calls and by the
 * last session day. No re-send is recomputed from tokens on this page. */
export function sessionResends(
  profile: AnalyticsProfile | undefined,
  from = "",
  to = "",
): SessionResendRow[] {
  const rows = (profile?.resend ?? []).filter(
    (row) => num(row.calls) >= RESEND_MIN && (!row.last || inR(localDay(row.last), from, to)),
  );
  const peak = Math.max(0.01, ...rows.map((row) => num(row.resend_usd)));
  return rows.map((row: ResendSessionRow) => {
    const model = short(row.model);
    const provider = provOf("", row.model, "");
    const local = row.cost_class === "local";
    const state = row.cost_class === "free"
      ? "freetier"
      : row.priced === false || row.cost_class === "unpriced"
        ? "unpriced"
        : "";
    const cell = costCell(row.resend_usd, local, state);
    return {
      id: String(row.id ?? ""),
      title: String(row.title || row.id || ""),
      model,
      label: providerLabel(provider),
      icon: providerMark(provider),
      color: colorOfModel(model),
      calls: num(row.calls),
      ctxText: compact(row.ctx_per_call),
      cachedPct: num(row.cread_pct),
      cost: num(row.resend_usd),
      costText: local || state ? cell.text : `$${num(row.resend_usd).toFixed(2)}`,
      widthPct: Math.max(2, (num(row.resend_usd) / peak) * 100),
    };
  });
}

/** Four-decimal money from renderAttribution (views.js:1362). */
export function attributionMoney(value: unknown): string {
  return `$${num(value).toFixed(4)}`;
}

/** views.js:1354-1411 — only collector aggregates; there is no client-side
 * attribution, and an empty by_source hides the whole card. */
export function attributionPanel(data: AttributionData | undefined): AttributionModel {
  const empty: AttributionModel = {
    hidden: true, bySource: [], byTool: [], byRoot: [], byCron: [], footer: "",
  };
  if (!data?.by_source?.length) return empty;
  return {
    hidden: false,
    bySource: data.by_source.map((row) => ({
      source: String(row.source ?? "n/a"),
      sessionsText: `${row.sessions ?? 0} sess`,
      costText: attributionMoney(row.cost),
    })),
    byTool: (data.by_tool ?? []).map((row) => ({
      tool: String(row.tool ?? "n/a"),
      tokensText: `${num(row.tokens).toLocaleString("en-US")} tok`,
      costText: attributionMoney(row.cost),
    })),
    byRoot: (data.by_root ?? []).slice(0, 10).map((row) => ({
      id: String(row.id ?? ""),
      title: String(row.title ?? "n/a"),
      ownText: `own ${attributionMoney(row.own)}`,
      descendantsText: `+desc ${attributionMoney(row.descendants)}`,
      totalText: attributionMoney(row.total),
    })),
    byCron: (data.by_cron ?? []).map((row) => ({
      name: String(row.name ?? "n/a"),
      runsText: `${row.runs ?? 0} runs`,
      avgText: `avg ${attributionMoney(row.avg)}`,
      monthlyText: `~${attributionMoney(row.monthly_projection)}/mo`,
    })),
    footer:
      "Cost here comes from this dashboard’s own OpenRouter-rate pricing, not from Hermes’s own cost_status (which is unknown on a large share of sessions).",
  };
}

type StaleRecord = { stale?: boolean; age_s?: number | string | null; policy_s?: number | string | null };

/** views.js:2590-2614 — an inline chip, not a page-wide red banner. The
 * collector's stale.prices record wins; the artifact's price freshness is the
 * fallback, with the same 72h policy cut used by the Prices pill. */
export function stalePriceChip(
  freshness: Record<string, unknown> | undefined,
  stale: Record<string, unknown> | undefined,
): StaleChip {
  const price = (stale?.prices ?? null) as StaleRecord | null;
  if (price) {
    const age = price.age_s == null ? null : Math.max(0, num(price.age_s));
    if (!price.stale) return { visible: false, state: "fresh", text: "" };
    const policy = price.policy_s == null ? "72h" : ago(num(price.policy_s));
    const shown = age == null ? "no data" : ago(age);
    return {
      visible: true,
      state: "stale",
      text: `Rates last refreshed ${shown} ago (policy ${policy}); costs use the last good price sheet.`,
    };
  }
  const fresh = freshness ?? {};
  const age = fresh.age_s == null ? null : Math.max(0, num(fresh.age_s));
  const state = fresh.state === "pinned" ? "fresh" : age == null ? "unknown" : age >= 3 * DAY_MS ? "stale" : "fresh";
  if (state !== "stale") return { visible: false, state, text: "" };
  return {
    visible: true,
    state,
    text: `Rates last refreshed ${ago(age!)} ago (policy ${ago(3 * DAY_MS)}); costs use the last good price sheet.`,
  };
}

function chosenProfile(snapshot: UsageSnapshot, f: UsageFilters): [string | null, AnalyticsProfile | undefined] {
  const profiles = snapshot.analytics?.profiles ?? {};
  const keys = Object.keys(profiles);
  const key = f.profile && profiles[f.profile] ? f.profile : keys[0] ?? null;
  return [key, key ? profiles[key] : undefined];
}

/** One pass over the selected profile, matching the Cost tab's dataset build. */
export function deriveCost(snapshot: UsageSnapshot, f: UsageFilters = {}): CostModel {
  const [profileKey, profile] = chosenProfile(snapshot, f);
  const rows = filterRows(profile?.rows ?? [], f);
  const tasks = taskCosts(rows);
  const providerRows = providerCostRows(rows);
  const modelRows = modelCostRows(rows);
  const resend = sessionResends(profile, f.from, f.to);
  const staleRecord = snapshot.analytics?.stale as Record<string, unknown> | undefined;
  const byModel = agg(rows, (r) => short(r.model), (r) => r.market_value_usd)
    .slice(0, 8)
    .map(([key, value]) => ({
      key,
      label: key || "n/a",
      value: Number(value.toFixed(4)),
      color: colorOfModel(key),
    }));
  return {
    profile: profileKey,
    rowCount: rows.length,
    empty: rows.length === 0,
    taskCosts: tasks,
    modelCosts: byModel,
    providers: providerRows.map((row) => ({
      key: row.key,
      label: row.label,
      value: row.calls,
      color: row.color,
      icon: row.icon,
    })),
    providerRows,
    modelRows,
    unpriced: unpricedModels(rows),
    resend,
    resendNote: resend.length
      ? `${resend.length} sessions · $${resend.reduce((sum, row) => sum + row.cost, 0).toFixed(2)} of re-sent context`
      : `No session in this range has at least ${RESEND_MIN} calls to average.`,
    attribution: attributionPanel(profile?.attribution),
    stale: stalePriceChip(snapshot.costs?.freshness, staleRecord),
  };
}

/** Bytes are shown as measured artifacts, never converted from token costs. */
export const providerBytesText = (value: number): string => fmtB(value);
