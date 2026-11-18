/** Collector port — T-16 (LLMTELEMET-287).
 *
 * Port of src/llm_telemetry/session_timeline.py: pure span-building for one
 * session's shape over time. Lanes: model, tool, delegation, compaction, user.
 */

import { cmpStr } from "./pySort.js";

type Obj = Record<string, unknown>;

export interface Span {
  lane: string; start: number; end: number; label: string; color_key: string;
  failed: boolean; meta: Obj;
}

export interface TimelineMessage {
  role: string | null; timestamp: number; model?: string | null; tool_name?: string; outcome?: string;
}
export interface TimelineDelegation {
  dispatched_at: number; completed_at: number | null; status: string | null; child_id: string | null;
  model?: string | null;
}

const truthy = (v: unknown): boolean => !(v === null || v === undefined || v === false || v === 0 || v === "");

function span(lane: string, start: number, end: number, label: string, colorKey: string,
  failed = false, meta: Obj = {}): Span {
  return { lane, start, end: Math.max(end, start), label, color_key: colorKey, failed, meta };
}

/** A flat list of spans across all lanes, sorted by (start, lane). */
export function buildSpans(
  messages: TimelineMessage[],
  delegations: TimelineDelegation[] = [],
  compactions: Array<{ start: number; end: number }> = [],
): Span[] {
  const spans: Span[] = [];

  let run: Span | null = null;
  for (const m of messages) {
    if (m.role !== "assistant" || !truthy(m.model)) continue;
    const ts = m.timestamp;
    const model = m.model as string;
    if (run && run.color_key === model) {
      run.end = ts;
    } else {
      if (run) spans.push(run);
      run = span("model", ts, ts, model, model);
    }
  }
  if (run) spans.push(run);

  for (const m of messages) {
    if (m.role !== "tool" || !truthy(m.tool_name)) continue;
    const ts = m.timestamp;
    spans.push(span("tool", ts, ts, m.tool_name as string, m.tool_name as string,
      m.outcome === "fail", { outcome: m.outcome ?? null }));
  }

  for (const m of messages) {
    if (m.role !== "user") continue;
    spans.push(span("user", m.timestamp, m.timestamp, "user turn", "user"));
  }

  for (const d of delegations) {
    spans.push(span(
      "delegation", d.dispatched_at, truthy(d.completed_at) ? (d.completed_at as number) : d.dispatched_at,
      truthy(d.child_id) ? (d.child_id as string) : "(delegation)",
      truthy(d.model) ? (d.model as string) : "(unknown)",
      !(d.status === null || d.status === undefined || d.status === "completed"),
      { status: d.status ?? null }));
  }

  for (const c of compactions) spans.push(span("compaction", c.start, c.end, "compaction", "compaction"));

  spans.sort((a, b) => (a.start !== b.start ? a.start - b.start : cmpStr(a.lane, b.lane)));
  return spans;
}

export interface TimelineSession {
  id: string; title: string | null; source: string | null; started_at: number; ended_at: number | null;
  end_reason: string | null; models: string[]; input_tokens: number; output_tokens: number;
  cache_read_tokens: number; estimated_cost_usd: number; actual_cost_usd: number;
}

/** The full per-session payload: header + spans + axis bounds. A still-running
 * session extends the axis to `now` and reports running=true. */
export function buildTimeline(
  session: TimelineSession,
  messages: TimelineMessage[],
  delegations: TimelineDelegation[] = [],
  compactions: Array<{ start: number; end: number }> = [],
  now: number | null = null,
): Obj {
  const started = session.started_at;
  const ended = session.ended_at ?? null;
  const running = ended === null;
  const axisEnd = !running ? ended : (now !== null ? now : started);
  return {
    id: session.id,
    title: truthy(session.title) ? session.title : "(untitled)",
    source: session.source ?? null,
    models: session.models.length ? session.models : [],
    started_at: started,
    ended_at: ended,
    running,
    end_reason: session.end_reason ?? null,
    axis_start: started,
    axis_end: axisEnd,
    input_tokens: session.input_tokens ?? 0,
    output_tokens: session.output_tokens ?? 0,
    cache_read_tokens: session.cache_read_tokens ?? 0,
    estimated_cost_usd: session.estimated_cost_usd ?? 0,
    actual_cost_usd: session.actual_cost_usd ?? 0,
    bytes_up: 0,
    bytes_down: 0,
    spans: buildSpans(messages, delegations, compactions),
  };
}
