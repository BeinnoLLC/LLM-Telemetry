/**
 * T-19 (LLMTELEMET-290): port of serve.py's refresh_state, start_refresh,
 * _current_generated_at and the POST /api/refresh handler.
 *
 * All process-global effects (clock, PID probe, child spawn, filesystem) are
 * injectable so tests and the parity harness never start a real build.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as import_fs from "node:fs";
import * as path from "node:path";

import {
  HEADER,
  PyFloat,
  candidatePaths,
  isLoopback,
  parseContentLength,
  peerDepsFromEnv,
  peerIp,
  pyJsonResponse,
  type FsLike,
  type PeerDeps,
} from "./settings";

export { HEADER };

/** serve.py REFRESH_DEBOUNCE_S. */
export const REFRESH_DEBOUNCE_S = 20.0;

export interface RefreshState {
  pid: number | null;
  started: number;
  last_result: string | null;
  last_at: number | null;
}

/** serve.py module-level `_REFRESH`, shared by the route in one process. */
export const REFRESH: RefreshState = {
  pid: null,
  started: 0,
  last_result: null,
  last_at: null,
};

/** Reset the singleton between hermetic tests. */
export function resetRefresh(): void {
  REFRESH.pid = null;
  REFRESH.started = 0;
  REFRESH.last_result = null;
  REFRESH.last_at = null;
}

export interface RefreshDeps extends PeerDeps {
  /** Unix time in seconds; defaults to Date.now()/1000. */
  now?: () => number;
  /** Signal-0 PID probe; defaults to process.kill(pid, 0). */
  alive?: (pid: number) => boolean;
  /** Starter injected by tests; returns a pid or throws. */
  starter?: (command: string[]) => { pid: number };
  /** Python interpreter used by the real starter. */
  python?: string;
  /** Reports dir holding dashboard.html; defaults to the config's reports_dir. */
  reportsDir?: string;
  fs?: FsLike;
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** Fully overrides peer derivation (used by the parity harness). */
  peer?: (request: Request) => string | null | undefined;
}

function defaults(d: RefreshDeps = {}): Required<Pick<RefreshDeps, "now" | "alive" | "python" | "fs" | "env" | "directPeer">> {
  const env = d.env ?? process.env;
  const envDeps = peerDepsFromEnv(env);
  return {
    now: d.now ?? (() => Date.now() / 1000),
    alive: d.alive ?? ((pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    }),
    python: d.python ?? d.env?.["LLM_TELEMETRY_PYTHON"] ?? process.env["LLM_TELEMETRY_PYTHON"] ?? "python3",
    fs: d.fs ?? {
      existsSync: (p) => import_fs.existsSync(p),
      readFileSync: (p) => import_fs.readFileSync(p, "utf8"),
      writeFileSync: (p, data, opts) => import_fs.writeFileSync(p, data, opts),
      renameSync: (a, b) => import_fs.renameSync(a, b),
      mkdirSync: (p, opts) => import_fs.mkdirSync(p, opts),
      statSync: (p) => import_fs.statSync(p),
      chmodSync: (p, m) => import_fs.chmodSync(p, m),
      unlinkSync: (p) => import_fs.unlinkSync(p),
    },
    env,
    directPeer: d.directPeer === undefined ? envDeps.directPeer : d.directPeer,
  };
}

/** Python round(x, 1), adequate for the clock-derived payload fields. */
function round1(n: number): number {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}

/**
 * serve.py `refresh_state(now)` -> [should_start, payload]. A dead PID is
 * cleared before the debounce check, exactly as in Python.
 */
export function refreshState(d: RefreshDeps = {}): [boolean, Record<string, unknown>] {
  const cfg = defaults(d);
  const now = cfg.now();
  const pid = REFRESH.pid;
  let running = false;
  if (pid) {
    try {
      running = cfg.alive(pid);
    } catch {
      running = false;
    }
    if (!running) REFRESH.pid = null;
  }
  const since = now - (REFRESH.started || 0);
  if (running && pid !== null) {
    return [false, {
      accepted: false,
      running: true,
      pid,
      since_s: round1(since),
      detail: "a rebuild is already running",
    }];
  }
  if (REFRESH.started && since < REFRESH_DEBOUNCE_S) {
    return [false, {
      accepted: false,
      debounced: true,
      retry_in_s: round1(REFRESH_DEBOUNCE_S - since),
      last_result: REFRESH.last_result,
      detail: "rebuilt moments ago; not starting another build",
    }];
  }
  return [true, { accepted: true }];
}

/**
 * serve.py `start_refresh()` — spawn the builder detached, record its PID and
 * return the 202 payload. Tests inject `starter`, so no build runs.
 */
export function startRefresh(d: RefreshDeps = {}): Record<string, unknown> {
  const cfg = defaults(d);
  const [ok, info] = refreshState(d);
  if (!ok) return info;
  const command = [cfg.python, "-m", "llm_telemetry.cli", "dashboard"];
  try {
    const proc: { pid?: number; unref?: () => void } = d.starter
      ? d.starter(command)
      : spawn(command[0], command.slice(1), {
        detached: true,
        stdio: "ignore",
      }) as ChildProcess;
    if (typeof proc.pid !== "number") throw new Error("builder process has no pid");
    proc.unref?.();
    REFRESH.pid = proc.pid;
    REFRESH.started = cfg.now();
    return {
      accepted: true,
      pid: proc.pid,
      detail: "rebuild started; the page will pick it up on its next poll",
    };
  } catch (err) {
    REFRESH.last_result = `could not start builder: ${err instanceof Error ? err.message : String(err)}`;
    REFRESH.last_at = cfg.now();
    return { accepted: false, error: REFRESH.last_result };
  }
}

/** config.py's reports_dir default, expanded the same way as Python. */
function resolveReportsDir(d: RefreshDeps): string {
  if (d.reportsDir) return d.reportsDir;
  const cfg = defaults(d);
  const env = cfg.env;
  const home = d.home ?? (process.env["HOME"] ?? "");
  const candidates = candidatePaths(env, home);
  for (const p of candidates) {
    if (cfg.fs.existsSync(p)) {
      const raw = JSON.parse(cfg.fs.readFileSync(p, "utf8")) as Record<string, unknown>;
      if (typeof raw["reports_dir"] === "string") {
        const value = raw["reports_dir"];
        return value.startsWith("~")
          ? path.join(home, value.slice(1))
          : path.resolve(value);
      }
    }
  }
  return path.join(home, ".local", "share", "llm-telemetry", "reports");
}

/** Python datetime.fromtimestamp(mtime).isoformat(timespec="seconds"). */
export function generatedAt(mtimeSeconds: number): string {
  const dt = new Date(mtimeSeconds * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}` +
    `T${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
}

/** serve.py `_current_generated_at()` — missing file is not an error. */
export function currentGeneratedAt(d: RefreshDeps = {}): string | null {
  const cfg = defaults(d);
  try {
    const stat = cfg.fs.statSync(path.join(resolveReportsDir(d), "dashboard.html"));
    return generatedAt(stat.mtimeMs / 1000);
  } catch {
    return null;
  }
}

/**
 * POST /api/refresh handler logic, kept out of the route so tests can supply
 * a peer, a clock, a fake PID probe and a fake starter.
 */
export async function handleRefreshPost(request: Request, d: RefreshDeps = {}): Promise<Response> {
  const cfg = defaults(d);
  const peer = d.peer
    ? d.peer(request) ?? null
    : peerIp(
      request.headers,
      cfg.directPeer,
      d.trustProxy ?? peerDepsFromEnv(cfg.env).trustProxy,
    );
  if (!isLoopback(peer)) {
    return pyJsonResponse(403, { error: "a rebuild can only be triggered from this machine" });
  }
  if (request.headers.get(HEADER) !== "1") {
    return pyJsonResponse(403, { error: `missing ${HEADER} header` });
  }
  const n = parseContentLength(request.headers.get("content-length"));
  if (n > 1024) return pyJsonResponse(413, { error: "body too large" });
  if (n) {
    try {
      await request.text();
    } catch {
      // Python ignores OSError while draining; the connection is still reusable.
    }
  }
  const payload = startRefresh(d);
  // Python's round() and json.dumps() write these as floats (15.0, not 15).
  for (const key of ["since_s", "retry_in_s"]) {
    if (typeof payload[key] === "number") payload[key] = new PyFloat(payload[key] as number);
  }
  payload["generated_at"] = currentGeneratedAt(d);
  return pyJsonResponse(202, payload);
}
