// LLMTELEMET-291 (T-20 RUN F1): pure completion / failure / critical-alert
// sound engine. No React, no DOM globals and no audio files: the Python
// dashboard's Web Audio behaviour is ported verbatim and made injectable.
//
// Ports from src/llm_telemetry/web/js/live.js:
//   868-905   Web Audio tones (success 880 then 1174.66 Hz, fail 220 Hz)
//   907-923   2 s debounce and fail escalation
//   925-953   recent_ended / recent_delegations diff, silent first snapshot
//   955-978   first pointerdown/keydown unlock, listeners removed on running
//   980-997   critical alert id sounds once, never every poll
//   999-1025  localStorage 'lt-sound' ('0'/'1'), ON unless explicitly muted
// Old oracle: tests/check_completion_sound.js (expected frequencies unchanged).
import type { AlertRow, LiveProfile } from "./types";

export const SOUND_STORAGE_KEY = "lt-sound"; // live.js:999
export const SUCCESS_HZ: readonly number[] = [880, 1174.66]; // live.js:878
export const FAIL_HZ = 220; // live.js:878
export const SOUND_DEBOUNCE_MS = 2000; // live.js:920

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
  exponentialRampToValueAtTime(value: number, endTime: number): void;
}
export interface OscillatorLike {
  type: string;
  frequency: AudioParamLike;
  connect(node: unknown): void;
  start(when: number): void;
  stop(when: number): void;
}
export interface GainLike {
  gain: AudioParamLike;
  connect(node: unknown): void;
}
export interface AudioContextLike {
  state: string;
  currentTime: number;
  destination: unknown;
  resume(): void | Promise<void>;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
}
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface SoundClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
export interface UnlockTarget {
  addEventListener(type: string, listener: () => void, capture?: boolean): void;
  removeEventListener(type: string, listener: () => void, capture?: boolean): void;
}
export interface SoundDeps {
  createAudioContext: () => AudioContextLike;
  clock?: SoundClock;
  storage?: KeyValueStorage;
}
export type ToneKind = "success" | "fail";

export interface SoundEngine {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  playTone(kind: ToneKind): void;
  checkCompletions(profiles?: Record<string, LiveProfile> | null): boolean;
  checkCriticalAlerts(alerts?: AlertRow[] | null): boolean;
  unlock(): boolean;
  armUnlock(target?: UnlockTarget | null): () => void;
}

type Row = Record<string, unknown>;

const systemClock: SoundClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
  };
}

const rows = (value: unknown): Row[] =>
  Array.isArray(value)
    ? value.filter((row): row is Row => !!row && typeof row === "object")
    : [];

/** Stable identity across polls; id-less rows keep their collector position. */
function rowKey(row: Row, prefix: string, index: number): string {
  const id = row.id;
  if (id != null && id !== "") return `${prefix}:${String(id)}`;
  const when = row.completed_at ?? row.ended_at ?? "";
  const why = row.state ?? row.end_reason ?? "";
  return `${prefix}:anon:${String(when)}:${String(why)}:${index}`;
}

/**
 * Build an isolated engine. `createAudioContext`, `clock` and `storage` are all
 * supplied by the caller so unit tests never touch real audio/time/storage.
 */
export function createSoundEngine(deps: SoundDeps): SoundEngine {
  const clock = deps.clock ?? systemClock;
  const storage = deps.storage ?? memoryStorage();
  let ctx: AudioContextLike | null = null;
  // live.js:869: only an explicit saved '0' mutes; a missing key is ON.
  let enabled = (() => {
    try { return storage.getItem(SOUND_STORAGE_KEY) !== "0"; }
    catch { return true; }
  })();

  let baseline = true; // live.js:871: first diff is silent
  const seenEnded = new Set<string>(); // live.js:872
  const seenDeleg = new Set<string>(); // live.js:873
  let alertBaseline = true; // live.js:982-987: critical alerts have their own baseline
  const seenAlerts = new Set<string>();
  let pendingKind: ToneKind | null = null; // live.js:909
  let timerPending = false; // live.js:910
  let timer: unknown = null;
  let debounceUntil = 0; // live.js:874

  function ensureContext(): AudioContextLike | null {
    if (ctx) return ctx;
    try { ctx = deps.createAudioContext(); }
    catch { return null; }
    return ctx;
  }

  function resumeContext(context: AudioContextLike): Promise<void> | null {
    if (context.state === "running") return null;
    try {
      const resumed = context.resume();
      if (resumed && typeof resumed.then === "function") return resumed.catch(() => {});
    } catch { /* an unavailable device must not break polling */ }
    return null;
  }

  // live.js:868-905: two quiet sine notes for success, one low note for fail.
  // No audio files (ADR 0001); all timing is relative to ctx.currentTime.
  function playTone(kind: ToneKind): void {
    if (!enabled) return;
    const context = ensureContext();
    if (!context) return;
    if (context.state !== "running") void resumeContext(context);
    const notes = kind === "success" ? SUCCESS_HZ : [FAIL_HZ];
    const now = context.currentTime;
    notes.forEach((freq, i) => {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = now + i * 0.09;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.06, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start(t0);
      osc.stop(t0 + 0.16);
    });
  }

  function clearPending(): void {
    pendingKind = null;
    timerPending = false;
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  }

  // live.js:907-923: one queued play per window; failures override successes.
  function scheduleTone(kind: ToneKind): void {
    if (!enabled) return;
    if (kind === "fail") pendingKind = "fail";
    else if (!pendingKind) pendingKind = "success";
    if (timerPending) return;
    timerPending = true;
    const wait = Math.max(0, debounceUntil - clock.now());
    timer = clock.setTimeout(() => {
      timer = null;
      timerPending = false;
      const next = pendingKind;
      pendingKind = null;
      if (next && enabled) playTone(next);
      debounceUntil = clock.now() + SOUND_DEBOUNCE_MS;
    }, wait);
  }

  // live.js:925-953: diff every fetched profile, not only the visible one.
  function checkCompletions(profiles?: Record<string, LiveProfile> | null): boolean {
    let any = false;
    Object.values(profiles ?? {}).forEach((profile) => {
      rows(profile?.recent_ended).forEach((session, index) => {
        const key = rowKey(session, "ended", index);
        if (seenEnded.has(key)) return;
        seenEnded.add(key);
        if (baseline) return;
        any = true;
        const bad = /orphan_reap|error/i.test(String(session.end_reason ?? ""));
        scheduleTone(bad ? "fail" : "success");
      });
      rows(profile?.recent_delegations).forEach((delegation, index) => {
        const state = String(delegation.state ?? "");
        // Unfinished work is not a completion; do not remember it either.
        if (/^(running|pending|queued)$/i.test(state)) return;
        const key = rowKey(delegation, "deleg", index);
        if (seenDeleg.has(key)) return;
        seenDeleg.add(key);
        if (baseline) return;
        any = true;
        scheduleTone(/error|fail|interrupt|cancel|timeout/i.test(state) ? "fail" : "success");
      });
    });
    baseline = false;
    return any;
  }

  // live.js:980-997: a critical alert id sounds once, not on every 5 s poll.
  function checkCriticalAlerts(alerts?: AlertRow[] | null): boolean {
    let fresh = false;
    (alerts ?? []).forEach((alert, index) => {
      if (!alert || alert.severity !== "critical") return;
      const id = alert.id;
      const key = id != null && id !== ""
        ? `alert:${String(id)}`
        : `alert:anon:${String(alert.rule ?? "")}:${String(alert.message ?? "")}:${String(alert.why ?? "")}:${index}`;
      if (seenAlerts.has(key)) return;
      seenAlerts.add(key);
      if (!alertBaseline) fresh = true;
    });
    alertBaseline = false;
    if (fresh) scheduleTone("fail");
    return fresh;
  }

  function unlock(): boolean {
    const context = ensureContext();
    if (!context) return false;
    void resumeContext(context);
    return context.state === "running";
  }

  // live.js:955-978: browsers block audio until a real gesture; drop the
  // listeners for good once the context reports 'running'.
  function armUnlock(target?: UnlockTarget | null): () => void {
    if (!target) return () => {};
    const events = ["pointerdown", "keydown"];
    let detached = false;
    const detach = (): void => {
      if (detached) return;
      detached = true;
      events.forEach((event) => target.removeEventListener(event, onGesture, true));
    };
    function onGesture(): void {
      if (!enabled) return;
      const context = ensureContext();
      if (!context) return;
      const resumed = resumeContext(context);
      if (resumed) void resumed.then(() => { if (context.state === "running") detach(); });
      else if (context.state === "running") detach();
    }
    events.forEach((event) => target.addEventListener(event, onGesture, true));
    return detach;
  }

  function setEnabled(next: boolean): void {
    const was = enabled;
    enabled = next;
    try { storage.setItem(SOUND_STORAGE_KEY, next ? "1" : "0"); }
    catch { /* storage can be blocked; in-memory state still applies */ }
    if (!next) clearPending();
    else if (!was) {
      // live.js:1014-1019: unmuting is a gesture and confirms with one chime.
      unlock();
      playTone("success");
    }
  }

  return {
    isEnabled: () => enabled,
    setEnabled,
    playTone,
    checkCompletions,
    checkCriticalAlerts,
    unlock,
    armUnlock,
  };
}
