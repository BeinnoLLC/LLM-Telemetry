// LLMTELEMET-291 (T-20 RUN D1): pure shaping of the "In progress now" table.
// No React/DOM/net here: this module turns one HomeSnapshot into typed rows
// plus the derived fan-out/cost facts the later UI will render.
//
// Ports (line numbers refer to this checkout's bundled Python dashboard JS):
//   dedup + engine whitelist        src/llm_telemetry/web/js/live.js:128-149
//   state, rank, stable sort        src/llm_telemetry/web/js/live.js:360-369, 444-456
//   subscription coverage           src/llm_telemetry/web/js/live.js:370-378
//   Hermes/PI/agent row fields      src/llm_telemetry/web/js/live.js:516-546, 617-635
//   fan-out parents + titles        src/llm_telemetry/web/js/live.js:576-592
//   token sum                       src/llm_telemetry/web/js/live.js:72-76
//   short() model names             src/llm_telemetry/web/js/palette.js:164
//   "N models used" / helpers       src/llm_telemetry/web/js/views.js:1124-1140
import { short } from "./format";
import type { HomeSnapshot, JsonRecord, LiveProfile } from "./types";

export type LiveKind = "hermes" | "pi" | "claude" | "codex";
export type LiveState = "Running" | "Compressing" | "Waiting" | "Idle";
export type LiveSortKey =
  | "kind" | "session" | "model" | "state" | "elapsed"
  | "tokens" | "cost" | "activity" | "load";
export type SortDir = "asc" | "desc";

/** One entry of a Hermes session's per-model breakdown (views.js:1128-1139). */
export interface LiveModelUsage {
  name: string | null;
  tasks: string[];
  calls: number | null;
  tokens: number | null;
  main: boolean;
}

export interface LiveRow {
  key: string;
  kind: LiveKind;
  id: string;
  sessionId: string;
  title: string;
  profile: string | null;
  owner: string | null;
  category: string | null;
  baseUrl: string | null;
  subagent: boolean;
  model: string | null;
  initModel: string | null;
  models: LiveModelUsage[];
  modelCount: number;
  nmodels: number | null;
  helperCount: number;
  switched: boolean;
  state: LiveState;
  phase: string | null;
  idleS: number | null;
  elapsedS: number | null;
  tokens: number | null;
  costUsd: number | null;
  subscription: boolean;
  coveredBy: string | null;
  /** API-equivalent cost is for display only; it never enters spend totals. */
  billableCostUsd: number | null;
  /** live.js:144-149: idle PI/agent rows are not "in flight". */
  inFlight: boolean;
  tools: string[];
  parent: string | null;
  parentTitle: string | null;
  load: number | null;
  upBytes: number | null;
  downBytes: number | null;
  lanUpBytes: number | null;
  lanDownBytes: number | null;
}

export interface LiveFanout {
  parentId: string;
  parentTitle: string;
  running: number;
  children: string[];
  label: string;
}

export interface CostTotals {
  billable: number | null;
  covered: number | null;
}

const KIND_LABEL: Record<LiveKind, string> = {
  hermes: "Hermes", pi: "PI", claude: "Claude", codex: "Codex",
};
export const STATE_RANK: Record<LiveState, number> = {
  Running: 0, Compressing: 1, Waiting: 2, Idle: 3, // live.js:360
};
export const TILE_IDLE_S = 120; // live.js:336-338

const list = (value: unknown): JsonRecord[] =>
  Array.isArray(value)
    ? value.filter((v): v is JsonRecord => !!v && typeof v === "object")
    : [];
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** Missing values stay null; only real numeric strings are coerced (unlike
 * `+x || 0`, which would silently invent a zero for absent data). */
function finite(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** palette.js:164: keep the full last path segment (claude-opus-4-5), never a
 * letter/glyph proxy. `format.ts` is the verbatim port of short(). */
const shortModel = (model: unknown): string | null => short(model) || null;

function tokenSum(value: JsonRecord | null | undefined): number | null {
  if (!value) return null;
  let sum = 0;
  let present = false;
  for (const key of ["in_tok", "out_tok"] as const) {
    const n = finite(value[key]);
    if (n !== null) { sum += n; present = true; }
  }
  return present ? sum : null;
}

function modelUsages(value: unknown): LiveModelUsage[] {
  return list(value).map((model) => ({
    name: shortModel(model.model),
    tasks: strings(model.tasks),
    calls: finite(model.calls),
    tokens: tokenSum(model),
    main: model.main === true,
  }));
}

function usageTokens(models: LiveModelUsage[]): number | null {
  let sum = 0;
  let present = false;
  for (const model of models) {
    if (model.tokens !== null) { sum += model.tokens; present = true; }
  }
  return present ? sum : null;
}

/** live.js:361-369: Hermes idles on quiet time + compression phase; PI and
 * agents idle on phase and report waiting/blocked/input separately. */
export function classifyState(kind: LiveKind, phase: unknown, idleS: number | null): LiveState {
  const p = text(phase) ?? "";
  if (kind === "hermes") {
    if (idleS !== null && idleS > TILE_IDLE_S) return "Idle";
    return /compress/i.test(p) && !/completed|done|finished/i.test(p) ? "Compressing" : "Running";
  }
  if (p.toLowerCase() === "idle") return "Idle";
  return /wait|approv|blocked|input/i.test(p) ? "Waiting" : "Running";
}

const PLACEHOLDER = new Set(["bot chat", "(untitled)", "untitled"]);

/** DB titles can be blank or the generic "Bot Chat"; fall back to an owner,
 * model or kind label so the row still says what it is. */
function liveTitle(
  raw: unknown,
  kind: LiveKind,
  owner: string | null,
  model: string | null,
  id: string,
): string {
  const title = text(raw);
  if (title && !PLACEHOLDER.has(title.toLowerCase())) return title;
  const detail = owner || model || (id ? id : null);
  return detail
    ? `${KIND_LABEL[kind]} session · ${detail}`
    : `${KIND_LABEL[kind]} session`;
}

/** live.js:371-378: Claude/ChatGPT subscriptions are labelled, and their
 * API-price equivalent is excluded from every spend total. */
function coverage(kind: LiveKind, costClass: unknown): string | null {
  if (costClass !== "subscription") return null;
  if (kind === "claude") return "Claude";
  if (kind === "codex") return "ChatGPT";
  return "subscription";
}

interface BaseRow {
  kind: LiveKind;
  key: string;
  id: string;
  sessionId: string;
  rawTitle: unknown;
  profile: string | null;
  owner: string | null;
  category: unknown;
  baseUrl: unknown;
  subagent: boolean;
  rawModel: unknown;
  rawInitModel: unknown;
  modelRows: LiveModelUsage[];
  nmodels: unknown;
  switched: boolean;
  phase: unknown;
  idle: unknown;
  elapsed: unknown;
  rawTokens: number | null;
  rawCost: unknown;
  costClass: unknown;
  tools: string[];
  parent: string | null;
  parentTitle: string | null;
  load: unknown;
  bytes: [unknown, unknown, unknown, unknown];
}

function baseRow(input: BaseRow): LiveRow {
  const idleS = finite(input.idle);
  const costUsd = finite(input.rawCost);
  const coveredBy = coverage(input.kind, input.costClass);
  const subscription = coveredBy !== null;
  return {
    key: input.key,
    kind: input.kind,
    id: input.id,
    sessionId: input.sessionId,
    title: liveTitle(input.rawTitle, input.kind, input.owner, shortModel(input.rawModel), input.id),
    profile: input.profile,
    owner: input.owner,
    category: text(input.category),
    baseUrl: text(input.baseUrl),
    subagent: input.subagent,
    model: shortModel(input.rawModel),
    initModel: shortModel(input.rawInitModel) || shortModel(input.rawModel),
    models: input.modelRows,
    modelCount: input.modelRows.length,
    nmodels: finite(input.nmodels) ?? (input.modelRows.length || null),
    helperCount: input.modelRows.filter((m) => !m.main).length,
    switched: input.switched,
    state: classifyState(input.kind, input.phase, idleS),
    phase: text(input.phase),
    idleS,
    elapsedS: finite(input.elapsed),
    tokens: input.rawTokens,
    costUsd,
    subscription,
    coveredBy,
    billableCostUsd: subscription ? null : costUsd,
    inFlight: input.kind === "hermes" || text(input.phase)?.toLowerCase() !== "idle",
    tools: input.tools,
    parent: input.parent,
    parentTitle: input.parentTitle,
    load: finite(input.load),
    upBytes: finite(input.bytes[0]),
    downBytes: finite(input.bytes[1]),
    lanUpBytes: finite(input.bytes[2]),
    lanDownBytes: finite(input.bytes[3]),
  };
}

/** live.js:130-140: one row per engine:session for Claude/Codex, keeping the
 * freshest copy (smallest idle_s). Unknown engines are claude, as in Python. */
const engineOf = (engine: unknown): "claude" | "codex" =>
  engine === "codex" ? "codex" : "claude";

function dedupAgents(sessions: JsonRecord[]): JsonRecord[] {
  const best = new Map<string, { session: JsonRecord; idle: number }>();
  for (const session of sessions) {
    const key = engineOf(session.engine) + ":" + (text(session.session_id) ?? "");
    const idle = finite(session.idle_s) ?? Infinity;
    const current = best.get(key);
    if (!current || idle < current.idle) best.set(key, { session, idle });
  }
  return [...best.values()].map((v) => v.session);
}

function toolGauge(session: JsonRecord): unknown {
  if (session.tools_gauge != null) return session.tools_gauge;
  const tools = session.tools;
  return tools && typeof tools === "object" && !Array.isArray(tools)
    ? (tools as JsonRecord).pct
    : null;
}

function selectProfiles(
  snapshot: HomeSnapshot,
  profile: string | undefined,
): Array<[string, LiveProfile]> {
  const profiles = snapshot.live?.profiles ?? {};
  if (profile && profile !== "All") {
    const one = profiles[profile];
    return one ? [[profile, one]] : [];
  }
  if (profiles.All) return [["All", profiles.All]];
  return Object.entries(profiles).filter(([name]) => name !== "All");
}

/**
 * Build the merged, unsorted live table rows for one profile (or the merged
 * `All` view when no profile is given). Feed order is Hermes, PI, agents —
 * exactly like live.js:617-641 — and sortRows() applies the header order.
 */
export function buildLiveRows(snapshot: HomeSnapshot, profile?: string): LiveRow[] {
  const entries = selectProfiles(snapshot, profile);
  const recent = entries.flatMap(([name]) =>
    list(snapshot.analytics?.profiles?.[name]?.recent_sessions));
  const recentTitle = (id: string): string | null => {
    const found = recent.find((session) => text(session.id) === id);
    return found ? text(found.title) : null;
  };

  const rows: LiveRow[] = [];
  // live.js:556-559: the merged All tab can repeat a Hermes id; keep the first.
  const seen = new Set<string>();
  for (const [name, p] of entries) {
    for (const session of list(p.live)) {
      const id = text(session.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const models = modelUsages(session.models);
      const parent = text(session.parent);
      rows.push(baseRow({
        kind: "hermes", key: id, id, sessionId: id, rawTitle: session.title,
        profile: text(session.profile) ?? (name === "All" ? null : name),
        owner: text(session.profile) ?? (name === "All" ? null : name),
        category: session.category, baseUrl: session.base_url,
        subagent: session.kind === "subagent",
        rawModel: session.model, rawInitModel: session.init_model,
        modelRows: models, nmodels: session.nmodels, switched: session.switched === true,
        phase: session.phase, idle: session.idle_s, elapsed: session.uptime_s,
        rawTokens: usageTokens(models), rawCost: null, costClass: null,
        tools: strings(session.tools), parent,
        parentTitle: parent ? recentTitle(parent) : null,
        load: toolGauge(session),
        bytes: [session.up_bytes, session.down_bytes, session.lan_up_bytes, session.lan_down_bytes],
      }));
    }
  }

  // PI rows have no sqlite row and share the same table (live.js:512-527).
  const piSeen = new Set<string>();
  for (const session of list(snapshot.live?.pi_live)) {
    const id = text(session.session_id) ?? "";
    if (piSeen.has(id)) continue;
    piSeen.add(id);
    const inTok = finite(session.in_tok);
    const outTok = finite(session.out_tok);
    const hasTokens = inTok !== null || outTok !== null;
    rows.push(baseRow({
      kind: "pi", key: "pi:" + id, id, sessionId: id, rawTitle: session.title,
      profile: null, owner: text(session.agent),
      category: null, baseUrl: null, subagent: false,
      rawModel: session.model, rawInitModel: session.init_model,
      modelRows: [], nmodels: null, switched: session.switched === true,
      phase: session.phase, idle: session.idle_s, elapsed: session.uptime_s,
      rawTokens: hasTokens ? (inTok ?? 0) + (outTok ?? 0) : null,
      rawCost: session.cost_usd, costClass: session.cost_class,
      tools: strings(session.tools), parent: null, parentTitle: null,
      load: toolGauge(session), bytes: [null, null, null, null],
    }));
  }

  for (const session of dedupAgents(list(snapshot.live?.agent_live))) {
    const kind = engineOf(session.engine);
    const id = text(session.session_id) ?? "";
    const inTok = finite(session.in_tok);
    const outTok = finite(session.out_tok);
    const hasTokens = inTok !== null || outTok !== null;
    rows.push(baseRow({
      kind, key: kind + ":" + id, id, sessionId: id, rawTitle: session.title,
      profile: null, owner: text(session.login) ?? text(session.agent),
      category: null, baseUrl: null, subagent: false,
      rawModel: session.model, rawInitModel: null,
      modelRows: [], nmodels: null, switched: false,
      phase: session.phase, idle: session.idle_s, elapsed: session.uptime_s,
      rawTokens: hasTokens ? (inTok ?? 0) + (outTok ?? 0) : null,
      rawCost: session.cost_usd, costClass: session.cost_class,
      tools: strings(session.tools), parent: null, parentTitle: null,
      load: null, bytes: [null, null, null, null],
    }));
  }
  return rows;
}

/** Engine-filtered view used by the live KPIs and the task-queue jars
 * (live.js:144-149); the table itself keeps idle rows so their state is visible. */
export const inFlightRows = (rows: LiveRow[]): LiveRow[] => rows.filter((row) => row.inFlight);

/** live.js:576-592: a parent with 2+ in-flight children is one summary chip.
 * Parent title comes from the parent row first, then recent_sessions. */
export function liveFanouts(rows: LiveRow[]): LiveFanout[] {
  const byParent = new Map<string, { children: string[]; title: string | null }>();
  for (const row of rows) {
    if (!row.parent || !row.inFlight) continue;
    const group = byParent.get(row.parent) ?? { children: [], title: null };
    group.children.push(row.key);
    group.title ??= row.parentTitle;
    byParent.set(row.parent, group);
  }
  const parentRows = new Map(rows.map((row) => [row.id, row]));
  return [...byParent.entries()]
    .filter(([, group]) => group.children.length >= 2)
    .map(([parentId, group]) => {
      const parentTitle = parentRows.get(parentId)?.title ?? group.title ?? parentId;
      const running = group.children.length;
      return {
        parentId, parentTitle, running, children: group.children,
        label: `${parentTitle} → ${running} running`,
      };
    });
}

/** live.js:370-378: display cost and spend totals must not be confused.
 * With no priced rows the total is null, never zero. */
export function costTotals(rows: LiveRow[]): CostTotals {
  let billable = 0, covered = 0, hasBillable = false, hasCovered = false;
  for (const row of rows) {
    if (row.costUsd === null) continue;
    if (row.subscription) { covered += row.costUsd; hasCovered = true; }
    else { billable += row.costUsd; hasBillable = true; }
  }
  return { billable: hasBillable ? billable : null, covered: hasCovered ? covered : null };
}

const SORT_VALUE: Record<LiveSortKey, (row: LiveRow) => string | number | null> = {
  kind: (row) => row.kind,
  session: (row) => row.title.toLowerCase(),
  model: (row) => row.model?.toLowerCase() ?? null,
  state: (row) => STATE_RANK[row.state],
  elapsed: (row) => row.elapsedS,
  tokens: (row) => row.tokens,
  cost: (row) => row.costUsd,
  activity: (row) => row.idleS,
  load: (row) => row.load,
};

/** live.js:444-456: stable order, nulls always last in either direction.
 * Ties keep feed order, so a 5 s poll cannot shuffle identical rows. */
export function sortRows(
  rows: LiveRow[],
  key: LiveSortKey,
  dir: SortDir = "asc",
): LiveRow[] {
  const value = SORT_VALUE[key];
  if (!value) return rows.slice();
  const sign = dir === "desc" ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const x = value(a.row), y = value(b.row);
      if (x == null && y == null) return a.index - b.index;
      if (x == null) return 1;
      if (y == null) return -1;
      const c = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
      return c ? c * sign : a.index - b.index;
    })
    .map((entry) => entry.row);
}
