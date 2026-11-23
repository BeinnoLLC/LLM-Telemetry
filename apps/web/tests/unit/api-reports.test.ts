// @vitest-environment node
/**
 * T-19 (LLMTELEMET-290): hermetic tests for the report-data route logic.
 * Every path lives in a fresh temp directory; no live server or real reports.
 */
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  handleDataRequest,
  handleSessionGet,
  resolveSessionFile,
} from "../../lib/api/reports";

const STAMP = 1714975689;
const CACHE = "no-store, no-cache, must-revalidate, max-age=0";

let root: string;
let reports: string;
let sessions: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lst-290-reports-"));
  reports = join(root, "reports");
  sessions = join(reports, "sessions");
  mkdirSync(sessions, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function session(profile: string, id: string): Response {
  return handleSessionGet(profile, id, { reportsDir: reports });
}

function data(name: string, method: "GET" | "HEAD" = "GET"): Response {
  return handleDataRequest(name, method, { reportsDir: reports });
}

async function body(res: Response): Promise<Buffer> {
  return Buffer.from(await res.arrayBuffer());
}

function expectNoCache(res: Response): void {
  expect(res.headers.get("cache-control")).toBe(CACHE);
  expect(res.headers.get("pragma")).toBe("no-cache");
  expect(res.headers.get("expires")).toBe("0");
}

function expectNotFound(res: Response): void {
  expect(res.status).toBe(404);
  expectNoCache(res);
  expect(res.headers.get("content-type")).toBe("application/json");
  expect(res.headers.get("content-length")).toBe("22");
  expect(res.headers.get("last-modified")).toBeNull();
}

describe("GET /api/sessions/[profile]/[id]", () => {
  it("returns the raw file bytes and serve.py's headers, with .json optional", async () => {
    const dir = join(sessions, "root");
    mkdirSync(dir);
    const file = join(dir, "s-1.json");
    const raw = Buffer.from('{"id":"s-1","title":"🚀","weird":"é\\u0000"}\n', "utf8");
    writeFileSync(file, raw);
    utimesSync(file, STAMP, STAMP);

    for (const id of ["s-1", "s-1.json"]) {
      const res = session("root", id);
      expect(res.status).toBe(200);
      expectNoCache(res);
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(res.headers.get("content-length")).toBe(String(raw.byteLength));
      expect(res.headers.get("last-modified")).toBe(new Date(STAMP * 1000).toUTCString());
      expect(await body(res)).toEqual(raw);
    }
  });

  it("uses the config-driven reports resolver when no directory is injected", () => {
    const dir = join(sessions, "root");
    mkdirSync(dir);
    writeFileSync(join(dir, "s-2.json"), "{}");
    const previous = process.env["LLM_TELEMETRY_REPORTS_DIR"];
    process.env["LLM_TELEMETRY_REPORTS_DIR"] = reports;
    try {
      expect(resolveSessionFile("root", "s-2")).toBe(join(dir, "s-2.json"));
      expect(handleSessionGet("root", "s-2").status).toBe(200);
    } finally {
      if (previous === undefined) delete process.env["LLM_TELEMETRY_REPORTS_DIR"];
      else process.env["LLM_TELEMETRY_REPORTS_DIR"] = previous;
    }
  });

  it.each([
    ["empty profile", "", "s-1"],
    ["empty id", "root", ""],
    ["parent segment profile", "..", "s-1"],
    ["parent segment id", "root", ".."],
    ["encoded parent", "root", "%2e%2e"],
    ["double-encoded parent", "root", "%252e%252e"],
    ["encoded slash", "root", "a%2fb"],
    ["absolute path", "/etc", "passwd"],
    ["dotfile", "root", ".hidden"],
    ["NUL byte", "root", "s-1%00.json"],
    ["symlink out of the reports tree", "root", "link"],
  ])("returns 404 for %s", async (_label, profile, id) => {
    const outside = join(root, "outside.json");
    writeFileSync(outside, '{"secret":true}');
    mkdirSync(join(sessions, "root"), { recursive: true });
    symlinkSync(outside, join(sessions, "root", "link.json"));

    const res = session(profile, id);
    expectNotFound(res);
    expect(await body(res)).toEqual(Buffer.from('{"error": "not found"}'));
  });
});

describe("GET/HEAD /api/data/[name]", () => {
  it("allows only the ten report artifacts and serves raw bytes", async () => {
    const raw = Buffer.from('{"generated":1714975689}\n', "utf8");
    const file = join(reports, "live-data.json");
    writeFileSync(file, raw);
    utimesSync(file, STAMP, STAMP);

    const get = data("live-data.json");
    expect(get.status).toBe(200);
    expectNoCache(get);
    expect(get.headers.get("content-type")).toBe("application/json");
    expect(get.headers.get("content-length")).toBe(String(raw.byteLength));
    expect(get.headers.get("last-modified")).toBe(new Date(STAMP * 1000).toUTCString());
    expect(await body(get)).toEqual(raw);

    const head = data("live-data.json", "HEAD");
    expect(head.status).toBe(200);
    expectNoCache(head);
    expect(head.headers.get("content-type")).toBe("application/json");
    expect(head.headers.get("content-length")).toBe(String(raw.byteLength));
    expect(head.headers.get("last-modified")).toBe(new Date(STAMP * 1000).toUTCString());
    expect(await body(head)).toEqual(Buffer.alloc(0));
  });

  it.each([
    "dashboard.html",
    "live-data.json.bak",
    "../serve.py",
    "%2e%2e%2flive-data.json",
    ".env",
    "",
  ])("404s non-allowlisted name %s", async (name) => {
    const res = data(name);
    expectNotFound(res);
    expect(await body(res)).toEqual(Buffer.from('{"error": "not found"}'));
  });

  it("404s an allowlisted name that is a symlink pointing outside reports", async () => {
    const outside = join(root, "outside.json");
    writeFileSync(outside, '{"secret":true}');
    symlinkSync(outside, join(reports, "router-data.json"));
    expectNotFound(data("router-data.json"));
    expectNotFound(data("router-data.json", "HEAD"));
    expect(await body(data("router-data.json", "HEAD"))).toEqual(Buffer.alloc(0));
  });
});
