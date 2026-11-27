// LLMTELEMET-293 (T-22 RUN A): pure Usage derivations ported from
// src/llm_telemetry/web/js/views.js (610-626, 774-843) and charts.js:148.
// No DOM, no Chart.js, no collectors: given a snapshot and the cross-filters,
// these functions produce the five datasets the page draws. Values come only
// from the artifacts; an absent artifact produces n/a, never a fabricated row.
import {
  HEXAGON_PATH,
  RT_LOGO,
  RT_SVG,
} from "../home-board/provider-icons";
import type {
  AnalyticsProfile,
  AnalyticsRow,
  DateBounds,
  HourRow,
  UsageFilters,
  UsageSnapshot,
} from "./types";

/** Chart.js-free dataset shapes shared with components/ChartCard.tsx. */
export interface ChartPoint {
  key: string;
  label: string;
  value: number;
  color: string;
  /** SVG path data for provider marks; never a letter or monogram. */
  icon?: string;
  /** Opt-in display text (e.g. dollars); the numeric value still scales the bar. */
  valueText?: string;
}

export interface ChartSeries {
  key: string;
  label: string;
  values: number[];
  color: string;
  format?: "count" | "compact";
}

export interface SeriesStats {
  max: number;
  mean: number;
  last: number;
}

export interface UsageModel {
  profile: string | null;
  bounds: DateBounds;
  rowCount: number;
  calls: number;
  tokens: number;
  providers: ChartPoint[];
  models: ChartPoint[];
  share: ChartPoint[];
  daily: { labels: string[]; series: ChartSeries[] };
  hours: ChartPoint[];
}

/** `+x || 0` from the Python view, including numeric strings and NaN. */
export function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function short(model: unknown): string {
  return model == null ? "" : String(model).split("/").pop() ?? "";
}

/** views.js:174-212, in the same evidence order and with config's LAN list. */
export const DEFAULT_LOCAL_HOSTS = [
  "127.0.0.1", "localhost", "::1",
  "192.168.", "10.", "172.16.", "172.17.", "172.18.", "172.19.",
  "172.2", "172.30.", "172.31.", ".local", ".internal", ".lan",
] as const;

const CLOUD_SUFFIX = /(:|-|\.)cloud$/i;
const LOCAL_RE = /^(qwen|gpt-oss|deepseek-r1|nemotron|llama|mistral|phi|gemma)/i;

export function provOf(
  provider: unknown,
  model: unknown,
  baseUrl: unknown,
  localHosts: readonly string[] = DEFAULT_LOCAL_HOSTS,
): string {
  const url = String(baseUrl ?? "").toLowerCase();
  if (url) {
    if (url.includes("fireworks.ai")) return "fireworks";
    if (url.includes("opencode.ai")) return "opencode-go";
    if (url.includes("api.anthropic.com")) return "anthropic";
    if (url.includes("openai.com") || url.includes("chatgpt.com")) return "openai-codex";
    if (url.includes("openrouter.ai")) return "openrouter";
    if (url.includes("nousresearch")) return "nous";
    if (url.includes("ollama.com")) return "ollama-cloud";
    if (localHosts.some((host) => url.includes(host))) return "local";
  }
  const key = String(provider ?? "").toLowerCase().trim();
  if (key && key !== "custom") return key;
  const m = String(model ?? "").toLowerCase();
  if (m.includes("fireworks")) return "fireworks";
  if (CLOUD_SUFFIX.test(m)) return "ollama-cloud";
  if (!m.includes("/") && LOCAL_RE.test(m)) return "local";
  if (m.includes("claude")) return "anthropic";
  if (m.includes("glm") || m.includes("kimi") || m.includes("minimax")) return "opencode-go";
  if (m.startsWith("stepfun/") || m.startsWith("step-") || m.includes("hermes-")) return "nous";
  if (m.startsWith("gpt-")) return "openai-codex";
  if (key === "custom") return "local";
  return "cloud";
}

/** Human labels for the nine PROV keys; any other key stays as recorded. */
export const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  anthropic: "Anthropic",
  "opencode-go": "OpenCode Go",
  fireworks: "Fireworks",
  "openai-codex": "OpenAI",
  local: "Local",
  moa: "MoA",
  cloud: "Cloud",
  "ollama-cloud": "Ollama Cloud",
  nous: "Nous",
};

export function providerLabel(key: string): string {
  return PROVIDER_LABELS[key] ?? key;
}

const PROVIDER_BRAND: Readonly<Record<string, string>> = {
  anthropic: "anthropic",
  "openai-codex": "openai",
  openai: "openai",
  gemini: "googlegemini",
  local: "ollama",
  custom: "ollama",
  "ollama-cloud": "ollama",
  openrouter: "openrouter",
  copilot: "githubcopilot",
  "opencode-go": "opencode",
  deepseek: "deepseek",
};

/** Brand SVG path only. Unknown brands get the neutral hexagon, never a letter. */
export function providerMark(key: string): string {
  const brand = PROVIDER_BRAND[key] ?? RT_LOGO[key];
  return brand && brand in RT_SVG ? RT_SVG[brand as keyof typeof RT_SVG] : HEXAGON_PATH;
}

function cssKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
}

const FG_TOKENS = new Set([
  "anthropic", "openai-codex", "cloud", "ollama-cloud", "local",
  "opencode-go", "nous", "fireworks", "moa",
]);
const BASE_TOKENS = new Set([
  "anthropic", "openai", "gemini", "local", "ollama-cloud", "openrouter",
  "copilot", "opencode-go", "deepseek", "nous", "fireworks", "moa", "unknown",
]);

/** PROV[x].fg is a CSS token lookup; keep that indirection in the browser. */
export function colorOfProvider(key: string): string {
  const k = cssKey(key);
  if (k === "custom") return colorOfProvider("local");
  if (FG_TOKENS.has(k)) return `var(--prov-${k}-fg, var(--prov-unknown))`;
  if (BASE_TOKENS.has(k)) return `var(--prov-${k}, var(--prov-unknown))`;
  return "var(--prov-unknown)";
}

/** Model colours resolve through --chart-N / --prov-* tokens, never hex. */
export function colorOfModel(name: string): string {
  const m = name.toLowerCase();
  if (/claude|opus|sonnet|haiku/.test(m)) return "var(--prov-anthropic)";
  if (/glm|kimi|minimax/.test(m)) return "var(--prov-opencode-go)";
  if (/deepseek/.test(m)) return "var(--prov-deepseek)";
  if (/qwen|gpt-oss|nemotron|llama|mistral|phi|gemma/.test(m)) return "var(--prov-local)";
  if (/gpt-|astra|luna|codex/.test(m)) return "var(--prov-openai-codex)";
  if (/gemini/.test(m)) return "var(--prov-gemini)";
  return "var(--prov-unknown)";
}

/** Inclusive date test from views.js:615 — an empty date is not in range. */
export function inR(date: unknown, from = "", to = ""): boolean {
  const d = String(date ?? "");
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

/** Project -> provider -> model, composed in that fixed order. */
export function filterRows(rows: readonly AnalyticsRow[], f: UsageFilters = {}): AnalyticsRow[] {
  let out = rows.filter((r) => inR(r.date, f.from, f.to));
  if (f.project) out = out.filter((r) => (r.project || "Unattributed") === f.project);
  if (f.provider) out = out.filter((r) => (r.provider || "") === f.provider);
  if (f.model) out = out.filter((r) => r.model === f.model);
  return out;
}

/** charts.js:148 — descending by value; ties keep first-seen order. */
export function agg<T>(
  rows: readonly T[],
  keyFn: (row: T) => unknown,
  valFn: (row: T) => unknown,
): Array<[string, number]> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = String(keyFn(row) ?? "");
    totals.set(key, (totals.get(key) ?? 0) + num(valFn(row)));
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

/** Input + output only, matching the Usage chart's token definition. */
export const rowTokens = (row: AnalyticsRow): number => num(row.inp) + num(row.outp);

/** charts.js:104-112: stats come from the plotted arrays themselves. */
export function seriesStats(values: readonly unknown[]): SeriesStats | null {
  const finite = values
    .map((v) => (v === null || v === "" ? NaN : Number(v)))
    .filter((v) => Number.isFinite(v));
  if (!finite.length) return null;
  return {
    max: Math.max(...finite),
    mean: finite.reduce((sum, v) => sum + v, 0) / finite.length,
    last: finite[finite.length - 1],
  };
}

function dateBounds(profile: AnalyticsProfile | undefined): DateBounds {
  const rows = profile?.rows ?? [];
  let min = "", max = "";
  for (const row of rows) {
    const d = String(row.date ?? "");
    if (!d) continue;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  }
  return {
    from: String(profile?.min_date ?? "") || min,
    to: String(profile?.max_date ?? "") || max,
  };
}

function hourBuckets(profile: AnalyticsProfile | undefined, f: UsageFilters): ChartPoint[] {
  const source = (profile?.hours ?? []).filter((h: HourRow) => inR(h.date, f.from, f.to));
  const byHour = new Map(agg(source, (h) => num(h.hour), (h) => h.calls));
  return Array.from({ length: 24 }, (_, hour) => {
    const key = String(hour).padStart(2, "0");
    return {
      key,
      label: key,
      value: byHour.get(String(hour)) ?? 0,
      color: "var(--chart-4)",
    };
  });
}

/** One pass over the selected profile; pure enough to call in render and tests. */
export function deriveUsage(snapshot: UsageSnapshot, f: UsageFilters = {}): UsageModel {
  const profiles = snapshot.analytics?.profiles ?? {};
  const keys = Object.keys(profiles);
  const profileKey = f.profile && profiles[f.profile] ? f.profile : keys[0] ?? null;
  const profile = profileKey ? profiles[profileKey] : undefined;
  const rows = filterRows(profile?.rows ?? [], f);

  const providers = agg(
    rows,
    (r) => provOf(r.provider, r.model, r.base_url),
    (r) => r.calls,
  ).map(([key, value]) => ({
    key,
    label: providerLabel(key),
    value,
    color: colorOfProvider(key),
    icon: providerMark(key),
  }));

  const models = agg(rows, (r) => short(r.model), (r) => r.calls)
    .slice(0, 10)
    .map(([key, value]) => ({
      key,
      label: key,
      value,
      color: colorOfModel(key),
    }));

  const share = agg(rows, (r) => short(r.model), rowTokens)
    .slice(0, 8)
    .map(([key, value]) => ({
      key,
      label: key,
      value,
      color: colorOfModel(key),
    }));

  // views.js:782 — sorted distinct dates, not an agg() order, so the chart
  // reads oldest to newest on every profile.
  const labels = [...new Set(rows.map((r) => String(r.date ?? "")))].sort();
  const callsByDay = new Map(agg(rows, (r) => r.date, (r) => r.calls));
  const tokensByDay = new Map(agg(rows, (r) => r.date, rowTokens));
  const daily = {
    labels,
    series: [
      {
        key: "calls",
        label: "calls",
        values: labels.map((d) => callsByDay.get(d) ?? 0),
        color: "var(--accent)",
        format: "count" as const,
      },
      {
        key: "tokens",
        label: "tokens",
        values: labels.map((d) => tokensByDay.get(d) ?? 0),
        color: "var(--accent2)",
        format: "compact" as const,
      },
    ],
  };

  return {
    profile: profileKey,
    bounds: dateBounds(profile),
    rowCount: rows.length,
    calls: rows.reduce((sum, r) => sum + num(r.calls), 0),
    tokens: rows.reduce((sum, r) => sum + rowTokens(r), 0),
    providers,
    models,
    share,
    daily,
    hours: hourBuckets(profile, f),
  };
}
