/** Collector port — T-16 (LLMTELEMET-287).
 *
 * Port of src/llm_telemetry/collect_rankings.py: OpenRouter public model
 * rankings -> rankings-data.json. One request per run for a fixed window of the
 * last WINDOW_DAYS days; the day series is kept verbatim under `rows` and the
 * day/week/month views are re-aggregated from it. Failure is never guessed into
 * data: no key / network error / non-200 records `status: "unavailable"` (or
 * keeps the previous good payload with `last_error`). Only the variable NAME of
 * the key is ever reported.
 *
 * Known limit: token sums are JS numbers (exact to 2^53, ~9e15 tokens); the
 * Python port uses unbounded ints.
 */

import * as fs from "node:fs";
import { cmpStr } from "./pySort.js";
import { pyRound } from "./pySemantics.js";
import { parsePy, pyStrOf } from "./pyJson.js";
import { stamp } from "./schema.js";

type Obj = Record<string, unknown>;

export const URL_ = "https://openrouter.ai/api/v1/datasets/rankings-daily";
export const KEY_ENV = "OPENROUTER_API_KEY";
export const FLOOR = "2025-01-01";
export const WINDOW_DAYS = 30;
export const OTHER = "other";
export const TOP_N = 10;
export const VIEWS: Record<string, number> = { day: 1, week: 7, month: 30 };
export const ATTRIBUTION = "Rankings data by OpenRouter, CC BY 4.0";
export const ATTRIBUTION_URL = "https://openrouter.ai/docs";

// Python whitespace as seen by int(): str.isspace minus the \x1c-\x1f separators.
const PY_INT_WS = "[ \\t\\n\\v\\f\\r\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const PY_STRIP_WS = "[ \\t\\n\\v\\f\\r\\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const INT_RE = new RegExp(`^${PY_INT_WS}*([+-]?)(\\p{Nd}+(?:_\\p{Nd}+)*)${PY_INT_WS}*$`, "u");

/** Value of a run of Unicode Nd digits (Nd digits come in contiguous 0-9 blocks). */
const ndToAscii = (s: string): string =>
  Array.from(s.replaceAll("_", ""), (c) => {
    if (/[0-9]/.test(c)) return c;
    const cp = c.codePointAt(0)!;
    let z = cp;
    while (z > 0 && /^\p{Nd}$/u.test(String.fromCodePoint(z - 1))) z--;
    return String((cp - z) % 10);
  }).join("");

const pyIntStr = (s: string): number | null => {
  const m = INT_RE.exec(s);
  if (m === null) return null;
  const n = Number(ndToAscii(m[2]!));
  return m[1] === "-" && n !== 0 ? -n : n;
};

export const minRefetchS = (env: NodeJS.ProcessEnv = process.env): number => {
  const raw = env["LLM_TELEMETRY_RANKINGS_TTL"] ?? "3600";
  const n = pyIntStr(raw);
  if (n === null) throw new Error(`ValueError: invalid literal for int() with base 10: ${JSON.stringify(raw)}`);
  return n;
};

const isRecord = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v) && v.constructor === Object;
const orEmpty = <T>(v: unknown, empty: T): unknown =>
  (v === null || v === undefined || v === false || v === 0 || v === "" ||
    (Array.isArray(v) && !v.length) || (isRecord(v) && !Object.keys(v).length)) ? empty : v;

/** `int(str(v).strip())`, 0 when Python would raise. */
export function parseTokens(v: unknown): number {
  const s = pyStrOf(v).replace(new RegExp(`^${PY_STRIP_WS}+|${PY_STRIP_WS}+$`, "gu"), "");
  const m = /^([+-]?)(\p{Nd}+(?:_\p{Nd}+)*)$/u.exec(s);
  if (m === null) return 0;
  const n = Number(ndToAscii(m[2]!));
  return m[1] === "-" && n !== 0 ? -n : n;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number): string =>
  iso(new Date(Date.parse(date + "T00:00:00Z") + n * 86400_000));

export const localToday = (now = new Date()): string => {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
};

/** (start, end) dates of the fixed fetch window, clamped to the floor. */
export function window(today?: string): [string, string] {
  const end = addDays(today ?? localToday(), -1);
  const start = addDays(end, -(WINDOW_DAYS - 1));
  return [start < FLOOR ? FLOOR : start, end];
}

function sumByModel(rows: Obj[], dates: Set<unknown>): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (dates.has(r["date"] ?? null)) {
      const m = String(orEmpty(r["model_permaslug"], ""));
      out.set(m, (out.get(m) ?? 0) + parseTokens(r["total_tokens"] ?? null));
    }
  }
  return out;
}

export function aggregate(rows: Obj[], days: number): Obj {
  const all = [...new Set(rows.map((r) => r["date"]).filter((d) => orEmpty(d, null) !== null))] as string[];
  all.sort(cmpStr);
  if (!all.length) return { days: 0, start: null, end: null, total: 0, top: [], other: null };
  const dates = all.slice(-days);
  const span = all.slice(-Math.max(2, days));
  const half = Math.floor(span.length / 2);
  const first = half ? sumByModel(rows, new Set(span.slice(0, half))) : new Map<string, number>();
  const second = half ? sumByModel(rows, new Set(span.slice(-half))) : new Map<string, number>();

  const sums = sumByModel(rows, new Set(dates));
  let total = 0;
  for (const t of sums.values()) total += t;
  const named = [...sums.entries()].filter(([m]) => m !== OTHER)
    .sort((a, b) => (a[1] !== b[1] ? b[1] - a[1] : cmpStr(a[0], b[0])));

  const trend = (m: string): number | null => {
    const a = first.get(m) ?? 0;
    const b = second.get(m) ?? 0;
    return !a ? null : pyRound(((b - a) / a) * 100, 1);
  };

  const top = named.slice(0, TOP_N).map(([m, t], i) => ({
    rank: i + 1, model: m, tokens: t,
    share: total ? pyRound((t / total) * 100, 2) : 0.0,
    trend: trend(m),
  }));
  const rest = total - top.reduce((a, x) => a + x.tokens, 0);
  const other = {
    model: OTHER, tokens: rest,
    share: total ? pyRound((rest / total) * 100, 2) : 0.0,
    models: Math.max(0, named.length - TOP_N), source_other: sums.get(OTHER) ?? 0,
  };
  return { days: dates.length, start: dates[0], end: dates[dates.length - 1], total, top, other };
}

/** `datetime.now(timezone.utc).isoformat()` (microsecond precision). */
const utcIso = (d: Date): string => d.toISOString().slice(0, -1) + "000+00:00";
const localIsoSeconds = (d: Date): string => {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${localToday(d)}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/** The payload for a successful response (raw rows kept unmodified). */
export function assemble(resp: Obj, start: string, end: string, ttl: number, now = new Date()): Obj {
  const rows = orEmpty(resp["data"], []) as Obj[];
  const meta = orEmpty(resp["meta"], {}) as Obj;
  const views: Obj = {};
  for (const [name, n] of Object.entries(VIEWS)) views[name] = aggregate(rows, n);
  return stamp({
    status: "ok",
    source: URL_,
    window: { start, end, period: "day" },
    meta,
    as_of: meta["as_of"] ?? null,
    rows,
    views,
    attribution: { text: ATTRIBUTION, url: ATTRIBUTION_URL },
    fetched_at: utcIso(now),
    ttl_s: ttl,
  });
}

export function unavailable(reason: string, start: string | null, end: string | null, ttl: number): Obj {
  return stamp({
    status: "unavailable", reason, source: URL_,
    window: { start: start ?? null, end: end ?? null, period: "day" },
    rows: [], views: {},
    attribution: { text: ATTRIBUTION, url: ATTRIBUTION_URL },
    fetched_at: null, ttl_s: ttl,
  });
}

export interface FetchResult { resp: unknown; reason: string | null }
export type SyncFetcher = (start: string, end: string, key: string) => FetchResult;
export type AsyncFetcher = (start: string, end: string, key: string) => Promise<FetchResult>;

/** The real fetch. The reason never contains the key. */
export const fetchRankings: AsyncFetcher = async (start, end, key) => {
  const url = `${URL_}?start_date=${start}&end_date=${end}&period=day`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: "Bearer " + key, Accept: "application/json", "User-Agent": "llm-telemetry" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { resp: null, reason: `network error (URLError)` };
  }
  if (!res.ok) return { resp: null, reason: `HTTP ${res.status} from OpenRouter rankings API` };
  try {
    return { resp: parsePy(await res.text()), reason: null };
  } catch {
    return { resp: null, reason: "response was not valid JSON" };
  }
};

export interface CollectRankingsOptions {
  today?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  previous?: Obj | null;
  now?: Date;
}

const DATE_RE = /^(\d{4})(?:-(\d{2})-(\d{2})|(\d{2})(\d{2}))/;
const WEEK_RE = /^(\d{4})-?W(\d{2})(?:-?(\d))?/;
const TIME_RE = /^(\d{2})(?:(:?)(\d{2})(?:\2(\d{2}))?)?(?:[.,](\d+))?/;
const OFFSET_RE = /^ ?(?:(Z)|([+-])(\d{2})(?:(:?)(\d{2})(?:\4(\d{2})(?:[.,](\d+))?)?)?)$/;

const isoWeekDate = (y: number, w: number, d: number): [number, number, number] | null => {
  if (w < 1 || w > 53 || d < 1 || d > 7) return null;
  const jan4 = Date.UTC(y, 0, 4);
  const dow = (new Date(jan4).getUTCDay() + 6) % 7;
  const t = new Date(jan4 - dow * 86400000 + ((w - 1) * 7 + (d - 1)) * 86400000);
  // week 53 must exist in that year
  if (w === 53) {
    const dec28 = new Date(Date.UTC(y, 11, 28));
    const wk = Math.floor((Date.UTC(y, 11, 28) - (jan4 - dow * 86400000)) / 604800000) + 1;
    if (wk < 53 || dec28.getUTCFullYear() !== y) return null;
  }
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
};

/** `datetime.fromisoformat(s).timestamp()` (CPython 3.12), 0 where Python raises. */
export function isoToTs(s: string): number {
  let y: number, mo: number, d: number;
  let rest: string;
  let m = DATE_RE.exec(s);
  if (m !== null) {
    y = +m[1]!; mo = +(m[2] ?? m[4]!); d = +(m[3] ?? m[5]!);
    rest = s.slice(m[0].length);
  } else {
    const w = WEEK_RE.exec(s);
    if (w === null) return 0;
    const r = isoWeekDate(+w[1]!, +w[2]!, w[3] === undefined ? 1 : +w[3]);
    if (r === null) return 0;
    [y, mo, d] = r;
    rest = s.slice(w[0].length);
  }
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return 0;
  if (d > new Date(Date.UTC(2000, mo, 0)).getUTCDate() - (mo === 2 && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 1 : 0)) return 0;
  let h = 0, mi = 0, sec = 0, us = 0;
  let off: number | null = null;
  if (rest !== "") {
    rest = rest.slice(1); // any single separator character
    m = TIME_RE.exec(rest);
    if (m === null) return 0;
    h = +m[1]!; mi = +(m[3] ?? 0); sec = +(m[4] ?? 0);
    if (m[5] !== undefined) us = +m[5].slice(0, 6).padEnd(6, "0");
    if (h > 23 || mi > 59 || sec > 59) return 0;
    const tz = rest.slice(m[0].length);
    if (tz !== "") {
      const o = OFFSET_RE.exec(tz);
      if (o === null) return 0;
      if (o[1] !== undefined) off = 0;
      else {
        const oh = +o[3]!, om = +(o[5] ?? 0), os = +(o[6] ?? 0);
        const ous = o[7] === undefined ? 0 : +o[7].slice(0, 6).padEnd(6, "0");
        const tot = oh * 3600 + om * 60 + os + ous / 1e6;
        if (tot >= 86400) return 0;
        off = o[2] === "-" ? -tot : tot;
      }
    }
  }
  const wall = new Date(0);
  wall.setUTCFullYear(y, mo - 1, d);
  wall.setUTCHours(h, mi, sec, 0);
  const wallS = wall.getTime() / 1000;
  if (off !== null) return (Math.round((wallS - off) * 1e6) + us) / 1e6;
  const loc = new Date(0);
  loc.setFullYear(y, mo - 1, d);
  loc.setHours(h, mi, sec, 0);
  if (y === 1 || (y === 9999 && mo === 12 && d === 31)) return 0;
  return loc.getTime() / 1000 + us / 1e6;
}

const asTs = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (typeof v === "string") return isoToTs(v);
  return 0;
};

type Step = { done: Obj } | { need: [string, string, string]; finish: (r: FetchResult) => Obj };

function begin(opts: CollectRankingsOptions): Step {
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();
  const ttl = minRefetchS(env as NodeJS.ProcessEnv);
  const [start, end] = window(opts.today);
  const prev = opts.previous ?? null;
  if (prev && prev["status"] === "ok" && !orEmpty(prev["sample"], null) && !orEmpty(prev["last_error"], null) &&
    now.getTime() / 1000 - asTs(prev["fetched_at"]) < ttl) {
    return { done: prev };
  }
  const key = String(env[KEY_ENV] ?? "").trim();
  const fail = (reason: string): Obj => {
    if (prev && prev["status"] === "ok") {
      const kept: Obj = { ...prev };
      if (!("ttl_s" in kept)) kept["ttl_s"] = ttl;
      kept["last_error"] = { reason, at: localIsoSeconds(now) };
      return kept;
    }
    return unavailable(reason, start, end, ttl);
  };
  if (!key) return { done: fail(`${KEY_ENV} is not set`) };
  return {
    need: [start, end, key],
    finish: ({ resp, reason }) => {
      if (resp !== null && resp !== undefined) {
        if (isRecord(resp) && Array.isArray(resp["data"])) return assemble(resp, start, end, ttl, now);
        return fail("response had no data list");
      }
      return fail(reason ?? "response had no data list");
    },
  };
}

/** Synchronous collect (injected sync fetcher: fixtures, tests, parity). */
export function collectRankings(opts: CollectRankingsOptions & { fetcher: SyncFetcher }): Obj {
  const s = begin(opts);
  return "done" in s ? s.done : s.finish(opts.fetcher(...s.need));
}

/** Collect with the real (async) network fetcher by default. */
export async function collectRankingsAsync(
  opts: CollectRankingsOptions & { fetcher?: AsyncFetcher } = {},
): Promise<Obj> {
  const s = begin(opts);
  return "done" in s ? s.done : s.finish(await (opts.fetcher ?? fetchRankings)(...s.need));
}

/** Previous payload at `file`, or null when absent/unreadable. */
export function readPrevious(file: string): Obj | null {
  try {
    const v = parsePy(fs.readFileSync(file, "utf8"));
    return isRecord(v) ? v : null;
  } catch {
    return null;
  }
}
