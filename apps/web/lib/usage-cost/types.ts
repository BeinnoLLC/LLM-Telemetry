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
  energy_usd?: number | string | null;
  rate_source?: string;
  priced?: boolean;
  /** Per-row transfer bytes (bandwidth.py / collect_analytics.py). */
  up_bytes?: number | string | null;
  down_bytes?: number | string | null;
  lan_up_bytes?: number | string | null;
  lan_down_bytes?: number | string | null;
}

/** Bandwidth history row from bandwidth_history.py, as carried in analytics. */
export interface BandwidthDailyRow {
  date?: string;
  model?: string;
  provider?: string;
  up_bytes?: number | string | null;
  down_bytes?: number | string | null;
  lan_up_bytes?: number | string | null;
  lan_down_bytes?: number | string | null;
  input_tokens?: number | string | null;
  cache_read_tokens?: number | string | null;
  cache_write_tokens?: number | string | null;
  output_tokens?: number | string | null;
  calls?: number | string | null;
  bytes_per_token?: number | string | null;
  frozen?: boolean;
}

/** Hour-keyed concurrency sample from concurrency.py. */
export interface ConcurrencyRow {
  hour?: string;
  top?: number | string | null;
  sub?: number | string | null;
}

/** Server-computed latency percentile bucket (latency.py); never recomputed. */
export interface LatencyBucket {
  n?: number | string | null;
  p50?: number | string | null;
  p90?: number | string | null;
  p99?: number | string | null;
  tok_s?: number | string | null;
}

export interface LatencySlowRow {
  session?: string;
  model?: string;
  s?: number | string | null;
  ts?: number | string | null;
}

export interface LatencyData {
  by_model?: Record<string, LatencyBucket>;
  by_endpoint?: Record<string, LatencyBucket>;
  slowest?: LatencySlowRow[];
  idle_threshold_s?: number | string | null;
  idle_n?: number | string | null;
}

/** Repo/branch cost rows from collect_repo_branch.py. */
export interface RepoBranchBucket {
  branch?: string;
  sessions?: number | string | null;
  calls?: number | string | null;
  tokens?: number | string | null;
  cost?: number | string | null;
}

export interface RepoCostRow {
  repo?: string;
  sessions?: number | string | null;
  calls?: number | string | null;
  tokens?: number | string | null;
  cost?: number | string | null;
  branches?: RepoBranchBucket[];
}

export interface RepoBranchData {
  repos?: RepoCostRow[];
}

/** One Ollama host entry. Only `queue` is read, and it is a live snapshot. */
export interface OllamaHost {
  [key: string]: unknown;
  queue?: number | string | null;
}

export interface OllamaData extends Artifact {
  [key: string]: unknown;
  hosts?: OllamaHost[];
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

/** Session-level context re-send row from collect_analytics.py. */
export interface ResendSessionRow {
  id?: string;
  title?: string;
  model?: string;
  calls?: number | string | null;
  ctx_per_call?: number | string | null;
  cread_pct?: number | string | null;
  resend_usd?: number | string | null;
  cost_class?: string;
  priced?: boolean;
  last?: number | string | null;
}

/** Collector-priced cost attribution; no client-side pricing happens here. */
export interface AttributionData {
  by_source?: Array<{
    source?: string;
    cost?: number | string | null;
    tokens?: number | string | null;
    sessions?: number | string | null;
  }>;
  by_root?: Array<{
    id?: string;
    title?: string;
    own?: number | string | null;
    descendants?: number | string | null;
    total?: number | string | null;
  }>;
  by_cron?: Array<{
    name?: string;
    runs?: number | string | null;
    total?: number | string | null;
    avg?: number | string | null;
    monthly_projection?: number | string | null;
  }>;
  by_tool?: Array<{
    tool?: string;
    tokens?: number | string | null;
    cost?: number | string | null;
  }>;
}

export interface AnalyticsProfile {
  [key: string]: unknown;
  resend?: ResendSessionRow[];
  attribution?: AttributionData;
  rows?: AnalyticsRow[];
  hours?: HourRow[];
  /** Optional higher-resolution payload used by the hour-range UI. */
  hour_rows?: HourRow[];
  min_date?: string;
  max_date?: string;
  active?: number;
  live?: unknown[];
  bandwidth_daily?: BandwidthDailyRow[];
  concurrency?: ConcurrencyRow[];
  latency?: LatencyData;
  repo_branch?: RepoBranchData;
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
  used?: number | string | null;
  inp?: number | string | null;
  outp?: number | string | null;
  cache?: number | string | null;
  energy?: number | string | null;
  market_value_usd?: number | string | null;
  billed_usd?: number | string | null;
  rate_origin?: string;
  override?: boolean;
  base_url?: string;
  served_by?: string[] | string;
  inferred_by?: string[] | string;
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
  /** Live Ollama host snapshot; only used for the queue-depth "now" line. */
  ollama?: OllamaData | null;
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
  /** Hide the Unattributed bucket from the project cost chart. */
  exclude?: boolean;
}

export interface DateBounds {
  from: string;
  to: string;
}
