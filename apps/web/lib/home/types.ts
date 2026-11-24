// LLMTELEMET-291 (T-20 RUN B1): the four collector payloads consumed by Home.
// Field lists come from the approved plan's RUN B "Exact fields used"; extra
// collector fields stay available through the index signatures. Real data only.
export type JsonRecord = Record<string, unknown>;
export type NumLike = number | string | null | undefined;

/** Fields every collector stamps (src/llm_telemetry/schema.py:13). */
export interface Artifact extends JsonRecord {
  generated?: string | number;
  schema_version?: number;
}

export interface AnalyticsRow extends JsonRecord {
  date?: string;
  model?: string;
  provider?: string;
  task?: string;
  calls?: NumLike;
  inp?: NumLike;
  outp?: NumLike;
  cread?: NumLike;
  market_value_usd?: NumLike;
  act?: NumLike;
  est?: NumLike;
  cost_class?: string;
  energy_usd?: NumLike;
  project?: string;
  up_bytes?: NumLike;
  down_bytes?: NumLike;
  lan_up_bytes?: NumLike;
  lan_down_bytes?: NumLike;
}

export interface HourRow extends JsonRecord {
  date?: string;
  hour?: NumLike;
  calls?: NumLike;
  inp?: NumLike;
  outp?: NumLike;
}

export interface AlertRow extends JsonRecord {
  rule?: string;
  severity?: string;
  value?: NumLike;
  threshold?: NumLike;
  message?: string;
  why?: string;
  id?: string;
}

export interface AnalyticsProfile extends JsonRecord {
  rows?: AnalyticsRow[];
  hour_rows?: HourRow[];
  sessions?: JsonRecord[];
  health?: Array<JsonRecord & { ok?: NumLike; fail?: NumLike }>;
  failures_recent?: JsonRecord[];
  alerts?: AlertRow[];
  recent_sessions?: JsonRecord[];
}

export interface AnalyticsData extends Artifact {
  build_interval_s?: NumLike;
  profiles?: Record<string, AnalyticsProfile>;
}

export interface LiveSession extends JsonRecord {
  id?: string | number;
  title?: string;
  init_model?: string;
  phase?: string;
  idle_s?: NumLike;
  parent?: string;
  model?: string;
  models?: JsonRecord[];
}

export interface LiveProfile extends JsonRecord {
  active?: NumLike;
  live?: LiveSession[];
  tools_recent?: JsonRecord[];
  logs?: JsonRecord[];
  agents?: JsonRecord[];
  recent_ended?: JsonRecord[];
  recent_delegations?: JsonRecord[];
}

export interface LiveData extends Artifact {
  errors?: JsonRecord[];
  profiles?: Record<string, LiveProfile>;
  pi_live?: JsonRecord[];
  agent_live?: JsonRecord[];
  ollama?: JsonRecord & { hosts?: JsonRecord[] };
}

export interface RouterData extends Artifact {
  profiles?: Record<
    string,
    JsonRecord & {
      tier_router?: JsonRecord & { enabled?: unknown; tiers?: unknown };
      decisions?: JsonRecord & { total?: NumLike };
    }
  >;
}

export interface QuotaData extends Artifact {
  profiles?: Record<
    string,
    JsonRecord & {
      providers?: Array<
        JsonRecord & { attention?: NumLike; unavailable_reason?: string }
      >;
    }
  >;
  summary?: JsonRecord & { available?: NumLike; providers?: NumLike };
  meta?: JsonRecord & {
    summary?: JsonRecord & { available?: NumLike; providers?: NumLike };
  };
  attention_percent?: NumLike;
}

/** Nullable sections: a missing artifact is `null`, never a zeroed payload. */
export interface HomeSnapshot {
  analytics: AnalyticsData | null;
  live: LiveData | null;
  router: RouterData | null;
  quota: QuotaData | null;
}
