// LLMTELEMET-282 (T-3): stream cap — port of serve.py `_hive_acquire` /
// `_hive_release`. Eight concurrent streams; the 9th gets 503 + Retry-After
// and the client auto-falls-back to the `?since=` polling endpoint.

export class StreamCap {
  private count = 0;
  constructor(private readonly max: number) {}

  /** False when the cap is reached (Python `_hive_acquire`). */
  acquire(): boolean {
    if (this.count >= this.max) return false;
    this.count += 1;
    return true;
  }

  /** Give the slot back (Python `_hive_release`). Callers release exactly once
   * per acquired slot. */
  release(): void {
    this.count -= 1;
  }

  get active(): number {
    return this.count;
  }

  get limit(): number {
    return this.max;
  }
}
