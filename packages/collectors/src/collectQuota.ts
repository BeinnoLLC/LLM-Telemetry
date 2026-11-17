/** Collector port — T-16 (LLMTELEMET-287).
 *
 * Port of src/llm_telemetry/collect_quota.py: each profile's provider quota
 * headroom, copied from `<profile home>/quota_cache.json` through a strict
 * whitelist (a credential-shaped key can never leak in), with credential-shaped
 * substrings in free text scrubbed to `[REDACTED]`, plus the quota-history
 * ledger. Never opens auth.json, .env or config.yaml.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Config, get as getConfig } from "./config.js";
import { cmpStr } from "./pySort.js";
import { pyRound, pySlice } from "./pySemantics.js";
import { floatRepr, num, parsePy, pyFloat, pyStrOf } from "./pyJson.js";
import { stamp } from "./schema.js";

type Obj = Record<string, unknown>;

export const CACHE_NAME = "quota_cache.json";
export const DATA_NAME = "quota-data.json";
export const HISTORY_NAME = "quota-history.json";
export const HISTORY_DAYS = 30;
export const HISTORY_MAX_SAMPLES = 900;

const ACCOUNT_FIELDS = [
  "id", "label", "last_error_code", "last_error_reason", "last_error_reset_at",
  "failure_reason", "expires_at_ms", "source", "auth_type",
] as const;
const ACCOUNT_NUM_FIELDS = ["priority", "request_count"] as const;
const BALANCE_FIELDS = ["currency", "total_balance", "granted_balance", "topped_up_balance"] as const;
const STATUS_KEYS = ["status", "last_status"] as const;
const MODELS_KEYS = ["models", "model_cooldowns"] as const;
const ACCOUNT_STATUSES = ["ok", "exhausted", "dead"];
const SPENT_STATUSES = ["exhausted", "dead"];
const MAX_ACCOUNT_MODELS = 8;
export const ATTENTION_PERCENT = 90.0;

// Python's `\b` / `\w` are Unicode-aware; spelled with lookarounds here.
const NW = "(?<![\\p{L}\\p{N}_])";
const NW_END = "(?![\\p{L}\\p{N}_])";
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{8,}/gu,
  /gh[pousr]_[A-Za-z0-9]{16,}/gu,
  new RegExp(`${NW}bearer\\s+[A-Za-z0-9._-]{8,}`, "giu"),
  new RegExp(`${NW}(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)${NW_END}\\s*[:=]\\s*\\S+`, "giu"),
  /[A-Za-z0-9_-]{40,}/gu,
];
const SECRET_REPLACEMENT = "[REDACTED]";

const isRecord = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v) && v.constructor === Object;

/** Python `x or default`. */
const truthy = (v: unknown): boolean => {
  const n = num(v);
  if (n !== null) return n !== 0;
  if (v === null || v === undefined || v === false || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (isRecord(v)) return Object.keys(v).length > 0;
  return true;
};

const getKey = (d: Obj, k: string): unknown => (Object.hasOwn(d, k) ? d[k] : null);

/** `for x in v` for the shapes JSON can hold (str → chars, dict → keys). */
function iter(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return Array.from(v);
  if (isRecord(v)) return Object.keys(v);
  return [];
}

/** Replace credential-shaped substrings with `[REDACTED]`; cap length. */
export function scrub(text: unknown): string | null {
  if (typeof text !== "string") return null;
  let out = text;
  for (const pat of SECRET_PATTERNS) out = out.replace(pat, SECRET_REPLACEMENT);
  return pySlice(out, 0, 400);
}

/** A scrubbed string, or null when there is nothing to show. */
export function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return scrub(pyStrOf(value)) || null;
}

/** Coerce to a float percentage, or null. Booleans are not numbers here. */
export function percent(value: unknown): number | null {
  if (typeof value === "boolean" || value === null || value === undefined) return null;
  const n = pyFloat(value);
  if (n === null || Number.isNaN(n)) return null;
  return pyRound(n, 2);
}

/** Decimal strings survive verbatim; anything else is coerced. */
export function numstr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return scrub(value);
  if (typeof value === "boolean") return null;
  const n = num(value);
  if (n !== null) {
    return Number.isInteger(n) && typeof value === "number" ? String(n) : floatRepr(n);
  }
  return null;
}

export interface QuotaWindow { label: string; reset_at: string | null; used_percent: number | null }

export function window(raw: unknown): QuotaWindow | null {
  if (!isRecord(raw)) return null;
  const label = text(getKey(raw, "label"));
  if (!label) return null;
  return {
    label,
    reset_at: text(getKey(raw, "reset_at")),
    used_percent: percent(getKey(raw, "used_percent")),
  };
}

export function balance(raw: unknown): Record<string, string | null> | null {
  if (!isRecord(raw)) return null;
  const out: Record<string, string | null> = {};
  for (const k of BALANCE_FIELDS) out[k] = numstr(getKey(raw, k));
  if (!(out["currency"] || out["total_balance"])) return null;
  return out;
}

/** Lowest priority first; unset/unparseable sort last, stable. */
function priorityKey(acct: Obj): [number, number] {
  const p = acct["priority"];
  const f = typeof p === "string" ? pyFloat(p) : null;
  return f === null ? [1, 0] : [0, f];
}

function first(raw: Obj, keys: readonly string[]): unknown {
  for (const k of keys) if (getKey(raw, k) !== null) return getKey(raw, k);
  return null;
}

export interface QuotaAccount { id: string; status: string | null; priority: string | null; [k: string]: unknown }

/** Whitelist one credential-pool account, or null when it has no identity. */
export function account(raw: unknown): QuotaAccount | null {
  if (!isRecord(raw)) return null;
  const identity = text(getKey(raw, "id"));
  if (!identity) return null;
  let status = first(raw, STATUS_KEYS);
  if (typeof status !== "string" || !ACCOUNT_STATUSES.includes(status)) status = null;
  let cooldowns = first(raw, MODELS_KEYS);
  if (!isRecord(cooldowns)) cooldowns = Array.isArray(cooldowns) ? cooldowns : [];
  const out: Obj = {};
  for (const k of ACCOUNT_FIELDS) out[k] = text(getKey(raw, k));
  out["id"] = identity;
  out["status"] = status;
  out["models"] = iter(cooldowns).map(text).filter((m): m is string => !!m).slice(0, MAX_ACCOUNT_MODELS);
  out["in_use"] = getKey(raw, "in_use") === true;
  const usage = getKey(raw, "usage");
  out["usage"] = Array.isArray(usage) ? usage.map(window).filter((w): w is QuotaWindow => w !== null) : [];
  for (const k of ACCOUNT_NUM_FIELDS) out[k] = numstr(getKey(raw, k));
  return out as QuotaAccount;
}

export interface QuotaProvider {
  id: string;
  label: string;
  plan: string | null;
  unavailable_reason: string | null;
  api_calls_available: boolean | null;
  windows: QuotaWindow[];
  balances: Array<Record<string, string | null>>;
  details: string[];
  accounts: QuotaAccount[];
  max_used_percent: number | null;
  attention: boolean;
}

/** Whitelist one provider record into the payload shape the view expects. */
export function provider(pid: string, rawIn: unknown): QuotaProvider {
  const raw = isRecord(rawIn) ? rawIn : {};
  const orList = (k: string): unknown[] => iter(truthy(getKey(raw, k)) ? getKey(raw, k) : []);
  const windows = orList("windows").map(window).filter((w): w is QuotaWindow => w !== null);
  const balances = orList("account_balances").map(balance).filter((b): b is Record<string, string | null> => b !== null);
  const details = orList("details").map(text).filter((d): d is string => !!d);
  const accounts = orList("accounts").map(account).filter((a): a is QuotaAccount => a !== null);
  accounts.sort((a, b) => {
    const [ga, va] = priorityKey(a);
    const [gb, vb] = priorityKey(b);
    return ga !== gb ? ga - gb : va < vb ? -1 : va > vb ? 1 : 0;
  });
  const callsRaw = getKey(raw, "api_calls_available");
  const calls = typeof callsRaw === "boolean" ? callsRaw : null;
  const used = windows.map((w) => w.used_percent).filter((p): p is number => p !== null);
  const worst = used.length ? Math.max(...used) : null;
  return {
    id: pid,
    label: text(getKey(raw, "label")) || pid,
    plan: text(getKey(raw, "plan")),
    unavailable_reason: text(getKey(raw, "unavailable_reason")),
    api_calls_available: calls,
    windows,
    balances,
    details,
    accounts,
    max_used_percent: worst,
    attention: worst !== null && worst >= ATTENTION_PERCENT,
  };
}

/** A profile's quota cache, or null when absent/unreadable/foreign. */
export function readCache(home: string): Obj | null {
  const p = path.join(home, CACHE_NAME);
  if (!fs.existsSync(p)) return null;
  let data: unknown;
  try {
    const t = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(p));
    data = parsePy(t);
  } catch {
    return null;
  }
  return isRecord(data) ? data : null;
}

export interface QuotaProfile {
  providers: Record<string, QuotaProvider>;
  cache_fetched_at: string | null;
  note: string | null;
}

export function profilePayload(home: string): QuotaProfile {
  const raw = readCache(home);
  if (raw === null) return { providers: {}, cache_fetched_at: null, note: "no-quota-cache" };
  const provsRaw = getKey(raw, "providers");
  const provs = isRecord(provsRaw) ? provsRaw : {};
  const out: Record<string, QuotaProvider> = {};
  for (const pid of Object.keys(provs).sort(cmpStr)) out[pid] = provider(pid, provs[pid]);
  return {
    providers: out,
    cache_fetched_at: text(getKey(raw, "fetched_at")),
    note: Object.keys(out).length ? null : "no-providers",
  };
}

export function summarise(profiles: Record<string, QuotaProfile>): Record<string, number> {
  let total = 0, avail = 0, attention = 0, accounts = 0, usable = 0;
  for (const pdata of Object.values(profiles)) {
    for (const prov of Object.values(pdata.providers)) {
      total += 1;
      if (prov.unavailable_reason === null) avail += 1;
      if (prov.attention) attention += 1;
      for (const acct of prov.accounts) {
        accounts += 1;
        if (!SPENT_STATUSES.includes(acct.status as string)) usable += 1;
      }
    }
  }
  return {
    providers: total, available: avail, attention, accounts, accounts_usable: usable,
    accounts_spent: accounts - usable,
  };
}

export interface CollectQuotaOptions {
  cfg?: Config;
  now?: Date;
}

/** Pure: assemble the payload without touching the reports directory. */
export function collectQuota(opts: CollectQuotaOptions = {}): Obj {
  const cfg = opts.cfg ?? getConfig();
  const nowS = opts.now ? opts.now.getTime() / 1000 : Date.now() / 1000;
  const profiles: Record<string, QuotaProfile> = {};
  for (const p of cfg.liveProfiles()) profiles[p.name] = profilePayload(p.home);
  const out: Obj = {
    profiles,
    collected_at: Math.trunc(nowS),
    attention_percent: ATTENTION_PERCENT,
  };
  out["summary"] = summarise(profiles);
  return stamp(out);
}

export interface HistorySample { t: number; providers: Obj }

/** One compact ledger row: per profile/provider, each window's fill level. */
export function historySample(now: number, data: Obj): HistorySample | null {
  const providers: Obj = {};
  for (const [pname, pdata] of Object.entries(data["profiles"] as Record<string, QuotaProfile>)) {
    const entry: Obj = {};
    for (const [pid, prov] of Object.entries(pdata.providers)) {
      const windows: Obj = {};
      for (const w of prov.windows) windows[w.label] = w.used_percent;
      entry[pid] = { plan: prov.plan, unavailable_reason: prov.unavailable_reason, windows };
    }
    if (Object.keys(entry).length) providers[pname] = entry;
  }
  if (!Object.keys(providers).length) return null;
  return { t: now, providers };
}

/** Append one sample to the ledger, pruning by age and count. Returns the
 * number of samples kept. Caller is responsible for the single-writer rule. */
export function appendHistory(file: string, sample: HistorySample | null, now: number): number {
  let samples: Obj[] = [];
  if (fs.existsSync(file)) {
    try {
      const prev = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
      if (isRecord(prev) && Array.isArray(prev["samples"])) {
        samples = (prev["samples"] as unknown[]).filter(isRecord);
      }
    } catch {
      samples = [];
    }
  }
  if (sample) samples.push(sample as unknown as Obj);
  const cutoff = now - HISTORY_DAYS * 86400;
  samples = samples.filter((s) => typeof s["t"] === "number" && (s["t"]) >= cutoff);
  samples = samples.slice(-HISTORY_MAX_SAMPLES);
  const payload = stamp({ samples, days: HISTORY_DAYS } as Obj);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(payload), "utf8");
  fs.renameSync(tmp, file);
  return samples.length;
}
