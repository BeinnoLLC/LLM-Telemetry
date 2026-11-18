/** Port of `llm_telemetry/latency.py` (T-15, LLMTELEMET-286): p50/p90/p99 of
 * assistant-turn gaps per model and endpoint, idle gaps excluded. */
import { pyRound, pyRound0 } from "./pySemantics.js";

export const DEFAULT_IDLE_THRESHOLD_S = 600;

export interface Gap {
  session: string;
  ts: number;
  model: string | null;
  base_url: string | null;
  s: number;
  tok_s: number | null;
}
export type TurnRow = [string, number, string | null, string | null, number | null];

/** Nearest-rank percentile of a sorted list; null when empty (not 0). */
export function percentile(sorted: number[], pct: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, pyRound0((pct / 100.0) * (sorted.length - 1)));
  return sorted[idx] as number;
}

export function computeGaps(rows: TurnRow[], idleThresholdS = DEFAULT_IDLE_THRESHOLD_S): { gaps: Gap[]; idle: Gap[] } {
  const turnsOf = new Map<string, [number, string | null, string | null, number | null][]>();
  for (const [sid, ts, model, baseUrl, outTok] of rows) {
    let t = turnsOf.get(sid);
    if (!t) turnsOf.set(sid, (t = []));
    t.push([ts, model, baseUrl, outTok]);
  }
  const gaps: Gap[] = [];
  const idle: Gap[] = [];
  for (const [sid, turns] of turnsOf) {
    turns.sort((a, b) => a[0] - b[0]); // stable, like Python's list.sort
    for (let i = 1; i < turns.length; i++) {
      const prevTs = (turns[i - 1] as (typeof turns)[number])[0];
      const [ts, model, baseUrl, outTok] = turns[i] as (typeof turns)[number];
      const delta = ts - prevTs;
      if (delta < 0) continue;
      const tokS = outTok && delta > 0 ? outTok / delta : null;
      const row: Gap = {
        session: sid, ts, model, base_url: baseUrl, s: pyRound(delta, 3),
        tok_s: tokS !== null ? pyRound(tokS, 2) : null,
      };
      (delta > idleThresholdS ? idle : gaps).push(row);
    }
  }
  return { gaps, idle };
}

export function buildLatency(
  gaps: Gap[],
  endpointOf: (baseUrl: string | null) => string | null | undefined,
  slowestN = 10,
) {
  const byModelRaw = new Map<string, Gap[]>();
  const byEndpointRaw = new Map<string, Gap[]>();
  for (const g of gaps) {
    const m = g.model || "(unknown)";
    (byModelRaw.get(m) ?? byModelRaw.set(m, []).get(m) as Gap[]).push(g);
    const ep = endpointOf(g.base_url) || "(unknown)";
    (byEndpointRaw.get(ep) ?? byEndpointRaw.set(ep, []).get(ep) as Gap[]).push(g);
  }
  const summarize = (rows: Gap[]) => {
    const secs = rows.map((r) => r.s).sort((a, b) => a - b);
    const tok = rows.filter((r) => r.tok_s !== null).map((r) => r.tok_s as number).sort((a, b) => a - b);
    return { n: rows.length, p50: percentile(secs, 50), p90: percentile(secs, 90), p99: percentile(secs, 99), tok_s: percentile(tok, 50) };
  };
  const fold = (m: Map<string, Gap[]>) => Object.fromEntries([...m].map(([k, v]) => [k, summarize(v)]));
  const slowest = [...gaps].sort((a, b) => b.s - a.s).slice(0, slowestN)
    .map((g) => ({ session: g.session, ts: g.ts, model: g.model, s: g.s }));
  return { by_model: fold(byModelRaw), by_endpoint: fold(byEndpointRaw), slowest };
}
