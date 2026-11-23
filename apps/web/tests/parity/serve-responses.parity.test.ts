// @vitest-environment node
/**
 * T-19 (LLMTELEMET-290) response-diff harness.
 *
 * For every case, drive the REAL Python `serve.py` handler through
 * `serve_oracle.py` and the TypeScript route logic with the same temp fixture,
 * then compare status, decoded JSON body, resulting config file and refresh
 * state. Python interpreter discovery follows the collectors' resolvePython
 * pattern ($LLM_TELEMETRY_PARITY_PYTHON, then <main-repo>/.venv/bin/python).
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { HEADER, handleSettingsGet, handleSettingsPost } from "../../lib/api/settings";
import { REFRESH, handleRefreshPost, resetRefresh } from "../../lib/api/refresh";
import { resolvePython } from "./python";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, "..", "..");
const REPO_ROOT = resolve(WEB_ROOT, "..", "..");
const SRC = join(REPO_ROOT, "src");
const ORACLE = join(HERE, "serve_oracle.py");
const STAMP = 1714975689; // fixed mtime for generated_at parity

const python = resolvePython(WEB_ROOT);

type Route = "settings_get" | "settings_post" | "refresh_post";

interface Case {
  name: string;
  route: Route;
  configLocation?: "explicit" | "xdg" | "default";
  configRaw?: string | null;
  configMode?: number;
  dashboard?: boolean;
  peer?: string;
  headers?: Record<string, string>;
  body?: string;
  now: number;
  refresh?: { pid: number | null; started: number; last_result: string | null; last_at: number | null };
  spawnPid?: number;
  spawnError?: string;
  alivePids?: number[];
}

const BASE_REFRESH = { pid: null, started: 0, last_result: null, last_at: null } as const;

const CASES: Case[] = [
  { name: "settings_get_defaults", route: "settings_get", configLocation: "default", now: 100 },
  {
    name: "settings_get_existing_xdg",
    route: "settings_get",
    configLocation: "xdg",
    configRaw: JSON.stringify({
      electricity_rate_kwh: 0.08,
      gpu_draw_watts: 420,
      host_overhead_watts: 95,
      live_poll_interval_s: 4,
      analytics_rebuild_interval_s: 90,
      unrelated: "keep",
    }) + "\n",
    configMode: 0o600,
    now: 100,
  },
  {
    name: "settings_post_success_merge",
    route: "settings_post",
    configLocation: "explicit",
    configRaw: JSON.stringify({ port: 8477, electricity_rate_kwh: 0.06 }) + "\n",
    configMode: 0o640,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": "29",
      [HEADER]: "1",
    },
    body: '{"gpu_draw_watts":400,"host_overhead_watts":91}',
    now: 100,
  },
  {
    name: "settings_post_empty_object",
    route: "settings_post",
    configLocation: "explicit",
    configRaw: "{}\n",
    headers: { "Content-Type": "application/json", "Content-Length": "2", [HEADER]: "1" },
    body: "{}",
    now: 100,
  },
  {
    name: "settings_post_unknown_keys_sorted",
    route: "settings_post",
    configLocation: "explicit",
    configRaw: "{}\n",
    headers: { "Content-Type": "application/json", "Content-Length": "28", [HEADER]: "1" },
    body: '{"zeta":1,"alpha":2,"mid":3}',
    now: 100,
  },
  {
    name: "settings_post_bool_rejected",
    route: "settings_post",
    configLocation: "explicit",
    configRaw: "{}\n",
    headers: { "Content-Type": "application/json", "Content-Length": "25", [HEADER]: "1" },
    body: '{"gpu_draw_watts":true}',
    now: 100,
  },
  {
    name: "settings_post_range_error",
    route: "settings_post",
    configLocation: "explicit",
    configRaw: "{}\n",
    headers: { "Content-Type": "application/json", "Content-Length": "28", [HEADER]: "1" },
    body: '{"live_poll_interval_s":61}',
    now: 100,
  },
  {
    name: "settings_post_invalid_json",
    route: "settings_post",
    configLocation: "explicit",
    configRaw: "{}\n",
    headers: { "Content-Type": "application/json", "Content-Length": "5", [HEADER]: "1" },
    body: "{oops",
    now: 100,
  },
  {
    name: "settings_post_wrong_content_type",
    route: "settings_post",
    configLocation: "explicit",
    configRaw: "{}\n",
    headers: { "Content-Type": "text/plain", "Content-Length": "2", [HEADER]: "1" },
    body: "{}",
    now: 100,
  },
  {
    name: "settings_post_body_too_large",
    route: "settings_post",
    configLocation: "explicit",
    configRaw: "{}\n",
    headers: { "Content-Type": "application/json", "Content-Length": "4097", [HEADER]: "1" },
    body: "{}",
    now: 100,
  },
  {
    name: "settings_post_missing_header",
    route: "settings_post",
    configLocation: "explicit",
    configRaw: "{}\n",
    headers: { "Content-Type": "application/json", "Content-Length": "2" },
    body: "{}",
    now: 100,
  },
  {
    name: "settings_post_remote_guard",
    route: "settings_post",
    configLocation: "explicit",
    configRaw: "{}\n",
    headers: { "Content-Type": "application/json", "Content-Length": "2", [HEADER]: "1" },
    peer: "203.0.113.4",
    body: "{}",
    now: 100,
  },
  {
    name: "refresh_start",
    route: "refresh_post",
    configLocation: "explicit",
    configRaw: "{}\n",
    dashboard: true,
    headers: { "Content-Length": "0", [HEADER]: "1" },
    body: "",
    now: 100,
    spawnPid: 4242,
  },
  {
    name: "refresh_running",
    route: "refresh_post",
    configLocation: "explicit",
    configRaw: "{}\n",
    dashboard: true,
    headers: { "Content-Length": "0", [HEADER]: "1" },
    body: "",
    now: 103,
    refresh: { pid: 4242, started: 100, last_result: null, last_at: null },
    alivePids: [4242],
  },
  {
    name: "refresh_debounced",
    route: "refresh_post",
    configLocation: "explicit",
    configRaw: "{}\n",
    headers: { "Content-Length": "0", [HEADER]: "1" },
    body: "",
    now: 105,
    refresh: { pid: 4242, started: 100, last_result: "prior build ok", last_at: 98 },
    alivePids: [],
  },
  {
    name: "refresh_spawn_failure",
    route: "refresh_post",
    configLocation: "explicit",
    configRaw: "{}\n",
    headers: { "Content-Length": "0", [HEADER]: "1" },
    body: "",
    now: 100,
    spawnError: "boom",
  },
  {
    name: "refresh_remote_guard",
    route: "refresh_post",
    configLocation: "explicit",
    configRaw: "{}\n",
    headers: { "Content-Length": "0", [HEADER]: "1" },
    peer: "203.0.113.4",
    body: "",
    now: 100,
  },
  {
    name: "refresh_missing_header",
    route: "refresh_post",
    configLocation: "explicit",
    configRaw: "{}\n",
    headers: { "Content-Length": "0" },
    body: "",
    now: 100,
  },
  {
    name: "refresh_body_too_large",
    route: "refresh_post",
    configLocation: "explicit",
    configRaw: "{}\n",
    headers: { "Content-Length": "1025", [HEADER]: "1" },
    body: "",
    now: 100,
  },
];

interface Fixture {
  home: string;
  reportsDir: string;
  cfgPath: string;
  env: Record<string, string>;
}

function fixture(c: Case): Fixture {
  const home = mkdtempSync(join(tmpdir(), "lst-290-parity-"));
  const env: Record<string, string> = { HOME: home, NODE_ENV: "test" };
  const location = c.configLocation ?? "default";
  let cfgPath: string;
  if (location === "explicit") {
    cfgPath = join(home, "config.json");
    env["LLM_TELEMETRY_CONFIG"] = cfgPath;
  } else if (location === "xdg") {
    const xdg = join(home, "xdg");
    cfgPath = join(xdg, "llm-telemetry", "config.json");
    env["XDG_CONFIG_HOME"] = xdg;
  } else {
    cfgPath = join(home, ".config", "llm-telemetry", "config.json");
  }
  if (c.configRaw !== undefined && c.configRaw !== null) {
    mkdirSync(dirname(cfgPath), { recursive: true });
    writeFileSync(cfgPath, c.configRaw);
    chmodSync(cfgPath, c.configMode ?? 0o644);
  }
  const reportsDir = join(home, "reports");
  mkdirSync(reportsDir, { recursive: true });
  if (c.dashboard) {
    const html = join(reportsDir, "dashboard.html");
    writeFileSync(html, "<html>parity</html>");
    utimesSync(html, STAMP, STAMP);
  }
  return { home, reportsDir, cfgPath, env };
}

/** Declared lengths in the cases are only meaningful for the 413 tests. */
function headersFor(c: Case): Record<string, string> {
  const headers = { ...(c.headers ?? {}) };
  if (!c.name.endsWith("_too_large")) {
    headers["Content-Length"] = String(Buffer.byteLength(c.body ?? ""));
  }
  return headers;
}

function spec(c: Case, f: Fixture): Record<string, unknown> {
  return {
    route: c.route,
    peer: c.peer ?? "127.0.0.1",
    path: c.route === "refresh_post" ? "/api/refresh" : "/api/settings",
    headers: headersFor(c),
    body: c.body ?? "",
    now: c.now,
    env: f.env,
    reportsDir: f.reportsDir,
    refresh: c.refresh ?? BASE_REFRESH,
    spawnPid: c.spawnPid ?? 4242,
    spawnError: c.spawnError ?? null,
    alivePids: c.alivePids ?? [],
  };
}

function runOracle(py: string, c: Case, f: Fixture): Record<string, unknown> {
  const specPath = join(f.home, "oracle-spec.json");
  writeFileSync(specPath, JSON.stringify(spec(c, f)));
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv["LLM_TELEMETRY_CONFIG"];
  delete childEnv["XDG_CONFIG_HOME"];
  Object.assign(childEnv, f.env);
  const res = spawnSync(py, [ORACLE, SRC, specPath], {
    cwd: WEB_ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env: childEnv,
  });
  if (res.error) throw new Error(`${c.name}: oracle did not run: ${String(res.error)}`);
  if (res.status !== 0) {
    throw new Error(`${c.name}: oracle failed (${String(res.status)}): ${res.stderr.trim() || res.stdout.trim()}`);
  }
  const out = JSON.parse(res.stdout) as { status: number; body: unknown; raw: string; extra: Record<string, unknown> };
  out.extra.spawn_calls = (out.extra.spawn_calls as string[][]).map((cmd) => cmd.slice(1));
  return out;
}

function normalize(value: unknown, home: string): unknown {
  if (typeof value === "string") return value.split(home).join("<HOME>");
  if (Array.isArray(value)) return value.map((v) => normalize(v, home));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, home)]));
  }
  return value;
}

async function runNode(c: Case, f: Fixture, py: string): Promise<Record<string, unknown>> {
  resetRefresh();
  Object.assign(REFRESH, c.refresh ?? BASE_REFRESH);
  const spawnCalls: string[][] = [];
  const starter = vi.fn((cmd: string[]) => {
    spawnCalls.push(cmd.slice(1));
    if (c.spawnError) throw new Error(c.spawnError);
    return { pid: c.spawnPid ?? 4242, unref: () => undefined };
  });
  const deps = {
    env: f.env as NodeJS.ProcessEnv,
    home: f.home,
    directPeer: c.peer ?? "127.0.0.1",
    peer: () => c.peer ?? "127.0.0.1",
    reportsDir: f.reportsDir,
    now: () => c.now,
    alive: (pid: number) => (c.alivePids ?? []).includes(pid),
    starter,
    python: py,
  };
  const url = `http://localhost${c.route === "refresh_post" ? "/api/refresh" : "/api/settings"}`;
  const request = new Request(url, {
    method: c.route === "settings_get" ? "GET" : "POST",
    headers: headersFor(c),
    ...(c.route === "settings_get" ? {} : { body: c.body ?? "" }),
  });
  const response = c.route === "settings_get"
    ? handleSettingsGet(request, deps)
    : c.route === "settings_post"
      ? await handleSettingsPost(request, deps)
      : await handleRefreshPost(request, deps);
  const mode = existsSync(f.cfgPath) ? statSync(f.cfgPath).mode & 0o777 : null;
  const raw = await response.text();
  return {
    status: response.status,
    body: JSON.parse(raw) as unknown,
    raw,
    extra: {
      config_path: f.cfgPath,
      spawn_calls: spawnCalls,
      mode,
      raw: existsSync(f.cfgPath) ? readFileSync(f.cfgPath, "utf8") : null,
      refresh: { ...REFRESH },
    },
  };
}

describe.runIf(python !== null)("serve.py response parity (status + JSON + file state)", () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const pyFixture = fixture(c);
      const tsFixture = fixture(c);
      try {
        const pyOut = runOracle(python as string, c, pyFixture);
        const tsOut = await runNode(c, tsFixture, python as string);
        expect(normalize(tsOut, tsFixture.home)).toEqual(normalize(pyOut, pyFixture.home));
      } finally {
        rmSync(pyFixture.home, { recursive: true, force: true });
        rmSync(tsFixture.home, { recursive: true, force: true });
      }
    });
  }
});

describe.skipIf(python !== null)("serve.py response parity", () => {
  it("requires an interpreter with llm_telemetry (set LLM_TELEMETRY_PARITY_PYTHON)", () => {
    expect(python).not.toBeNull();
  });
});
