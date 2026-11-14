// LLMTELEMET-282 (T-3): LiveFeed — port of src/llm_telemetry/hive.py `HiveFeed`.
//
// One collector loop feeds both transports: every tick appends sequenced
// frames to a bounded ring (`id:` = seq on the wire), so SSE streams and the
// `?since=` polling fallback share one source and resume losslessly. The
// snapshot at seq N is the state after frame N; `since(n)` replays exactly the
// frames > n, or answers `reset` with a fresh snapshot when n is outside the
// ring (too old, or from a previous server run).
import { commKey, diffTasks, userSig } from "./delta";
import type {
  CollectSnapshot,
  PollPayload,
  SeqFrame,
  SnapshotFrame,
  TaskRow,
} from "./types";

export interface FeedOptions {
  /** Bounded ring size (Python `HiveFeed(ring=512)`). */
  ring?: number;
  /** Background poll cadence in ms (Python `interval=3.0` s). */
  intervalMs?: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class LiveFeed {
  private readonly collectFn: () => CollectSnapshot | Promise<CollectSnapshot>;
  private readonly maxRing: number;
  private readonly intervalMs: number;
  private readonly ring: SeqFrame[] = [];
  private readonly seen = new Set<string | number | null>();
  private seq = 0;
  private snap: SnapshotFrame | null = null;
  private tasks: Record<string, TaskRow> = {};
  private userSigValue: string | null = null;
  private stopped = false;
  private loopRunning = false;
  private waiters: Array<() => void> = [];
  errors = 0;
  lastError: string | null = null;

  constructor(
    collectFn: () => CollectSnapshot | Promise<CollectSnapshot>,
    opts: FeedOptions = {},
  ) {
    this.collectFn = collectFn;
    this.maxRing = opts.ring ?? 512;
    this.intervalMs = opts.intervalMs ?? 3000;
  }

  /** Lazy start: the first request spawns the collector loop (Python `start()`). */
  start(): void {
    if (this.loopRunning || this.stopped) return;
    this.loopRunning = true;
    void this.run();
  }

  stop(): void {
    this.stopped = true;
    this.wakeAll();
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      await this.tick();
      await sleep(this.intervalMs);
    }
  }

  /** One collect + diff pass (port of `HiveFeed.tick`). Errors keep serving
   * the last good snapshot and are counted, exactly like Python. */
  async tick(): Promise<void> {
    const t0 = Date.now();
    let snap: CollectSnapshot;
    try {
      snap = await this.collectFn();
    } catch (e) {
      this.errors += 1;
      this.lastError = String(e);
      return;
    }
    const took = Math.round(Date.now() - t0) / 1000; // seconds, ms-grained (Python round(s, 3))
    const tasks = snap.tasks ?? {};
    const comms = snap.comms ?? [];
    const first = this.snap === null;
    const at = snap.at || Date.now() / 1000; // Python: snap.get("at") or time.time()
    const frames: Array<Record<string, unknown>> = [];
    if (!first) {
      for (const e of diffTasks(this.tasks, tasks)) {
        frames.push({ type: "event", at, ...e });
      }
    }
    // Dedup applies from the first tick on (the seen-set is updated even then),
    // but fresh comms only produce frames after the baseline snapshot.
    const fresh = comms.filter((c) => !this.seen.has(commKey(c)));
    for (const c of comms) this.seen.add(commKey(c));
    if (!first) {
      for (const c of fresh.slice(-25)) frames.push({ type: "comm", ...c });
      if (userSig(snap.user) !== this.userSigValue) {
        frames.push({ type: "user", at, user: snap.user ?? null });
      }
    }
    this.userSigValue = userSig(snap.user);
    for (const fr of frames) {
      this.seq += 1;
      this.ring.push({ seq: this.seq, ...fr } as SeqFrame);
      if (this.ring.length > this.maxRing) this.ring.shift();
    }
    this.tasks = tasks;
    this.snap = { ...snap, type: "snapshot", seq: this.seq, collect_s: took };
    this.wakeAll();
  }

  waitReady(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    return this.waitUntil(() => this.snap !== null, deadline);
  }

  snapshot(): SnapshotFrame | null {
    return this.snap;
  }

  /** -> delta frame, or a reset carrying a fresh snapshot. Null before the
   * first collect (port of `HiveFeed.since`). */
  since(n: number): PollPayload | null {
    if (this.snap === null) return null;
    const cur = this.seq;
    const oldest = this.ring.length ? this.ring[0].seq : cur + 1;
    if (n > cur || n < oldest - 1) {
      return { type: "reset", snapshot: this.snap };
    }
    return {
      type: "delta",
      from: n,
      to: cur,
      events: this.ring.filter((f) => f.seq > n),
    };
  }

  /** Wait up to `timeoutMs` for frames newer than seq n (port of
   * `HiveFeed.wait_after`): -> {frames, snap}; `snap` is set when n fell out
   * of the ring. */
  async waitAfter(
    n: number,
    timeoutMs: number,
  ): Promise<{ frames: SeqFrame[]; snap: SnapshotFrame | null }> {
    const deadline = Date.now() + timeoutMs;
    await this.waitUntil(() => this.seq > n || this.stopped, deadline);
    if (this.seq <= n) return { frames: [], snap: null };
    const oldest = this.ring.length ? this.ring[0].seq : this.seq + 1;
    if (n < oldest - 1) return { frames: [], snap: this.snap };
    return { frames: this.ring.filter((f) => f.seq > n), snap: null };
  }

  private async waitUntil(pred: () => boolean, deadline: number): Promise<boolean> {
    while (!pred()) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return pred();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return true;
  }

  private wakeAll(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }
}
