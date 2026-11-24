// LLMTELEMET-291 (T-20 RUN B2): pure live-payload merge for the Home hook.
// Port of src/llm_telemetry/web/js/live.js:1032-1090 (`pollLive` merge):
// per-profile live/active/tools_recent/logs/agents, then global errors,
// ollama, pi_live and agent_live. No DOM, no fetch, no React state here.
import { num } from "../../lib/home/format";
import type {
  HomeSnapshot,
  JsonRecord,
  LiveData,
  LiveProfile,
  LiveSession,
} from "../../lib/home/types";

const COUNTERS = ["calls", "in_tok", "out_tok"] as const;

export const STREAM_URL = "/api/events/stream";
export const LIVE_URL = "/api/data/live-data.json";
/** lib/live-feed/http.ts:84-86 answers a full cap with 503 + Retry-After: 5. */
export const CAP_RETRY_MS = 5000;

export interface CounterChange {
  calls: number;
  tokens: number;
}

export interface LiveHomeState extends HomeSnapshot {
  /** Clamped per-poll increments (live.js:90); null until the first live poll. */
  counters: Record<string, CounterChange> | null;
}

/** live.js:89-90 — a backwards counter is a restart, not negative work. */
export function counterDelta(previous: unknown, current: unknown): number {
  return Math.max(0, num(current) - num(previous));
}

function oldModels(old: LiveSession[] | undefined): Map<string, JsonRecord> {
  const map = new Map<string, JsonRecord>();
  for (const session of old ?? []) {
    for (const model of session.models ?? []) map.set(String(model.model), model);
  }
  return map;
}

/** Keep clamped raw counters: a fresh value below the previous one means the
 * session restarted, so store 0 (the zero increment live.js:90 would report). */
function clampSessions(
  previous: LiveSession[] | undefined,
  fresh: LiveSession[] | undefined,
): LiveSession[] | undefined {
  if (!Array.isArray(fresh)) return fresh;
  const byId = new Map((previous ?? []).map((s) => [String(s.id), s]));
  return fresh.map((session) => {
    const old = byId.get(String(session.id));
    if (!old || !Array.isArray(session.models)) return session;
    const models = oldModels([old]);
    return {
      ...session,
      models: session.models.map((model) => {
        const before = models.get(String(model.model));
        if (!before) return model;
        const next = { ...model };
        for (const key of COUNTERS) {
          if (key in model && num(model[key]) < num(before[key])) next[key] = 0;
        }
        return next;
      }),
    };
  });
}

/** Per-session, per-model increments for the live KPIs (live.js:76-98). */
export function counterChanges(
  previous: LiveData | null,
  fresh: LiveData,
): Record<string, CounterChange> {
  const out: Record<string, CounterChange> = {};
  if (!previous) return out; // first sample is a baseline, like live.js:78
  for (const [name, profile] of Object.entries(fresh.profiles ?? {})) {
    const oldSessions = previous.profiles?.[name]?.live ?? [];
    const byId = new Map(oldSessions.map((s) => [String(s.id), s]));
    for (const session of profile.live ?? []) {
      const old = byId.get(String(session.id));
      if (!old) continue;
      const models = oldModels([old]);
      for (const model of session.models ?? []) {
        const before = models.get(String(model.model));
        if (!before) continue;
        out[`${name}:${String(session.id)}:${String(model.model)}`] = {
          calls: counterDelta(before.calls, model.calls),
          tokens:
            counterDelta(before.in_tok, model.in_tok) +
            counterDelta(before.out_tok, model.out_tok),
        };
      }
    }
  }
  return out;
}

/** live.js:1062-1086: merge the polled live slice into the boot snapshot. */
export function mergeLiveSnapshot(
  state: LiveHomeState,
  fresh: LiveData,
): LiveHomeState {
  const previous = state.live;
  const profiles: Record<string, LiveProfile> = { ...(previous?.profiles ?? {}) };
  for (const [name, incoming] of Object.entries(fresh.profiles ?? {})) {
    const current = profiles[name];
    if (!current) {
      // live.js:1064 skips unknown profiles; a null section adopts fresh data.
      if (previous) continue;
      profiles[name] = { ...incoming, live: clampSessions(undefined, incoming.live) };
      continue;
    }
    profiles[name] = {
      ...current,
      live: clampSessions(current.live, incoming.live), // live.js:1066
      active: incoming.active, // live.js:1067
      tools_recent: incoming.tools_recent, // live.js:1068
      logs: incoming.logs, // live.js:1069
      agents: incoming.agents, // live.js:1070
    };
  }
  return {
    ...state,
    live: {
      ...(previous ?? {}),
      ...fresh,
      profiles,
      errors: fresh.errors || [], // live.js:1074
      ollama: fresh.ollama || previous?.ollama, // live.js:1078
      pi_live: fresh.pi_live || [], // live.js:1082
      agent_live: fresh.agent_live || [], // live.js:1085
    },
    counters: { ...(state.counters ?? {}), ...counterChanges(previous, fresh) },
  };
}

/** The T-3 feed wraps the artifact with tasks/comms/seq (artifacts.ts:51-82);
 * read the spread payload fields, not just `tasks` (RUN B risk). */
export function liveFromFrame(frame: JsonRecord): LiveData | null {
  const strip = new Set(["type", "seq", "collect_s", "tasks", "comms", "user", "at"]);
  const artifact: JsonRecord = {};
  for (const [key, value] of Object.entries(frame)) {
    if (!strip.has(key)) artifact[key] = value;
  }
  return artifact.profiles && typeof artifact.profiles === "object"
    ? (artifact as LiveData)
    : null;
}
