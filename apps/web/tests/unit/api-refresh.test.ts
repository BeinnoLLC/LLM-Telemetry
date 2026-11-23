// @vitest-environment node
/**
 * T-19 (LLMTELEMET-290): hermetic tests for the serve.py refresh port.
 * The builder starter is always injected — no real build or service is used.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import {
  HEADER,
  generatedAt,
  handleRefreshPost,
  refreshState,
  resetRefresh,
  startRefresh,
} from "../../lib/api/refresh";

let root: string;
let reportsDir: string;

beforeEach(() => {
  resetRefresh();
  root = mkdtempSync(join(tmpdir(), "lst-290-refresh-"));
  reportsDir = join(root, "reports");
  mkdirSync(reportsDir);
});

afterEach(() => {
  resetRefresh();
  rmSync(root, { recursive: true, force: true });
});

function request(headers: Record<string, string> = {}, method = "POST"): Request {
  return new Request("http://localhost/api/refresh", { method, headers });
}

function validHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { [HEADER]: "1", "content-length": "0", ...extra };
}

describe("refreshState() — serve.py parity", () => {
  it("accepts the first request", () => {
    expect(refreshState({ now: () => 100 })).toEqual([true, { accepted: true }]);
  });

  it("reports a live PID as running", () => {
    startRefresh({ now: () => 100, starter: () => ({ pid: 4242 }) });
    expect(refreshState({ now: () => 103.5, alive: () => true })).toEqual([false, {
      accepted: false,
      running: true,
      pid: 4242,
      since_s: 3.5,
      detail: "a rebuild is already running",
    }]);
  });

  it("debounces a dead PID inside the 20 s window and includes last_result", () => {
    startRefresh({ now: () => 100, starter: () => ({ pid: 4242 }) });
    expect(refreshState({ now: () => 105, alive: () => false })).toEqual([false, {
      accepted: false,
      debounced: true,
      retry_in_s: 15,
      last_result: null,
      detail: "rebuilt moments ago; not starting another build",
    }]);
  });

  it("allows a new build after the debounce window", () => {
    startRefresh({ now: () => 100, starter: () => ({ pid: 4242 }) });
    expect(refreshState({ now: () => 120.5, alive: () => false })).toEqual([true, { accepted: true }]);
  });

  it("records a failed starter as last_result and does not start", () => {
    const result = startRefresh({
      now: () => 100,
      starter: () => { throw new Error("boom"); },
    });
    expect(result).toEqual({ accepted: false, error: "could not start builder: boom" });
  });
});

describe("startRefresh() — detached, injectable", () => {
  it("passes the Python dashboard command to the starter and unrefs it", () => {
    const starter = vi.fn(() => ({ pid: 777, unref: vi.fn() }));
    const result = startRefresh({ now: () => 10, python: "/opt/py", starter });
    expect(starter).toHaveBeenCalledTimes(1);
    expect(starter).toHaveBeenCalledWith(["/opt/py", "-m", "llm_telemetry.cli", "dashboard"]);
    expect(starter.mock.calls.length).toBe(1);
    const proc = starter.mock.results[0]?.value as { unref: ReturnType<typeof vi.fn> };
    expect(proc.unref).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      accepted: true,
      pid: 777,
      detail: "rebuild started; the page will pick it up on its next poll",
    });
  });
});

describe("POST /api/refresh responses", () => {
  it("enforces the loopback guard and the required header", async () => {
    const remote = await handleRefreshPost(request(validHeaders({ "x-forwarded-for": "203.0.113.4" })), {
      reportsDir,
    });
    expect(remote.status).toBe(403);
    expect(await remote.json()).toEqual({ error: "a rebuild can only be triggered from this machine" });

    const noHeader = await handleRefreshPost(request({ "content-length": "0" }), { reportsDir });
    expect(noHeader.status).toBe(403);
    expect(await noHeader.json()).toEqual({ error: "missing X-LLM-Telemetry header" });
  });

  it("rejects a body over 1024 bytes without starting anything", async () => {
    const starter = vi.fn(() => ({ pid: 1 }));
    const res = await handleRefreshPost(request(validHeaders({ "content-length": "1025" })), {
      reportsDir,
      starter,
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "body too large" });
    expect(starter).not.toHaveBeenCalled();
  });

  it("starts a build and returns 202 with generated_at from dashboard.html", async () => {
    const html = join(reportsDir, "dashboard.html");
    writeFileSync(html, "<html></html>");
    const stamp = new Date("2024-05-06T07:08:09").getTime() / 1000;
    utimesSync(html, stamp, stamp);
    const starter = vi.fn(() => ({ pid: 4242 }));
    const res = await handleRefreshPost(request(validHeaders()), {
      reportsDir,
      starter,
      now: () => 100,
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      accepted: true,
      pid: 4242,
      detail: "rebuild started; the page will pick it up on its next poll",
      generated_at: generatedAt(stamp),
    });
    expect(starter).toHaveBeenCalledTimes(1);
  });

  it("returns 202 with running and debounced payloads, still with generated_at", async () => {
    startRefresh({ now: () => 100, starter: () => ({ pid: 4242 }) });
    const running = await handleRefreshPost(request(validHeaders()), {
      reportsDir,
      alive: () => true,
      now: () => 104,
      starter: () => { throw new Error("must not spawn"); },
    });
    expect(running.status).toBe(202);
    expect(await running.json()).toEqual({
      accepted: false,
      running: true,
      pid: 4242,
      since_s: 4,
      detail: "a rebuild is already running",
      generated_at: null,
    });

    const debounced = await handleRefreshPost(request(validHeaders()), {
      reportsDir,
      alive: () => false,
      now: () => 106,
      starter: () => { throw new Error("must not spawn"); },
    });
    expect(debounced.status).toBe(202);
    expect(await debounced.json()).toEqual({
      accepted: false,
      debounced: true,
      retry_in_s: 14,
      last_result: null,
      detail: "rebuilt moments ago; not starting another build",
      generated_at: null,
    });
  });

  it("reports a spawn failure inside the 202 payload", async () => {
    const res = await handleRefreshPost(request(validHeaders()), {
      reportsDir,
      now: () => 100,
      starter: () => { throw new Error("boom"); },
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      accepted: false,
      error: "could not start builder: boom",
      generated_at: null,
    });
  });
});
