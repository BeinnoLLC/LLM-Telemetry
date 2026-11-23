/**
 * T-19 (LLMTELEMET-290): report-artifact reads ported from serve.py's
 * NoCacheHandler static path. The report directory resolver is deliberately
 * imported from the live-feed module so both stacks agree on where collectors
 * write; callers may inject `reportsDir` for hermetic tests.
 *
 * Intentional difference from SimpleHTTPRequestHandler: a missing or rejected
 * file returns a JSON `{"error": "not found"}` body instead of Python's HTML
 * error page. The status (404) and all no-cache headers still match. This is
 * documented in apps/web/README.md as well.
 */

import { readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

import { reportsDir as configuredReportsDir } from "../live-feed/artifacts";

/** NoCacheHandler.end_headers() — every response, success or error. */
export const NO_CACHE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
});

/** The report artifacts the legacy dashboard reads via plain static GETs. */
export const DATA_ARTIFACTS = [
  "live-data.json",
  "analytics-data.json",
  "logs-data.json",
  "quota-data.json",
  "router-data.json",
  "transcripts.json",
  "rankings-data.json",
  "kanban-data.json",
  "costs-data.json",
  "ollama-data.json",
] as const;

export type DataArtifact = (typeof DATA_ARTIFACTS)[number];

const DATA_SET: ReadonlySet<string> = new Set<string>(DATA_ARTIFACTS);
const NOT_FOUND_BYTES = new TextEncoder().encode('{"error": "not found"}');

export interface ReportsDeps {
  /** Overrides the config-driven resolver in live-feed/artifacts.ts. */
  reportsDir?: string;
}

function root(deps: ReportsDeps): string {
  return deps.reportsDir ?? configuredReportsDir();
}

/**
 * Decode percent escapes (more than once: a proxy may double-encode) and
 * reject any segment that is empty, hidden, absolute, nested or NUL-bearing.
 * Route params from Next are normally decoded already, so the raw and the
 * decoded forms are both checked.
 */
function safeSegment(raw: string): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let decoded = raw;
  for (let i = 0; i < 8; i += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return null;
    }
    if (next === decoded) break;
    decoded = next;
  }
  // Any escape left after decoding (including over-encoded ones) is refused.
  if (decoded.includes("%")) return null;
  for (const value of new Set([raw, decoded])) {
    if (
      value.length === 0 ||
      value.startsWith(".") ||
      value.includes("/") ||
      value.includes("\\") ||
      value.includes("\0")
    ) return null;
  }
  return decoded;
}

/**
 * path.resolve containment plus a realpath containment check: the latter is
 * what stops a symlink inside the reports tree from pointing at a file
 * outside it. Directories are not served by these endpoints.
 */
function resolveInside(base: string, segments: string[]): string | null {
  try {
    const basePath = resolve(base);
    const target = resolve(basePath, ...segments);
    if (!target.startsWith(basePath + sep)) return null;
    const realBase = realpathSync(basePath);
    const realTarget = realpathSync(target);
    if (!realTarget.startsWith(realBase + sep)) return null;
    return statSync(realTarget).isFile() ? target : null;
  } catch {
    return null;
  }
}

/** Resolve `<reports>/sessions/<profile>/<id>.json`; `.json` is optional. */
export function resolveSessionFile(
  profile: string,
  id: string,
  deps: ReportsDeps = {},
): string | null {
  const safeProfile = safeSegment(profile);
  const safeId = safeSegment(id);
  if (safeProfile === null || safeId === null) return null;
  const file = safeId.endsWith(".json") ? safeId : `${safeId}.json`;
  return resolveInside(resolve(root(deps), "sessions"), [safeProfile, file]);
}

/** Resolve an allowlisted `<reports>/<name>` artifact, or null. */
export function resolveDataFile(name: string, deps: ReportsDeps = {}): string | null {
  if (!DATA_SET.has(name)) return null;
  const safeName = safeSegment(name);
  if (safeName !== name) return null;
  return resolveInside(root(deps), [safeName]);
}

/** SimpleHTTPRequestHandler.date_time_string(): UTC GMT, second precision. */
export function lastModified(mtimeMs: number): string {
  return new Date(Math.floor(mtimeMs / 1000) * 1000).toUTCString();
}

function fileHeaders(bytes: number, mtimeMs: number): HeadersInit {
  return {
    ...NO_CACHE_HEADERS,
    "Content-Type": "application/json",
    "Content-Length": String(bytes),
    "Last-Modified": lastModified(mtimeMs),
  };
}

/** Documented divergence: Python sends an HTML error page here. HEAD keeps
 * the JSON headers and length but, like Python's HEAD, has no body. */
export function notFoundResponse(method: "GET" | "HEAD" = "GET"): Response {
  return new Response(method === "HEAD" ? null : NOT_FOUND_BYTES, {
    status: 404,
    headers: {
      ...NO_CACHE_HEADERS,
      "Content-Type": "application/json",
      "Content-Length": String(NOT_FOUND_BYTES.byteLength),
    },
  });
}

function serveFile(path: string | null, method: "GET" | "HEAD"): Response {
  if (path === null) return notFoundResponse(method);
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return notFoundResponse(method);
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: fileHeaders(stat.size, stat.mtimeMs) });
    }
    const bytes = readFileSync(path);
    return new Response(bytes, {
      status: 200,
      headers: fileHeaders(bytes.byteLength, stat.mtimeMs),
    });
  } catch {
    return notFoundResponse(method);
  }
}

/** GET /api/sessions/[profile]/[id] — raw exported bytes, never re-serialised. */
export function handleSessionGet(
  profile: string,
  id: string,
  deps: ReportsDeps = {},
): Response {
  return serveFile(resolveSessionFile(profile, id, deps), "GET");
}

/** GET/HEAD /api/data/[name] — allowlisted artifacts only. */
export function handleDataRequest(
  name: string,
  method: "GET" | "HEAD" = "GET",
  deps: ReportsDeps = {},
): Response {
  return serveFile(resolveDataFile(name, deps), method);
}
