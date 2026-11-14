// @vitest-environment node
// LLMTELEMET-282 (T-3): transport behaviours of /api/events/stream. Reference:
// tests/test_hive_api.py (framing, heartbeat, resume, cap -> 503, slot release)
// and serve.py `/api/hive` (the `?since=` polling fallback payload shapes).
import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONFIG,
  LiveFeed,
  StreamCap,
  handleEventsRequest,
  handlePoll,
  type CollectSnapshot,
  type LiveFeedConfig,
  type TaskRow,
} from "../../lib/live-feed";

const task = (status: string): TaskRow => ({
  family: "root",
  brain: "b",
  board: "B",
  agent: "a",
  status,
  title: "t",
});

function makeFeed(ring = 8): {
  feed: LiveFeed;
  set: (tasks: Record<string, TaskRow>) => void;
} {
  let tasks: Record<string, TaskRow> = {};
  const feed = new LiveFeed(
    (): CollectSnapshot => ({ at: 1700000000, tasks, schema_version: 1 }),
    { ring },
  );
  return { feed, set: (t) => { tasks = t; } };
}

const CFG: LiveFeedConfig = {
  ...DEFAULT_CONFIG,
  heartbeatS: 0.05,
  idleCloseS: 60,
  readyWaitS: 1,
};

interface SseFrame {
  [k: string]: string;
}

/** Reads one SSE block exactly like tests/test_hive_api.py `read_frame`. */
class SseReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private buf = "";
  private decoder = new TextDecoder();
  constructor(res: Response) {
    if (res.body === null) throw new Error("no body");
    this.reader = res.body.getReader();
  }
  async readFrame(): Promise<SseFrame | null> {
    for (;;) {
      const nl = this.buf.indexOf("\n");
      if (nl >= 0) {
        const line = this.buf.slice(0, nl + 1);
        this.buf = this.buf.slice(nl + 1);
        if (line === "\n" || line === "\r\n") continue;
        if (line.startsWith(":")) return { "#": line.slice(1).trim() };
        const clean = line.replace(/\n$/, "");
        const i = clean.indexOf(": ");
        const out: SseFrame = {};
        if (i >= 0) out[clean.slice(0, i)] = clean.slice(i + 2);
        else out[clean] = "";
        // A block continues until the blank line; fold the rest of the block.
        const rest = await this.readBlockTail();
        return { ...out, ...rest };
      }
      const { done, value } = await this.reader.read();
      if (done) return null;
      this.buf += this.decoder.decode(value, { stream: true });
    }
  }
  private async readBlockTail(): Promise<SseFrame> {
    const out: SseFrame = {};
    for (;;) {
      const nl = this.buf.indexOf("\n");
      if (nl < 0) {
        const { done, value } = await this.reader.read();
        if (done) return out;
        this.buf += this.decoder.decode(value, { stream: true });
        continue;
      }
      const line = this.buf.slice(0, nl + 1);
      this.buf = this.buf.slice(nl + 1);
      if (line === "\n" || line === "\r\n") return out;
      const clean = line.replace(/\n$/, "");
      const i = clean.indexOf(": ");
      if (i >= 0) out[clean.slice(0, i)] = clean.slice(i + 2);
    }
  }
  async close(): Promise<void> {
    await this.reader.cancel();
  }
}

async function open(
  feed: LiveFeed,
  cap: StreamCap,
  path = "/api/events/stream",
  headers?: Record<string, string>,
): Promise<{ res: Response; sse: SseReader }> {
  const res = await handleEventsRequest(
    new Request(`http://localhost${path}`, { headers }),
    feed,
    cap,
    CFG,
  );
  return { res, sse: res.body ? new SseReader(res) : (null as never) };
}

describe("SSE stream", () => {
  it("serves a schema-stamped snapshot first, with the SSE headers", async () => {
    const { feed, set } = makeFeed();
    set({ "root:1": task("running") });
    await feed.tick();
    const cap = new StreamCap(CFG.maxStreams);
    const { res, sse } = await open(feed, cap);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    const f = await sse.readFrame();
    expect(f!.event).toBe("snapshot");
    expect(f!.id).toBe("0");
    const data = JSON.parse(f!.data) as Record<string, unknown>;
    expect(data.schema_version).toBe(1);
    expect(data.type).toBe("snapshot");
    await sse.close();
  });

  it("emits delta frames with id: = seq after each tick", async () => {
    const { feed, set } = makeFeed();
    await feed.tick();
    const cap = new StreamCap(CFG.maxStreams);
    const { sse } = await open(feed, cap);
    await sse.readFrame(); // snapshot
    set({ "root:1": task("running") });
    await feed.tick();
    const f = await sse.readFrame();
    expect(f!.event).toBe("delta");
    expect(f!.id).toBe("1");
    expect(JSON.parse(f!.data).kind).toBe("new");
    await sse.close();
  });

  it("resumes from Last-Event-ID and answers a gap with a fresh snapshot", async () => {
    const { feed, set } = makeFeed();
    await feed.tick();
    for (let i = 0; i < 3; i++) {
      set({ [`root:${i}`]: task("running") });
      await feed.tick();
    }
    const cap = new StreamCap(CFG.maxStreams);
    const a = await open(feed, cap, "/api/events/stream", { "Last-Event-ID": "1" });
    const got = [await a.sse.readFrame(), await a.sse.readFrame()];
    expect(got.map((g) => g!.id)).toEqual(["2", "3"]);
    expect(new Set(got.map((g) => g!.event))).toEqual(new Set(["delta"]));
    await a.sse.close();

    const b = await open(feed, cap, "/api/events/stream?last=99999");
    const f = await b.sse.readFrame();
    expect(f!.event).toBe("snapshot");
    expect(f!.id).toBe("3");
    await b.sse.close();
  });

  it("heartbeats with the ': heartbeat' comment", async () => {
    const { feed } = makeFeed();
    await feed.tick();
    const cap = new StreamCap(CFG.maxStreams);
    const { sse } = await open(feed, cap);
    await sse.readFrame(); // snapshot
    const f = await sse.readFrame();
    expect(f).toEqual({ "#": "heartbeat" });
    await sse.close();
  });

  it("caps concurrent streams at 8 with 503 + Retry-After, and frees slots", async () => {
    const { feed } = makeFeed();
    await feed.tick();
    const cap = new StreamCap(CFG.maxStreams);
    const held: SseReader[] = [];
    for (let i = 0; i < 8; i++) {
      const { res, sse } = await open(feed, cap);
      expect(res.status).toBe(200);
      await sse.readFrame();
      held.push(sse);
    }
    expect(cap.active).toBe(8);
    const over = await handleEventsRequest(
      new Request("http://localhost/api/events/stream"),
      feed,
      cap,
      CFG,
    );
    expect(over.status).toBe(503);
    expect(over.headers.get("Retry-After")).toBe("5");
    expect(JSON.parse(await over.text() as string)).toEqual({
      error: "too many event streams",
    });

    await held.pop()!.close(); // a hung-up client frees its slot
    expect(cap.active).toBe(7);
    const again = await open(feed, cap);
    expect(again.res.status).toBe(200);
    await again.sse.close();
    for (const s of held) await s.close();
    expect(cap.active).toBe(0);
  });

  it("recycles an idle stream and frees its slot", async () => {
    const { feed } = makeFeed();
    await feed.tick();
    const cap = new StreamCap(1);
    // Python parity: the loop re-checks idleness on every <=1 s wait, so with
    // heartbeats parked the stream ends one wait after idleCloseS.
    const idleCfg: LiveFeedConfig = { ...CFG, idleCloseS: 0.1, heartbeatS: 30 };
    const res = await handleEventsRequest(
      new Request("http://localhost/api/events/stream"),
      feed,
      cap,
      idleCfg,
    );
    const sse = new SseReader(res);
    await sse.readFrame(); // snapshot
    expect(await sse.readFrame()).toBeNull(); // EOF after the idle recycle
    await sse.close();
    expect(cap.active).toBe(0);
  });

  it("a broken client does not wedge the feed or the cap", async () => {
    const { feed, set } = makeFeed();
    await feed.tick();
    const cap = new StreamCap(1);
    const { sse } = await open(feed, cap);
    await sse.readFrame();
    await sse.close(); // abrupt hang-up
    set({ "root:1": task("running") });
    await feed.tick(); // pump notices on its next write window
    await new Promise((r) => setTimeout(r, 120));
    expect(cap.active).toBe(0);
    expect((await handlePoll(feed, null)).status).toBe(200);
  });
});

describe("?since= polling fallback", () => {
  it("replays exactly the missed frames with the Python payload shape", async () => {
    const { feed, set } = makeFeed();
    await feed.tick();
    set({ "root:1": task("running") });
    await feed.tick();
    set({ "root:1": task("done") });
    await feed.tick();
    const res = await handlePoll(feed, "0");
    expect(res.status).toBe(200);
    const d = JSON.parse(await res.text() as string) as Record<string, unknown>;
    expect(d.type).toBe("delta");
    expect([d.from, d.to]).toEqual([0, 2]);
    expect((d.events as Array<{ seq: number; kind: string }>).map((e) => [e.seq, e.kind])).toEqual([
      [1, "new"],
      [2, "status"],
    ]);
  });

  it("resets with a fresh snapshot when the seq fell out of the ring", async () => {
    const { feed, set } = makeFeed();
    await feed.tick();
    for (let i = 0; i < 12; i++) {
      set({ [`root:${i}`]: task("running") });
      await feed.tick();
    }
    const d = JSON.parse(await (await handlePoll(feed, "1")).text() as string);
    expect(d.type).toBe("reset");
    expect(d.snapshot.seq).toBe(feed.snapshot()!.seq);
    const future = JSON.parse(await (await handlePoll(feed, "99999")).text() as string);
    expect(future.type).toBe("reset");
  });

  it("rejects a non-integer since with the Python error body", async () => {
    const { feed } = makeFeed();
    await feed.tick();
    for (const bad of ["x", ""]) {
      const res = await handlePoll(feed, bad);
      expect(res.status).toBe(400);
      expect(JSON.parse(await res.text() as string)).toEqual({
        error: "since must be an integer",
      });
    }
  });

  it("answers the full snapshot when no since is given (GET /api/hive parity)", async () => {
    const { feed, set } = makeFeed();
    set({ "root:1": task("running") });
    await feed.tick();
    const d = JSON.parse(await (await handlePoll(feed, null)).text() as string);
    expect(d.type).toBe("snapshot");
    expect(d.seq).toBe(0);
    expect(d.schema_version).toBe(1);
  });

  it("503s while the feed is still warming up", async () => {
    const never = new LiveFeed(() => {
      throw new Error("scanner still scanning");
    });
    void never.tick(); // records the failure, never produces a snapshot
    const cfg: LiveFeedConfig = { ...CFG, readyWaitS: 0.05 };
    const poll = await handlePoll(never, "0", cfg);
    expect(poll.status).toBe(503);
    expect(JSON.parse(await poll.text() as string)).toEqual({
      error: "events feed warming up",
      detail: "Error: scanner still scanning",
    });
    const cap = new StreamCap(1);
    const stream = await handleEventsRequest(
      new Request("http://localhost/api/events/stream"),
      never,
      cap,
      cfg,
    );
    expect(stream.status).toBe(503);
    expect(JSON.parse(await stream.text() as string)).toEqual({
      error: "events feed warming up",
    });
    expect(cap.active).toBe(0); // the rejected stream gave its slot back
  });
});
