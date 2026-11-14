// LLMTELEMET-282 (T-3): wire types for the live feed.
//
// Payload shapes mirror the Python reference exactly (src/llm_telemetry/hive.py
// `HiveFeed` + serve.py `/api/hive*`), so a polling client and an SSE client
// see the same frames the Python stack emits today. TypeScript strict, no any.

/** A task row in the feed's snapshot map (port of hive.py `tasks` values). */
export interface TaskRow {
  status: string;
  worker?: boolean;
  [key: string]: unknown;
}

/** A comm/bot-chat row (port of hive.py `comms` values; `id` drives dedup). */
export interface CommFrame {
  id?: string | number | null;
  [key: string]: unknown;
}

/** What a collector hands the feed each tick (port of hive.py `collect()`). */
export interface CollectSnapshot {
  /** Collection clock; falls back to "now" when missing or falsy (Python `or`). */
  at?: number;
  tasks?: Record<string, TaskRow> | null;
  comms?: CommFrame[] | null;
  user?: unknown;
  [key: string]: unknown;
}

/** One sequenced delta frame in the ring (`{"seq": n, **frame}`, Python order). */
export interface SeqFrame {
  seq: number;
  type: "event" | "comm" | "user";
  [key: string]: unknown;
}

/** Snapshot reply: `{**snap, "type": "snapshot", "seq": n, "collect_s": s}`. */
export interface SnapshotFrame {
  type: "snapshot";
  seq: number;
  collect_s: number;
  [key: string]: unknown;
}

/** `?since=` polling reply when the client is inside the ring. */
export interface DeltaPayload {
  type: "delta";
  from: number;
  to: number;
  events: SeqFrame[];
}

/** `?since=` polling reply when the requested seq fell out of the ring. */
export interface ResetPayload {
  type: "reset";
  snapshot: SnapshotFrame;
}

/** The polling fallback payload (identical shape to Python `HiveFeed.since()`). */
export type PollPayload = DeltaPayload | ResetPayload;
