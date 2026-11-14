// @vitest-environment node
// LLMTELEMET-282 (T-3): SSE framing. Reference: serve.py `NoCacheHandler._sse`
// (id/event/data lines + blank line) and the ": heartbeat" comment cadence.
import { describe, expect, it } from "vitest";

import { formatSse, HEARTBEAT_COMMENT } from "../../lib/live-feed";

describe("formatSse (port of serve.py _sse)", () => {
  it("writes id:, event: and one data: line, then a blank line", () => {
    expect(formatSse({ a: 1 }, 3, "delta")).toBe('id: 3\nevent: delta\ndata: {"a":1}\n\n');
  });

  it("omits id and event when they are absent", () => {
    expect(formatSse({ x: "y" })).toBe('data: {"x":"y"}\n\n');
  });

  it("keeps payloads parseable JSON even with newlines in strings", () => {
    const out = formatSse({ text: "a\nb" }, 1, "comm");
    const dataLines = out
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => l.slice("data: ".length));
    expect(dataLines).toHaveLength(1); // JSON.stringify escapes \n, like json.dumps
    expect(JSON.parse(dataLines[0])).toEqual({ text: "a\nb" });
  });

  it("heartbeat comment matches the Python byte layout", () => {
    expect(HEARTBEAT_COMMENT).toBe(": heartbeat\n\n");
  });
});
