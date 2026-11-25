// LLMTELEMET-293 (T-22 RUN A): the two artifacts the Usage view needs, and
// the narrow shapes its derivations read from them. Mirrors the collector
// payloads in examples/reports rather than inventing values for either one.
// A missing artifact stays `null` in the snapshot so the page can show n/a.

export interface Artifact {
  schema_version?: number;
}

export interface AnalyticsRow {
  [key: string]: unknown;
  date?: string;
  model?: string;
  provider?: string;
  project?: string;
  task?: string;
  calls?: number | string | null;
  inp?: number | string | null;
  outp?: number | string | null;
  cread?: number | string | null;
  cwrite?: number | string | null;
  rtok?: number | string | null;
  est?: number | string | null;
  act?: number | string | null;
  sessions?: number | string | null;
  base_url?: string;
  cost_class?: string;
  market_value_usd?: number | string | null;
  billed_usd?: number | string | null;
  priced?: boolean;
}

export interface HourRow {
  [key: string]: unknown;
  date?: string;
  hour?: number | string | null;
  calls?: number | string | null;
  inp?: number | string | null;
  outp?: number | string | null;
  cread?: number | string | null;
  cwrite?: number | string | null;
  tokens?: number | string | null;
  model?: string;
  provider?: string;
  task?: string;
  base_url?: string;
}

export interface AnalyticsProfile {
  [key: string]: unknown;
  rows?: AnalyticsRow[];
  hours?: HourRow[];
  /** Optional higher-resolution payload used by the hour-range UI. */
  hour_rows?: HourRow[];
  min_date?: string;
  max_date?: string;
  active?: number;
  live?: unknown[];
}

export interface AnalyticsData extends Artifact {
  [key: string]: unknown;
  generated?: string;
  profiles?: Record<string, AnalyticsProfile>;
}

export interface CostModel {
  [key: string]: unknown;
  model?: string;
  short?: string;
  oid?: string;
  in_1m?: number | string | null;
  out_1m?: number | string | null;
  cache_1m?: number | string | null;
  source?: string;
  tps?: number | string | null;
  calls?: number | string | null;
  cost?: number | string | null;
  providers?: string[];
}

export interface CostsData extends Artifact {
  [key: string]: unknown;
  generated?: string;
  models?: CostModel[];
  catalog_size?: number;
  catalog_source?: string;
  freshness?: Record<string, unknown>;
}

/** One read of the reports dir: both artifacts, no second file walk. */
export interface UsageSnapshot {
  analytics: AnalyticsData | null;
  costs: CostsData | null;
  dir: string;
}

/** Cross-filters mirror views.js:610-626 and compose in that same order. */
export interface UsageFilters {
  profile?: string;
  from?: string;
  to?: string;
  project?: string;
  provider?: string;
  model?: string;
}

export interface DateBounds {
  from: string;
  to: string;
}
