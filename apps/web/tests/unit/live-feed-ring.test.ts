// @vitest-environment node
// LLMTELEMET-282 (T-3): ring buffer + ?since= resume semantics. Reference:
// tests/test_hive_api.py (since replays exactly the missed frames; outside the
// ring resets with a fresh snapshot; since=current answers an empty delta).
import { describe, expect, it } from "vitest";

import { LiveFeed, type CollectSnapshot, type TaskRow } from "../../lib/live-feed";

const task = (status: string): TaskRow => ({
  family: "root",
  brain: "b",
  board: "B",
  agent: "a",
  status,
  title: "t",
});

describe("LiveFeed ring and ?since= resume", () => {
  it("since(n) replays exactly the missed frames", async () => {
    let tasks: Record<string, TaskRow> = {};
    const feed = new LiveFeed((): CollectSnapshot => ({ at: 1700000000, tasks }));
    await feed.tick(); // seq 0: baseline
    tasks = { "root:1": task("running") };
    await feed.tick(); // seq 1: new
    tasks = { "root:1": task("done") };
    await feed.tick(); // seq 2: status

    const d = feed.since(0);
    if (!d || d.type !== "delta") throw new Error("expected delta");
    expect([d.from, d.to]).toEqual([0, 2]);
    expect(d.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(d.events.map((e) => e.kind)).toEqual(["new", "status"]);

    const d1 = feed.since(1);
    if (!d1 || d1.type !== "delta") throw new Error("expected delta");
    expect(d1.events.map((e) => e.seq)).toEqual([2]);
    expect(d1.events[0].from).toBe("running");

    const d2 = feed.since(2);
    if (!d2 || d2.type !== "delta") throw new Error("expected delta");
    expect(d2.events).toEqual([]);
  });

  it("since outside the ring resets, and a future seq resets too", async () => {
    let tasks: Record<string, TaskRow> = {};
    const feed = new LiveFeed(
      (): CollectSnapshot => ({ at: 1700000000, tasks }),
      { ring: 8 },
    );
    await feed.tick();
    for (let i = 0; i < 12; i++) {
      tasks = { [`root:${i}`]: task("running") };
      await feed.tick(); // ring holds 8; seq runs to 12
    }
    const d = feed.since(1);
    if (!d || d.type !== "reset") throw new Error("expected reset");
    expect(d.snapshot.seq).toBe(feed.snapshot()!.seq);

    expect(feed.since(99999)!.type).toBe("reset"); // from a previous server run
  });

  it("since() before the first collect answers null (503 upstream)", () => {
    const feed = new LiveFeed(() => ({ at: 1 }));
    expect(feed.since(0)).toBeNull();
  });

  it("waitAfter returns frames, and the snapshot when n fell out of the ring", async () => {
    let tasks: Record<string, TaskRow> = {};
    const feed = new LiveFeed(
      (): CollectSnapshot => ({ at: 1700000000, tasks }),
      { ring: 8 },
    );
    await feed.tick();
    for (let i = 0; i < 12; i++) {
      tasks = { [`root:${i}`]: task("running") };
      await feed.tick();
    }
    // seq 1..12 exist; ring holds 5..12
    const gap = await feed.waitAfter(1, 10);
    expect(gap.frames).toEqual([]);
    expect(gap.snap!.seq).toBe(12);

    tasks = { "root:x": task("running") };
    const pending = feed.waitAfter(12, 500);
    await feed.tick(); // seq 13 wakes the waiter
    const got = await pending;
    expect(got.snap).toBeNull();
    expect(got.frames.map((f) => f.seq)).toEqual([13]);
  });

  it("waitAfter times out empty when nothing changes", async () => {
    const feed = new LiveFeed((): CollectSnapshot => ({ at: 1700000000, tasks: {} }));
    await feed.tick();
    const got = await feed.waitAfter(0, 30);
    expect(got).toEqual({ frames: [], snap: null });
  });
});
