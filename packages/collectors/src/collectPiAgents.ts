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

/** ISO 8601 -> unix seconds; Python `_iso_to_unix` falls back to "now" on
 * unparseable input. */
export function isoToUnix(ts: string): number {
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? Date.now() / 1000 : ms / 1000;
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
