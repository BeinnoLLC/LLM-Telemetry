// LLMTELEMET-282 (T-3): transport for the live feed — one GET shape serves the
// SSE stream and its `?since=` polling fallback, ported from serve.py's
// `/api/hive` + `/api/hive/stream` handlers so both transports share one
// payload vocabulary:
//
//   GET /api/events/stream            -> SSE (snapshot on connect, id: = seq,
//                                        ": heartbeat" <= 20 s, idle recycle)
//   GET /api/events/stream?since=N    -> polling fallback JSON:
//                                        {"type":"delta","from","to","events"}
//                                        or {"type":"reset","snapshot":{…}}
//   …?since=<not an integer>          -> 400 {"error":"since must be an integer"}
//   cap reached (8 streams)           -> 503 + Retry-After: 5
//   feed not ready yet                -> 503 {"error":"… warming up"}
import { StreamCap } from "./cap";
import type { LiveFeed } from "./feed";
import { formatSse, HEARTBEAT_COMMENT } from "./sse";
import type { PollPayload, SnapshotFrame } from "./types";

export interface LiveFeedConfig {
  /** Concurrent SSE streams (serve.py HIVE_MAX_STREAMS = 8). */
  maxStreams: number;
  /** ": heartbeat" comment cadence in seconds (Python 15 s, contract <= 20 s). */
  heartbeatS: number;
  /** Recycle idle streams after this many seconds (Python 600 s). */
  idleCloseS: number;
  /** How long to wait for the first collect (Python HIVE_READY_WAIT_S = 20). */
  readyWaitS: number;
}

export const DEFAULT_CONFIG: LiveFeedConfig = {
  maxStreams: 8,
  heartbeatS: 15,
  idleCloseS: 600,
  readyWaitS: 20,
};

const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Connection: "close",
  "X-Accel-Buffering": "no",
};

function json(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** Python `int(since)` acceptance for the seq parameters: optional sign +
 * digits (Python's int() also tolerates surrounding whitespace). `null` means
 * the parameter was absent; `undefined` means it is not an integer. */
function parseSeq(raw: string | null | undefined): number | null | undefined {
  if (raw === null || raw === undefined) return null;
  const t = raw.trim();
  if (!/^[+-]?\d+$/.test(t)) return undefined;
  return Number(t);
}

/** The `?since=` polling fallback (port of serve.py `_hive`). `sinceRaw` null
 * answers the full snapshot like `GET /api/hive` does in Python. */
export async function handlePoll(
  feed: LiveFeed,
  sinceRaw: string | null,
  cfg: LiveFeedConfig = DEFAULT_CONFIG,
): Promise<Response> {
  const since = parseSeq(sinceRaw);
  if (since === undefined) {
    return json({ error: "since must be an integer" }, 400);
  }
  if (!(await feed.waitReady(cfg.readyWaitS * 1000))) {
    return json(
      { error: "events feed warming up", detail: feed.lastError ?? null },
      503,
    );
  }
  const body: PollPayload | SnapshotFrame | null =
    since === null ? feed.snapshot() : feed.since(since);
  return json(body);
}

/** The SSE stream (port of serve.py `_hive_stream`): snapshot on connect,
 * `id:` sequence numbers, `Last-Event-ID`/`?last=` resume from the ring,
 * heartbeat comments, idle close, and the connection cap with 503. */
export async function handleStream(
  feed: LiveFeed,
  request: Request,
  url: URL,
  cap: StreamCap,
  cfg: LiveFeedConfig = DEFAULT_CONFIG,
): Promise<Response> {
  if (!cap.acquire()) {
    return json({ error: "too many event streams" }, 503, {
      "Retry-After": "5",
    });
  }
  let released = false;
  const release = (): void => {
    if (!released) {
      released = true;
      cap.release();
    }
  };
  if (!(await feed.waitReady(cfg.readyWaitS * 1000))) {
    release();
    return json({ error: "events feed warming up" }, 503);
  }
  // Resume: Last-Event-ID header wins, ?last= is the query fallback; a
  // non-integer restarts from a fresh snapshot (Python: last = None).
  const header = request.headers.get("Last-Event-ID");
  const last: number | null = parseSeq(header || url.searchParams.get("last")) ?? null;

  const heartbeatMs = cfg.heartbeatS * 1000;
  const idleMs = cfg.idleCloseS * 1000;
  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      void (async () => {
        try {
          const first: PollPayload | null = last !== null ? feed.since(last) : null;
          let lastSeq: number;
          if (first && first.type === "delta") {
            for (const fr of first.events) {
              controller.enqueue(encoder.encode(formatSse(fr, fr.seq, "delta")));
            }
            lastSeq = first.to;
          } else {
            const snap: SnapshotFrame | null =
              first && first.type === "reset" ? first.snapshot : feed.snapshot();
            if (snap === null) throw new Error("feed is not ready");
            controller.enqueue(
              encoder.encode(formatSse(snap, snap.seq, "snapshot")),
            );
            lastSeq = snap.seq;
          }
          let beat = Date.now();
          const started = Date.now();
          while (!cancelled) {
            const now = Date.now();
            if (now - started > idleMs) return;
            const { frames, snap } = await feed.waitAfter(
              lastSeq,
              Math.min(1000, Math.max(50, heartbeatMs - (now - beat))),
            );
            if (cancelled) return;
            if (snap !== null) {
              controller.enqueue(
                encoder.encode(formatSse(snap, snap.seq, "snapshot")),
              );
              lastSeq = snap.seq;
              beat = Date.now();
            }
            for (const fr of frames) {
              controller.enqueue(encoder.encode(formatSse(fr, fr.seq, "delta")));
              lastSeq = fr.seq;
              beat = Date.now();
            }
            if (Date.now() - beat >= heartbeatMs) {
              controller.enqueue(encoder.encode(HEARTBEAT_COMMENT));
              beat = Date.now();
            }
          }
        } catch {
          // client hung up mid-write: drop it, free the slot
        } finally {
          release();
          try {
            controller.close();
          } catch {
            // already closed or cancelled
          }
        }
      })();
    },
    cancel: () => {
      cancelled = true;
      release();
    },
  });

  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}

/** Route-level dispatch: `?since=` present -> polling JSON, else SSE. */
export async function handleEventsRequest(
  request: Request,
  feed: LiveFeed,
  cap: StreamCap,
  cfg: LiveFeedConfig = DEFAULT_CONFIG,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.has("since")) {
    // ?since= with an empty value: Python int("") raises -> 400
    return handlePoll(feed, url.searchParams.get("since"), cfg);
  }
  return handleStream(feed, request, url, cap, cfg);
}
