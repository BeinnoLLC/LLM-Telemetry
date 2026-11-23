/**
 * T-19 (LLMTELEMET-290): pure settings/config logic ported from
 * `src/llm_telemetry/serve.py` and `src/llm_telemetry/config.py`.
 *
 * The route handlers under app/api/settings stay thin: validation, config
 * candidate selection, fresh reads and atomic writes live here so the same
 * code can be exercised by hermetic unit tests and by the Python parity
 * harness. Nothing in this module starts a build or touches production.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Power-model keys and their inclusive numeric ranges (serve.py SETTINGS). */
export const SETTINGS: Record<string, [number, number]> = {
  electricity_rate_kwh: [0.0001, 10.0],
  gpu_draw_watts: [1.0, 5000.0],
  host_overhead_watts: [0.0, 5000.0],
  live_poll_interval_s: [1.0, 60.0],
  analytics_rebuild_interval_s: [10.0, 600.0],
};

/** Dataclass defaults from config.py Config, used when a key is absent. */
export const SETTINGS_DEFAULTS: Record<string, number> = {
  electricity_rate_kwh: 0.047,
  gpu_draw_watts: 350,
  host_overhead_watts: 90,
  live_poll_interval_s: 5.0,
  analytics_rebuild_interval_s: 60.0,
};

/** serve.py HEADER — required on every write/refresh request. */
export const HEADER = "X-LLM-Telemetry";

export interface FsLike {
  existsSync(p: string): boolean;
  readFileSync(p: string, encoding: "utf8"): string;
  writeFileSync(p: string, data: string, options?: { mode?: number; flag?: string }): void;
  renameSync(from: string, to: string): void;
  mkdirSync(p: string, options?: { recursive?: boolean }): void;
  statSync(p: string): { mode: number; mtimeMs: number };
  chmodSync(p: string, mode: number): void;
  unlinkSync(p: string): void;
}

export interface SettingsEnv {
  /** Defaults to process.env. Injectable so tests can set candidate paths. */
  env?: NodeJS.ProcessEnv;
  /** Defaults to os.homedir(). */
  home?: string;
  /** Defaults to node:fs (wrapped for the parts we use). */
  fs?: FsLike;
}

const defaultFs: FsLike = {
  existsSync: fs.existsSync,
  readFileSync: (p, enc) => fs.readFileSync(p, { encoding: enc }),
  writeFileSync: (p, data, opts) => fs.writeFileSync(p, data, opts),
  renameSync: fs.renameSync,
  mkdirSync: (p, opts) => fs.mkdirSync(p, opts),
  statSync: (p) => fs.statSync(p),
  chmodSync: fs.chmodSync,
  unlinkSync: fs.unlinkSync,
};

function deps(d: SettingsEnv = {}): Required<SettingsEnv> {
  return {
    env: d.env ?? process.env,
    home: d.home ?? os.homedir(),
    fs: d.fs ?? defaultFs,
  };
}

/** Python os.path.expandvars + expanduser + abspath, for config candidates. */
export function expandPath(p: string, env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  const expanded = p.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, braced, plain) => {
    const key = braced ?? plain;
    return env[key] ?? m;
  });
  const withHome = expanded === "~" ? home : expanded.startsWith("~/") || expanded.startsWith("~\\")
    ? home + expanded.slice(1)
    : expanded;
  return path.resolve(withHome);
}

/** Python config.py `_candidate_paths()` — first hit wins, last is default. */
export function candidatePaths(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string[] {
  const out: string[] = [];
  const explicit = env["LLM_TELEMETRY_CONFIG"];
  if (explicit) out.push(expandPath(explicit, env, home));
  const xdg = env["XDG_CONFIG_HOME"];
  if (xdg) out.push(expandPath(`${xdg}/llm-telemetry/config.json`, env, home));
  out.push(expandPath("~/.config/llm-telemetry/config.json", env, home));
  return out;
}

/** serve.py `config_path()` — first existing candidate, else the default. */
export function configPath(options: SettingsEnv = {}): string {
  const d = deps(options);
  const candidates = candidatePaths(d.env, d.home);
  for (const p of candidates) {
    if (d.fs.existsSync(p)) return p;
  }
  return candidates[candidates.length - 1];
}

/** serve.py `_tilde()` — display a path below the home dir with `~`. */
export function tilde(p: string, home = os.homedir()): string {
  return p.startsWith(home + path.sep) ? "~" + p.slice(home.length) : p;
}

function readRaw(p: string, fsLike: FsLike): Record<string, unknown> {
  if (!fsLike.existsSync(p)) return {};
  const parsed: unknown = JSON.parse(fsLike.readFileSync(p, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("config file is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/** Python float(): numbers, numeric strings and bools are accepted. */
function pyFloat(v: unknown, key: string): number {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  throw new Error(`could not convert ${key} to float`);
}

/**
 * serve.py `current()` — read the config fresh from disk (never a cache) and
 * return every power-model value, falling back to config.py's defaults.
 */
export function current(resourcePath?: string, options: SettingsEnv = {}): Record<string, number> {
  const d = deps(options);
  const raw = readRaw(resourcePath || configPath(d), d.fs);
  const out: Record<string, number> = {};
  for (const key of Object.keys(SETTINGS)) {
    out[key] = Object.prototype.hasOwnProperty.call(raw, key)
      ? pyFloat(raw[key], key)
      : SETTINGS_DEFAULTS[key];
  }
  return out;
}

/** Python's `{lo:g}` formatting, used by the range error message. */
function fmtBound(n: number): string {
  return Number(n.toPrecision(6)).toString();
}

/**
 * serve.py `validate()` -> [clean dict, error or null]. Unknown keys are an
 * error rather than silently dropped, and bools are rejected explicitly.
 */
export function validate(body: unknown): [Record<string, number> | null, string | null] {
  if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).length === 0) {
    return [null, "expected a JSON object"];
  }
  const obj = body as Record<string, unknown>;
  const unknown = Object.keys(obj).filter((k) => !Object.prototype.hasOwnProperty.call(SETTINGS, k));
  if (unknown.length) {
    return [null, "unknown setting(s): " + [...new Set(unknown)].sort().join(", ")];
  }
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "boolean" || typeof value !== "number" || !Number.isFinite(value)) {
      return [null, `${key} must be a number`];
    }
    const [lo, hi] = SETTINGS[key];
    if (!(lo <= value && value <= hi)) {
      return [null, `${key} must be between ${fmtBound(lo)} and ${fmtBound(hi)}`];
    }
    out[key] = value;
  }
  return [out, null];
}

/**
 * serve.py `save()` — merge `clean` into the config file atomically. The temp
 * file lives beside the target, keeps the old file's permission bits and is
 * removed on any failure.
 */
export function save(clean: Record<string, number>, resourcePath?: string, options: SettingsEnv = {}): string {
  const d = deps(options);
  const target = resourcePath || configPath(d);
  const raw = readRaw(target, d.fs);
  const merged = { ...raw, ...clean };
  const dir = path.dirname(target) || ".";
  d.fs.mkdirSync(dir, { recursive: true });
  // Python validate() casts every accepted value to float, so json.dump()
  // writes 400 as 400.0 into the config file; mirror that exactly.
  const forWrite: Record<string, unknown> = { ...merged };
  for (const key of Object.keys(clean)) forWrite[key] = new PyFloat(clean[key]);
  const tmp = path.join(dir, `.config-${Math.random().toString(36).slice(2, 12)}.json`);
  try {
    d.fs.writeFileSync(tmp, pyDumps(forWrite, 2) + "\n", { mode: 0o600, flag: "wx" });
    if (d.fs.existsSync(target)) {
      d.fs.chmodSync(tmp, d.fs.statSync(target).mode & 0o777);
    }
    d.fs.renameSync(tmp, target);
  } catch (err) {
    if (d.fs.existsSync(tmp)) d.fs.unlinkSync(tmp);
    throw err;
  }
  return target;
}

/** Python `ipaddress.ip_address(ip).is_loopback`, without extra deps. */
export function isLoopback(ip: string | null | undefined): boolean {
  if (!ip) return false;
  const value = ip.trim().replace(/^\[|\]$/g, "");
  if (/^127(?:\.\d{1,3}){3}$/.test(value)) {
    return value.split(".").slice(1).every((part) => Number(part) <= 255);
  }
  const lower = value.toLowerCase();
  return lower === "::1" || lower === "0:0:0:0:0:0:0:1";
}

const TRUTHY_ENV_VALUES = new Set(["1", "true", "yes", "on"]);

type EnvReader = Readonly<Record<string, string | undefined>>;

/** Only an explicit truthy flag enables trust in client-supplied proxy headers. */
export function trustProxyFromEnv(env: EnvReader = process.env): boolean {
  const value = env["LLM_TELEMETRY_TRUST_PROXY"];
  return value !== undefined && TRUTHY_ENV_VALUES.has(value.trim().toLowerCase());
}

export interface PeerDeps {
  /** Direct peer used when no trusted proxy supplies a peer (loopback by default). */
  directPeer?: string | null;
  /** Trust proxy headers; false unless explicitly enabled in the environment. */
  trustProxy?: boolean;
}

/** Route-level peer deps: socket-equivalent peer plus the explicit proxy flag. */
export function peerDepsFromEnv(env: EnvReader = process.env): Required<PeerDeps> {
  const configuredPeer = env["LLM_TELEMETRY_PEER_IP"]?.trim();
  return {
    directPeer: configuredPeer || "127.0.0.1",
    trustProxy: trustProxyFromEnv(env),
  };
}

/**
 * Peer IP. Proxy headers are ignored by default: Next fills x-forwarded-for
 * only when a client did not send one, so a spoofed value must never pass a
 * loopback guard. In trusted-proxy mode the rightmost XFF hop is the proxy
 * that appended the value, so the peer is the entry immediately to its left.
 */
export function peerIp(
  headers: Headers,
  directPeer?: string | null,
  trustProxy = false,
): string | null {
  if (trustProxy) {
    const forwarded = headers.get("x-forwarded-for");
    if (forwarded) {
      const hops = forwarded.split(",").map((hop) => hop.trim()).filter(Boolean);
      const peer = hops.length >= 2 ? hops[hops.length - 2] : undefined;
      if (peer) return peer;
    }
    const real = headers.get("x-real-ip")?.trim();
    if (real) return real;
  }
  return directPeer ?? null;
}

/** Marker for values Python's json.dumps writes as floats (5 -> 5.0). */
export class PyFloat {
  constructor(readonly value: number) {}
}

export function pyFloatMap(values: Record<string, number>): Record<string, PyFloat> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, new PyFloat(v)]));
}

function pyString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20 || code > 0x7f) {
      if (code <= 0xffff) {
        out += "\\u" + code.toString(16).padStart(4, "0");
      } else {
        const v = code - 0x10000;
        out += "\\u" + (0xd800 + (v >> 10)).toString(16).padStart(4, "0");
        out += "\\u" + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, "0");
      }
    } else out += ch;
  }
  return out + '"';
}

/** JSON serialization matching Python's json.dumps(obj) defaults. */
function dump(value: unknown, level: number, indent: number): string {
  if (value instanceof PyFloat) {
    return Number.isInteger(value.value) ? value.value.toFixed(1) : String(value.value);
  }
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return pyString(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    if (!indent || value.length === 0) {
      return "[" + value.map((v) => dump(v, level, indent)).join(", ") + "]";
    }
    const pad = " ".repeat((level + 1) * indent);
    return "[\n" + value.map((v) => pad + dump(v, level + 1, indent)).join(",\n") +
      "\n" + " ".repeat(level * indent) + "]";
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!indent || entries.length === 0) {
      return "{" + entries.map(([k, v]) => `${pyString(k)}: ${dump(v, level, indent)}`).join(", ") + "}";
    }
    const pad = " ".repeat((level + 1) * indent);
    return "{\n" + entries.map(([k, v]) => `${pad}${pyString(k)}: ${dump(v, level + 1, indent)}`).join(",\n") +
      "\n" + " ".repeat(level * indent) + "}";
  }
  return "null";
}

export function pyDumps(value: unknown, indent = 0): string {
  return dump(value, 0, indent);
}

/** serve.py NoCacheHandler._json() plus its no-store end_headers(). */
export function pyJsonResponse(status: number, obj: unknown): Response {
  return new Response(pyDumps(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

export function parseContentLength(value: string | null): number {
  if (!value) return 0;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

export interface SettingsRequestDeps extends SettingsEnv, PeerDeps {
  /** Fully overrides peer derivation, for tests and the parity harness. */
  peer?: (request: Request) => string | null | undefined;
}

function requestPeer(request: Request, d: SettingsRequestDeps): string | null {
  if (d.peer) return d.peer(request) ?? null;
  const envDeps = peerDepsFromEnv(d.env ?? process.env);
  return peerIp(
    request.headers,
    d.directPeer === undefined ? envDeps.directPeer : d.directPeer,
    d.trustProxy ?? envDeps.trustProxy,
  );
}

/** GET /api/settings: always 200; `writable` mirrors the loopback guard. */
export function handleSettingsGet(request: Request, d: SettingsRequestDeps = {}): Response {
  return pyJsonResponse(200, {
    values: pyFloatMap(current(undefined, d)),
    config_file: tilde(configPath(d), d.home),
    writable: isLoopback(requestPeer(request, d)),
  });
}

/** POST /api/settings: the guard/header/content-type/size checks and write. */
export async function handleSettingsPost(request: Request, d: SettingsRequestDeps = {}): Promise<Response> {
  if (!isLoopback(requestPeer(request, d))) {
    return pyJsonResponse(403, { error: "settings can only be changed from this machine" });
  }
  if (request.headers.get(HEADER) !== "1") {
    return pyJsonResponse(403, { error: `missing ${HEADER} header` });
  }
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return pyJsonResponse(415, { error: "expected application/json" });
  }
  const n = parseContentLength(request.headers.get("content-length"));
  if (n > 4096) return pyJsonResponse(413, { error: "body too large" });
  let body: unknown = null;
  try {
    const text = await request.text();
    body = text === "" ? null : JSON.parse(text);
  } catch {
    return pyJsonResponse(400, { error: "body is not valid JSON" });
  }
  const [clean, err] = validate(body);
  if (err || clean === null) return pyJsonResponse(400, { error: err ?? "expected a JSON object" });
  try {
    const savedPath = save(clean, undefined, d);
    return pyJsonResponse(200, {
      saved: pyFloatMap(clean),
      config_file: tilde(savedPath, d.home),
      values: pyFloatMap(current(savedPath, d)),
    });
  } catch (e) {
    return pyJsonResponse(500, { error: `could not write config: ${e instanceof Error ? e.message : String(e)}` });
  }
}
