/** Gateway "is anything actually running" — T-6 (LLMTELEMET-285).
 *
 * Port of `agents_alive.py` (pure functions; the /proc liveness check is
 * isolated behind one injectable function). A backend is "alive" while its
 * heartbeat is fresh and "stale" past ALIVE_THRESHOLD_S; the /proc check can
 * only prove death on THIS host — a stale row from another fleet host is
 * never asserted dead-by-pid across a host boundary.
 */

export const HEARTBEAT_INTERVAL_S = 60;
export const ALIVE_THRESHOLD_S = HEARTBEAT_INTERVAL_S * 2;

import * as fs from "node:fs";

export interface Heartbeat {
  backend_id: string;
  pid: number;
  started_at: number | null;
  last_heartbeat: number;
  profile: string;
  host: string;
}

export interface Lease {
  conversation_id: string;
  holder: string;
  acquired_at: number | null;
  expires_at: number | null;
}

export interface AgentRow {
  backend: string;
  profile: string;
  host: string;
  pid: number;
  last_heartbeat: number;
  age_s: number;
  state: string;
  leases: number;
  kill_hint: string | null;
}

/** pid_exists(pid, host) -> true/false, or null when unverifiable (other host). */
export type PidExists = (pid: number, host: string) => boolean | null;

export function defaultPidExists(thisHost: string): PidExists {
  return (pid: number, host: string): boolean | null => {
    if (host !== thisHost) return null;
    try {
      // /proc/<pid> existence, injectable for tests (Python parity).
      return fs.existsSync(`/proc/${String(pid)}`);
    } catch {
      return null;
    }
  };
}

export function buildAgents(
  heartbeats: readonly Heartbeat[],
  leases: readonly Lease[],
  thisHost: string,
  now: number,
  pidExists?: PidExists,
): AgentRow[] {
  const exists = pidExists ?? defaultPidExists(thisHost);
  // Leases carry no backend id: count them per backend by matching the
  // holder's pid=… against each heartbeat's pid.
  const leaseCounts = new Map<number, number>();
  for (const lease of leases) {
    const holder = lease.holder ?? "";
    let pid: number | null = null;
    for (const part of holder.split(":")) {
      if (part.startsWith("pid=")) {
        const n = Number(part.slice(4));
        pid = Number.isInteger(n) ? n : null;
        break;
      }
    }
    if (pid !== null) leaseCounts.set(pid, (leaseCounts.get(pid) ?? 0) + 1);
  }

  const agents: AgentRow[] = [];
  for (const hb of heartbeats) {
    const age = now - hb.last_heartbeat;
    let state = age <= ALIVE_THRESHOLD_S ? "alive" : "stale";
    const aliveCheck = exists(hb.pid, hb.host);
    if (aliveCheck === false) state = "dead";
    agents.push({
      backend: hb.backend_id,
      profile: hb.profile,
      host: hb.host,
      pid: hb.pid,
      last_heartbeat: hb.last_heartbeat,
      age_s: Number(age.toFixed(1)),
      state,
      leases: leaseCounts.get(hb.pid) ?? 0,
      kill_hint: state === "dead" ? `kill ${String(hb.pid)}` : null,
    });
  }
  agents.sort((a, b) =>
    Number(a.state !== "dead") - Number(b.state !== "dead") ||
    Number(a.state !== "stale") - Number(b.state !== "stale") ||
    a.age_s - b.age_s,
  );
  return agents;
}
