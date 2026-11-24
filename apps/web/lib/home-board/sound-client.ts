// LLMTELEMET-291 (T-20 RUN F2): browser adapter for the pure RUN F1 engine.
// All tone shaping, debouncing and diffing stays in lib/home-board/sound.ts; this
// file only supplies Web Audio, localStorage and one shared instance.
import {
  createSoundEngine,
  type AudioContextLike,
  type KeyValueStorage,
  type SoundEngine,
} from "./sound";
import type { AlertRow } from "./types";

type AudioCtor = new () => AudioContextLike;

const browserStorage: KeyValueStorage = {
  getItem(key) {
    try {
      return typeof window === "undefined" ? null : window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      if (typeof window !== "undefined") window.localStorage.setItem(key, value);
    } catch {
      // Private browsing can deny storage; the engine keeps in-memory state.
    }
  },
};

function browserAudioContext(): AudioContextLike {
  const scope = typeof window === "undefined" ? null : window;
  const ctor = scope
    ? ((scope as unknown as { AudioContext?: AudioCtor }).AudioContext ??
      (scope as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext)
    : null;
  if (!ctor) throw new Error("Web Audio unavailable");
  return new ctor();
}

let shared: SoundEngine | null = null;

/** One engine per page: baseline/seen ids must span every Home hook instance. */
export function homeSound(): SoundEngine {
  if (!shared) {
    shared = createSoundEngine({
      createAudioContext: browserAudioContext,
      storage: browserStorage,
    });
  }
  return shared;
}

interface AlertSource {
  live?: { profiles?: Record<string, Record<string, unknown>> } | null;
  analytics?: { profiles?: Record<string, Record<string, unknown>> } | null;
}

function alertRows(value: unknown): AlertRow[] {
  return Array.isArray(value)
    ? value.filter((row): row is AlertRow => !!row && typeof row === "object")
    : [];
}

/** live.js:1049-1052 sound-only path reads alerts from the merged profiles. */
export function soundAlerts(snapshot: AlertSource): AlertRow[] {
  const live = Object.values(snapshot.live?.profiles ?? {}).flatMap((profile) =>
    alertRows(profile?.alerts),
  );
  if (live.length) return live;
  // A null live section still has the boot-time analytics alerts.
  return Object.entries(snapshot.analytics?.profiles ?? {})
    .filter(([name]) => name !== "All")
    .flatMap(([, profile]) => alertRows(profile?.alerts));
}
