"use client";

// LLMTELEMET-291 (T-20 RUN B2): subscribe the server-rendered HomeSnapshot to
// the existing T-3 stream. Initial render is pure; all I/O starts in useEffect.
import { useEffect, useState } from "react";

import { checkSchemaVersion } from "../../lib/home/schema";
import type { HomeSnapshot, JsonRecord, LiveData } from "../../lib/home/types";
import {
  CAP_RETRY_MS,
  LIVE_URL,
  STREAM_URL,
  liveFromFrame,
  mergeLiveSnapshot,
  type LiveHomeState,
} from "./liveHomeMerge";

export type { CounterChange, LiveHomeState } from "./liveHomeMerge";
export {
  CAP_RETRY_MS,
  LIVE_URL,
  STREAM_URL,
  counterDelta,
  liveFromFrame,
  mergeLiveSnapshot,
} from "./liveHomeMerge";

/** Python LIVE_MS cadence (src/llm_telemetry/web/js/live.js:860-865). */
const POLL_MS = 5000;

interface PollPayload {
  type: string;
  to?: number;
  events?: JsonRecord[];
  snapshot?: JsonRecord;
}

/** EventSource has no status code, so a 503 cap (lib/live-feed/http.ts:84-86)
 * is detected by a short probe after `onerror`. */
export function useLiveHome(initial: HomeSnapshot): LiveHomeState {
  const [state, setState] = useState<LiveHomeState>(() => ({
    ...initial,
    counters: null,
  }));

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let probe: AbortController | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setTimeout> | null = null;
    let inflight: Promise<void> | null = null;
    let pending = false;
    let seq: number | null = null;

    const apply = (frame: JsonRecord, event: string): void => {
      const at = Number(frame.seq);
      if (Number.isFinite(at)) seq = at;
      // The SSE event name is `delta`; the payload's own `type` is the feed's
      // row type (`event`/`comm`/`user`, types.ts:29), not the wire event.
      if (event === "delta" || ["event", "comm", "user"].includes(String(frame.type))) {
        // One coherent delta means one artifact GET (live.js:1038-1043).
        if (inflight) pending = true;
        else void fetchLive();
        return;
      }
      if (event === "snapshot" || frame.type === "snapshot") {
        const artifact = liveFromFrame(frame);
        if (artifact && !disposed) setState((prev) => mergeLiveSnapshot(prev, artifact));
      }
    };

    const fetchLive = async (): Promise<void> => {
      if (inflight) return;
      inflight = (async () => {
        try {
          const res = await fetch(LIVE_URL, { cache: "no-store" }); // live.js:1040
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const fresh = (await res.json()) as LiveData;
          checkSchemaVersion("live-data.json", fresh.schema_version); // live.js:1046
          if (!fresh.profiles) throw new Error("empty payload"); // live.js:1049
          if (!disposed) setState((prev) => mergeLiveSnapshot(prev, fresh));
        } catch {
          // A transient miss must not blank the panel (live.js:1091-1103).
        } finally {
          inflight = null;
          if (pending && !disposed) {
            pending = false;
            void fetchLive();
          }
        }
      })();
      await inflight;
    };

    const openStream = (): void => {
      if (disposed) return;
      retry = null;
      const es = new EventSource(STREAM_URL);
      source = es;
      const onFrame = (event: string) => (ev: Event): void => {
        try {
          apply(JSON.parse((ev as MessageEvent<string>).data) as JsonRecord, event);
        } catch {
          // Ignore a malformed frame; the next delta resynchronises.
        }
      };
      es.addEventListener("snapshot", onFrame("snapshot"));
      es.addEventListener("delta", onFrame("delta"));
      es.onerror = () => void onStreamError(es);
    };

    const startPolling = (): void => {
      if (disposed || poll !== null) return;
      const tick = async (): Promise<void> => {
        if (disposed) return;
        try {
          // feed.ts:61-63: `since(n)` replays frames > n or resets.
          const res = await fetch(`${STREAM_URL}?since=${seq ?? 0}`, {
            cache: "no-store",
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const payload = (await res.json()) as PollPayload;
          if (payload.type === "reset" && payload.snapshot) {
            const artifact = liveFromFrame(payload.snapshot);
            if (artifact && !disposed) {
              setState((prev) => mergeLiveSnapshot(prev, artifact));
            }
            seq = Number(payload.snapshot.seq) || seq;
          } else if (payload.events?.length) {
            for (const frame of payload.events) {
              const at = Number(frame.seq);
              if (Number.isFinite(at)) seq = at;
            }
            if (inflight) pending = true;
            else void fetchLive();
          }
        } catch {
          // Keep the last good snapshot while the fallback is unavailable.
        } finally {
          if (!disposed) poll = setTimeout(() => void tick(), POLL_MS);
        }
      };
      void tick();
    };

    const onStreamError = async (failed: EventSource): Promise<void> => {
      if (disposed || source !== failed) return;
      failed.close();
      source = null;
      probe?.abort();
      probe = new AbortController();
      try {
        const res = await fetch(STREAM_URL, {
          signal: probe.signal,
          cache: "no-store",
        });
        // Only the cap reply carries Retry-After: 5; a warming-up 503
        // (http.ts:88-92) must fall back rather than retry in a tight loop.
        const capped =
          res.status === 503 && res.headers.get("Retry-After") === "5";
        void res.body?.cancel().catch(() => undefined);
        if (capped) {
          // Retry-After: 5 from http.ts:85; EventSource cannot read headers.
          retry = setTimeout(openStream, CAP_RETRY_MS);
          return;
        }
      } catch {
        // A network probe failure is a stream failure: use ?since= below.
      }
      startPolling();
    };

    openStream();
    return () => {
      disposed = true;
      source?.close();
      source = null;
      probe?.abort();
      if (retry !== null) clearTimeout(retry);
      if (poll !== null) clearTimeout(poll);
    };
  }, []);

  return state;
}
