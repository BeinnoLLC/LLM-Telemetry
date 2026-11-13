import * as fs from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Config,
  autodiscoverProfiles,
  candidatePaths,
  expand,
  load,
  resolveAgentHome,
  resolveNodeReportsDir,
  resolveProfiles,
} from "../../src/config.js";
import { makeTmpDir } from "./helpers.js";

describe("config port (parity with src/llm_telemetry/config.py)", () => {
  let dir: string;
  const saved: Record<string, string | undefined> = {};

  function setEnv(name: string, value: string | undefined): void {
    if (!(name in saved)) saved[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  beforeEach(() => {
    dir = makeTmpDir("config-");
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
      delete saved[name];
    }
  });

  it("resolution order: LLM_TELEMETRY_CONFIG, XDG, ~/.config, defaults", () => {
    setEnv("LLM_TELEMETRY_CONFIG", "/explicit/config.json");
    setEnv("XDG_CONFIG_HOME", "/xdg");
    const paths = candidatePaths();
    expect(paths[0]).toBe("/explicit/config.json");
    expect(paths[1]).toBe("/xdg/llm-telemetry/config.json");
    expect(paths[2]).toContain("/.config/llm-telemetry/config.json");
  });

  it("loads an explicit config file with expanded paths and merged profiles", () => {
    const home = join(dir, "agent-home");
    fs.mkdirSync(join(home, "profiles", "named"), { recursive: true });
    fs.writeFileSync(join(home, "state.db"), "");
    fs.writeFileSync(join(home, "profiles", "named", "state.db"), "");
    const cfgPath = join(dir, "config.json");
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({
        reports_dir: "~/node-test-reports",
        agent_home: home,
        profiles: [{ name: "configured", home: join(dir, "configured-home") }],
        port: 9999,
      }),
    );
    setEnv("LLM_TELEMETRY_AGENT_HOME", undefined);

    const cfg = load(cfgPath);
    expect(cfg.reports_dir).toBe(expand("~/node-test-reports"));
    expect(cfg.port).toBe(9999);
    // configured wins its name; discovered "default"/"named" are appended
    // in autodiscovery order (root home first, then sorted profiles/*).
    expect(cfg.profiles.map((p) => p.name)).toEqual(["configured", "default", "named"]);
    expect(cfg.resolution.mode).toBe("merged");
    expect(cfg.resolution.config_file).toBe(cfgPath);
  });

  it("autodiscovers the root default profile and profiles/* (state.db only)", () => {
    const home = join(dir, "home");
    fs.mkdirSync(join(home, "profiles", "research"), { recursive: true });
    fs.mkdirSync(join(home, "profiles", "stray"), { recursive: true });
    fs.writeFileSync(join(home, "state.db"), "");
    fs.writeFileSync(join(home, "profiles", "research", "state.db"), "");
    const found = autodiscoverProfiles(home);
    // sorted profiles/ listing + root default appended first; the stale
    // profiles/default stub rule and stray dirs are excluded.
    expect(found.map((p) => p.name)).toEqual(["default", "research"]);
    expect(found[0]!.db).toBe(join(home, "state.db"));
  });

  it("profiles/default is a skipped stale stub when the root home has state.db", () => {
    const home = join(dir, "home2");
    fs.mkdirSync(join(home, "profiles", "default"), { recursive: true });
    fs.writeFileSync(join(home, "state.db"), "");
    fs.writeFileSync(join(home, "profiles", "default", "state.db"), "");
    expect(autodiscoverProfiles(home).map((p) => p.name)).toEqual(["default"]);
  });

  it("resolveProfiles honours explicit-empty and exclude (P5-01/02)", () => {
    const home = join(dir, "home3");
    fs.mkdirSync(join(home, "profiles", "a"), { recursive: true });
    fs.mkdirSync(join(home, "profiles", "b"), { recursive: true });
    fs.writeFileSync(join(home, "profiles", "a", "state.db"), "");
    fs.writeFileSync(join(home, "profiles", "b", "state.db"), "");

    const empty = resolveProfiles([], home);
    expect(empty.profiles).toEqual([]);
    expect(empty.report.mode).toBe("explicit-empty");

    const discovered = resolveProfiles(null, home);
    expect(discovered.report.mode).toBe("discovered");
    expect(discovered.profiles.map((p) => p.name)).toEqual(["a", "b"]);

    const excluded = resolveProfiles(null, home, ["b"]);
    expect(excluded.profiles.map((p) => p.name)).toEqual(["a"]);
    expect(excluded.report.excluded).toEqual([
      { name: "b", reason: "listed in config exclude" },
    ]);
  });

  it("agent home precedence: env > config > ~/.hermes", () => {
    setEnv("LLM_TELEMETRY_AGENT_HOME", "/from-env");
    expect(resolveAgentHome("/from-config")).toBe("/from-env");
    setEnv("LLM_TELEMETRY_AGENT_HOME", undefined);
    expect(resolveAgentHome("/from-config")).toBe("/from-config");
    expect(resolveAgentHome(null)).toContain("/.hermes");
  });

  it("node output dir: env > config > the non-production reports-node default", () => {
    setEnv("LLM_TELEMETRY_NODE_REPORTS_DIR", "/from-env");
    expect(resolveNodeReportsDir(new Config())).toBe("/from-env");
    setEnv("LLM_TELEMETRY_NODE_REPORTS_DIR", undefined);

    const cfg = new Config();
    cfg.node_reports_dir = "/from-config";
    expect(resolveNodeReportsDir(cfg)).toBe("/from-config");

    const def = resolveNodeReportsDir(new Config());
    expect(def.endsWith("/llm-telemetry/reports-node")).toBe(true);
    expect(def).not.toBe(new Config().reports_dir); // never the Python default
  });

  it("expand keeps UNSET env vars literal (os.path.expandvars parity)", () => {
    // Python's expandvars leaves an undefined variable as literal text; a
    // naive empty-string substitution silently redirects "$TYPO/reports" to
    // the absolute "/reports".
    setEnv("LLM_TELEMETRY_TEST_UNSET_EXPAND", undefined);
    expect(expand("$LLM_TELEMETRY_TEST_UNSET_EXPAND/reports")).toContain(
      "$LLM_TELEMETRY_TEST_UNSET_EXPAND/reports",
    );
    expect(expand("${LLM_TELEMETRY_TEST_UNSET_EXPAND}/reports")).toContain(
      "${LLM_TELEMETRY_TEST_UNSET_EXPAND}/reports",
    );
    setEnv("LLM_TELEMETRY_TEST_UNSET_EXPAND", "/resolved");
    expect(expand("$LLM_TELEMETRY_TEST_UNSET_EXPAND/reports")).toBe("/resolved/reports");
  });

  it("python reports_dir default resolves identically (migration plan §14.6)", () => {
    expect(new Config().reports_dir).toBe(expand("~/.local/share/llm-telemetry/reports"));
    const cfg = load(join(dir, "missing-config.json")); // falls through to defaults
    expect(cfg.reports_dir).toBe(expand("~/.local/share/llm-telemetry/reports"));
  });
});
