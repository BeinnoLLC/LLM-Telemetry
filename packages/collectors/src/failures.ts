/** Error-log failure parsing — T-6 (LLMTELEMET-285), port of `failures.py`
 * (classify/model/ts regexes) plus collect_live.tail_errors and
 * collect_quota's secret scrub.
 *
 * The database records only successful usage, so failed calls are invisible
 * there; failures live in the profile's errors.log next to structured
 * `provider=… model=…` markers. Secrets in log lines are redacted before the
 * payload is ever written.
 */
import * as fs from "node:fs";
import type { Config } from "./config.js";

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_\-]{8,}/g,
  /gh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bbearer\s+[A-Za-z0-9._\-]{8,}/gi,
  /\b(api[_\-]?key|access[_\-]?token|refresh[_\-]?token|secret|password)\b\s*[:=]\s*\S+/gi,
  /[A-Za-z0-9_\-]{40,}/g,
];
const SECRET_REPLACEMENT = "[REDACTED]";

/** Redact credential-shaped substrings (parity with collect_live.scrub_secrets). */
export function scrubSecrets(text: string | null | undefined): string {
  let out = text ?? "";
  for (const pat of SECRET_PATTERNS) {
    out = out.replace(pat, SECRET_REPLACEMENT);
  }
  return out;
}

/** collect_quota.scrub(): scrub + length cap. */
export function scrub(text: string | null | undefined): string {
  return scrubSecrets(text).slice(0, 400);
}

export const MODEL_ONLY = /model=([^\s|]+)/;
export const TS_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/;

const KINDS: Array<[string, string[]]> = [
  ["rate_limit", ["429", "rate limit", "usage limit", "out of capacity", "quota"]],
  ["overloaded", ["overloaded", "503", "502", "capacity"]],
  ["timeout", ["timed out", "timeout"]],
  ["auth", ["401", "403", "unauthorized", "forbidden", "expired", "invalid api key"]],
  ["server_error", ["500", "internal server"]],
  ["unavailable", ["unavailable", "not supported", "no fallback"]],
];

export function classify(line: string): string | null {
  const low = line.toLowerCase();
  for (const [kind, needles] of KINDS) {
    if (needles.some((n) => low.includes(n))) return kind;
  }
  return null;
}

export interface ErrorRow {
  ts: number;
  profile: string;
  level: string;
  kind: string;
  model: string;
  msg: string;
}

/** Parse "YYYY-MM-DD HH:MM:SS" as local time -> unix seconds (mktime parity). */
function parseLocalTs(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4]), Number(m[5]), Number(m[6]),
  );
  return d.getTime() / 1000;
}

/** Recent failure lines from every profile's errors.log, newest first
 * (collect_live.tail_errors, limit=60, window_s=7200). */
export function tailErrors(cfg: Config, now: number, limit = 60, windowS = 7200): ErrorRow[] {
  const out: ErrorRow[] = [];
  const cutoff = now - windowS;
  for (const prof of cfg.liveProfiles()) {
    const p = prof.errorsLog;
    if (!p || !fs.existsSync(p)) continue;
    let text: string;
    try {
      const buf = fs.readFileSync(p);
      const start = Math.max(0, buf.length - 400_000);
      text = buf.subarray(start).toString("utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const kind = classify(line);
      if (!kind) continue;
      const hasModel = MODEL_ONLY.test(line);
      const hasHttp = /(?:HTTP|status|code|Error code:)\s*[:=]?\s*(4\d\d|5\d\d)\b/i.test(line);
      if (!(hasModel || hasHttp)) continue;
      const tsm = TS_RE.exec(line);
      if (!tsm?.[1]) continue;
      let ts: number | null = null;
      try {
        ts = parseLocalTs(tsm[1]);
      } catch {
        ts = null;
      }
      if (ts === null) continue;
      if (ts < cutoff) continue;
      // Python tail_errors keeps the line verbatim (marker-trimmed only):
      // scrub_secrets runs in the title path, not here.
      let msg = line.trim();
      for (const marker of ["HTTP ", "Error code: ", "error_type="]) {
        const i = msg.indexOf(marker);
        if (i !== -1) {
          msg = msg.slice(i);
          break;
        }
      }
      const mm = MODEL_ONLY.exec(line);
      out.push({
        ts,
        profile: prof.name,
        level: "error",
        kind,
        model: mm?.[1] ?? "",
        msg: msg.slice(0, 180),
      });
    }
  }
  out.sort((a, b) => b.ts - a.ts);
  return out.slice(0, limit);
}

export interface FailStat { total: number; last: string; last_msg: string; last_kind: string; [kind: string]: number | string }
export interface FailEvent { model: string; when: string; kind: string; msg: string }

/** failures.parse: per-model failure stats + newest 60 events from one errors.log. */
export function parseErrors(path: string, sinceDays = 7, nowS = Date.now() / 1000): [Record<string, FailStat>, FailEvent[]] {
  const stats: Record<string, FailStat> = {};
  const events: FailEvent[] = [];
  if (!path || !fs.existsSync(path)) return [stats, events];
  const cutoff = nowS - sinceDays * 86400;
  let lines: string[];
  try {
    const raw = fs.readFileSync(path, "utf8").split("\n");
    if (raw.at(-1) === "") raw.pop();
    lines = raw.slice(-60000);
  } catch {
    return [stats, events];
  }
  for (const line of lines) {
    const kind = classify(line);
    if (!kind) continue;
    const low = line.toLowerCase();
    if (!line.includes("API call failed") && !low.includes("auxiliary") && !low.includes("unhealthy")) continue;
    const kv = /provider=([\w.:-]+)\s+model=([^\s|]+)/.exec(line);
    const model = kv ? kv[2] : (MODEL_ONLY.exec(line)?.[1] ?? null);
    if (!model) continue;
    const ts = TS_RE.exec(line)?.[1] ?? "";
    if (ts) {
      const t = parseLocalTs(ts);
      if (t !== null && t < cutoff) continue;
    }
    const s = (stats[model] ??= { total: 0, last: "", last_msg: "", last_kind: "" });
    s[kind] = ((s[kind] as number | undefined) ?? 0) + 1;
    s.total += 1;
    let msg = line.trim();
    for (const marker of ["HTTP ", "Error code: ", "error_type="]) {
      const i = msg.indexOf(marker);
      if (i !== -1) { msg = msg.slice(i); break; }
    }
    msg = msg.slice(0, 150);
    events.push({ model, when: ts, kind, msg });
    if (ts >= s.last) { s.last = ts; s.last_kind = kind; s.last_msg = msg; }
  }
  // Python sort(reverse=True) is stable for equal keys (keeps original order).
  const idx = events.map((e, i) => [e, i] as const);
  idx.sort((a, b) => (a[0].when < b[0].when ? 1 : a[0].when > b[0].when ? -1 : a[1] - b[1]));
  return [stats, idx.map(([e]) => e).slice(0, 60)];
}

/** failures.for_profile */
export function forProfile(cfg: Config, name: string, sinceDays = 7): [Record<string, FailStat>, FailEvent[]] {
  const p = cfg.liveProfiles().find((x) => x.name === name);
  return parseErrors(p ? p.errorsLog : "", sinceDays);
}
