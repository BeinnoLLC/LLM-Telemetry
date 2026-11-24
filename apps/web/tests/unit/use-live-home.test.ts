// LLMTELEMET-291 (T-20 RUN B2): hook contract with mocked EventSource/fetch.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LIVE_URL,
  STREAM_URL,
  useLiveHome,
  type LiveHomeState,
} from "../../components/home/useLiveHome";
import { EXPECTED_SCHEMA_VERSION } from "../../lib/home/schema";
import type { HomeSnapshot, LiveData } from "../../lib/home/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

class MockEventSource {
  static instances: MockEventSource[] = [];
  readyState = 0;
  onerror: ((ev: Event) => void) | null = null;
  close = vi.fn();
  private listeners = new Map<string, Array<(ev: Event) => void>>();

  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (ev: Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string, data: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) {
      fn(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
  }
  fail(): void {
    this.onerror?.(new Event("error"));
  }
}

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

function live(calls: number, tokens: number): LiveData {
  return {
    generated: "2026-09-25T13:51:12",
    schema_version: EXPECTED_SCHEMA_VERSION,
    profiles: {
      work: {
        active: 7,
        live: [
          {
            id: "s1",
            models: [{ model: "m", calls, in_tok: tokens, out_tok: 0 }],
          },
        ],
      },
    },
  };
}

const snapshot = (data: LiveData): HomeSnapshot => ({
  analytics: null,
  live: data,
  router: null,
  quota: null,
});

function Probe({ initial }: { initial: HomeSnapshot }): null {
  seen = useLiveHome(initial);
  return null;
}

let seen: LiveHomeState;
let root: Root;
let host: HTMLDivElement;
let unmounted: boolean;
let responder: (url: string) => Response;
const fetchMock = vi.fn((input: RequestInfo | URL) =>
  Promise.resolve(responder(String(input))),
);
const liveCalls = (): number =>
  fetchMock.mock.calls.filter(([url]) => String(url) === LIVE_URL).length;
const pollCalls = (): number =>
  fetchMock.mock.calls.filter(([url]) =>
    String(url).startsWith(`${STREAM_URL}?since=`),
  ).length;
const flush = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
};
const mount = async (initial: HomeSnapshot): Promise<void> => {
  await act(async () => {
    root.render(createElement(Probe, { initial }));
  });
};

beforeEach(() => {
  MockEventSource.instances = [];
  fetchMock.mockClear();
  responder = (url) => (url === LIVE_URL ? json(live(2, 20)) : new Response(null));
  vi.stubGlobal("EventSource", MockEventSource);
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  unmounted = false;
});
afterEach(() => {
  if (!unmounted) act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useLiveHome", () => {
  it("uses the server snapshot on first render without a data fetch", async () => {
    const initial = snapshot(live(10, 100));
    await mount(initial);
    expect(seen.live).toBe(initial.live);
    expect(seen.counters).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(MockEventSource.instances[0].url).toBe(STREAM_URL);
  });

  it("fetches the live artifact exactly once per delta frame", async () => {
    responder = (url) => (url === LIVE_URL ? json(live(12, 120)) : new Response(null));
    await mount(snapshot(live(10, 100)));
    await act(async () => {
      MockEventSource.instances[0].emit("delta", { seq: 7, type: "event" });
    });
    await flush();
    expect(liveCalls()).toBe(1);
    expect(seen.live?.profiles?.work.active).toBe(7);
    expect(seen.live?.profiles?.work.live?.[0].models?.[0].calls).toBe(12);
  });

  it("falls back to ?since= polling after a stream error", async () => {
    responder = (url) =>
      url === LIVE_URL
        ? json(live(3, 30))
        : url.startsWith(`${STREAM_URL}?since=`)
          ? json({ type: "delta", to: 1, events: [{ seq: 1, type: "event" }] })
          : new Response(null);
    await mount(snapshot(live(1, 10)));
    await act(async () => MockEventSource.instances[0].fail());
    await flush();
    expect(pollCalls()).toBeGreaterThan(0);
    expect(fetchMock.mock.calls[1][0]).toBe(`${STREAM_URL}?since=0`);
  });

  it("retries the stream after 5s on a 503 cap, without polling", async () => {
    vi.useFakeTimers();
    responder = () => new Response(null, { status: 503, headers: { "Retry-After": "5" } });
    await mount(snapshot(live(1, 10)));
    await act(async () => MockEventSource.instances[0].fail());
    await flush();
    expect(MockEventSource.instances).toHaveLength(1);
    expect(pollCalls()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(MockEventSource.instances).toHaveLength(2);
  });

  it("clamps a backwards counter to zero (live.js:90)", async () => {
    await mount(snapshot(live(10, 100)));
    await act(async () => {
      MockEventSource.instances[0].emit("delta", { seq: 1, type: "event" });
    });
    await flush();
    const model = seen.live?.profiles?.work.live?.[0].models?.[0];
    expect(model?.calls).toBe(0);
    expect(model?.in_tok).toBe(0);
    expect(seen.counters?.["work:s1:m"]).toEqual({ calls: 0, tokens: 0 });
  });

  it("closes the EventSource on unmount", async () => {
    await mount(snapshot(live(1, 10)));
    const source = MockEventSource.instances[0];
    act(() => {
      root.unmount();
    });
    unmounted = true;
    expect(source.close).toHaveBeenCalledOnce();
  });
});
