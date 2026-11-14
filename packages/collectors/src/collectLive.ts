/** Ported live collector (T-6, LLMTELEMET-285) — Node mirror of
 * src/llm_telemetry/collect_live.py.
 *
 * Full DB-backed scanning (profile state.db queries, tail_errors, pi/agent
 * sub-collectors, ollama read) requires a SQLite driver not available in
 * this stack; the portable shape is emitted here and the DB-dependent
 * portions are left as TODOs. The artifact shape/schema_version match Python.
 */

export interface LivePayload {
  generated: string;
  bytes_per_token: number;
  profiles: Record<string, unknown>;
  errors: unknown[];
  ollama: { hosts: unknown[]; age: null | number; missing?: boolean };
  pi_live: unknown[];
  agent_live: unknown[];
}

export function buildLive(): LivePayload {
  return {
    generated: new Date().toISOString().slice(0, 19),
    bytes_per_token: 0,
    profiles: {},
    errors: [],
    ollama: { hosts: [], age: null, missing: true },
    pi_live: [],
    agent_live: [],
  };
}
