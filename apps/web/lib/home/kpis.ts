// LLMTELEMET-291 (T-20 RUN C1): pure Home KPI derivations. No React/DOM/net;
// every number comes from collector payloads. Python bundled JS is the spec;
// line references point at this checkout.
import { ago, compact, fmt, fmtB, money, num, short } from "./format";
import type {
  AnalyticsProfile,
  JsonRecord,
  LiveProfile,
  NumLike,
  QuotaData,
  RouterData,
} from "./types";

export const EM_DASH = "—";
export const TPUT_WINDOW_S = 300; // live.js:67
const LIVE_MS = 5000; // live.js:860-865 default poll interval

export interface Counts { calls: number; tokens: number }
export interface ThroughputPoint { t: number; by: Record<string, Counts> }
/** Immutable poll state; callers keep it between snapshots (live.js:73-74). */
export interface ThroughputState {
  prev: Record<string, Counts> | null;
  ring: ThroughputPoint[];
}
export const EMPTY_THROUGHPUT: ThroughputState = { prev: null, ring: [] };
export interface ThroughputWindow {
  calls: number | null;
  tokens: number | null;
  series: number[];
  span: number;
  window: string;
}
export type KpiState = "ok" | "warn" | "bad" | undefined;
export interface KpiStat {
  key: string;
  label: string;
  value: number | null;
  display: string;
  sub: string;
  unit?: string;
  state?: KpiState;
  title?: string;
  detail?: string;
  href?: string;
  /** live.js:153-165: icon + "N Label" chips with no separator. */
  chips?: { letter: string; text: string }[];
  series?: number[];
}
export type LiveKpiKey = "sessions" | "agents" | "throughput" | "alerts";
export interface ExploreCard {
  title: string;
  value: string;
  blurb: string;
  route: string;
  href: string;
  sec?: string;
}

const list = (value: unknown): JsonRecord[] | null =>
  Array.isArray(value)
    ? value.filter((v): v is JsonRecord => !!v && typeof v === "object")
    : null;
const record = (value: unknown): JsonRecord | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
const shown = (
  value: number | null,
  format: (n: number) => string = (n) => n.toLocaleString(),
): string => (value == null ? EM_DASH : format(value));

function sessTotals(session: JsonRecord): Counts {
  // live.js:76-81 — models[] carry CUMULATIVE counters.
  let calls = 0;
  let tokens = 0;
  for (const model of list(session.models) ?? []) {
    calls += num(model.calls);
    tokens += num(model.in_tok) + num(model.out_tok);
  }
  return { calls, tokens };
}

/** live.js:83-101 — diff two polls per session id, clamp backwards counters
 * to zero, keep a 300s ring. The first call only lays the baseline. */
export function sampleThroughput(
  profiles: Record<string, LiveProfile> | null | undefined,
  state: ThroughputState,
  now?: number,
): { state: ThroughputState; by: Record<string, Counts> } {
  const t = now ?? Math.floor(Date.now() / 1000);
  const baseline = state.prev === null;
  const prev = state.prev ?? {};
  const next: Record<string, Counts> = {};
  const by: Record<string, Counts> = {};
  for (const [name, profile] of Object.entries(profiles ?? {})) {
    let calls = 0;
    let tokens = 0;
    for (const session of list(profile?.live) ?? []) {
      const id = String(session.id ?? "");
      if (!id || next[id]) continue; // live.js:88
      const current = sessTotals(session);
      next[id] = current;
      if (baseline) continue;
      const old = prev[id] ?? { calls: 0, tokens: 0 };
      calls += Math.max(0, current.calls - old.calls);
      tokens += Math.max(0, current.tokens - old.tokens);
    }
    by[name] = { calls, tokens };
  }
  const ring = baseline ? state.ring : [...state.ring, { t, by }];
  return {
    state: { prev: next, ring: ring.filter((sample) => t - sample.t < TPUT_WINDOW_S) },
    by,
  };
}

/** live.js:104-119 — sum one profile's ring, or all profiles for `All`. */
export function throughputFor(
  name: string,
  state: ThroughputState,
  now?: number,
): ThroughputWindow {
  const t = now ?? Math.floor(Date.now() / 1000);
  const ring = state.ring.filter((sample) => t - sample.t < TPUT_WINDOW_S);
  const pick = (sample: ThroughputPoint): Counts => {
    if (sample.by[name]) return sample.by[name];
    return Object.values(sample.by).reduce<Counts>(
      (sum, value) => ({ calls: sum.calls + value.calls, tokens: sum.tokens + value.tokens }),
      { calls: 0, tokens: 0 },
    );
  };
  const series = ring.map((sample) => pick(sample).calls);
  const span = ring.length
    ? Math.min(TPUT_WINDOW_S, t - ring[0].t + LIVE_MS / 1000)
    : 0;
  return {
    calls: ring.length ? series.reduce((a, b) => a + b, 0) : null,
    tokens: ring.length ? ring.reduce((sum, sample) => sum + pick(sample).tokens, 0) : null,
    series,
    span,
    window: span >= TPUT_WINDOW_S
      ? "last 5 min"
      : span > 0
        ? `last ${ago(Math.round(span))}`
        : "measuring…", // live.js:256-258
  };
}

export function dedupAgentLive(list: JsonRecord[] | null | undefined): JsonRecord[] {
  // live.js:138-149 — one row per engine:session, freshest idle_s wins.
  const best = new Map<string, { row: JsonRecord; idle: number }>();
  for (const row of list ?? []) {
    if (!row) continue;
    const engine = row.engine === "codex" ? "codex" : "claude";
    const key = `${engine}:${String(row.session_id ?? "")}`;
    const idle = typeof row.idle_s === "number" && Number.isFinite(row.idle_s)
      ? row.idle_s
      : Infinity;
    const current = best.get(key);
    if (!current || idle < current.idle) best.set(key, { row, idle });
  }
  return [...best.values()].map((value) => value.row);
}

export function inFlight(
  profile: LiveProfile | null | undefined,
  piLive: JsonRecord[] | null | undefined,
  agentLive: JsonRecord[] | null | undefined,
): Array<{ kind: string; session: JsonRecord }> {
  // live.js:151-160 — idle PI/agent rows are deliberately not in flight.
  const seen = new Set<string>();
  const out: Array<{ kind: string; session: JsonRecord }> = [];
  for (const session of list(profile?.live) ?? []) {
    const id = String(session.id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ kind: "hermes", session });
  }
  for (const session of piLive ?? []) {
    if (session && session.phase !== "idle") out.push({ kind: "pi", session });
  }
  for (const session of dedupAgentLive(agentLive)) {
    if (session.phase !== "idle") {
      out.push({ kind: session.engine === "codex" ? "codex" : "claude", session });
    }
  }
  return out;
}

function mergedField(
  profiles: Record<string, LiveProfile> | null | undefined,
  field: "agents" | "alerts",
): JsonRecord[] | null {
  // live.js:120-127 — `All` has neither agents nor alerts; read the real rows.
  const names = Object.keys(profiles ?? {}).filter((name) => name !== "All");
  if (!names.length) return null;
  return names.flatMap((name) => list((profiles?.[name] as JsonRecord | undefined)?.[field]) ?? []);
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 }; // live.js:228
const ruleTitle = (rule: unknown): string => {
  // live.js:230-231 — "delegation_failure_rate" -> "Delegation failure rate".
  const text = String(rule ?? "").replace(/[_-]+/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : "Alert";
};

/** live.js:193-205 + 231-275 — four above-the-fold cards, in this order. */
export function liveKpis(
  profile: LiveProfile | null | undefined,
  name: string,
  profiles: Record<string, LiveProfile> | null | undefined,
  piLive: JsonRecord[] | null | undefined,
  agentLive: JsonRecord[] | null | undefined,
  tput: ThroughputWindow,
  analyticsAlerts?: JsonRecord[] | null,
): KpiStat[] {
  const merged = name === "All" && !!profiles;
  const flying = inFlight(profile, piLive, agentLive);
  const counts = new Map<string, number>();
  for (const entry of flying) counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  const kinds = ["hermes", "pi", "claude", "codex"] as const;
  const labels: Record<string, string> = {
    hermes: "Hermes", pi: "PI", claude: "Claude", codex: "Codex",
  };
  const kindSub = kinds
    .filter((kind) => counts.get(kind))
    .map((kind) => `${counts.get(kind)} ${labels[kind]}`)
    .join(" · ");
  const chips = kinds
    .filter((kind) => counts.get(kind))
    .map((kind) => ({ letter: labels[kind][0], text: `${counts.get(kind)} ${labels[kind]}` }));

  const agents = merged
    ? mergedField(profiles, "agents")
    : list((profile as JsonRecord | undefined)?.agents);
  const alive = agents ? agents.filter((agent) => agent.state === "alive").length : 0;
  const down = (agents?.length ?? 0) - alive;

  // Python keeps alerts on the analytics profile, not the live slice
  // (views.js:697-711); main.js merge does not copy them onto All.
  const alerts = analyticsAlerts ?? (merged
    ? mergedField(profiles, "alerts")
    : list((profile as JsonRecord | undefined)?.alerts));
  const sorted = [...(alerts ?? [])].sort(
    (a, b) =>
      (SEVERITY_RANK[String(a.severity)] ?? 9) - (SEVERITY_RANK[String(b.severity)] ?? 9),
  );
  const critical = sorted.filter((alert) => alert.severity === "critical").length;
  const warning = sorted.length - critical;
  const worst = sorted[0];
  const split = [
    critical ? `${critical} critical` : "",
    warning ? `${warning} warning` : "",
  ].filter(Boolean).join(" · ");

  const hasLive = Array.isArray(profile?.live);
  return [
    {
      key: "sessions", label: "Sessions in flight",
      value: hasLive ? flying.length : null,
      display: shown(hasLive ? flying.length : null),
      sub: kindSub || (hasLive ? "open right now" : "no live session data"),
      chips: chips.length ? chips : undefined,
    },
    agents && agents.length
      ? {
          key: "agents", label: "Agents alive", value: alive, display: String(alive),
          unit: `/${agents.length}`,
          sub: down ? `${down} not heartbeating` : "all heartbeating",
          state: down ? "warn" : undefined,
        }
      : {
          key: "agents", label: "Agents alive", value: null, display: EM_DASH,
          sub: "no agent heartbeats reported",
        },
    {
      key: "throughput", label: "Calls · tokens", value: tput.calls,
      display: shown(tput.calls), unit: "calls",
      sub: `${shown(tput.tokens, compact)} tokens · ${tput.window}`,
    },
    alerts && alerts.length
      ? {
          key: "alerts", label: "Active alerts", value: alerts.length,
          display: String(alerts.length), sub: split,
          state: critical ? "bad" : "warn",
          title: String(worst.why ?? worst.message ?? ""),
          detail: ruleTitle(worst.rule), href: "#/health",
        }
      : alerts
        ? {
            key: "alerts", label: "Active alerts", value: 0, display: "0",
            sub: "All clear", state: "ok", href: "#/health",
          }
        : {
            key: "alerts", label: "Active alerts", value: null, display: EM_DASH,
            sub: "no alerts reported", href: "#/health",
          },
  ];
}
function meter(pct: number | null, warnAt: number, badAt: number): { sub: string; state?: KpiState } {
  // live.js:180-191 + views.js:662-665 — bounded 0-100 metric wording.
  if (pct == null) return { sub: "no data" };
  const state: KpiState = pct >= warnAt ? "ok" : pct >= badAt ? "warn" : "bad";
  return { sub: state === "ok" ? "Healthy" : state === "warn" ? "Watch" : "Low", state };
}

function unpricedCount(rows: JsonRecord[]): number {
  // views.js:358-368, 532-543 — no price and real calls is unknown cost.
  const by = new Map<string, { calls: number; priced: boolean }>();
  for (const row of rows) {
    const key = short(row.model);
    const entry = by.get(key) ?? { calls: 0, priced: false };
    entry.calls += num(row.calls);
    if (row.priced || ["local", "free", "preset"].includes(String(row.cost_class))) {
      entry.priced = true;
    }
    by.set(key, entry);
  }
  return [...by.values()].filter((entry) => !entry.priced && entry.calls > 0).length;
}

/** views.js:610-707 — the six analytics totals, date-scoped by `inR`. */
export function analyticsTotals(
  profile: AnalyticsProfile | null | undefined,
  inR?: (date?: string) => boolean,
): KpiStat[] {
  const pass = inR ?? (() => true);
  const scoped = (value: unknown) =>
    list(value)?.filter((row) => pass(typeof row.date === "string" ? row.date : undefined)) ?? null;
  const rows = scoped(profile?.rows);
  const sessions = scoped(profile?.sessions);
  const health = list(profile?.health);
  const sum = (field: string) => (rows ?? []).reduce((total, row) => total + num(row[field]), 0);
  const calls = rows ? sum("calls") : null;
  const tokens = rows ? sum("inp") + sum("outp") : null;
  const cache = sum("cread");
  const cacheDenom = sum("inp") + cache;
  const cacheRate = rows && cacheDenom ? (cache / cacheDenom) * 100 : null;
  const market = rows ? sum("market_value_usd") : null;
  const nsess = sessions
    ? sessions.reduce((total, row) => total + num(row.sessions), 0)
    : null;
  const okN = (health ?? []).reduce((total, row) => total + num(row.ok), 0);
  const failN = (health ?? []).reduce((total, row) => total + num(row.fail), 0);
  const successRate = health && okN + failN ? (okN / (okN + failN)) * 100 : null;
  const elec = (rows ?? []).reduce(
    (total, row) => total + (row.cost_class === "local" ? num(row.energy_usd) : 0), 0,
  );
  const unpriced = rows ? unpricedCount(rows) : 0;
  const dayCount = new Set((rows ?? []).map((row) => row.date)).size;
  const range = rows ? `${dayCount} day${dayCount === 1 ? "" : "s"} in range` : "no data in range";

  const days = [...new Set((rows ?? []).map((row) => row.date).filter(Boolean))]
    .sort().slice(-7);
  const series = (getValue: (row: JsonRecord) => number) =>
    days.map((day) =>
      (rows ?? []).filter((row) => row.date === day)
        .reduce((total, row) => total + getValue(row), 0),
    );
  const cacheMeter = meter(cacheRate, 60, 30);
  const successMeter = meter(successRate, 95, 80);
  return [
    {
      key: "calls", label: "API calls", value: calls, display: shown(calls), sub: range,
      series: series((row) => num(row.calls)),
    },
    {
      key: "tokens", label: "Tokens", value: tokens, display: shown(tokens, compact),
      sub: "input + output", series: series((row) => num(row.inp) + num(row.outp)),
    },
    {
      key: "cacheHit", label: "Cache hit rate", value: cacheRate,
      display: shown(cacheRate, (pct) => `${Math.round(pct)}%`), sub: cacheMeter.sub,
      state: cacheMeter.state,
    },
    {
      key: "sessions", label: "Sessions", value: nsess, display: shown(nsess), sub: range,
      series: days.map((day) =>
        (sessions ?? []).filter((row) => row.date === day)
          .reduce((total, row) => total + num(row.sessions), 0),
      ),
    },
    {
      key: "successRate", label: "Success rate", value: successRate,
      display: shown(successRate, (pct) => `${Math.round(pct)}%`), sub: successMeter.sub,
      state: successMeter.state,
    },
    {
      key: "estCost", label: "Est. cost", value: market,
      display: market == null ? EM_DASH : market ? money(market) : "$0.00",
      sub: rows == null ? "no data in range" : unpriced
        ? `excludes ${unpriced} unpriced model${unpriced === 1 ? "" : "s"}`
        : elec > 0 ? `incl. ~${money(elec)} electricity` : "market value",
      state: unpriced ? "warn" : undefined,
      series: series((row) => num(row.market_value_usd)),
    },
  ];
}

/** live.js:672-694 — six LOCAL-time hour buckets ending at the current hour. */
export const HOME_HOURS = 6;
export function home6h(profile: AnalyticsProfile | null | undefined, now: number = Date.now()) {
  const end = new Date(now);
  end.setMinutes(0, 0, 0);
  const keys: string[] = [];
  const labels: string[] = [];
  const pad = (value: number) => String(value).padStart(2, "0");
  for (let step = HOME_HOURS - 1; step >= 0; step--) {
    const date = new Date(end.getTime() - step * 3600e3);
    keys.push(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}|${date.getHours()}`);
    labels.push(`${pad(date.getHours())}:00`);
  }
  const calls = keys.map(() => 0);
  const tokens = keys.map(() => 0);
  for (const row of list(profile?.hour_rows) ?? []) {
    const index = keys.indexOf(`${row.date}|${num(row.hour)}`);
    if (index < 0) continue;
    calls[index] += num(row.calls);
    tokens[index] += num(row.inp) + num(row.outp);
  }
  return { labels, calls, tokens };
}
/** routerview.js:360-371 — one profile's tiers/decisions, or fleet coverage. */
export function routerStat(router: RouterData | null | undefined, name: string): string {
  const all = router?.profiles ?? {};
  const names = name && name !== "All" && all[name] ? [name] : Object.keys(all);
  if (!names.length) return "No data";
  const enabled = (key: string) => !!record((all[key] as JsonRecord | undefined)?.tier_router)?.enabled;
  const on = names.filter(enabled);
  if (names.length === 1) {
    if (!on.length) return "router off";
    const profile = all[names[0]] as JsonRecord;
    const tiers = record(profile.tier_router)?.tiers;
    return `${Array.isArray(tiers) ? tiers.length : 0} tiers · ${num(record(profile.decisions)?.total)} decisions`;
  }
  return `${on.length}/${names.length} profiles routed`;
}

/** quotaview.js:419-439 — absent plugin cache is "not cached", never clear. */
export function quotaStat(quota: QuotaData | null | undefined, name: string): string {
  const all = quota?.profiles ?? {};
  const names = name && name !== "All" && all[name] ? [name] : Object.keys(all);
  if (!names.length) return "No data";
  const providers: JsonRecord[] = [];
  for (const key of names) {
    const raw = (all[key] as JsonRecord | undefined)?.providers;
    const values = Array.isArray(raw) ? raw : Object.values(record(raw) ?? {});
    providers.push(...values.filter((value): value is JsonRecord => !!value && typeof value === "object"));
  }
  if (!providers.length) return names.length === 1 ? "not cached" : "no cached profiles";
  const near = providers.filter((provider) => !!provider.attention).length;
  const available = providers.filter((provider) => !provider.unavailable_reason).length;
  if (names.length === 1) {
    return near
      ? `${near}/${providers.length} near limit`
      : `${providers.length} provider${providers.length === 1 ? "" : "s"} clear`;
  }
  const summary = (quota?.summary ?? record(quota?.meta)?.summary) as JsonRecord | undefined;
  return `${num(summary?.available) || available}/${num(summary?.providers) || providers.length} available`;
}

/** views.js:1014-1122 — every Explore strip card, derived from date rows. */
export function exploreCards(
  profile: AnalyticsProfile | null | undefined,
  name: string,
  inR?: (date?: string) => boolean,
  router?: RouterData | null,
  quota?: QuotaData | null,
  tariff: NumLike = null,
): ExploreCard[] {
  const pass = inR ?? (() => true);
  const rows = list(profile?.rows)?.filter((row) => pass(typeof row.date === "string" ? row.date : undefined)) ?? null;
  const sum = (field: string) => (rows ?? []).reduce((total, row) => total + num(row[field]), 0);
  const models = new Set((rows ?? []).map((row) => short(row.model)).filter(Boolean));
  const calls = sum("calls");
  const cost = sum("market_value_usd");
  const up = sum("up_bytes") + sum("lan_up_bytes");
  const down = sum("down_bytes") + sum("lan_down_bytes");

  const health = list(profile?.health);
  const okN = (health ?? []).reduce((total, row) => total + num(row.ok), 0);
  const hTot = (health ?? []).reduce((total, row) => total + num(row.ok) + num(row.fail), 0);
  const okPct = hTot ? (okN / hTot * 100).toFixed(1) + "%" : EM_DASH;
  const fails = list(profile?.failures_recent)?.length ?? 0;

  const spend = new Map<string, number>();
  for (const row of rows ?? []) {
    const project = String(row.project || "Unattributed");
    spend.set(project, (spend.get(project) ?? 0) + (num(row.act) || num(row.est)));
  }
  const totalSpend = [...spend.values()].reduce((a, b) => a + b, 0);
  const unattrPct = totalSpend > 0
    ? `${Math.round(100 * (spend.get("Unattributed") ?? 0) / totalSpend)}%`
    : EM_DASH;
  const topProject = [...spend.entries()]
    .filter(([project]) => project !== "Unattributed")
    .sort((a, b) => b[1] - a[1])[0];
  const projStat = topProject
    ? `${topProject[0]} · ${unattrPct} unattributed`
    : totalSpend > 0 ? `${unattrPct} unattributed` : rows ? "No data" : EM_DASH;

  const card = (
    title: string, value: string, blurb: string, route: string,
    href: string = route.toLowerCase(), sec?: string,
  ): ExploreCard => ({ title, value, blurb, route, href, sec });
  return [
    card("Flow", rows ? `${models.size} model${models.size === 1 ? "" : "s"}` : EM_DASH,
      "Provider → model → task routing", "Flow"),
    card("Router", routerStat(router, name),
      "Which model handles which kind of work, and why", "Router"),
    card("Quota", quotaStat(quota, name),
      "How much headroom is left on each provider", "Quota"),
    card("Usage", rows ? `${fmt(calls)} calls` : EM_DASH,
      "Calls and tokens over time", "Usage"),
    card("Sessions", projStat,
      "Spend and calls broken down by project", "Sessions"),
    card("Cost", rows ? `$${cost.toFixed(2)}` : EM_DASH,
      "What the traffic is worth at public rates", "Cost"),
    card("Health", okPct === EM_DASH ? EM_DASH : okPct + (fails ? ` · ${fails} recent` : ""),
      "Success rate and recent failures", "Health"),
    card("Detail", rows ? `${rows.length} rows` : EM_DASH,
      "Per-model table and the activity calendar", "Detail"),
    card("Settings", tariff == null ? EM_DASH : `$${num(tariff)} / kWh`,
      "Electricity tariff and hardware behind local cost", "Settings"),
    card("Bandwidth (est.)", rows ? `↑ ${fmtB(up)} / ↓ ${fmtB(down)}` : EM_DASH,
      "Estimated from tokens, not measured", "Usage", "usage?s=bandwidth", "bwpanel"),
    card("Prices", "per 1M tokens",
      "Per-million-token rates & spend", "Prices"),
  ];
}
