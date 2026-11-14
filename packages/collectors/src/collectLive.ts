/** Live view payload (live-data.json) — T-6 (LLMTELEMET-285).
 *
 * Port of `collect_live.py` `build_live()`: active sessions per profile from
 * the read-only Hermes session DBs (`sessions` / `messages` /
 * `session_model_usage`), plus pi/agent CLI sessions and error-log failures.
 * The payload is rebuilt in full on every call; the DB is the history.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { Config } from "./config.js";
import { isLan, BYTES_PER_TOKEN, estimateBytes } from "./bandwidth.js";
import { tailErrors, scrubSecrets } from "./failures.js";
import { buildPiLive } from "./collectPiLive.js";
import { buildAgentLive } from "./collectAgentLive.js";
import { cachedCatalog } from "./pricing.js";
import { buildAgents, type AgentRow, type Heartbeat, type Lease } from "./agentsAlive.js";

export const GENERIC_TITLES = new Set([
  "", "(untitled)", "untitled", "bot chat", "new chat", "chat",
  "new session", "new conversation", "cli", "tui",
]);

export const SOURCE_LABELS: Record<string, string> = {
  tui: "TUI",
  cli: "CLI",
  kanban: "Kanban",
  cron: "Cron",
  desktop: "Desktop",
  tool: "Tool",
  local: "Local",
};

export const TITLE_MAX = 80;

const ACTIVE = `select count(*) from sessions
where ended_at is null
  and coalesce(last_activity_at, started_at) > strftime('%s','now') - 600`;

const LIVE = `select s.id,
       coalesce(nullif(s.title,''),'(untitled)'),
       s.model,
       coalesce(s.last_activity_description,''),
       cast(strftime('%s','now') - coalesce(s.last_activity_at, s.started_at) as int),
       coalesce(s.parent_session_id,''),
       (select group_concat(tn) from (
           select distinct m.tool_name tn from messages m
           where m.session_id = s.id and m.tool_name is not null and m.tool_name != ''
             and m.timestamp > strftime('%s','now') - 900
           limit 12)),
       (select u.model from session_model_usage u
          where u.session_id = s.id
            and coalesce(nullif(u.task,''),'main') = 'main'
          order by u.last_seen desc limit 1),
       (select count(distinct u.model) from session_model_usage u
          where u.session_id = s.id
            and coalesce(nullif(u.task,''),'main') = 'main'),
       (select u.billing_base_url from session_model_usage u
          where u.session_id = s.id
            and coalesce(nullif(u.task,''),'main') = 'main'
          order by u.last_seen desc limit 1),
       case when s.started_at is null then null
            else cast(strftime('%s','now') - s.started_at as int) end
from sessions s
where s.ended_at is null
  and coalesce(s.last_activity_at, s.started_at) > strftime('%s','now') - 600
order by coalesce(s.last_activity_at, s.started_at) desc`;

export const LIVE_COLS =
  "id title init_model phase idle_s parent tools model nmodels base_url uptime_s".split(" ");

const LIVE_BYTES = `select u.session_id,
       coalesce(u.billing_base_url,''),
       coalesce(sum(u.input_tokens + u.cache_read_tokens),0),
       coalesce(sum(u.output_tokens),0)
from session_model_usage u join sessions s on s.id = u.session_id
where s.ended_at is null
  and coalesce(s.last_activity_at, s.started_at) > strftime('%s','now') - 600
group by u.session_id, u.billing_base_url`;

const LIVE_TOOLS = `select m.tool_name, count(*) from messages m
where m.session_id in (
        select id from sessions
        where ended_at is null
          and coalesce(last_activity_at, started_at) > strftime('%s','now') - 600)
  and m.tool_name is not null and m.tool_name != ''
  and m.timestamp > strftime('%s','now') - 3600
group by m.tool_name order by 2 desc limit 14`;

const LIVE_MODELS = `select u.session_id, u.model, coalesce(nullif(u.task,''),'main'),
       coalesce(sum(u.api_call_count),0),
       coalesce(sum(u.input_tokens + u.cache_read_tokens),0),
       coalesce(sum(u.output_tokens),0),
       max(u.last_seen), max(coalesce(u.billing_base_url,''))
from session_model_usage u join sessions s on s.id = u.session_id
where s.ended_at is null
  and coalesce(s.last_activity_at, s.started_at) > strftime('%s','now') - 600
group by u.session_id, u.model, 3`;

const LIVE_META = `select s.id, coalesce(s.source,''), coalesce(s.chat_type,''),
       (select substr(m.content,1,600) from messages m
         where m.session_id = s.id and m.role = 'user'
           and coalesce(m.content,'') != ''
         order by m.timestamp, m.id limit 1)
from sessions s
where s.ended_at is null
  and coalesce(s.last_activity_at, s.started_at) > strftime('%s','now') - 600`;

const LIVE_LOGS = `select m.timestamp, s.title, m.role, coalesce(m.tool_name,'') tool,
       substr(coalesce(m.content,''),1,200) preview, m.session_id
from messages m join sessions s on s.id=m.session_id
where m.session_id in (
        select id from sessions
        where ended_at is null
          and coalesce(last_activity_at, started_at) > strftime('%s','now') - 600)
  and m.timestamp > strftime('%s','now') - 600
order by m.timestamp desc limit 80`;

export const LIVE_LOGS_COLS = "ts title role tool preview sid".split(" ");

const RECENT_ENDED = `select id, title, ended_at, end_reason,
       (select substr(m.content,1,600) from messages m
         where m.session_id = sessions.id and m.role = 'user'
           and coalesce(m.content,'') != ''
         order by m.timestamp, m.id limit 1)
from sessions
where ended_at is not null
  and ended_at > strftime('%s','now') - 90
order by ended_at desc`;

const RECENT_DELEGATIONS = `select delegation_id, state, completed_at
from async_delegations
where completed_at is not null
  and completed_at > strftime('%s','now') - 90
order by completed_at desc`;

const GATEWAY_HEARTBEATS =
  "select backend_id, pid, started_at, last_heartbeat, profile, host from gateway_heartbeats";
const SESSION_TURN_LEASES =
  "select conversation_id, holder, acquired_at, expires_at from session_turn_leases";

type SqlVal = string | number | null | Uint8Array;
type Row = Record<string, SqlVal>;

/** Read-only DB handle; `pinnedNow` freezes every strftime('%s','now') so a
 * test/parity run sees one clock (production leaves SQL's clock alone). */
export class Ro {
  private db: DatabaseSync;
  private pinned: number | undefined;

  constructor(dbPath: string, pinnedNow?: number) {
    this.db = new DatabaseSync(dbPath, { readOnly: true });
    this.pinned = pinnedNow;
  }

  query(sql: string, params: SqlValue[] = []): SqlVal[][] {
    let q = sql;
    if (this.pinned !== undefined) {
      q = q.split("strftime('%s','now')").join(String(Math.trunc(this.pinned)));
    }
    const stmt: StatementSync = this.db.prepare(q);
    const rows = stmt.all(...params) as unknown as Row[];
    return rows.map((r) => Object.values(r));
  }

  scalar(sql: string, params: SqlValue[] = []): SqlVal {
    return this.query(sql, params)[0]?.[0] ?? null;
  }

  close(): void {
    this.db.close();
  }
}

type SqlValue = string | number | bigint | null | Uint8Array;

export interface ProfileLive {
  active: number;
  live: Array<Record<string, unknown>>;
  tools_recent: Array<{ tool: string; calls: number }>;
  logs: Array<Record<string, unknown>>;
  recent_ended: Array<Record<string, unknown>>;
  recent_delegations: Array<Record<string, unknown>>;
  agents: AgentRow[];
}

export interface LivePayload {
  generated: string;
  profiles: Record<string, ProfileLive>;
  errors: Array<Record<string, unknown>>;
  ollama: Record<string, unknown>;
  pi_live: Array<Record<string, unknown>>;
  agent_live: Array<Record<string, unknown>>;
  bytes_per_token: number;
}

export function isGenericTitle(title: string | null): boolean {
  return GENERIC_TITLES.has((title ?? "").trim().toLowerCase());
}

const URL_RE = /\b[A-Za-z][A-Za-z0-9+.\-]*:\/\/(?:[^/\s?#@]*@)?([^/\s?#:]+)(?::\d+)?[^\s]*/g;
const WIN_PATH_RE = /\b[A-Za-z]:\\(?:[\w.\- ]+\\)*([\w.\-]+)/g;
const UNIX_PATH_RE = /(?<![\w.])\/(?:[\w.\-]+(?: [\w.\-]+)?\/)+([\w.\-]+)/g;
const ENVELOPE_RE = /^\s*Message from (?:[^\w\s]+ )?(.+?) \(@[^)]*\):\s*/;

/** Python's str.title() for source_label fallbacks. */
export function pyTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[^a-z])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
}

export function sourceLabel(source: string | null): string {
  const s = source ?? "";
  if (s in SOURCE_LABELS) return SOURCE_LABELS[s] as string;
  return pyTitle(s) || "Bot Chat";
}

/** collect_live.clean_title: secrets redacted FIRST, then chrome cleanup. */
export function cleanTitle(text: string | null, limit = TITLE_MAX): string {
  let s = scrubSecrets(text ?? "");
  s = s.replace(ENVELOPE_RE, "$1: ");
  s = s.replace(URL_RE, "$1");
  s = s.replace(/@file:\s*/g, "");
  s = s.replace(WIN_PATH_RE, "$1");
  s = s.replace(UNIX_PATH_RE, "$1");
  s = s.replace(/[`*_#>]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > limit) s = `${s.slice(0, limit - 1).replace(/\s+$/, "")}\u2026`;
  return s;
}

/** collect_live.resolve_title: a real title is only scrubbed and trimmed;
 * otherwise the cleaned first user message, else "(untitled)". */
export function resolveTitle(rawTitle: string | null, firstUser: string | null): string {
  const raw = rawTitle ?? "";
  if (!isGenericTitle(raw)) {
    const t = scrubSecrets(raw).replace(/\s+/g, " ").trim();
    return t.length > 120 ? `${t.slice(0, 119).replace(/\s+$/, "")}\u2026` : t;
  }
  return cleanTitle(firstUser ?? "") || "(untitled)";
}

export interface ModelSummary {
  model: string;
  tasks: string[];
  calls: number;
  in_tok: number;
  out_tok: number;
  last: number;
  base_url: string;
  main: boolean;
}

/** collect_live.fold_models: [(sid, model, task, calls, in, out, last, url)] ->
 * {sid: [model dicts]}, 'main' models first, then newest. */
export function foldModels(rows: SqlVal[][]): Record<string, ModelSummary[]> {
  const out = new Map<string, Map<string, ModelSummary>>();
  for (const r of rows) {
    const sid = String(r[0] ?? "");
    const model = String(r[1] ?? "");
    if (!model) continue;
    const task = String(r[2] ?? "");
    let per = out.get(sid);
    if (!per) {
      per = new Map();
      out.set(sid, per);
    }
    let m = per.get(model);
    if (!m) {
      m = {
        model,
        tasks: [],
        calls: 0,
        in_tok: 0,
        out_tok: 0,
        last: 0,
        base_url: "",
        main: false,
      };
      per.set(model, m);
    }
    m.tasks.push(task);
    m.calls += Number(r[3] ?? 0) || 0;
    m.in_tok += Number(r[4] ?? 0) || 0;
    m.out_tok += Number(r[5] ?? 0) || 0;
    const last = Number(r[6] ?? 0) || 0;
    if (last >= m.last) {
      m.last = last;
      m.base_url = String(r[7] ?? "") || m.base_url;
    }
    m.main = m.main || task === "main";
  }
  const keyed: Record<string, ModelSummary[]> = {};
  for (const [sid, per] of out) {
    keyed[sid] = [...per.values()].sort(
      (a, b) => Number(!a.main) - Number(!b.main) || b.last - a.last,
    );
  }
  return keyed;
}

function num(v: SqlVal | undefined | null): number {
  return typeof v === "number" ? v : Number(v ?? 0) || 0;
}

/** collect_live.read_ollama: cached probe data with staleness exposed. */
export function readOllama(cfg: Config, now: number): Record<string, unknown> {
  const fallback: Record<string, unknown> = { hosts: [], age: null, missing: true };
  try {
    const d = JSON.parse(
      fs.readFileSync(path.join(cfg.reports_dir, "ollama-data.json"), "utf8"),
    ) as Record<string, unknown>;
    const tsRaw = d["ts"] ?? 0;
    const ts = typeof tsRaw === "number" ? tsRaw : Number(tsRaw);
    if (!Number.isFinite(ts)) return fallback;
    d["age"] = Math.max(0, Math.trunc(now) - Math.trunc(ts));
    return d;
  } catch {
    return fallback;
  }
}

/** EA.classify(phase, tools): phase text wins outright; tool names only when
 * the phase carries no signal. */
export function classifySession(phase: string | null, toolsCsv: string | null): string {
  const p = (phase ?? "").toLowerCase();
  const tl = (toolsCsv ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");
  for (const [name, phrases] of CATEGORIES) {
    if (phrases.some((w) => p.includes(w))) return name;
  }
  if (p.includes("stream") || p.includes("turn") || p.includes("thinking")) return "Generating";
  const ts = new Set(tl);
  for (const [name, , toolset] of CATEGORIES) {
    if (toolset.length > 0 && toolset.some((t) => ts.has(t))) return name;
  }
  return tl.length === 0 ? "Idle" : "Working";
}

const CATEGORIES: Array<[string, string[], string[]]> = [
  ["Compressing", ["compression"], []],
  ["Reviewing", ["review", "critique"], ["delegate_task"]],
  ["Waiting", ["approval", "waiting", "confirm"], []],
  ["Thinking", ["reasoning", "thinking", "planning"], []],
  ["Running", ["terminal", "command running", "process"], ["terminal", "process_manage", "execute_code"]],
  ["Coding", ["patch", "write_file", "editing"], ["patch", "write_file", "edit_file"]],
  ["Researching", ["web", "browser", "search"], ["web_search", "web_extract", "browser_exec", "search_files"]],
  ["Reading", ["read_file", "skill", "reading"], ["read_file", "skill_view", "chat_history_lookup"]],
];

export function buildLive(opts: {
  cfg: Config;
  env?: NodeJS.ProcessEnv;
  now?: number;
  piHome?: string;
  claudeHome?: string;
  codexHome?: string;
  thisHost?: string;
  pidExists?: (pid: number, host: string) => boolean | null;
}): LivePayload {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now() / 1000;
  const pinned = opts.now;
  const cfg = opts.cfg;
  const out: LivePayload = {
    generated: new Date().toISOString().slice(0, 19),
    profiles: {},
    errors: tailErrors(cfg, now, 60, 7200).map((e) => ({ ...e })),
    ollama: readOllama(cfg, now),
    pi_live: [],
    agent_live: [],
    bytes_per_token: BYTES_PER_TOKEN,
  };
  try {
    out.pi_live = buildPiLive({
      piHome: opts.piHome ?? env["LLM_TELEMETRY_PI_HOME"] ?? path.join(os.homedir(), ".pi"),
      now,
    });
  } catch {
    out.pi_live = [];
  }
  try {
    out.agent_live = buildAgentLive({
      cfg,
      catalog: cachedCatalog(cfg, env),
      now,
      claudeHome: opts.claudeHome,
      codexHome: opts.codexHome,
      env,
    });
  } catch {
    out.agent_live = [];
  }

  for (const prof of cfg.liveProfiles()) {
    if (!fs.existsSync(prof.db)) continue;
    const db = new Ro(prof.db, pinned);
    try {
      const active = num(db.scalar(ACTIVE));
      const live: Array<Record<string, unknown>> = [];
      for (const r of db.query(LIVE)) {
        const L: Record<string, unknown> = {};
        LIVE_COLS.forEach((c, i) => {
          L[c] = r[i] === null ? null : typeof r[i] === "number" ? r[i] : String(r[i] ?? "");
        });
        live.push(L);
      }
      for (const L of live) {
        L["profile"] = prof.name;
        L["category"] = classifySession(String(L["phase"] ?? ""), String(L["tools"] ?? ""));
        L["tools"] = String(L["tools"] ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t !== "");
        L["kind"] = L["parent"] ? "subagent" : "top-level";
        L["model"] = L["model"] || L["init_model"];
        L["switched"] = Boolean(
          L["model"] && L["init_model"] && L["model"] !== L["init_model"],
        );
        L["up_bytes"] = 0;
        L["down_bytes"] = 0;
        L["lan_up_bytes"] = 0;
        L["lan_down_bytes"] = 0;
      }
      const byId = new Map<string, Record<string, unknown>>(
        live.map((L) => [String(L["id"] ?? ""), L]),
      );
      for (const r of db.query(LIVE_BYTES)) {
        const L = byId.get(String(r[0] ?? ""));
        if (L === undefined) continue;
        const lan = isLan(
          String(r[1] ?? ""),
          cfg.local_host_patterns ?? [],
          cfg.endpoint_aliases ?? {},
        );
        const up = estimateBytes(num(r[2]));
        const down = estimateBytes(num(r[3]));
        if (lan) {
          L["lan_up_bytes"] = num(L["lan_up_bytes"] as SqlVal) + up;
          L["lan_down_bytes"] = num(L["lan_down_bytes"] as SqlVal) + down;
        } else {
          L["up_bytes"] = num(L["up_bytes"] as SqlVal) + up;
          L["down_bytes"] = num(L["down_bytes"] as SqlVal) + down;
        }
      }
      for (const L of live) {
        L["bw_local"] =
          num(L["up_bytes"] as SqlVal) + num(L["down_bytes"] as SqlVal) === 0 &&
          num(L["lan_up_bytes"] as SqlVal) + num(L["lan_down_bytes"] as SqlVal) > 0;
      }
      const meta = new Map<string, SqlVal[]>();
      for (const r of db.query(LIVE_META)) meta.set(String(r[0] ?? ""), r);
      for (const L of live) {
        const m = meta.get(String(L["id"] ?? "")) ?? [L["id"], "", "", null];
        const first = m[3] === null ? null : String(m[3]);
        L["source"] = sourceLabel(m[1] === null ? "" : String(m[1]));
        L["title_raw"] = L["title"];
        L["title"] = resolveTitle(
          L["title"] === "(untitled)" ? "" : String(L["title"] ?? ""),
          first,
        );
      }
      const models = foldModels(db.query(LIVE_MODELS));
      for (const L of live) {
        L["models"] = models[String(L["id"] ?? "")] ?? [];
      }
      const toolsRecent: Array<{ tool: string; calls: number }> = [];
      for (const r of db.query(LIVE_TOOLS)) {
        toolsRecent.push({ tool: String(r[0] ?? ""), calls: num(r[1]) });
      }
      const titles = new Map<string, unknown>(
        live.map((L) => [String(L["id"] ?? ""), L["title"]]),
      );
      const logs: Array<Record<string, unknown>> = [];
      for (const r of db.query(LIVE_LOGS)) {
        const lg: Record<string, unknown> = {};
        LIVE_LOGS_COLS.forEach((c, i) => {
          lg[c] = r[i] === null ? null : typeof r[i] === "number" ? r[i] : String(r[i] ?? "");
        });
        lg["title"] =
          titles.get(String(lg["sid"] ?? "")) ||
          resolveTitle(String(lg["title"] ?? ""), null);
        logs.push(lg);
      }
      const recentEnded: Array<Record<string, unknown>> = [];
      for (const r of db.query(RECENT_ENDED)) {
        recentEnded.push({
          id: r[0],
          title: resolveTitle(r[1] === null ? null : String(r[1]), r[4] === null ? null : String(r[4])),
          ended_at: r[2],
          end_reason: r[3],
        });
      }
      let recentDelegations: Array<Record<string, unknown>> = [];
      try {
        for (const r of db.query(RECENT_DELEGATIONS)) {
          recentDelegations.push({ id: r[0], state: r[1], completed_at: r[2] });
        }
      } catch (err) {
        if (!String(err).toLowerCase().includes("no such table")) throw err;
        recentDelegations = [];
      }
      let agents: AgentRow[] = [];
      try {
        const heartbeats: Heartbeat[] = db.query(GATEWAY_HEARTBEATS).map((r) => ({
          backend_id: String(r[0] ?? ""),
          pid: num(r[1]),
          started_at: r[2] === null ? null : num(r[2]),
          last_heartbeat: num(r[3]),
          profile: String(r[4] ?? ""),
          host: String(r[5] ?? ""),
        }));
        const leases: Lease[] = db.query(SESSION_TURN_LEASES).map((r) => ({
          conversation_id: String(r[0] ?? ""),
          holder: String(r[1] ?? ""),
          acquired_at: r[2] === null ? null : num(r[2]),
          expires_at: r[3] === null ? null : num(r[3]),
        }));
        agents = buildAgents(
          heartbeats,
          leases,
          opts.thisHost ?? os.hostname(),
          now,
          opts.pidExists,
        );
      } catch (err) {
        if (!String(err).toLowerCase().includes("no such table")) throw err;
        agents = [];
      }
      out.profiles[prof.name] = {
        active,
        live,
        tools_recent: toolsRecent,
        logs,
        recent_ended: recentEnded,
        recent_delegations: recentDelegations,
        agents,
      };
    } finally {
      db.close();
    }
  }
  return out;
}

export { scrubSecrets };
