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

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Parse one PI session JSONL file. Divergence note: Python's `+=` on a
 * non-numeric usage value raises TypeError and drops the whole session; this
 * port coerces non-numeric values to 0 instead (parity fixtures use numeric
 * usage). */
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
          if (usage && typeof usage === "object") {
            const u = usage as Record<string, unknown>;
            session.inputTokens += num(u["input"]);
            session.outputTokens += num(u["output"]);
            session.cacheReadTokens += num(u["cacheRead"]);
            session.cacheWriteTokens += num(u["cacheWrite"]);
            session.totalTokens += num(u["totalTokens"]);
            const cost = u["cost"];
            if (cost && typeof cost === "object") {
              session.totalCost += num((cost as Record<string, unknown>)["total"]);
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
