// T-23 RUN B: profile resolution for merged artifacts and refetch-on-open
// transcripts (drawer.js:520-527). No live server — fetch is stubbed.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  firstSessionOpener,
  loadTranscript,
  sessionOpeners,
  TRANSCRIPTS_URL,
} from "../../lib/sessions-logs/load";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("merged sessions profile resolution", () => {
  it("keeps the owning profile of the first recent session when the view is All", () => {
    const payload = {
      profiles: {
        work: { recent_sessions: [{ id: "s-work", last_ts: 1 }] },
        personal: { recent_sessions: [{ id: "s-personal", last_ts: 99 }] },
      },
    };
    expect(firstSessionOpener(payload, "All")).toEqual({ id: "s-work", profile: "work" });
    expect(sessionOpeners(payload, "All").profiles).toEqual({
      "s-work": "work",
      "s-personal": "personal",
    });
  });

  it("honours an explicit profile field and a single selected profile", () => {
    const payload = {
      profiles: {
        work: { recent_sessions: [{ id: "s1", profile: "shared" }] },
        personal: { recent_sessions: [{ id: "s2" }] },
      },
    };
    expect(sessionOpeners(payload, "All").profiles).toEqual({
      s1: "shared",
      s2: "personal",
    });
    expect(firstSessionOpener(payload, "personal")).toEqual({
      id: "s2",
      profile: "personal",
    });
  });
});

describe("loadTranscript", () => {
  it("refetches the artifact on every open instead of serving a stale cache", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const reply = (content: string) => ({
      ok: true,
      json: async () => ({
        profiles: { work: { s1: [{ role: "user", content }] } },
      }),
    });
    fetchMock.mockResolvedValueOnce(reply("first"));
    fetchMock.mockResolvedValueOnce(reply("second"));

    expect(await loadTranscript("work", "s1", 1000)).toEqual([
      { role: "user", content: "first" },
    ]);
    expect(await loadTranscript("work", "s1", 2000)).toEqual([
      { role: "user", content: "second" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(`${TRANSCRIPTS_URL}?t=1000`);
    expect(fetchMock.mock.calls[1][0]).toBe(`${TRANSCRIPTS_URL}?t=2000`);
    expect(fetchMock.mock.calls[0][1]).toEqual({ signal: undefined, cache: "no-store" });
  });
});
