/** Collector port — T-16 (LLMTELEMET-287).
 *
 * Port of src/llm_telemetry/collect_router.py: each profile's ROUTER
 * configuration (primary, fallback chain, auxiliary tasks, delegation, MoA
 * preset, tier router + routing matrix, credential SOURCES, and the router's
 * real decisions over the last 7 days parsed from the agent log). Only
 * whitelisted descriptive fields leave auth.json; a token can never reach the
 * payload. The parity `router` case diffs the whole payload against Python.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { Config, get as getConfig } from "./config.js";
import { cmpStr } from "./pySort.js";
import { pyLen, pySlice } from "./pySemantics.js";
import { stamp } from "./schema.js";

type Obj = Record<string, unknown>;

export const TASK_DOC: Record<string, string> = {
  main: "Your actual conversation - the model that reads and answers you.",
  compression: "Summarises old turns when the context window fills up.",
  approval: "Judges whether a risky command should ask you first.",
  title_generation: "Names each session in the sidebar.",
  triage_specifier: "Picks which specialist handles an incoming request.",
  background_review: "Reviews finished work and updates skills/memory.",
  review: "Reviews finished work and updates skills/memory.",
  kanban_decomposer: "Breaks a kanban card into sub-tasks.",
  vision: "Reads images you attach.",
  tier_classifier: "Labels each turn '<category> <level>' so the router can pick a tier.",
  delegation: "Runs subagents spawned with delegate_task.",
};

export const TIERS = ["trivial", "monitoring", "test", "automation", "research", "writing",
  "normal", "complex", "plan"] as const;
export const CATEGORIES = ["coding", "test", "research", "writing", "data", "monitoring", "plan"] as const;
export const LEVELS = ["easy", "medium", "hard"] as const;

export const DEFAULT_ROUTES: Record<string, Record<string, string>> = {
  coding: { easy: "trivial", medium: "normal", hard: "complex" },
  test: { easy: "test", medium: "test", hard: "normal" },
  research: { easy: "trivial", medium: "research", hard: "complex" },
  writing: { easy: "trivial", medium: "writing", hard: "writing" },
  data: { easy: "trivial", medium: "automation", hard: "normal" },
  monitoring: { easy: "monitoring", medium: "monitoring", hard: "automation" },
  plan: { easy: "normal", medium: "plan", hard: "plan" },
};
export const CATEGORY_DOC: Record<string, string> = {
  coding: "Writing, changing or debugging code, config, infra, shell, git.",
  test: "Writing, running or fixing tests; coverage; e2e specs; test output.",
  research: "Finding information, comparing options, reading docs, summarising.",
  writing: "Emails, docs, posts, announcements, proposals, messages to people.",
  data: "Data processing, spreadsheets, transforms, scripts that automate a chore.",
  monitoring: "Status checks, logs, health checks, cron jobs, alerts.",
  plan: "Architecture, design decisions, roadmaps, ticket breakdown.",
};
export const LEVEL_DOC: Record<string, string> = {
  easy: "One-liner or lookup, a yes/no, a 'keep going' follow-up.",
  medium: "Ordinary work, even if it takes many steps. The usual answer.",
  hard: "Genuinely hard: unknown root cause, big refactor, security, high stakes.",
};
export const TIER_DOC: Record<string, string> = {
  trivial: "One-liners and lookups: the cheapest, fastest models.",
  monitoring: "Status checks, logs and cron jobs.",
  test: "Writing, running and fixing tests.",
  automation: "Data processing and chore scripts.",
  research: "Finding information, comparing options, summarising.",
  writing: "Emails, docs and posts.",
  normal: "Ordinary work: the usual answer for most turns.",
  complex: "Genuinely hard problems; the top of the escalation ladder.",
  plan: "Architecture, design and roadmaps.",
};

export const PROVIDER_ENV: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_TOKEN"],
  "opencode-go": ["OPENCODE_GO_API_KEY"],
  "opencode-zen": ["OPENCODE_ZEN_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  fireworks: ["FIREWORKS_API_KEY"],
  "ollama-cloud": ["OLLAMA_API_KEY"],
  copilot: ["GH_TOKEN", "GITHUB_TOKEN"],
  openai: ["OPENAI_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  xai: ["XAI_API_KEY"],
};
const CRED_FIELDS = ["auth_type", "source", "last_status"] as const;
// Python `re` gives \w/\d Unicode meaning; spelled with property escapes here.
// `\n?$` mirrors Python's `$`, which also matches before a trailing newline.
const EMAIL_RE = /^([^@\s])[^@\s]*(@[^@\s]+)$/u;
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{2,}\n?$/;
const SAFE_LABEL_RE = /^[\p{L}\p{N}_ .:@+-]{1,40}\n?$/u;
const SAFE_SOURCE_RE = /^[a-z_:-]{1,24}\n?$/;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Python truthiness for JSON/YAML values. */
export function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (isObj(v)) return Object.keys(v).length > 0;
  return true;
}

/** `a or b`. */
const or = <T>(a: unknown, b: T): unknown => (truthy(a) ? a : b);

/** `d.get(key)` on a dict-ish value (None when absent or not a dict). */
const get = (d: unknown, key: string): unknown =>
  isObj(d) && Object.hasOwn(d, key) ? d[key] : null;

/** `str(x)` for the scalar types a credential entry can hold. */
function pyStr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  return String(v);
}

const asObj = (v: unknown): Obj => (isObj(v) ? v : {});

export function safeLabel(label: unknown): string {
  const s = pyStr(or(label, "")).trim();
  if (label === null || label === undefined || s === "") return "";
  const m = EMAIL_RE.exec(s);
  if (m) return `${m[1] as string}•••${m[2] as string}`;
  if (ENV_NAME_RE.test(s)) return s;
  if (pyLen(s) > 24 && !s.includes(" ") && /\p{Nd}/u.test(s)) return "•••";
  return SAFE_LABEL_RE.test(s) ? s : "•••";
}

export function safeSource(src: unknown): string {
  const s = truthy(src) ? pyStr(src) : "";
  if (s.startsWith("env:")) {
    const name = s.slice(4);
    return ENV_NAME_RE.test(name) ? "env:" + name : "env";
  }
  return SAFE_SOURCE_RE.test(s) ? s : "other";
}

export function provOf(
  provider: unknown, model: unknown, baseUrl: unknown, cfg: Config = getConfig(),
): string {
  const u = pyStr(or(baseUrl, "")).toLowerCase();
  if (truthy(baseUrl)) {
    if (u.includes("fireworks.ai")) return "fireworks";
    if (u.includes("opencode.ai")) return "opencode-go";
    if (u.includes("api.anthropic.com")) return "anthropic";
    if (u.includes("openai.com") || u.includes("chatgpt.com")) return "openai-codex";
    if (u.includes("openrouter.ai")) return "openrouter";
    if (u.includes("nousresearch")) return "nous";
    if (u.includes("ollama.com")) return "ollama-cloud";
    if (u.includes("generativelanguage.googleapis.com")) return "gemini";
    if (cfg.local_host_patterns.some((s) => u.includes(s)) || u.includes("localhost") || u.includes("127.0.0.1")) {
      return "local";
    }
  }
  const key = (truthy(provider) ? pyStr(provider) : "").toLowerCase().trim();
  if (key === "ollama-cloud") return key;
  if (key.startsWith("ollama")) return "local";
  if (key && key !== "custom") return key;
  const m = (truthy(model) ? pyStr(model) : "").toLowerCase();
  if (["qwen", "gpt-oss", "deepseek-r1", "nemotron", "llama", "mistral"].some((p) => m.startsWith(p))) {
    return "local";
  }
  return key || "?";
}

export interface RouterEntry {
  provider: string;
  model: string;
  url: unknown;
  prov: string;
  [key: string]: unknown;
}

/** One routing hop, resolved against custom_providers for its real URL. */
export function entry(
  provider: unknown, model: unknown, baseUrl: unknown, providers: Obj, cfg?: Config,
): RouterEntry {
  const slot = asObj(truthy(provider) ? providers[pyStr(provider)] : undefined);
  const url = or(baseUrl, or(get(slot, "api"), or(get(slot, "base_url"), "")));
  return {
    provider: truthy(provider) ? pyStr(provider) : "",
    model: truthy(model) ? pyStr(model) : "",
    url,
    prov: provOf(provider, model, url, cfg),
  };
}

function entries(items: unknown, providers: Obj, cfg?: Config): RouterEntry[] {
  const list = Array.isArray(items) ? items : [];
  return list.filter(isObj).map((x) => entry(x["provider"] ?? null, x["model"] ?? null, x["base_url"] ?? null, providers, cfg));
}

export function normProviders(raw: unknown): Obj {
  if (Array.isArray(raw)) {
    const providers: Obj = {};
    for (const it of raw) {
      if (!isObj(it)) continue;
      if ("name" in it && typeof it["name"] === "string" && Object.keys(it).length > 1) {
        providers[it["name"]] = it;
      } else {
        Object.assign(providers, it);
      }
    }
    return providers;
  }
  return isObj(raw) ? raw : {};
}

/** DEFAULT_ROUTES overlaid with config tier_router.routes (unknown keys ignored). */
export function routesFor(tr: Obj): Record<string, Record<string, string>> {
  const routes: Record<string, Record<string, string>> = {};
  for (const [c, lv] of Object.entries(DEFAULT_ROUTES)) routes[c] = { ...lv };
  for (const [cat, lv] of Object.entries(asObj(or(tr["routes"], {})))) {
    if (!(cat in routes) || !isObj(lv)) continue;
    for (const [level, tier] of Object.entries(lv)) {
      if ((LEVELS as readonly string[]).includes(level) && typeof tier === "string" &&
        (TIERS as readonly string[]).includes(tier)) {
        (routes[cat] as Record<string, string>)[level] = tier;
      }
    }
  }
  return routes;
}

export interface TierRouter {
  enabled: boolean;
  default_tier: unknown;
  cooldown_s: unknown;
  restore_primary: boolean;
  classifier: { pool: RouterEntry[]; timeout_s: unknown; history_turns: unknown };
  tiers: Array<{ name: string; pool: RouterEntry[]; fallback: RouterEntry[]; [k: string]: unknown }>;
  routes: Record<string, Record<string, string>>;
  custom_routes: string[];
}

export function tierRouter(c: Obj, providers: Obj, cfg?: Config): TierRouter | null {
  const tr = asObj(or(c["tier_router"], {}));
  if (!truthy(tr)) return null;
  const routes = routesFor(tr);
  const tiersCfg = asObj(or(tr["tiers"], {}));
  const names = [
    ...(TIERS as readonly string[]).filter((t) => t in tiersCfg),
    ...Object.keys(tiersCfg).filter((t) => !(TIERS as readonly string[]).includes(t)),
  ];
  const tiers = names.map((name) => {
    const tv = asObj(or(tiersCfg[name], {}));
    const why: Array<{ category: string; level: string }> = [];
    for (const category of CATEGORIES) {
      for (const level of LEVELS) {
        if ((routes[category] as Record<string, string>)[level] === name) why.push({ category, level });
      }
    }
    return {
      name,
      doc: TIER_DOC[name] ?? "",
      mode: or(tv["mode"], "priority"),
      escalate_to: tv["escalate_to"] ?? null,
      escalated_from: Object.entries(tiersCfg)
        .filter(([, v]) => get(or(v, {}), "escalate_to") === name)
        .map(([t]) => t)
        .sort(cmpStr),
      pool: entries(tv["pool"], providers, cfg),
      fallback: entries(tv["fallback"], providers, cfg),
      why,
    };
  });
  const cl = asObj(or(tr["classifier"], {}));
  const custom: string[] = [];
  for (const [cat, lvs] of Object.entries(asObj(or(tr["routes"], {})))) {
    if (isObj(lvs)) for (const lv of Object.keys(lvs)) custom.push(`${cat}/${lv}`);
  }
  return {
    enabled: truthy(tr["enabled"]),
    default_tier: or(tr["default_tier"], "normal"),
    cooldown_s: tr["cooldown_s"] ?? null,
    restore_primary: truthy(tr["restore_primary"]),
    classifier: {
      pool: entries(cl["pool"], providers, cfg),
      timeout_s: cl["timeout_s"] ?? null,
      history_turns: cl["history_turns"] ?? null,
    },
    tiers,
    routes,
    custom_routes: custom.sort(cmpStr),
  };
}

/** Names (never values) of non-empty variables in the profile's .env. */
export function envNames(home: string): Set<string> {
  const names = new Set<string>();
  const p = path.join(home, ".env");
  if (!fs.existsSync(p)) return names;
  const text = fs.readFileSync(p).toString("utf8");
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i);
    const v = line.slice(i + 1);
    if (v.trim().replace(/^['"]+|['"]+$/g, "")) {
      names.add(k.trim().replace(/^export /, "").trim());
    }
  }
  return names;
}

export interface Credential {
  auth_type: string;
  source: string;
  last_status: string;
  label: string;
  requests: number;
}

export interface AuthInfo {
  prov: string;
  type: string;
  creds: Credential[];
  note: string;
}

/** {provider_slot: {type, creds:[...], note}} for every slot in use. */
export function authFor(home: string, used: Map<string, string>, providers: Obj): Record<string, AuthInfo> {
  let a: Obj = {};
  try {
    a = asObj(JSON.parse(fs.readFileSync(path.join(home, "auth.json")).toString("utf8")));
  } catch {
    a = {};
  }
  const pool = asObj(a["credential_pool"]);
  const oauth = asObj(a["providers"]);
  const env = envNames(home);
  const out: Record<string, AuthInfo> = {};
  for (const slot of [...used.keys()].sort(cmpStr)) {
    const prov = used.get(slot) as string;
    const creds: Credential[] = [];
    const poolEntries = pool[slot];
    for (const e of Array.isArray(poolEntries) ? poolEntries : []) {
      if (!isObj(e)) continue;
      const c = {} as Record<string, unknown>;
      for (const k of CRED_FIELDS) c[k] = truthy(e[k]) ? pyStr(e[k]) : "";
      c["source"] = safeSource(c["source"]);
      c["label"] = safeLabel(e["label"]);
      c["requests"] = Math.trunc(Number(or(e["request_count"], 0)));
      creds.push(c as unknown as Credential);
    }
    const cp = asObj(providers[slot]);
    let kind: string;
    let note = "";
    if (creds.length) {
      const types = new Set(creds.map((c) => c.auth_type));
      const only = (t: string): boolean => types.size === 1 && types.has(t);
      kind = only("oauth") ? "oauth" : only("api_key") ? "api_key" : "mixed";
    } else if (slot in oauth) {
      kind = "oauth"; note = "signed in (auth.json)";
    } else if (prov === "local") {
      kind = "none"; note = "self-hosted endpoint, no key";
    } else if (["api_key", "key", "apiKey"].some((k) => k in cp)) {
      kind = "api_key"; note = "inline in config";
    } else if (truthy(cp["key_env"]) || truthy(cp["api_key_env"])) {
      const name = pyStr(or(cp["key_env"], cp["api_key_env"]));
      kind = "api_key";
      note = `env:${name}` + (env.has(name) ? "" : " (not set)");
    } else {
      const known = PROVIDER_ENV[slot] ?? PROVIDER_ENV[prov] ?? [];
      const names = known.filter((n) => env.has(n));
      if (names.length) {
        kind = "api_key"; note = "env:" + names.join(", ");
      } else {
        kind = "unknown"; note = "no credential found for this slot";
      }
    }
    out[slot] = { prov, type: kind, creds, note };
  }
  return out;
}

const DEC_RE = new RegExp(
  "^([0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2})\\S* [\\p{L}\\p{N}_]+ \\[[^\\]]*\\] agent\\.tier_router: " +
  "tier_router: ([\\p{L}\\p{N}_]+)→([\\p{L}\\p{N}_]+) \\(([^)]*)\\) -> (.+?) via (\\S+)\\s*$", "u");
const TS_RE = /^([0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2})/;
export const DECISION_WINDOW_S = 7 * 86400;
export const RECENT_N = 15;

/** `datetime.strptime(s, "%Y-%m-%d %H:%M:%S").timestamp()` (local time), or
 * null where strptime raises ValueError. */
export function localTimestamp(s: string): number | null {
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)$/.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi, sec] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || sec > 61) return null;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > dim) return null;
  return new Date(y, mo - 1, d, h, mi, sec).getTime() / 1000;
}

export interface Decisions {
  window_days: number;
  total: number;
  by_tier: Record<string, number>;
  by_route: Record<string, number>;
  by_model: Record<string, number>;
  escalations: number;
  defaulted: number;
  failed_open: number;
  budget_exhausted: number;
  classifier_failures: Record<string, number>;
  recent: Array<{ ts: number; tier: string; used: string; reason: string; model: string; prov: string }>;
}

const bump = (o: Record<string, number>, k: string): void => { o[k] = (o[k] ?? 0) + 1; };

/** `line.split("tier_router: ", 2)[-1]`. */
function lastOfSplit2(line: string): string {
  const sep = "tier_router: ";
  const parts: string[] = [];
  let rest = line;
  for (let i = 0; i < 2; i++) {
    const at = rest.indexOf(sep);
    if (at < 0) break;
    parts.push(rest.slice(0, at));
    rest = rest.slice(at + sep.length);
  }
  parts.push(rest);
  return parts[parts.length - 1] as string;
}

export function decisions(home: string, now?: number): Decisions | null {
  const dir = path.join(home, "logs");
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.startsWith("agent.log")).sort(cmpStr)
      .map((f) => path.join(dir, f));
  } catch {
    files = [];
  }
  if (!files.length) return null;
  const nowS = now ?? Date.now() / 1000;
  const cutoff = nowS - DECISION_WINDOW_S;
  const d: Decisions = {
    window_days: DECISION_WINDOW_S / 86400, total: 0, by_tier: {}, by_route: {},
    by_model: {}, escalations: 0, defaulted: 0, failed_open: 0,
    budget_exhausted: 0, classifier_failures: {}, recent: [],
  };
  const recent: Decisions["recent"] = [];
  for (const fp of files) {
    let text: string;
    try {
      text = fs.readFileSync(fp).toString("utf8");
    } catch {
      continue;
    }
    // Python's universal newlines: \r\n and lone \r end a line too.
    const lines = text.split(/(?<=\r\n|\r(?!\n)|\n)/);
    for (const line of lines) {
      if (!line.includes("agent.tier_router:")) continue;
      const t = TS_RE.exec(line);
      if (!t) continue;
      const ts = localTimestamp(t[1] as string);
      if (ts === null) continue;
      if (ts < cutoff) continue;
      const m = DEC_RE.exec(line.replace(/(\r\n|\r|\n)$/, ""));
      if (m) {
        const [, , tier, used, reason, model, prov] = m as unknown as [string, string, string, string, string, string, string];
        d.total += 1;
        bump(d.by_tier, used);
        bump(d.by_model, `${model}@${prov}`);
        if (tier !== used) d.escalations += 1;
        if (reason.startsWith("classifier:")) bump(d.by_route, reason.slice(reason.indexOf(":") + 1));
        else d.defaulted += 1;
        recent.push({
          ts: Math.trunc(ts), tier, used, reason: pySlice(reason, 0, 40),
          model: pySlice(model, 0, 60), prov: pySlice(prov, 0, 30),
        });
        continue;
      }
      const body = lastOfSplit2(line);
      if (body.startsWith("failed open")) {
        d.failed_open += 1;
      } else if (body.startsWith("classifier budget exhausted")) {
        d.budget_exhausted += 1;
      } else {
        const f = /^classifier (\S+) (?:failed|returned unparseable)/.exec(body);
        if (f) bump(d.classifier_failures, pySlice(f[1] as string, 0, 60));
      }
    }
  }
  recent.sort((a, b) => a.ts - b.ts);
  d.recent = recent.slice(-RECENT_N).reverse();
  return d;
}

/** yaml.safe_load: YAML 1.1 (yes/no/on/off), duplicate keys last-wins. */
export function loadYaml(text: string): unknown {
  return parseYaml(text, { version: "1.1", uniqueKeys: false, merge: true });
}

export function profilePayload(cfgPath: string, now?: number, cfg?: Config): Obj {
  const c = asObj(or(loadYaml(fs.readFileSync(cfgPath).toString("utf8")), {}));
  const home = path.dirname(path.resolve(cfgPath));
  const providers = normProviders(c["custom_providers"]);

  const m = asObj(or(c["model"], {}));
  const primary = entry(m["provider"], m["default"], m["base_url"], providers, cfg);
  primary["effort"] = or(m["reasoning_effort"], "");

  const chain = entries(c["fallback_providers"], providers, cfg);

  const tasks: RouterEntry[] = [];
  for (const [tk, tv] of Object.entries(asObj(or(c["auxiliary"], {})))) {
    if (!isObj(tv)) continue;
    const e = entry(tv["provider"], tv["model"], tv["base_url"], providers, cfg);
    e["task"] = tk;
    e["doc"] = TASK_DOC[tk] ?? "";
    const fc = or(tv["fallback_chain"], []);
    e["fallbacks"] = Array.isArray(fc) || typeof fc === "string" ? fc.length : 0;
    tasks.push(e);
  }
  tasks.sort((a, b) => cmpStr(a["task"] as string, b["task"] as string));

  const dg = asObj(or(c["delegation"], {}));
  let delegation: RouterEntry | null = null;
  if (truthy(dg["model"]) || truthy(dg["provider"])) {
    delegation = entry(dg["provider"], dg["model"], dg["base_url"], providers, cfg);
    const fc = or(dg["fallback_chain"], []);
    delegation["fallbacks"] = Array.isArray(fc) ? fc.length : 0;
    delegation["max_children"] = dg["max_concurrent_children"] ?? null;
  }

  const moa = asObj(or(c["moa"], {}));
  const preset = asObj(get(or(moa["presets"], {}), "default"));
  const refs = entries(preset["reference_models"], providers, cfg);
  const agg = asObj(or(preset["aggregator"], {}));
  const moaOut = refs.length
    ? {
      refs,
      agg: truthy(agg) ? entry(agg["provider"], agg["model"], null, providers, cfg) : null,
      fanout: or(preset["fanout"], ""),
    }
    : null;

  const tr = tierRouter(c, providers, cfg);

  const used = new Map<string, string>();
  const hops: RouterEntry[] = [primary, ...chain, ...tasks, ...refs];
  if (delegation) hops.push(delegation);
  if (moaOut?.agg) hops.push(moaOut.agg);
  if (tr) {
    hops.push(...tr.classifier.pool);
    for (const t of tr.tiers) hops.push(...t.pool, ...t.fallback);
  }
  for (const h of hops) {
    if (h.provider && !used.has(h.provider)) used.set(h.provider, h.prov);
  }

  const comp = asObj(or(c["compression"], {}));
  const endpoints: Obj = {};
  for (const [k, v] of Object.entries(providers)) {
    const vv = asObj(or(v, {}));
    const api = Object.hasOwn(vv, "api") ? vv["api"] : "";
    endpoints[k] = truthy(api) ? api : (Object.hasOwn(vv, "base_url") ? vv["base_url"] : "");
  }
  return {
    primary,
    chain,
    tasks,
    delegation,
    moa: moaOut,
    tier_router: tr,
    auth: authFor(home, used, providers),
    decisions: tr ? decisions(home, now) : null,
    compression: { threshold: comp["threshold"] ?? null, enabled: truthy(comp["enabled"]) },
    endpoints,
  };
}

export interface CollectRouterOptions {
  cfg?: Config;
  /** Clock override (seconds), shared with the Python producer in parity runs. */
  now?: Date;
}

export function collectRouter(opts: CollectRouterOptions = {}): Obj {
  const cfg = opts.cfg ?? getConfig();
  const nowS = opts.now ? opts.now.getTime() / 1000 : Date.now() / 1000;
  const out: Obj = {
    profiles: {} as Obj,
    vocab: {
      categories: [...CATEGORIES], levels: [...LEVELS],
      category_doc: CATEGORY_DOC, level_doc: LEVEL_DOC,
    },
    collected_at: Math.trunc(nowS),
  };
  for (const p of cfg.liveProfiles()) {
    if (fs.existsSync(p.config)) (out["profiles"] as Obj)[p.name] = profilePayload(p.config, nowS, cfg);
  }
  return stamp(out);
}
