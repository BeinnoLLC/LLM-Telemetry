// LLMTELEMET-291 (T-20 RUN F1): ports of tests/check_completion_sound.js with
// an injected FakeAudioContext, clock and storage. Expected frequencies are
// the old suite's: success 880 + 1174.66, fail 220. No UI or real audio.
import { describe, expect, it } from "vitest";

import {
  createSoundEngine,
  SOUND_STORAGE_KEY,
  type AudioContextLike,
  type GainLike,
  type KeyValueStorage,
  type OscillatorLike,
  type SoundClock,
  type UnlockTarget,
} from "../../lib/home/sound";
import type { AlertRow, LiveProfile } from "../../lib/home/types";

/** One oscillator start is pushed per note, exactly like the old jsdom fake. */
class FakeAudioContext implements AudioContextLike {
  currentTime = 0;
  destination = {};
  constructor(
    private readonly notes: number[],
    public state = "running",
  ) {}

  resume(): void { this.state = "running"; }

  createOscillator(): OscillatorLike {
    const notes = this.notes;
    const osc: OscillatorLike = {
      type: "sine",
      frequency: {
        value: 0,
        setValueAtTime() {},
        linearRampToValueAtTime() {},
        exponentialRampToValueAtTime() {},
      },
      connect() {},
      start() { notes.push(osc.frequency.value); },
      stop() {},
    };
    return osc;
  }

  createGain(): GainLike {
    return {
      gain: {
        value: 0,
        setValueAtTime() {},
        linearRampToValueAtTime() {},
        exponentialRampToValueAtTime() {},
      },
      connect() {},
    };
  }
}

interface FakeClock extends SoundClock {
  advance(ms: number): void;
}

function fakeClock(): FakeClock {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout(handle) { timers.delete(handle as number); },
    advance(ms) {
      const goal = now + ms;
      for (let guard = 0; guard < 1000; guard += 1) {
        const due = [...timers]
          .filter(([, timer]) => timer.at <= goal)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].fn();
      }
      now = goal;
    },
  };
}

class FakeStorage implements KeyValueStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

class FakeTarget implements UnlockTarget {
  private readonly listeners = new Map<string, Set<() => void>>();
  readonly removed: string[] = [];
  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set<() => void>();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
    this.removed.push(type);
  }
  fire(type: string): void { this.listeners.get(type)?.forEach((fn) => fn()); }
  count(type: string): number { return this.listeners.get(type)?.size ?? 0; }
}

function harness(saved: string | null = null, state = "running", storage: KeyValueStorage = new FakeStorage()) {
  const notes: number[] = [];
  const clock = fakeClock();
  if (saved !== null) storage.setItem(SOUND_STORAGE_KEY, saved);
  let context: FakeAudioContext | null = null;
  const engine = createSoundEngine({
    createAudioContext: () => {
      context = new FakeAudioContext(notes, state);
      return context;
    },
    clock,
    storage,
  });
  return { engine, notes, clock, storage, context: () => context };
}

const ending = (id: string, end_reason = "agent_close"): Record<string, unknown> => ({
  id, title: id, ended_at: 100, end_reason,
});
const profiles = (
  recent_ended: Record<string, unknown>[] = [],
  recent_delegations: Record<string, unknown>[] = [],
): Record<string, LiveProfile> => ({ work: { recent_ended, recent_delegations } });
const SUCCESS_NOTES = [880, 1174.66];

describe("completion sound engine (RUN F1)", () => {
  it("plays the exact spec frequencies for success and fail", () => {
    const { engine, notes } = harness();
    engine.playTone("success");
    expect(notes).toEqual(SUCCESS_NOTES);
    notes.length = 0;
    engine.playTone("fail");
    expect(notes).toEqual([220]);
  });

  it("treats the first snapshot as a silent baseline and never re-sounds seen ids", () => {
    const { engine, notes, clock } = harness();
    const old = [ending("old-1"), ending("old-2")];
    expect(engine.checkCompletions(profiles(old))).toBe(false);
    clock.advance(2500);
    expect(notes).toEqual([]);
    expect(engine.checkCompletions(profiles(old))).toBe(false);
    clock.advance(2500);
    expect(notes).toEqual([]);
    expect(engine.checkCompletions(profiles([...old, ending("new-1")]))).toBe(true);
    clock.advance(1); // the timer is injected, so a zero-delay play needs a tick
    expect(notes).toEqual(SUCCESS_NOTES);
  });

  it("debounces for exactly 2 s with the injected clock", () => {
    const h = harness();
    h.engine.checkCompletions(profiles());
    h.engine.checkCompletions(profiles([ending("one")]));
    h.clock.advance(1);
    expect(h.notes).toEqual(SUCCESS_NOTES);
    h.notes.length = 0;
    h.engine.checkCompletions(profiles([ending("one"), ending("two")]));
    h.clock.advance(1998);
    expect(h.notes).toEqual([]);
    h.clock.advance(1);
    expect(h.notes).toEqual(SUCCESS_NOTES);
  });

  it("plays one chime for four completions in a single window", () => {
    const h = harness();
    h.engine.checkCompletions(profiles());
    h.notes.length = 0;
    h.engine.checkCompletions(profiles([1, 2, 3, 4].map((n) => ending(`burst-${n}`))));
    h.clock.advance(2500);
    expect(h.notes).toEqual(SUCCESS_NOTES);
  });

  it("escalates orphan_reap and error end reasons to the fail tone", () => {
    for (const reason of ["orphan_reap", "error"]) {
      const h = harness();
      h.engine.checkCompletions(profiles());
      h.engine.checkCompletions(profiles([ending(`bad-${reason}`, reason)]));
      h.clock.advance(2500);
      expect(h.notes).toEqual([220]);
    }
  });

  it("escalates a failed delegation and overrides a pending success", () => {
    const h = harness();
    h.engine.checkCompletions(profiles());
    h.clock.advance(2000);
    h.engine.checkCompletions(profiles(
      [ending("ok-late")],
      [{ id: "deleg-fail", state: "error", completed_at: 100 }],
    ));
    h.clock.advance(2500);
    expect(h.notes).toEqual([220]);
  });

  it("does not sound or remember an unfinished delegation", () => {
    const h = harness();
    expect(h.engine.checkCompletions(profiles([], [{ id: "d1", state: "running" }]))).toBe(false);
    expect(h.engine.checkCompletions(profiles([], [
      { id: "d1", state: "running" },
      { id: "d2", state: "done", completed_at: 100 },
    ]))).toBe(true);
    h.clock.advance(1);
    expect(h.notes).toEqual(SUCCESS_NOTES);
  });

  it("unlocks on a gesture and removes pointerdown/keydown listeners when running", () => {
    const notes: number[] = [];
    const target = new FakeTarget();
    const contexts: FakeAudioContext[] = [];
    const engine = createSoundEngine({
      createAudioContext: () => {
        const context = new FakeAudioContext(notes, "suspended");
        contexts.push(context);
        return context;
      },
      clock: fakeClock(),
      storage: new FakeStorage(),
    });
    engine.armUnlock(target);
    expect(target.count("pointerdown")).toBe(1);
    expect(target.count("keydown")).toBe(1);
    target.fire("keydown");
    expect(contexts[0].state).toBe("running");
    expect(target.count("pointerdown")).toBe(0);
    expect(target.count("keydown")).toBe(0);
    expect(target.removed).toEqual(["pointerdown", "keydown"]);
  });

  it("is truly silent while muted, including already scheduled tones", () => {
    const h = harness();
    h.engine.checkCompletions(profiles());
    h.engine.checkCompletions(profiles([ending("scheduled")]));
    h.engine.setEnabled(false);
    h.clock.advance(2500);
    expect(h.notes).toEqual([]);
    h.engine.playTone("fail");
    h.engine.checkCompletions(profiles([ending("scheduled"), ending("muted")]));
    h.clock.advance(2500);
    expect(h.notes).toEqual([]);
  });

  it("defaults ON and persists lt-sound as 0 and 1", () => {
    const storage = new FakeStorage();
    const first = harness(null, "running", storage);
    expect(first.engine.isEnabled()).toBe(true);
    first.engine.setEnabled(false);
    expect(storage.getItem(SOUND_STORAGE_KEY)).toBe("0");
    const second = harness(null, "running", storage);
    expect(second.engine.isEnabled()).toBe(false);
    second.engine.setEnabled(true);
    expect(storage.getItem(SOUND_STORAGE_KEY)).toBe("1");
    expect(second.notes).toEqual(SUCCESS_NOTES); // unmute confirmation chime
    const third = harness(null, "running", storage);
    expect(third.engine.isEnabled()).toBe(true);
  });

  it("sounds a new critical alert once across repeated polls", () => {
    const h = harness();
    const old: AlertRow[] = [{ id: "a-old", rule: "r", severity: "critical", message: "old", why: "w" }];
    h.engine.checkCriticalAlerts(old);
    h.clock.advance(2500);
    expect(h.notes).toEqual([]);
    expect(h.engine.checkCriticalAlerts([{ id: "warn", severity: "warning" }])).toBe(false);
    const fresh = [...old, { id: "a-new", rule: "r", severity: "critical", message: "new", why: "w" }];
    expect(h.engine.checkCriticalAlerts(fresh)).toBe(true);
    h.clock.advance(2500);
    expect(h.notes).toEqual([220]);
    h.notes.length = 0;
    for (let i = 0; i < 3; i += 1) {
      expect(h.engine.checkCriticalAlerts(fresh)).toBe(false);
      h.clock.advance(2500);
    }
    expect(h.notes).toEqual([]);
  });
});
