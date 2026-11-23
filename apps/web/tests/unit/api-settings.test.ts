// @vitest-environment node
/**
 * T-19 (LLMTELEMET-290): hermetic tests for the serve.py settings port.
 * Every file access stays inside a fresh temp directory; no service is used.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  HEADER,
  candidatePaths,
  configPath,
  current,
  handleSettingsGet,
  handleSettingsPost,
  save,
  tilde,
  validate,
} from "../../lib/api/settings";

let root: string;
let cfg: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lst-290-settings-"));
  cfg = join(root, "config.json");
  env = { HOME: root, LLM_TELEMETRY_CONFIG: cfg, NODE_ENV: "test" as const };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function request(init: RequestInit = {}, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/settings", {
    ...init,
    headers: { ...headers },
  });
}

function jsonPost(body: string, extra: Record<string, string> = {}, length = body.length): Request {
  return request(
    { method: "POST", body },
    {
      "content-type": "application/json",
      "content-length": String(length),
      [HEADER]: "1",
      ...extra,
    },
  );
}

describe("validate() — serve.py parity", () => {
  it("rejects non-objects and empty objects with the same message", () => {
    for (const body of [null, "text", [], 42, {}]) {
      expect(validate(body)).toEqual([null, "expected a JSON object"]);
    }
  });

  it("rejects unknown keys in sorted order, including duplicates", () => {
    expect(validate({ zeta: 1, alpha: 2, gpu_draw_watts: 350 })).toEqual([
      null,
      "unknown setting(s): alpha, zeta",
    ]);
  });

  it("rejects booleans, strings and nulls as numbers", () => {
    expect(validate({ gpu_draw_watts: true })).toEqual([null, "gpu_draw_watts must be a number"]);
    expect(validate({ gpu_draw_watts: "350" })).toEqual([null, "gpu_draw_watts must be a number"]);
    expect(validate({ gpu_draw_watts: null })).toEqual([null, "gpu_draw_watts must be a number"]);
  });

  it("uses Python's :g bounds in range errors", () => {
    expect(validate({ electricity_rate_kwh: 0 })).toEqual([
      null, "electricity_rate_kwh must be between 0.0001 and 10",
    ]);
    expect(validate({ live_poll_interval_s: 61 })).toEqual([
      null, "live_poll_interval_s must be between 1 and 60",
    ]);
    expect(validate({ analytics_rebuild_interval_s: 9 })).toEqual([
      null, "analytics_rebuild_interval_s must be between 10 and 600",
    ]);
  });

  it("accepts a partial update and keeps values as numbers", () => {
    expect(validate({ gpu_draw_watts: 400, electricity_rate_kwh: 0.1 })).toEqual([
      { gpu_draw_watts: 400, electricity_rate_kwh: 0.1 },
      null,
    ]);
  });
});

describe("config candidates, tilde and current()", () => {
  it("selects the first existing candidate, then the default location", () => {
    const xdg = join(root, "xdg");
    mkdirSync(xdg);
    const xdgCfg = join(xdg, "llm-telemetry", "config.json");
    mkdirSync(join(xdg, "llm-telemetry"));
    writeFileSync(xdgCfg, "{}");
    const localEnv = { HOME: root, XDG_CONFIG_HOME: xdg, NODE_ENV: "test" as const };
    expect(candidatePaths(localEnv, root)).toEqual([
      xdgCfg,
      join(root, ".config/llm-telemetry/config.json"),
    ]);
    expect(configPath({ env: localEnv, home: root })).toBe(xdgCfg);
    writeFileSync(cfg, "{}");
    expect(configPath({ env: { ...localEnv, LLM_TELEMETRY_CONFIG: cfg }, home: root })).toBe(cfg);
  });

  it("renders paths under the home dir with a tilde", () => {
    expect(tilde(join(root, ".config/llm-telemetry/config.json"), root)).toBe(
      "~/.config/llm-telemetry/config.json",
    );
    expect(tilde("/etc/config.json", root)).toBe("/etc/config.json");
  });

  it("reads config.py defaults, then fresh values from disk", () => {
    const localEnv = { HOME: root, LLM_TELEMETRY_CONFIG: cfg, NODE_ENV: "test" as const };
    expect(current(undefined, { env: localEnv, home: root })).toEqual({
      electricity_rate_kwh: 0.047,
      gpu_draw_watts: 350,
      host_overhead_watts: 90,
      live_poll_interval_s: 5,
      analytics_rebuild_interval_s: 60,
    });
    writeFileSync(cfg, JSON.stringify({ gpu_draw_watts: 410, electricity_rate_kwh: "0.2", unrelated: "kept" }));
    expect(current(undefined, { env: localEnv, home: root }).gpu_draw_watts).toBe(410);
    expect(current(undefined, { env: localEnv, home: root }).electricity_rate_kwh).toBe(0.2);
  });

  it("rejects a config file that is not a JSON object", () => {
    writeFileSync(cfg, "[]");
    expect(() => current(undefined, { env, home: root })).toThrow("config file is not a JSON object");
  });
});

describe("save() — atomic merge and mode preservation", () => {
  it("merges without dropping other keys and preserves permission bits", () => {
    writeFileSync(cfg, JSON.stringify({ profiles: [], electricity_rate_kwh: 0.05, port: 8477 }));
    chmodSync(cfg, 0o640);
    const result = save({ gpu_draw_watts: 400 }, cfg, { env, home: root });
    expect(result).toBe(cfg);
    expect(JSON.parse(readFileSync(cfg, "utf8"))).toEqual({
      profiles: [],
      electricity_rate_kwh: 0.05,
      port: 8477,
      gpu_draw_watts: 400,
    });
    expect(statSync(cfg).mode & 0o777).toBe(0o640);
    expect(readdirSync(root).filter((n) => n.startsWith(".config-"))).toEqual([]);
  });

  it("creates missing parent directories and writes a trailing newline", () => {
    const nested = join(root, "nested", "config.json");
    save({ live_poll_interval_s: 2 }, nested, { env, home: root });
    expect(existsSync(nested)).toBe(true);
    expect(readFileSync(nested, "utf8").endsWith("\n")).toBe(true);
  });
});

describe("GET /api/settings", () => {
  it("reports values, config_file and loopback writability", async () => {
    writeFileSync(cfg, JSON.stringify({ electricity_rate_kwh: 0.1 }));
    const res = handleSettingsGet(request(), { env, home: root });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store, no-cache, must-revalidate, max-age=0");
    expect(await res.json()).toEqual({
      values: {
        electricity_rate_kwh: 0.1,
        gpu_draw_watts: 350,
        host_overhead_watts: 90,
        live_poll_interval_s: 5,
        analytics_rebuild_interval_s: 60,
      },
      config_file: "~/config.json",
      writable: true,
    });
  });

  it("uses x-forwarded-for first hop, then x-real-ip, for peer writability", async () => {
    const cases: Array<[Record<string, string>, boolean]> = [
      [{ "x-forwarded-for": "203.0.113.9, 127.0.0.1" }, false],
      [{ "x-real-ip": "203.0.113.9" }, false],
      [{ "x-forwarded-for": "::1" }, true],
      [{ "x-forwarded-for": "127.0.0.1", "x-real-ip": "203.0.113.9" }, true],
    ];
    for (const [extra, writable] of cases) {
      const res = handleSettingsGet(request({}, extra), { env, home: root });
      expect((await res.json() as { writable: boolean }).writable).toBe(writable);
    }
  });
});

describe("POST /api/settings", () => {
  it("keeps the loopback guard and required header", async () => {
    const remote = await handleSettingsPost(jsonPost("{}", { "x-forwarded-for": "203.0.113.4" }), { env, home: root });
    expect(remote.status).toBe(403);
    expect(await remote.json()).toEqual({ error: "settings can only be changed from this machine" });

    const noHeader = await handleSettingsPost(
      request({ method: "POST", body: "{}" }, { "content-type": "application/json", "content-length": "2" }),
      { env, home: root },
    );
    expect(noHeader.status).toBe(403);
    expect(await noHeader.json()).toEqual({ error: "missing X-LLM-Telemetry header" });
  });

  it("enforces content type, body size and JSON validity", async () => {
    const wrongType = await handleSettingsPost(
      request({ method: "POST", body: "{}" }, { "content-type": "text/plain", "content-length": "2", [HEADER]: "1" }),
      { env, home: root },
    );
    expect(wrongType.status).toBe(415);
    expect(await wrongType.json()).toEqual({ error: "expected application/json" });

    const large = await handleSettingsPost(jsonPost("{}", {}, 4097), { env, home: root });
    expect(large.status).toBe(413);
    expect(await large.json()).toEqual({ error: "body too large" });

    const broken = await handleSettingsPost(jsonPost("{oops"), { env, home: root });
    expect(broken.status).toBe(400);
    expect(await broken.json()).toEqual({ error: "body is not valid JSON" });
  });

  it("saves a validated merge and returns saved/config_file/values", async () => {
    writeFileSync(cfg, JSON.stringify({ port: 8477, electricity_rate_kwh: 0.06 }));
    const res = await handleSettingsPost(jsonPost('{"gpu_draw_watts":400}'), { env, home: root });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      saved: { gpu_draw_watts: 400 },
      config_file: "~/config.json",
      values: {
        electricity_rate_kwh: 0.06,
        gpu_draw_watts: 400,
        host_overhead_watts: 90,
        live_poll_interval_s: 5,
        analytics_rebuild_interval_s: 60,
      },
    });
    expect(JSON.parse(readFileSync(cfg, "utf8")).port).toBe(8477);
  });

  it("returns 500 when the config file is not an object", async () => {
    writeFileSync(cfg, "[]");
    const res = await handleSettingsPost(jsonPost('{"gpu_draw_watts":400}'), { env, home: root });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "could not write config: config file is not a JSON object" });
  });
});
