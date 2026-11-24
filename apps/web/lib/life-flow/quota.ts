// LLMTELEMET-292 (T-21 RUN A2): pure ports of quotaview.js:39-88 (qvAttention,
// qvPct, qvLevel, qvBar), 363-376 (qvKpis) and 529-558 (renderLifeQuota).
// Every value comes from the loaded quota artifact; no fallback numbers.
import type { JsonRecord, QuotaData } from "../home-board/types";

export type QuotaProfile = NonNullable<QuotaData["profiles"]>[string];
export type QuotaLevel = "ok" | "warn" | "bad" | "mute";

export interface QuotaBar {
  /** Mirrors qvBar's aria-label: "no reading" or "<pct>% used". */
  label: string;
  width: number;
  level: QuotaLevel;
}

export interface QuotaKpi {
  value: string | number;
  label: string;
  cls: string;
}

export interface LifeQuotaRow {
  key: string;
  label: string;
  status: string;
  statusClass: "rt-ok" | "rt-warn" | "rt-mute";
  level: QuotaLevel;
  bar: QuotaBar;
  /** CSS var expression from tokens.css:256-287, never a literal colour. */
  color: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** qvAttention() reads the threshold shipped by the collector, never a
 * second copy in the view. A missing or non-positive threshold is null. */
export function qvAttention(quota: QuotaData | null | undefined): number | null {
  const n = Number(quota?.attention_percent);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** qvPct(): null for absent readings, two decimals at most for noisy floats. */
export function qvPct(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 100) / 100;
  return rounded === n ? n : rounded;
}

/** qvLevel(): ok < 60 <= warn < attention <= bad; unknown is mute, not ok. */
export function qvLevel(pct: number | null, attention: number | null): QuotaLevel {
  if (pct === null) return "mute";
  if (attention === null) return "warn";
  if (pct >= attention) return "bad";
  return pct >= Math.min(60, attention) ? "warn" : "ok";
}

/** qvBar(): the metered span's aria-label, fill width and level class. */
export function qvBar(pct: number | null, attention: number | null): QuotaBar {
  const level = qvLevel(pct, attention);
  return {
    label: pct === null ? "no reading" : `${pct}% used`,
    width: pct === null ? 0 : Math.max(0, Math.min(100, pct)),
    level,
  };
}

/** Collectors store providers as a keyed map; older fixtures use a list. */
export function providersOf(profile: QuotaProfile | null | undefined): JsonRecord[] {
  const raw = profile?.providers;
  if (Array.isArray(raw)) return raw.filter(isRecord);
  if (isRecord(raw)) return Object.values(raw).filter(isRecord);
  return [];
}

/** renderLifeQuota()'s filter: a provider with an unavailable_reason is not
 * shown as a meter, but it is still counted by qvKpis. */
export function availableProviders(profile: QuotaProfile | null | undefined): JsonRecord[] {
  return providersOf(profile).filter((provider) => !provider.unavailable_reason);
}

/** Worst reported window, ignoring windows with no usable reading. */
export function worstPercent(provider: JsonRecord): number | null {
  const windows = Array.isArray(provider.windows) ? provider.windows : [];
  return windows.reduce<number | null>((worst, window) => {
    const pct = qvPct(isRecord(window) ? window.used_percent : null);
    return pct !== null && (worst === null || pct > worst) ? pct : worst;
  }, null);
}

/** qvKpis(): four counts from the same raw provider rows, keys tile omitted
 * when no provider reported accounts. */
export function qvKpis(profile: QuotaProfile | null | undefined): QuotaKpi[] {
  const provs = providersOf(profile);
  if (!provs.length) return [];
  const available = provs.filter((provider) => !provider.unavailable_reason).length;
  const near = provs.filter((provider) => provider.attention).length;
  const keys = provs.flatMap((provider) =>
    Array.isArray(provider.accounts) ? provider.accounts : [],
  );
  const usable = keys.filter(
    (key) => isRecord(key) && key.status === "ok",
  ).length;
  const tile = (value: string | number, label: string, cls = ""): QuotaKpi => ({
    value, label, cls,
  });
  return [
    tile(provs.length, provs.length === 1 ? "provider" : "providers"),
    tile(
      `${available}/${provs.length}`,
      "available",
      available < provs.length ? "qv-kpi-warn" : "",
    ),
    tile(near, "near limit", near ? "qv-kpi-bad" : "qv-kpi-ok"),
    ...(keys.length
      ? [tile(
          `${usable}/${keys.length}`,
          "keys usable",
          usable < keys.length ? "qv-kpi-warn" : "",
        )]
      : []),
  ];
}

/** Brand token from tokens.css:256-287. Unknown ids fall back to the neutral
 * provider token; no hex literals and no per-provider colour table here. */
export function providerColor(id: unknown): string {
  const key = String(id ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!key) return "var(--prov-unknown)";
  return `var(--prov-${key}-fg, var(--prov-${key}, var(--prov-unknown)))`;
}

/** One compact Life meter per available provider, in artifact key order. */
export function lifeRows(
  profile: QuotaProfile | null | undefined,
  attention: number | null,
): LifeQuotaRow[] {
  return availableProviders(profile).map((provider, index) => {
    const worst = worstPercent(provider);
    const level = qvLevel(worst, attention);
    return {
      key: String(provider.id ?? provider.label ?? index),
      label: String(provider.label || provider.id || ""),
      status: worst === null ? "no reading" : `${worst}% used`,
      statusClass: worst === null
        ? "rt-mute"
        : level === "ok" ? "rt-ok" : "rt-warn",
      level,
      bar: qvBar(worst, attention),
      color: providerColor(provider.id),
    };
  });
}
