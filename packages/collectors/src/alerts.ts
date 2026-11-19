/** Port of `alerts.py` (P10-10): every rule that tripped, evaluated over the
 * already-built per-profile analytics payload. */

import { pyRound } from "./pySemantics.js";

type P = Record<string, unknown>;
type Raw = number | [number, ...unknown[]] | unknown[];

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

/** Python truthiness for JSON values. */
function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}
const orEmpty = (v: unknown): P[] => (truthy(v) ? (v as P[]) : []);
const num = (v: unknown, d = 0): number => (truthy(v) ? Number(v) : d);
/** f"{x}" of a Python float: whole values keep their ".0". */
const fl = (x: number): string => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const plural = (n: number): string => (n !== 1 ? "s" : "");
const nowOf = (p: P): number => (p["_now"] !== undefined ? Number(p["_now"]) : Date.now() / 1000);
/** Python max(): the first of the largest items wins. */
function maxBy<T>(xs: T[], key: (x: T) => number): T {
  let best = xs[0] as T;
  for (const x of xs) if (key(x) > key(best)) best = x;
  return best;
}
const sortedUnique = (xs: string[]): string[] => [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

interface Rule {
  name: string; severity: string; target_view: string; why: string;
  predicate: (p: P) => Raw | null;
  message: (v: never) => string;
  threshold: number;
  value: (v: never) => unknown;
}

const unpricedCloud = (p: P): Raw | null => {
  const models = sortedUnique(orEmpty(p["rows"])
    .filter((r) => r["cost_class"] === "metered" && !truthy(r["priced"]))
    .map((r) => (truthy(r["model"]) ? String(r["model"]) : "(unknown)")));
  if (!models.length) return null;
  return [models.length, models.slice(0, 5).join(", ") + (models.length > 5 ? ", ..." : "")];
};

const delegationFailure = (p: P): Raw | null => {
  const d = p["delegations"] as P | undefined;
  if (!d || !truthy(d) || !truthy(d["children"])) return null;
  const total = Number(d["children"]);
  const failed = num(d["failed"]);
  const rate = (100.0 * failed) / total;
  if (rate <= 25.0) return null;
  return [pyRound(rate, 1), failed, total];
};

const orphanReap = (p: P): Raw | null => {
  const now = nowOf(p);
  const n = orEmpty(p["recent_ended"]).filter((s) =>
    (s["end_reason"] === "startup_orphan_reap" || s["end_reason"] === "ws_orphan_reap")
    && now - num(s["ended_at"]) <= 86400).length;
  return n ? n : null;
};

const backendStale = (p: P): Raw | null => {
  const stale = orEmpty(p["agents"]).filter((a) =>
    (a["state"] === "stale" || a["state"] === "dead") && num(a["age_s"]) > 600);
  if (!stale.length) return null;
  const worst = maxBy(stale, (a) => Number(a["age_s"]));
  return [stale.length, worst["backend"], pyRound(Number(worst["age_s"]) / 60.0, 1)];
};

const longSession = (p: P): Raw | null => {
  const now = nowOf(p);
  const long = orEmpty(p["live"]).filter((s) => truthy(s["started_at"]) && now - Number(s["started_at"]) > 3 * 3600);
  if (!long.length) return null;
  const oldest = maxBy(long, (s) => now - Number(s["started_at"]));
  return [long.length, truthy(oldest["title"]) ? oldest["title"] : oldest["id"],
    pyRound((now - Number(oldest["started_at"])) / 3600.0, 1)];
};

const toolFailureHigh = (p: P): Raw | null => {
  const d = p["delegations"] as P | undefined;
  const tools = orEmpty(d ? d["tools"] : undefined);
  const rate = (t: P): number => ("rate" in t ? Number(t["rate"]) : 100.0);
  const bad = tools.filter((t) => num(t["calls"]) >= 5 && 100.0 - rate(t) > 20.0);
  if (!bad.length) return null;
  const worst = maxBy(bad, (t) => 100.0 - Number(t["rate"]));
  return [bad.length, worst["tool"], pyRound(100.0 - Number(worst["rate"]), 1), worst["calls"]];
};

const bandwidthSpike = (p: P): Raw | null => {
  const byDate = new Map<string, number>();
  for (const r of orEmpty(p["bandwidth_daily"])) {
    const d = truthy(r["date"]) ? String(r["date"]) : "";
    byDate.set(d, (byDate.get(d) ?? 0) + Math.trunc(num(r["up_bytes"])) + Math.trunc(num(r["down_bytes"])));
  }
  const dates = sortedUnique([...byDate.keys()]);
  if (dates.length < 2) return null;
  const today = byDate.get(dates.at(-1) as string) as number;
  const trailing = dates.slice(0, -1).map((d) => byDate.get(d) as number);
  const mean = trailing.reduce((a, b) => a + b, 0) / trailing.length;
  if (mean <= 0 || today <= 3 * mean) return null;
  return pyRound(today / mean, 1);
};

const compressionFailure = (p: P): Raw | null => {
  const c = p["context"] as P | undefined;
  const cd = orEmpty(c ? c["cooldowns"] : undefined);
  if (!cd.length) return null;
  const first = cd[0] as P;
  return [cd.length, truthy(first["title"]) ? first["title"] : first["id"]];
};

type A = unknown[];
const RULES: Rule[] = [
  {
    name: "unpriced_cloud_model", severity: "warning", target_view: "Cost",
    why: "A metered/cloud model with no catalogue rate silently counts as $0 spend.",
    predicate: unpricedCloud, threshold: 0, value: (v: A) => v[0],
    message: (v: A) => `${v[0] as number} unpriced cloud model${plural(v[0] as number)} counted as $0: ${v[1] as string}`,
  },
  {
    name: "delegation_failure_rate", severity: "critical", target_view: "Health",
    why: "25% is roughly the point where a delegation run stops being a normal tail and starts wasting real wall-clock time.",
    predicate: delegationFailure, threshold: 25.0, value: (v: A) => v[0],
    message: (v: A) => `Delegation failure rate ${fl(v[0] as number)}% over the last 7 days (${v[1] as number}/${v[2] as number} children)`,
  },
  {
    name: "orphan_reap", severity: "critical", target_view: "Usage",
    why: "A reap means the agent process died mid-turn with the work unaccounted for -- always worth knowing about.",
    predicate: orphanReap, threshold: 0, value: (v: number) => v,
    message: (v: number) => `${v} session${plural(v)} reaped as orphaned in the last 24h`,
  },
  {
    name: "backend_stale", severity: "warning", target_view: "Live",
    why: "10 minutes is well past the ~1-minute heartbeat cadence -- a healthy backend should never be this quiet.",
    predicate: backendStale, threshold: 10.0, value: (v: A) => v[2],
    message: (v: A) => `${v[0] as number} backend${plural(v[0] as number)} stale/dead, worst: ${String(v[1])} (${fl(v[2] as number)} min)`,
  },
  {
    name: "long_running_session", severity: "info", target_view: "Live",
    why: "3 hours is well past a normal interactive turn -- likely a runaway agent or a forgotten background job.",
    predicate: longSession, threshold: 3.0, value: (v: A) => v[2],
    message: (v: A) => `${v[0] as number} session${plural(v[0] as number)} running over 3h, longest: ${String(v[1])} (${fl(v[2] as number)}h)`,
  },
  {
    name: "tool_failure_high", severity: "warning", target_view: "Health",
    why: "20% failure over at least 5 calls is a real, measured problem, not noise from one bad call.",
    predicate: toolFailureHigh, threshold: 20.0, value: (v: A) => v[2],
    message: (v: A) => `${v[0] as number} tool${plural(v[0] as number)} with a measured failure rate above 20%, worst: ${String(v[1])} (${fl(v[2] as number)}% over ${String(v[3])} calls)`,
  },
  {
    name: "bandwidth_spike", severity: "info", target_view: "Usage",
    why: "3x the trailing mean is a real spike worth a look, not the normal day-to-day variance.",
    predicate: bandwidthSpike, threshold: 3.0, value: (v: number) => v,
    message: (v: number) => `Today's bandwidth is ${fl(v)}x the trailing mean`,
  },
  {
    name: "compression_failure", severity: "warning", target_view: "Detail",
    why: "A session stuck failing to compact will keep growing its context until something breaks.",
    predicate: compressionFailure, threshold: 0, value: (v: A) => v[0],
    message: (v: A) => `${v[0] as number} session${plural(v[0] as number)} in a compaction-failure cooldown, e.g. ${String(v[1])}`,
  },
];

export interface Alert {
  rule: string; severity: string; value: unknown; threshold: number;
  message: string; target_view: string; why: string;
}

/** Tripped alerts, critical first (stable within a severity). */
export function buildAlerts(payload: P): Alert[] {
  const out: Alert[] = [];
  for (const rule of RULES) {
    const raw = rule.predicate(payload);
    if (raw === null) continue;
    out.push({
      rule: rule.name, severity: rule.severity, value: rule.value(raw as never), threshold: rule.threshold,
      message: rule.message(raw as never), target_view: rule.target_view, why: rule.why,
    });
  }
  return out.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99));
}
