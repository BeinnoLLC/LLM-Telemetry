// T-23 RUN A: shared types for the Sessions page, weighting control and the
// project × model matrix. Only T-20 primitives are imported; no T-21/T-22.
import type { AnalyticsData, Artifact, JsonRecord, NumLike } from "../home-board/types";

export type WeightAxis = "cost" | "calls" | "tokens" | "sessions";

export const WEIGHT_AXES: readonly WeightAxis[] = [
  "cost",
  "calls",
  "tokens",
  "sessions",
];

export const WEIGHT_KEY = "hermes-dash-projweight";

/** Analytics rows plus the one field the matrix weights that Home ignores. */
export interface SessionRow extends JsonRecord {
  date?: string;
  model?: string;
  provider?: string;
  base_url?: string;
  project?: string;
  task?: string;
  session_id?: string | number | null;
  calls?: NumLike;
  inp?: NumLike;
  outp?: NumLike;
  cread?: NumLike;
  cwrite?: NumLike;
  act?: NumLike;
  est?: NumLike;
}

export interface SessionProfile extends JsonRecord {
  rows?: SessionRow[];
}

export interface SessionAnalyticsData extends Artifact {
  profiles?: Record<string, SessionProfile>;
}

export interface SessionLog extends JsonRecord {
  id?: string | number;
  role?: string;
  text?: string;
  ts?: NumLike;
}

export interface SessionLogsData extends Artifact {
  profiles?: Record<string, JsonRecord & { logs?: SessionLog[] }>;
}

export interface TranscriptData extends Artifact {
  sessions?: Record<string, JsonRecord>;
  profiles?: Record<string, JsonRecord>;
}

export interface WeightLabel {
  axis: string;
  unit: string;
  fmt: (value: number) => string;
}

export interface MatrixValue {
  model: string;
  value: number;
  /** False for an untouched bucket (em dash), true for a real zero. */
  touched: boolean;
}

export interface MatrixRow {
  project: string;
  cells: MatrixValue[];
  rest: number;
  total: number;
}

export interface MatrixColumn {
  model: string;
  label: string;
  total: number;
  provider: string;
}

export interface MatrixData {
  empty: boolean;
  axis: WeightAxis;
  columns: MatrixColumn[];
  hiddenModels: string[];
  rest: { count: number; total: number; title: string } | null;
  rows: MatrixRow[];
  grandTotal: number;
}

export interface AnalyticsProfileResult {
  rows: SessionRow[];
  profiles: string[];
  generated: string | number | null;
  version: number;
  profileName: string;
  payload: AnalyticsData;
}

export interface DetailBucket {
  label: string;
  key: string;
  provider?: string;
  cost: number;
  pct: string;
}

export interface DetailSession {
  id: string;
  date: string;
}

export interface ProjectDetail {
  project: string;
  sessions: string;
  calls: number;
  inp: number;
  outp: number;
  cread: number;
  cwrite: number;
  act: number;
  est: number;
  firstSeen: string;
  lastSeen: string;
  models: DetailBucket[];
  providers: DetailBucket[];
  tasks: DetailBucket[];
  recent: DetailSession[];
  hasSessionIds: boolean;
}
