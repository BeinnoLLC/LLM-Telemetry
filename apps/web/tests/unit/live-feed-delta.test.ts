// @vitest-environment node
// LLMTELEMET-282 (T-3): delta logic, ported without diffdom. Reference:
// src/llm_telemetry/hive.py `diff_tasks` / `_user_sig` and their use in
// `HiveFeed.tick` (first tick emits nothing, comm dedup, user change frames).
import { describe, expect, it } from "vitest";

import {
  commKey,
  diffTasks,
  LiveFeed,
  userSig,
  type CollectSnapshot,
  type TaskRow,
} from "../../lib/live-feed";

const row = (status: string, extra: Partial<TaskRow> = {}): TaskRow => ({
  family: "root",
  brain: "b",
  board: "B",
  agent: "a",
  title: "t",
  ...extra,
  status,
});

describe("diffTasks (port of hive.py diff_tasks)", () => {
  it("emits kind:new for an appearing non-done task", () => {
    const ev = diffTasks({}, { "root:1": row("running") });
    expect(ev).toEqual([
      {
        kind: "new",
        id: "root:1",
        family: "root",
        brain: "b",
        board: "B",
        agent: "a",
        title: "t",
        status: "running",
      },
    ]);
  });

  it("does not announce a task that appears already done", () => {
    expect(diffTasks({}, { "root:1": row("done") })).toEqual([]);
  });

  it("emits kind:status with from: on a status change", () => {
    const ev = diffTasks({ "root:1": row("running") }, { "root:1": row("done") });
    expect(ev).toEqual([
      expect.objectContaining({ kind: "status", id: "root:1", from: "running", status: "done" }),
    ]);
  });

  it("reports a vanished worker as finished, and a vanished non-worker not at all", () => {
    const old = {
      "root:w1": row("running", { worker: true }),
      "root:t1": row("running"),
    };
    expect(diffTasks(old, {})).toEqual([
      expect.objectContaining({ kind: "status", id: "root:w1", from: "running", status: "finished" }),
    ]);
  });

  it("keeps the Python spread order: from:/status: win over the row's own keys", () => {
    const ev = diffTasks(
      { "root:w1": row("running", { worker: true, from: "stale", status: "running" }) },
      {},
    );
    expect(ev[0]).toEqual(
      expect.objectContaining({ from: "running", status: "finished" }),
    );
  });
});

describe("userSig (port of hive.py _user_sig)", () => {
  it("is stable across key order and ignores at:", () => {
    expect(userSig({ state: "idle", at: 1 })).toBe(userSig({ at: 2, state: "idle" }));
  });

  it("signs null and {} identically, like Python's (usr or {})", () => {
    expect(userSig(null)).toBe(userSig({}));
    expect(userSig(undefined)).toBe("{}");
  });

  it("changes when a value changes", () => {
    expect(userSig({ state: "idle" })).not.toBe(userSig({ state: "busy" }));
  });
});

describe("commKey (dedup identity, c.get('id'))", () => {
  it("missing and null ids are one identity, numbers never collide with strings", () => {
    expect(commKey({ text: "x" })).toBe(commKey({ id: null }));
    expect(commKey({ id: 1 })).not.toBe(commKey({ id: "1" }));
  });
});

describe("LiveFeed.tick framing (first tick, comms, user)", () => {
  const snap = (over: Partial<CollectSnapshot> = {}): CollectSnapshot => ({
    at: 1700000000,
    tasks: {},
    comms: [],
    user: null,
    ...over,
  });

  it("first tick emits no events and stamps the snapshot", async () => {
    const feed = new LiveFeed(() => snap({ tasks: { "root:1": row("running") } }));
    await feed.tick();
    const s = feed.snapshot();
    expect(s).not.toBeNull();
    expect(s!.type).toBe("snapshot");
    expect(s!.seq).toBe(0);
    expect(typeof s!.collect_s).toBe("number");
    expect(feed.since(0)).toEqual({ type: "delta", from: 0, to: 0, events: [] });
  });

  it("dedupes comms across ticks and fires one user frame on change", async () => {
    const states = [
      snap(),
      snap({ comms: [{ id: "bc:1", text: "hi" }] }),
      snap({ comms: [{ id: "bc:1", text: "hi" }] }),
      snap({ user: { state: "busy" } }),
    ];
    let i = 0;
    const feed = new LiveFeed(() => states[i++]);
    for (let n = 0; n < states.length; n++) await feed.tick();
    const d = feed.since(0);
    if (!d || d.type !== "delta") throw new Error("expected delta");
    expect(d.events.map((e) => e.type)).toEqual(["comm", "user"]);
    expect(d!.events[0]).toEqual({ seq: 1, type: "comm", id: "bc:1", text: "hi" });
    expect(d!.events[1]).toMatchObject({ seq: 2, type: "user", user: { state: "busy" } });
  });

  it("keeps serving the last good snapshot when collect() throws", async () => {
    let calls = 0;
    const feed = new LiveFeed(() => {
      calls += 1;
      if (calls > 1) throw new Error("disk on fire");
      return snap({ tasks: { "root:1": row("running") } });
    });
    await feed.tick();
    await feed.tick();
    expect(feed.errors).toBe(1);
    expect(feed.lastError).toContain("disk on fire");
    expect(feed.snapshot()!.seq).toBe(0);
  });
});
