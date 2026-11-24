// LLMTELEMET-291 (T-20 RUN E1): pure task-queue shaping for the three jars.
// Ports src/llm_telemetry/web/js/flow.js:14-64 (feeds), 91-199 (keys, seed,
// packing, fitting) and 356-449 (counters, qsub). No DOM, no synthetic balls.
import { short } from "./format";
import { buildLiveRows, inFlightRows } from "./live-rows";
import type { HomeSnapshot, JsonRecord } from "./types";

export type QueueKind = "q" | "r" | "d";

export interface QueueBall {
  key: string;
  kind: QueueKind;
  label: string;
  model: string | null;
  host?: string;
  pos?: number;
  depth?: number;
  profile?: string | null;
  state?: string;
  idleS?: number | null;
  lastTs?: number | null;
}

export interface QueueCounts {
  queued: number;
  running: number;
  done: number;
}

export interface TaskQueue {
  hosts: number;
  queued: QueueBall[];
  running: QueueBall[];
  done: QueueBall[];
  counts: QueueCounts;
  qsub: string;
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const list = (value: unknown): JsonRecord[] =>
  Array.isArray(value) ? value.filter((v): v is JsonRecord => !!v && typeof v === "object") : [];
const labelOf = (title: unknown, model: unknown): string =>
  (text(title) && text(title) !== "(untitled)" ? text(title) : short(model)) || "session";

/** flow.js:301-318: the selected profile's recent_sessions, newest first. */
function recentSessions(snapshot: HomeSnapshot, profile?: string): JsonRecord[] {
  const profiles = snapshot.analytics?.profiles ?? {};
  const selected = profile && profile !== "All"
    ? (profiles[profile] ? [profiles[profile]] : [])
    : (profiles.All ? [profiles.All] : Object.values(profiles));
  return selected
    .flatMap((p) => list(p.recent_sessions))
    .sort((a, b) => num(b.last_ts) - num(a.last_ts));
}

/** flow.js:14-64: three real-data feeds, keyed so polls can reconcile balls. */
export function buildTaskQueue(snapshot: HomeSnapshot, profile?: string): TaskQueue {
  const hosts = list(snapshot.live?.ollama?.hosts);
  const queued: QueueBall[] = hosts.flatMap((host) => {
    const label = text(host.label) ?? "";
    const depth = Math.max(0, num(host.queue));
    return Array.from({ length: depth }, (_, i) => ({
      key: `q:${label}:${i}`, kind: "q" as const, label, model: null,
      host: label, pos: i + 1, depth,
    }));
  });

  const running: QueueBall[] = inFlightRows(buildLiveRows(snapshot, profile))
    .sort((a, b) => (a.idleS ?? 0) - (b.idleS ?? 0))
    .map((row) => ({
      key: row.kind === "hermes" ? `s:${row.id}` : `${row.kind}:${row.sessionId}`,
      kind: "r", label: row.title, model: row.model, profile: row.profile,
      state: row.state, idleS: row.idleS,
    }));

  const done: QueueBall[] = recentSessions(snapshot, profile).map((s) => {
    const id = text(s.id) ?? "";
    return {
      key: `s:${id}`, kind: "d", label: labelOf(s.title, s.last_model ?? s.model),
      model: short(s.last_model ?? s.model) || null, profile: profile ?? null,
      lastTs: num(s.last_ts),
    };
  });

  const busy = hosts.filter((host) => num(host.queue) > 0).map((host) => text(host.label) ?? "");
  const qsub = busy.length
    ? `backed up on ${busy.join(", ")}`
    : hosts.length ? `fleet clear · ${hosts.length} host${hosts.length === 1 ? "" : "s"}` : "";

  return {
    hosts: hosts.length, queued, running, done,
    counts: { queued: queued.length, running: running.length, done: done.length },
    qsub,
  };
}

/** flow.js:95-101: FNV-1a-derived 0..1, so a poll never reshuffles a pile. */
export function qtSeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h ^= h >>> 13; h = Math.imul(h, 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export const QT_MAX = 28;
export const QT_MIN = 18;
export const QT_FILL = 0.5;

export interface PackedBall {
  x: number;
  y: number;
  rz: number;
}

/** flow.js:130-155: six seeded columns, stacked bottom-up; append-only. */
function qtPack(keys: string[], w: number, h: number, size: number, chip: boolean): {
  balls: PackedBall[]; top: number; ok: boolean;
} {
  const r = size / 2, d = size * 0.9, pad = 7, chipW = 56, chipH = 50;
  const balls: PackedBall[] = [];
  let top = h, ok = true;
  const fits = (x: number, y: number): boolean =>
    y - r * 1.14 >= 2 && !(chip && x + r > w - chipW && y - r < chipH);
  for (const key of keys) {
    let best: { x: number; y: number; rz: number; good: boolean } | null = null;
    for (let t = 0; t < 6; t++) {
      const x = r + pad + qtSeed(`${key}:${t}`) * Math.max(0, w - size - 2 * pad);
      let y = h - r - pad;
      for (const ball of balls) {
        const dx = Math.abs(ball.x - x);
        if (dx < d) y = Math.min(y, ball.y - Math.sqrt(d * d - dx * dx));
      }
      const good = fits(x, y);
      if (!best || (good && !best.good) || (good === best.good && y > best.y)) {
        best = { x, y, rz: (qtSeed(`${key}:r`) - 0.5) * 44, good };
      }
    }
    if (!best || !best.good) ok = false;
    const placed = best!;
    balls.push({ x: placed.x, y: placed.y, rz: placed.rz });
    top = Math.min(top, placed.y - r);
  }
  return { balls, top, ok };
}

export interface FitResult {
  keys: string[];
  balls: PackedBall[];
  overflow: number;
  more: string;
}

/** flow.js:158-170: fit the newest balls at QT_MIN; the rest become "+N". */
export function qtFit(keys: string[], w: number, h: number): FitResult {
  const fits = (n: number, more: boolean): boolean =>
    n === 0 || qtPack(keys.slice(keys.length - n), w, h, QT_MIN, more).ok;
  let count = keys.length;
  while (count > 0 && !fits(count, count < keys.length)) count--;
  if (count < keys.length) {
    // The +N chip reserves room, so re-check with the chip present.
    while (count > 0 && !fits(count, true)) count--;
  }
  const shown = keys.slice(keys.length - count);
  const pack = qtPack(shown, w, h, QT_MIN, count < keys.length);
  const overflow = keys.length - count;
  return { keys: shown, balls: pack.balls, overflow, more: overflow ? `+${overflow}` : "" };
}
