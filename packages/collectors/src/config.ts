/** Runtime configuration — T-4 (LST-283) port of src/llm_telemetry/config.py.
 *
 * Faithful port of the resolution rules so both stacks resolve THIS machine
 * identically (docs/plans/node-nextjs-migration.md §14.6, T-4 acceptance):
 *
 *   1. $LLM_TELEMETRY_CONFIG                     — explicit path, for tests/CI
 *   2. $XDG_CONFIG_HOME/llm-telemetry/config.json
 *   3. ~/.config/llm-telemetry/config.json
 *   4. built-in defaults + autodiscovery
 *
 * Two deliberate differences from the Python module:
 *
 * - Construction resolves `reports_dir` but does NOT mkdir it. The Python
 *   Config.__post_init__ creates the (production) reports dir as a side effect
 *   of merely loading config; a test/CI run of the Node stack must never create
 *   or touch production paths. The writer creates its own output dir.
 * - `node_reports_dir` (config key / LLM_TELEMETRY_NODE_REPORTS_DIR) selects
 *   where the NODE artifacts go. Default is `…/reports-node`, a
 *   non-production path: during the overlap the Node collectors write beside
 *   the Python artifacts and NEVER over them (single-writer rule, plan §13).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import { isAbsolute, resolve as resolvePath } from "node:path";

export function expand(p: string): string {
  // os.path.expanduser + os.path.expandvars + os.path.abspath, in that order.
  const home = os.homedir();
  let out = p.replace(/^~(?=$|[/\\])/, home);
  out = out.replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, braced, bare) => {
    const name = (braced ?? bare) as string;
    const val = process.env[name];
    // os.path.expandvars parity: an UNSET variable stays literal. Substituting
    // "" (the naive port) silently redirects e.g. "$TYPO/reports" to the
    // absolute "/reports"; Python leaves the literal text in place.
    return val === undefined ? m : val;
  });
  return isAbsolute(out) ? resolvePath(out) : resolvePath(process.cwd(), out);
}

export interface ProfileSpec {
  name: string;
  home: string;
}

export class Profile {
  name: string;
  home: string;

  constructor(name: string, home: string) {
    this.name = name;
    this.home = expand(home);
  }

  /** `home` is the profile root, NOT the database path — collectors derive
   * state.db, config.yaml and logs/errors.log from it (same as Python). */
  get db(): string {
    return resolvePath(this.home, "state.db");
  }

  get config(): string {
    return resolvePath(this.home, "config.yaml");
  }

  get errorsLog(): string {
    return resolvePath(this.home, "logs", "errors.log");
  }

  exists(): boolean {
    return fs.existsSync(this.db);
  }
}

export interface ResolutionReport {
  agent_home: string;
  discovered: string[];
  configured: string[];
  excluded: { name: string; reason: string }[];
  failed: unknown[];
  mode: string;
  config_file?: string | null;
}

export interface ConfigDict {
  profiles: ProfileSpec[];
  inference_endpoints: string[];
  local_host_patterns: string[];
  reports_dir: string;
  endpoint_aliases: Record<string, string>;
  port: number;
  bind: string;
  electricity_rate_kwh: number;
  gpu_draw_watts: number;
  host_overhead_watts: number;
  live_poll_interval_s: number;
  analytics_rebuild_interval_s: number;
  agent_home: string;
  exclude: string[];
  resolution: Record<string, unknown>;
  node_reports_dir: string;
}

const LOCAL_HOST_PATTERNS = [
  "127.0.0.1", "localhost", "::1",
  "192.168.", "10.", "172.16.", "172.17.", "172.18.", "172.19.",
  "172.2", "172.30.", "172.31.", ".local", ".internal", ".lan",
];

export class Config {
  profiles: Profile[] = [];
  inference_endpoints: string[] = [];
  local_host_patterns: string[] = [...LOCAL_HOST_PATTERNS];
  reports_dir = expand("~/.local/share/llm-telemetry/reports");
  endpoint_aliases: Record<string, string> = {};
  port = 8477;
  bind = "0.0.0.0";
  electricity_rate_kwh = 0.047;
  gpu_draw_watts = 350;
  host_overhead_watts = 90;
  live_poll_interval_s = 5.0;
  analytics_rebuild_interval_s = 60.0;
  agent_home = "";
  exclude: string[] = [];
  resolution: ResolutionReport = {
    agent_home: "", discovered: [], configured: [], excluded: [],
    failed: [], mode: "",
  };
  /** Node-only output dir (empty = use the reports-node default). */
  node_reports_dir = "";

  profile(name: string): Profile | undefined {
    return this.profiles.find((p) => p.name === name);
  }

  /** Profiles that actually have a database on disk: a configured-but-absent
   * profile degrades to "not shown", never crashes the collector. */
  liveProfiles(): Profile[] {
    return this.profiles.filter((p) => p.exists());
  }

  toDict(): ConfigDict {
    return {
      profiles: this.profiles.map((p) => ({ name: p.name, home: p.home })),
      inference_endpoints: this.inference_endpoints,
      local_host_patterns: this.local_host_patterns,
      reports_dir: this.reports_dir,
      endpoint_aliases: this.endpoint_aliases,
      port: this.port,
      bind: this.bind,
      electricity_rate_kwh: this.electricity_rate_kwh,
      gpu_draw_watts: this.gpu_draw_watts,
      host_overhead_watts: this.host_overhead_watts,
      live_poll_interval_s: this.live_poll_interval_s,
      analytics_rebuild_interval_s: this.analytics_rebuild_interval_s,
      agent_home: this.agent_home,
      exclude: this.exclude,
      resolution: this.resolution as unknown as Record<string, unknown>,
      node_reports_dir: this.node_reports_dir,
    };
  }
}

export function candidatePaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  if (env["LLM_TELEMETRY_CONFIG"]) out.push(expand(env["LLM_TELEMETRY_CONFIG"]));
  if (env["XDG_CONFIG_HOME"]) out.push(expand(`${env["XDG_CONFIG_HOME"]}/llm-telemetry/config.json`));
  out.push(expand("~/.config/llm-telemetry/config.json"));
  return out;
}

/** Find agent profiles without being told where they are. The default profile
 * lives at the agent home itself; named profiles one level down under
 * profiles/. Only directories containing a state.db count. */
export function autodiscoverProfiles(agentHome = "~/.hermes"): Profile[] {
  const home = expand(agentHome);
  const found: Profile[] = [];
  const hasRootDb = fs.existsSync(resolvePath(home, "state.db"));
  if (hasRootDb) found.push(new Profile("default", home));
  const pdir = resolvePath(home, "profiles");
  if (fs.existsSync(pdir) && fs.statSync(pdir).isDirectory()) {
    for (const entry of fs.readdirSync(pdir).sort()) {
      const sub = resolvePath(pdir, entry);
      if (fs.existsSync(resolvePath(sub, "state.db"))) {
        // profiles/default/ is a stale stub when the root home already holds
        // the real state.db — the root IS the default profile (P5, parity
        // with config.py's shadowing rule).
        if (entry === "default" && hasRootDb) continue;
        found.push(new Profile(entry, sub));
      }
    }
  }
  return found;
}

/** $LLM_TELEMETRY_AGENT_HOME, then config agent_home, then ~/.hermes. */
export function resolveAgentHome(configured?: string | null): string {
  const env = process.env["LLM_TELEMETRY_AGENT_HOME"];
  if (env) return expand(env);
  if (configured) return expand(configured);
  return expand("~/.hermes");
}

/** Merge configured profiles with discovered ones (P5-01/02). `configured` is
 * null when the config file has no "profiles" key (pure autodiscovery), and an
 * empty list is an explicit request for zero profiles. A non-empty list is a
 * modifier on discovery: configured wins a name collision, the rest are
 * appended, `exclude` is the only way to drop one. */
export function resolveProfiles(
  configured: ProfileSpec[] | null | undefined,
  agentHome: string,
  exclude: string[] = [],
): { profiles: Profile[]; report: ResolutionReport } {
  const report: ResolutionReport = {
    agent_home: agentHome,
    discovered: [],
    configured: [],
    excluded: [],
    failed: [],
    mode: "",
  };
  const excluded = new Set(exclude);

  if (configured !== null && configured !== undefined && configured.length === 0) {
    report.mode = "explicit-empty";
    return { profiles: [], report };
  }

  const discovered = autodiscoverProfiles(agentHome);
  report.discovered = discovered.map((p) => p.name);

  let merged: Profile[];
  if (configured === null || configured === undefined) {
    report.mode = "discovered";
    merged = discovered;
  } else {
    report.mode = "merged";
    const conf = configured.map((p) => new Profile(p.name, p.home));
    report.configured = conf.map((p) => p.name);
    const names = new Set(conf.map((p) => p.name));
    merged = [...conf, ...discovered.filter((p) => !names.has(p.name))];
  }

  const out: Profile[] = [];
  for (const p of merged) {
    if (excluded.has(p.name)) {
      report.excluded.push({ name: p.name, reason: "listed in config exclude" });
      continue;
    }
    out.push(p);
  }
  return { profiles: out, report };
}

const KNOWN_KEYS = new Set<string>([
  "profiles", "inference_endpoints", "local_host_patterns", "reports_dir",
  "endpoint_aliases", "port", "bind", "electricity_rate_kwh", "gpu_draw_watts",
  "host_overhead_watts", "live_poll_interval_s", "analytics_rebuild_interval_s",
  "agent_home", "exclude", "node_reports_dir",
]);

/** Load config from disk; profiles come from resolveProfiles(). */
export function load(path?: string | null): Config {
  const paths = path ? [expand(path)] : candidatePaths();
  let raw: Record<string, unknown> = {};
  let src: string | null = null;
  for (const p of paths) {
    if (fs.existsSync(p)) {
      raw = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
      src = p;
      break;
    }
  }
  const unknownKeys = Object.keys(raw).filter((k) => !KNOWN_KEYS.has(k));
  if (unknownKeys.length) {
    console.error(
      `config: ignoring unknown key(s) in ${src}: ${[...unknownKeys].sort().join(", ")}`,
    );
  }

  const cfg = new Config();
  if (typeof raw["reports_dir"] === "string") cfg.reports_dir = expand(raw["reports_dir"]);
  if (Array.isArray(raw["inference_endpoints"])) cfg.inference_endpoints = raw["inference_endpoints"] as string[];
  if (Array.isArray(raw["local_host_patterns"])) cfg.local_host_patterns = raw["local_host_patterns"] as string[];
  if (raw["endpoint_aliases"] && typeof raw["endpoint_aliases"] === "object") {
    cfg.endpoint_aliases = raw["endpoint_aliases"] as Record<string, string>;
  }
  if (typeof raw["port"] === "number") cfg.port = raw["port"];
  if (typeof raw["bind"] === "string") cfg.bind = raw["bind"];
  if (typeof raw["electricity_rate_kwh"] === "number") cfg.electricity_rate_kwh = raw["electricity_rate_kwh"];
  if (typeof raw["gpu_draw_watts"] === "number") cfg.gpu_draw_watts = raw["gpu_draw_watts"];
  if (typeof raw["host_overhead_watts"] === "number") cfg.host_overhead_watts = raw["host_overhead_watts"];
  if (typeof raw["live_poll_interval_s"] === "number") cfg.live_poll_interval_s = raw["live_poll_interval_s"];
  if (typeof raw["analytics_rebuild_interval_s"] === "number") cfg.analytics_rebuild_interval_s = raw["analytics_rebuild_interval_s"];
  if (typeof raw["node_reports_dir"] === "string") cfg.node_reports_dir = expand(raw["node_reports_dir"]);
  cfg.exclude = Array.isArray(raw["exclude"]) ? (raw["exclude"] as string[]) : [];

  const configured =
    "profiles" in raw ? (raw["profiles"] as ProfileSpec[] | null) : null;

  cfg.agent_home = resolveAgentHome(
    typeof raw["agent_home"] === "string" ? raw["agent_home"] : null,
  );
  if (!fs.existsSync(cfg.agent_home) && !(configured && configured.length === 0)) {
    console.error(
      `config: agent home not found: ${cfg.agent_home} ` +
        `(set LLM_TELEMETRY_AGENT_HOME or agent_home in the config)`,
    );
  }
  const { profiles, report } = resolveProfiles(
    configured, cfg.agent_home, Array.isArray(raw["exclude"]) ? raw["exclude"] : [],
  );
  cfg.profiles = profiles;
  cfg.resolution = report;
  cfg.resolution.config_file = src;
  if (Array.isArray(configured) && configured.length === 0) {
    console.error(`config: ${src} sets "profiles": [] -- no profiles will be read`);
  }
  return cfg;
}

let cached: Config | null = null;

/** Process-wide config singleton (parity with config.get()). */
export function get(): Config {
  if (cached === null) cached = load();
  return cached;
}

/** Where the NODE collectors write. Never the Python reports dir by default:
 * env override, then config `node_reports_dir`, then the non-production
 * `…/llm-telemetry/reports-node` default. */
export function resolveNodeReportsDir(cfg?: Config): string {
  const env = process.env["LLM_TELEMETRY_NODE_REPORTS_DIR"];
  if (env) return expand(env);
  const c = cfg ?? get();
  if (c.node_reports_dir) return c.node_reports_dir;
  return expand("~/.local/share/llm-telemetry/reports-node");
}
