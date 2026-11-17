/** Parsed PI session metadata + the shared JSONL walker — T-6
 * (LLMTELEMET-285), port of the `collect_pi_agents.py` pieces
 * `collect_pi_live` reuses (PISession fields, _iso_to_unix,
 * parse_pi_session_jsonl).
 */
import * as fs from "node:fs";

export interface PiParsedSession {
  agentName: string;
  sessionId: string;
  timestamp: string;
  cwd: string;
  model: string | null;
  provider: string | null;
  thinkingLevel: string | null;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
  rawEvents: Array<Record<string, unknown>>;
}

/** ISO 8601 -> unix seconds, mirroring Python `_iso_to_unix`
 * (collect_pi_agents.py): `datetime.fromisoformat(ts.replace("Z", "+00:00"))`
 * -> `.timestamp()`, with any unparseable input falling back to the current
 * time (also on non-strings, which raise AttributeError there). The accepted
 * grammar mirrors CPython 3.11+'s lenient `fromisoformat` (pinned against the
 * repo venv, Python 3.12.3):
 * - dates: `YYYY-MM-DD`, `YYYYMMDD`, `YYYY-Www-D`, `YYYYWwwD`, and week forms
 *   without a day (`YYYY-Www`, `YYYYWww` -> Monday); for basic week dates a
 *   trailing digit is always the day (greedy), so `2026W4212:04` is invalid;
 * - time: optional separator character (ANY character, e.g. `T`, space or a
 *   digit) then `HH[:MM[:SS]]` extended, `HHMM[SS]` compact, hour-only, with
 *   `.`/`,` fractions of 1+ digits truncated at 6 (`21.5`, `2104.5`,
 *   `21:04,5`);
 * - time components are strict (`21:60` rejects) but timezone offsets are
 *   normalised into a total strictly below one day (`+03:60` == 04:00:00,
 *   `+03:00:60` carries, `+23:59:60` rejects);
 * - no timezone -> the wall time is read in the process local timezone
 *   (Python naive `datetime.timestamp()`); with one -> fixed offset.
 */
export function isoToUnix(ts: string): number {
  const now = Date.now() / 1000;
  // Python catches the AttributeError for non-strings: same "now" fallback.
  if (typeof ts !== "string") return now;
  // Python `iso_str.replace("Z", "+00:00")`.
  const s = ts.replace(/Z/g, "+00:00");
  for (const form of DATE_FORMS) {
    const dm = form.re.exec(s);
    if (dm === null) continue;
    const date = resolveDateForm(form.kind, dm);
    if (date === null) continue;
    const rest = s.slice(dm[0].length);
    if (rest === "") {
      // Date-only: a naive Python datetime -> local midnight.
      return new Date(date.y, date.mo - 1, date.d).getTime() / 1000;
    }
    if (rest.length < 2) return now; // separator character with no time left
    const time = parseIsoTimePart(rest.slice(1));
    if (time === null) return now;
    const { h, mi, s: sc, us } = time.core;
    if (time.tzS === null) {
      // No timezone: naive wall time in the local timezone (Python
      // `datetime.timestamp()`); `setFullYear` avoids the 0-99 year remap.
      return new Date(date.y, date.mo - 1, date.d, h, mi, sc, Math.floor(us / 1000)).getTime() / 1000 + (us % 1000) / 1e6;
    }
    const tzS = time.tzS;
    // With a timezone Python applies a fixed offset, no DST rules: pure
    // integer proleptic-Gregorian math, no Date-object quirks (Date.UTC
    // remaps years 0-99).
    return (
      daysFromCivil(date.y, date.mo, date.d) * 86400 +
      h * 3600 +
      mi * 60 +
      sc +
      us / 1e6 -
      tzS
    );
  }
  return now;
}

/** Proleptic-Gregorian days since 1970-01-01 (Howard Hinnant's
 * civil_from_days; the JS Date object remaps years 0-99, so date-part math
 * stays in plain integers). */
function daysFromCivil(y: number, mo: number, d: number): number {
  const yy = mo <= 2 ? y - 1 : y;
  const m2 = mo <= 2 ? mo + 12 : mo;
  const era = Math.floor((yy >= 0 ? yy : yy - 399) / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m2 - 3) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** `civil_from_days` inverse: (y, mo, d) of the k-th day (integer days since
 * 1970-01-01). */
function civilFromDays(days: number): { y: number; mo: number; d: number } {
  const z = days + 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const yr = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const mo = mp < 10 ? mp + 3 : mp - 9;
  return { y: mo <= 2 ? yr + 1 : yr, mo, d };
}

/** ISO weekday (1=Mon..7=Sun) of a civil day; 1970-01-01 was a Thursday. */
function isoDowOfCivil(days: number): number {
  return (((days % 7) + 3) % 7) + 1;
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, mo: number): number {
  if (mo === 2) return isLeapYear(y) ? 29 : 28;
  if (mo <= 7) return mo % 2 === 1 ? 31 : 30;
  return mo % 2 === 1 ? 30 : 31;
}

/** A proleptic-Gregorian year has a 53rd ISO week iff Jan 1 is a Thursday,
 * or Jan 1 is a Wednesday in a leap year. */
function yearHasIso53(y: number): boolean {
  const dow = isoDowOfCivil(daysFromCivil(y, 1, 1));
  return dow === 4 || (dow === 3 && isLeapYear(y));
}

/** ISO week date -> (y, mo, d), like `date.fromisocalendar`: week 1 is the
 * week containing Jan 4, days run Monday(1)-Sunday(7). */
function isoWeekDate(
  y: number,
  w: number,
  wd: number,
): { y: number; mo: number; d: number } {
  const jan4 = daysFromCivil(y, 1, 4);
  const mondayW1 = jan4 - (isoDowOfCivil(jan4) - 1);
  return civilFromDays(mondayW1 + (w - 1) * 7 + (wd - 1));
}

const DATE_FORMS: ReadonlyArray<{ re: RegExp; kind: "ymd" | "weekDay" | "weekMonday" }> = [
  { re: /^(\d{4})-(\d{2})-(\d{2})/, kind: "ymd" },
  { re: /^(\d{4})(\d{2})(\d{2})/, kind: "ymd" },
  { re: /^(\d{4})-W(\d{2})-(\d)/, kind: "weekDay" },
  { re: /^(\d{4})W(\d{2})(\d)/, kind: "weekDay" },
  // The (?!\d) guard makes week dates with a trailing day digit resolve
  // through the weekday forms only (CPython's greedy day): no re-split of
  // `2026W4212:04` into week 42 + time.
  { re: /^(\d{4})-W(\d{2})(?!\d)/, kind: "weekMonday" },
  { re: /^(\d{4})W(\d{2})(?!\d)/, kind: "weekMonday" },
];

/** Validated (y, mo, d) from one DATE_FORMS match, or null on a Python
 * `ValueError` (year 0, impossible month/day, week 53 in a 52-week year). */
function resolveDateForm(
  kind: "ymd" | "weekDay" | "weekMonday",
  m: RegExpExecArray,
): { y: number; mo: number; d: number } | null {
  const y = Number(m[1]);
  if (y < 1) return null;
  if (kind === "ymd") {
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12) return null;
    if (d < 1 || d > daysInMonth(y, mo)) return null;
    return { y, mo, d };
  }
  const w = Number(m[2]);
  const wd = kind === "weekMonday" ? 1 : Number(m[3]);
  if (w < 1 || w > 53 || wd < 1 || wd > 7) return null;
  if (w === 53 && !yearHasIso53(y)) return null;
  return isoWeekDate(y, w, wd);
}

const TIME_CORE_RE =
  /^(?:(\d{2})(?::(\d{2})(?::(\d{2}))?)?|(\d{2})(\d{2})?(\d{2})?)(?:[.,](\d+))?$/;

interface IsoTimeCore {
  h: number;
  mi: number;
  s: number;
  us: number;
}

/** HH/MM/SS/us of one TIME_CORE_RE match (branch 1 extended groups 1-3,
 * branch 2 compact groups 4-6); fractions truncate at 6 digits, like Python
 * microseconds. Range checks stay with the caller: the main time is strict,
 * timezone offsets normalise components into a total instead. */
function timeCoreParts(m: RegExpExecArray): IsoTimeCore {
  const h = Number(m[1] ?? m[4]);
  const mi = Number(m[2] ?? m[5] ?? 0);
  const s = Number(m[3] ?? m[6] ?? 0);
  const f = m[7];
  const us = f === undefined ? 0 : Number(f.slice(0, 6).padEnd(6, "0"));
  return { h, mi, s, us };
}

/** Full-string time grammar: strict `HH[:MM[:SS]]` / `HHMM[SS]` with a
 * `.`/`,` fraction and an optional timezone offset (sign-prefixed core:
 * `+03:60` normalises to a 4h total, `+23:59:60` breaks the strict < 24h
 * bound; time components themselves never exceed 23/59/59). */
function parseIsoTimePart(s: string): { core: IsoTimeCore; tzS: number | null } | null {
  let coreStr = s;
  let tzStr: string | null = null;
  const signAt = s.search(/[+-]/);
  if (signAt > 0) {
    // The first sign ends the core (digits/`:`/`.`/`,` never contain +/-).
    coreStr = s.slice(0, signAt);
    tzStr = s.slice(signAt);
  } else if (signAt === 0) {
    return null; // a time never starts with a sign
  }
  const cm = TIME_CORE_RE.exec(coreStr);
  if (cm === null) return null;
  const core = timeCoreParts(cm);
  if (core.h > 23 || core.mi > 59 || core.s > 59) return null;
  let tzS: number | null = null;
  if (tzStr !== null) {
    const ocm = TIME_CORE_RE.exec(tzStr.slice(1));
    if (ocm === null) return null;
    const off = timeCoreParts(ocm);
    const total = off.h * 3600 + off.mi * 60 + off.s + off.us / 1e6;
    if (total >= 86400) return null; // Python timezone: strictly below a day
    tzS = tzStr[0] === "-" ? -total : total;
  }
  return { core, tzS };
}

/** Python `int`/`float` semantics for `usage += v` mirrors: a missing key takes
 * the default, bools count as 1/0 (bool is an int in Python), anything else
 * raises TypeError so the whole session drops exactly like Python's
 * `except (json.JSONDecodeError, KeyError, TypeError)`.
 */
function usageNum(u: Record<string, unknown>, key: string, dflt: number): number {
  const v = u[key];
  if (v === undefined) return dflt;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  throw new TypeError(`usage.${key} is not numeric`);
}

/** Python truthiness for the `if usage:` gate ({} / [] / "" / 0 / null are
 * falsy there). */
function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

/** Parse one PI session JSONL file. Matches `parse_pi_session_jsonl` exactly:
 * a non-numeric usage value raises TypeError inside Python's `+=` chain and
 * drops the whole session (it is never coerced to 0). */
export function parsePiSessionJsonl(jsonlPath: string): PiParsedSession | null {
  let lines: string[];
  try {
    lines = fs.readFileSync(jsonlPath, "utf8").split(/\r?\n/);
  } catch {
    return null;
  }
  let session: PiParsedSession | null = null;
  const events: Array<Record<string, unknown>> = [];
  try {
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const event = JSON.parse(line) as Record<string, unknown>;
      events.push(event);
      if (event["type"] === "session") {
        session = {
          agentName: jsonlPath.split(/[/\\]/).slice(-3, -2)[0] ?? "",
          sessionId: typeof event["id"] === "string" ? event["id"] : "",
          timestamp: typeof event["timestamp"] === "string" ? event["timestamp"] : "",
          cwd: typeof event["cwd"] === "string" ? event["cwd"] : "",
          model: null,
          provider: null,
          thinkingLevel: null,
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalCost: 0,
          rawEvents: events,
        };
      } else if (event["type"] === "model_change") {
        if (session) {
          session.provider = typeof event["provider"] === "string" ? event["provider"] : null;
          session.model = typeof event["modelId"] === "string" ? event["modelId"] : null;
        }
      } else if (event["type"] === "thinking_level_change") {
        if (session) {
          session.thinkingLevel =
            typeof event["thinkingLevel"] === "string" ? event["thinkingLevel"] : null;
        }
      } else if (event["type"] === "message" && session) {
        const msg = (event["message"] ?? {}) as Record<string, unknown>;
        if (msg["role"] === "assistant") {
          const usage = event["usage"];
          if (pyTruthy(usage)) {
            if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
              throw new TypeError("usage is not a mapping");
            }
            const u = usage as Record<string, unknown>;
            session.inputTokens += usageNum(u, "input", 0);
            session.outputTokens += usageNum(u, "output", 0);
            session.cacheReadTokens += usageNum(u, "cacheRead", 0);
            session.cacheWriteTokens += usageNum(u, "cacheWrite", 0);
            session.totalTokens += usageNum(u, "totalTokens", 0);
            const cost = u["cost"];
            if (cost !== null && typeof cost === "object" && !Array.isArray(cost)) {
              session.totalCost += usageNum(cost as Record<string, unknown>, "total", 0.0);
            }
          }
        }
      }
    }
  } catch {
    return null;
  }
  return session && session.sessionId ? session : null;
}
