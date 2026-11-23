// @vitest-environment node
/**
 * T-19 (LLMTELEMET-290) live static-response parity harness.
 *
 * Starts the real Python serve.py NoCacheHandler on an ephemeral 127.0.0.1
 * port with a temp reports dir, then drives the TypeScript route logic with
 * the same raw request target and compares status, the three no-cache
 * headers, Content-Type and body bytes. Content-Length and Last-Modified are
 * compared too when the payload is a served file.
 *
 * For 404s the diff is deliberate and asserted: Python sends its HTML error
 * page, the Next routes send {"error": "not found"} (see README). The Python
 * server is always shut down in each case's finally block, including after
 * a failed assertion.
 * Interpreter discovery is shared with serve-responses.parity.test.ts.
 */
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { handleDataRequest, handleSessionGet } from "../../lib/api/reports";
import { resolvePython } from "./python";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, "..", "..");
const REPO_ROOT = resolve(WEB_ROOT, "..", "..");
const SRC = join(REPO_ROOT, "src");
const SERVER = join(HERE, "serve_static.py");
const python = resolvePython(WEB_ROOT);
const STAMP = 1714975689;
const CACHE_HEADERS = ["cache-control", "pragma", "expires"] as const;
const NOT_FOUND_BYTES = Buffer.from('{"error": "not found"}');

const SESSION_BYTES = Buffer.from('{"id":"s-1","title":"🚀"}\n', "utf8");
const DATA_BYTES = Buffer.from('{"generated":1714975689,"rows":[1,2,3]}\n', "utf8");

interface Case {
  name: string;
  route: "session" | "data";
  method: "GET" | "HEAD";
  /** Raw request target: percent escapes are not normalised before sending. */
  path: string;
  served: boolean;
}

const CASES: Case[] = [
  { name: "session file", route: "session", method: "GET", path: "/sessions/root/s-1.json", served: true },
  { name: "data file", route: "data", method: "GET", path: "/live-data.json", served: true },
  { name: "data HEAD", route: "data", method: "HEAD", path: "/live-data.json", served: true },
  { name: "missing session", route: "session", method: "GET", path: "/sessions/root/missing.json", served: false },
  // Python drops the .. component and looks for sessions/outside.json; Next
  // rejects the segment before touching the filesystem. Both must be 404.
  { name: "traversal attempt", route: "session", method: "GET", path: "/sessions/root/%2e%2e/outside.json", served: false },
];

interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

function headerMap(headers: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") out[key.toLowerCase()] = value;
  }
  return out;
}

function rawRequest(port: number, path: string, method: "GET" | "HEAD"): Promise<RawResponse> {
  return new Promise((done, fail) => {
    const req = httpRequest({ hostname: "127.0.0.1", port, path, method }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => done({
        status: res.statusCode ?? 0,
        headers: headerMap(res.headers),
        body: Buffer.concat(chunks),
      }));
    });
    req.on("error", fail);
    req.end();
  });
}

interface LiveServer {
  port: number;
  stop: () => Promise<void>;
}

async function startServer(py: string, home: string, reports: string): Promise<LiveServer> {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, PYTHONUNBUFFERED: "1" };
  delete env["LLM_TELEMETRY_CONFIG"];
  delete env["XDG_CONFIG_HOME"];
  delete env["LLM_TELEMETRY_REPORTS_DIR"];
  const child = spawn(py, [SERVER, SRC, reports], {
    cwd: WEB_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => { stderr += String(chunk); });

  const stop = async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((done) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
      child.once("exit", () => { clearTimeout(timer); done(); });
      child.kill("SIGTERM");
    });
  };

  try {
    const port = await new Promise<number>((done, fail) => {
      let stdout = "";
      const timer = setTimeout(() => {
        fail(new Error(`static oracle did not print a port: ${stderr.trim()}`));
      }, 30_000);
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += String(chunk);
        const line = stdout.split(/\r?\n/)[0]?.trim() ?? "";
        if (/^\d+$/.test(line)) {
          clearTimeout(timer);
          done(Number(line));
        }
      });
      child.once("error", (err) => { clearTimeout(timer); fail(err); });
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        fail(new Error(`static oracle exited before listening (${code ?? signal}): ${stderr.trim()}`));
      });
    });
    return { port, stop };
  } catch (err) {
    await stop();
    throw err;
  }
}

describe.runIf(python !== null)("serve.py live static-response parity", () => {
  let home = "";
  let reports = "";

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "lst-290-static-parity-"));
    reports = join(home, "reports");
    mkdirSync(join(reports, "sessions", "root"), { recursive: true });
    const sessionFile = join(reports, "sessions", "root", "s-1.json");
    const dataFile = join(reports, "live-data.json");
    writeFileSync(sessionFile, SESSION_BYTES);
    writeFileSync(dataFile, DATA_BYTES);
    // Present in the oracle's document root, but the traversal target is
    // sessions/outside.json after Python's normpath — neither body may leak it.
    writeFileSync(join(reports, "outside.json"), '{"marker":"outside-secret"}');
    utimesSync(sessionFile, STAMP, STAMP);
    utimesSync(dataFile, STAMP, STAMP);
  }, 60_000);

  afterAll(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  async function routeResponse(c: Case): Promise<RawResponse> {
    const segments = c.path.split("?")[0].split("/").filter(Boolean);
    let response: Response;
    if (c.route === "session") {
      response = handleSessionGet(
        decodeURIComponent(segments[1]),
        decodeURIComponent(segments[2]),
        { reportsDir: reports },
      );
    } else {
      response = handleDataRequest(decodeURIComponent(segments[0]), c.method, { reportsDir: reports });
    }
    const headers: Record<string, string> = {};
    for (const [key, value] of response.headers.entries()) headers[key.toLowerCase()] = value;
    return {
      status: response.status,
      headers,
      body: Buffer.from(await response.arrayBuffer()),
    };
  }

  for (const c of CASES) {
    it(c.name, async () => {
      const live = await startServer(python as string, home, reports);
      try {
        const py = await rawRequest(live.port, c.path, c.method);
        const ts = await routeResponse(c);

        expect(ts.status).toBe(py.status);
        for (const header of CACHE_HEADERS) {
          expect(ts.headers[header]).toBe(py.headers[header]);
          expect(py.headers[header]).toBeTruthy();
        }

        if (c.served) {
          expect(ts.headers["content-type"]).toBe(py.headers["content-type"]);
          expect(ts.headers["content-type"]).toBe("application/json");
          expect(ts.body.equals(py.body)).toBe(true);
          expect(ts.headers["content-length"]).toBe(py.headers["content-length"]);
          expect(ts.headers["last-modified"]).toBe(py.headers["last-modified"]);
          if (c.method === "HEAD") expect(ts.body.byteLength).toBe(0);
        } else {
          // Intended divergence: compare the body bytes to each stack's
          // documented 404 representation rather than to each other.
          expect(py.status).toBe(404);
          expect(py.headers["content-type"]).toBe("text/html;charset=utf-8");
          expect(ts.headers["content-type"]).toBe("application/json");
          expect(ts.body.equals(NOT_FOUND_BYTES)).toBe(true);
          expect(py.body.toString("utf8")).toContain("Error code: 404");
          expect(py.body.equals(ts.body)).toBe(false);
          expect(py.body.toString("utf8")).not.toContain("outside-secret");
          expect(ts.body.toString("utf8")).not.toContain("outside-secret");
        }
      } finally {
        await live.stop();
      }
    }, 60_000);
  }
});

describe.skipIf(python !== null)("serve.py live static-response parity", () => {
  it("requires an interpreter with llm_telemetry (set LLM_TELEMETRY_PARITY_PYTHON)", () => {
    expect(python).not.toBeNull();
  });
});
