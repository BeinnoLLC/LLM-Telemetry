/** Port of `llm_telemetry/tool_outcomes.py` (T-15, LLMTELEMET-286): classify a
 * tool-result message as ok / fail / unknown from structured signals only. */

const FAIL_DISPOSITIONS = new Set(["failed", "error", "denied", "blocked", "rejected", "timeout", "cancelled"]);
const OK_DISPOSITIONS = new Set(["applied", "approved", "completed", "success", "ok", "written", "sent"]);
const FAIL_FINISH_REASONS = new Set(["error", "tool_error", "exception", "timeout"]);

export type Outcome = "ok" | "fail" | "unknown";
export interface OutcomeMsg {
  content?: unknown;
  effect_disposition?: unknown;
  finish_reason?: unknown;
}

/** Python `_parsed_json`: a dict on success, else null — never throws. */
export function parsedJson(content: unknown): Record<string, unknown> | null {
  if (typeof content !== "string" || content.trim() === "") return null;
  let doc: unknown;
  try {
    doc = JSON.parse(content);
  } catch {
    return null;
  }
  return doc !== null && typeof doc === "object" && !Array.isArray(doc) ? (doc as Record<string, unknown>) : null;
}

const norm = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");

/** Python `int(x) == 0` outcome for `exit_code`; null when `int()` would raise. */
function exitCodeIsZero(v: unknown): boolean | null {
  if (typeof v === "boolean") return !v;
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) === 0 : null;
  if (typeof v === "string") {
    if (!/^\s*[+-]?\d+(?:_\d+)*\s*$/.test(v)) return null;
    return Number(v.replaceAll("_", "").trim()) === 0;
  }
  return null;
}

export function toolOutcome(msg: OutcomeMsg): Outcome {
  const disp = norm(msg.effect_disposition);
  if (FAIL_DISPOSITIONS.has(disp)) return "fail";
  if (OK_DISPOSITIONS.has(disp)) return "ok";
  if (FAIL_FINISH_REASONS.has(norm(msg.finish_reason))) return "fail";

  const doc = parsedJson(msg.content);
  if (doc !== null) {
    if ("exit_code" in doc) {
      const z = exitCodeIsZero(doc["exit_code"]);
      if (z !== null) return z ? "ok" : "fail";
    }
    if (typeof doc["success"] === "boolean") return doc["success"] ? "ok" : "fail";
    if (doc["not_found"] === true) return "fail";
    if (doc["not_found"] === false) return "ok";
    const err = doc["error"];
    // Python `err not in (None, "", False)`: 0 == False, so 0 / 0.0 abstain too.
    if (!(err === undefined || err === null || err === "" || err === false || err === 0)) return "fail";
  }
  return "unknown";
}
