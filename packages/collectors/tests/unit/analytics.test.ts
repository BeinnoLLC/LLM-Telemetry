import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as SQL from "../../src/analyticsSql.js";
import {
  buildOutcomes, buildSessionsTree, buildCompressionPressure, buildConcurrency, buildLatency, buildToolReliability, concurrencyByHour, pXX, terminalCommandHint, classifyProfile, collectAnalytics, enrichRows, fetchHourRows, fetchRows,
} from "../../src/collectAnalytics.js";
import { load } from "../../src/config.js";
import { cachedCatalog } from "../../src/pricing.js";
import { computeGaps, type TurnRow } from "../../src/latency.js";
import { canonicalEndpoint } from "../../src/bandwidth.js";
import { toolOutcome } from "../../src/toolOutcomes.js";
import { resolvePython } from "../../parity/pythonProducer.js";
import { makeTmpDir } from "./helpers.js";
import { pyAnalytics, pyCall } from "./pyOracle.js";

let inputs = "";
let dbPath = "";
let con: DatabaseSync;

beforeAll(() => {
  inputs = makeTmpDir("an-fixture-");
  const py = resolvePython(process.cwd());
  if (py === null) throw new Error("no python");
  const res = spawnSync(py, ["parity/py/make_analytics_fixture.py", inputs], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(res.stderr);
  dbPath = join(inputs, "agent", "profiles", "alpha", "state.db");
  con = new DatabaseSync(dbPath, { readOnly: true });
});

describe("collect_analytics SQL text", () => {
  it("every SQL constant equals the Python module's", () => {
    const names = Object.keys(SQL).filter((k) => typeof (SQL as Record<string, unknown>)[k] === "string");
    const want = pyAnalytics(inputs, dbPath, `result={n:getattr(C,n) for n in ${JSON.stringify(names)}}`);
    const got = Object.fromEntries(names.map((n) => [n, (SQL as Record<string, unknown>)[n]]));
    expect(got).toEqual(want);
    expect(names.length).toBeGreaterThan(14);
  });
});

describe("day and hour rows match Python", () => {
  const cfgOf = () => {
    const saved = process.env["LLM_TELEMETRY_AGENT_HOME"];
    process.env["LLM_TELEMETRY_AGENT_HOME"] = join(inputs, "agent");
    try { return load(join(inputs, "config.json")); } finally {
      if (saved === undefined) delete process.env["LLM_TELEMETRY_AGENT_HOME"]; else process.env["LLM_TELEMETRY_AGENT_HOME"] = saved;
    }
  };
  const catalog = () => cachedCatalog(cfgOf(), { LLM_TELEMETRY_CATALOG: join(inputs, "catalog.json") });

  it("fetch_rows + enrich", () => {
    const rows = fetchRows(con);
    enrichRows(rows, catalog(), cfgOf());
    const want = pyAnalytics(inputs, dbPath,
      "cat,_=pricing.fetch_catalog()\nrows=C.fetch_rows(con)\nC._enrich_rows(rows,cat)\nresult=rows");
    expect(rows.length).toBeGreaterThan(5);
    expect(rows).toEqual(want);
  });

  it("fetch_hour_rows + enrich (3-day window drops the 40-day-old session)", () => {
    const rows = fetchHourRows(con);
    enrichRows(rows, catalog(), cfgOf());
    const want = pyAnalytics(inputs, dbPath,
      "cat,_=pricing.fetch_catalog()\nrows=C.fetch_hour_rows(con)\nC._enrich_rows(rows,cat)\nresult=rows");
    expect(rows.length).toBeGreaterThan(3);
    expect(rows).toEqual(want);
  });
});

describe("sessions tree and outcomes match Python", () => {
  it("build_sessions_tree rolls the failed subagent up into its parent", () => {
    const got = buildSessionsTree(con);
    const want = pyAnalytics(inputs, dbPath, "result=C.build_sessions_tree(con)");
    expect(got).toEqual(want);
    const root = got.find((n) => n.id === "s-root");
    expect(root?.child_count).toBe(1);
    expect(root?.failed_child_count).toBe(1);
  });

  it("build_sessions_tree handles a parent cycle like Python", () => {
    const cyc = join(makeTmpDir("an-cycle-"), "state.db");
    const mem = new DatabaseSync(cyc);
    mem.exec("pragma foreign_keys=off");
    const schema = pyAnalytics(inputs, dbPath, "result=[r[0] for r in con.execute(\"select sql from sqlite_master where name='sessions' and type='table'\")]") as string[];
    mem.exec(schema[0] as string);
    const t = Math.floor(Date.now() / 1000);
    mem.prepare("insert into sessions (id,source,parent_session_id,started_at,message_count) values ('a','cli','b',?,1),('b','cli','a',?,1),('r','cli',null,?,1),('k','cli','r',?,1)")
      .run(t - 10, t - 20, t - 30, t - 40);
    mem.close();
    const ro = new DatabaseSync(cyc, { readOnly: true });
    const got = buildSessionsTree(ro);
    expect(got.map((n) => n.id)).toEqual(["r"]); // the pure a<->b cycle has no root
    expect(got).toEqual(pyAnalytics(inputs, cyc, "result=C.build_sessions_tree(con)"));
  });

  it("build_outcomes", () => {
    const got = buildOutcomes(con);
    expect(got).toEqual(pyAnalytics(inputs, dbPath, "result=C.build_outcomes(con)"));
    expect(got.silent.map((s) => s.id)).toEqual(["s-cron"]);
    expect(got.reaped.map((s) => s.id)).toEqual(["s-reaped"]);
  });

  it("classify_profile", () => {
    const sess = [{ source: "cron", sessions: 5 }, { source: "cli", sessions: 1 }, { source: null, sessions: 9 }];
    expect(classifyProfile("x-bot", sess)).toEqual(pyCall("collect_analytics", "classify_profile", ["x-bot", sess]));
    expect(classifyProfile("pv-1", [])).toEqual(pyCall("collect_analytics", "classify_profile", ["pv-1", []]));
    expect(classifyProfile("me", [{ source: "tui", sessions: 4 }])).toEqual(
      pyCall("collect_analytics", "classify_profile", ["me", [{ source: "tui", sessions: 4 }]]));
  });
});

describe("collectAnalytics assembly", () => {
  it("emits the ported sections for every fixture profile and a valid header", () => {
    const out = collectAnalytics({ inputsDir: inputs });
    expect(Object.keys(out["profiles"] as object).sort()).toEqual(["alpha", "beta-bot"]);
    expect(out["pricing_source"]).toBe("pinned");
    expect(out.schema_version).toBeGreaterThan(0);
    const alpha = (out["profiles"] as Record<string, Record<string, unknown>>)["alpha"] as Record<string, unknown>;
    for (const k of ["rows", "hour_rows", "sessions_tree", "outcomes", "end_reasons", "heatmap", "repo_branch", "attribution"]) {
      expect(alpha).toHaveProperty(k);
    }
  });
});

describe("tool reliability matches Python", () => {
  it("_pXX over several lengths and percentiles", () => {
    for (const n of [0, 1, 2, 3, 4, 7, 10, 21]) {
      const vals = Array.from({ length: n }, (_, i) => i * 3 + 1);
      for (const pct of [50, 90, 95, 99]) {
        expect(pXX(vals, pct)).toBe(pyCall("collect_analytics", "_pXX", [vals, pct]));
      }
    }
  });

  it("tool_outcome agrees with Python on structured and odd inputs", () => {
    const cases: Record<string, unknown>[] = [
      { content: '{"exit_code":0}' }, { content: '{"exit_code":"2"}' }, { content: '{"exit_code":" 0 "}' },
      { content: '{"exit_code":true}' }, { content: '{"exit_code":null,"success":false}' },
      { content: '{"exit_code":1.9}' }, { content: '{"exit_code":"abc","error":"e"}' },
      { content: '{"exit_code":[1]}' }, { content: '{"success":1}' }, { content: '{"success":true}' },
      { content: '{"not_found":false}' }, { content: '{"not_found":1}' }, { content: '{"error":0}' },
      { content: '{"error":0.0}' }, { content: '{"error":[]}' }, { content: '{"error":"x"}' },
      { content: '{"error":null}' }, { content: "[1,2]" }, { content: "   " }, { content: null }, {},
      { content: "plain", finish_reason: " TOOL_ERROR " }, { content: "{}", effect_disposition: "OK " },
      { content: '{"exit_code":0}', effect_disposition: "Denied" }, { effect_disposition: "weird" },
    ];
    const want = pyAnalytics(inputs, dbPath,
      `from llm_telemetry.tool_outcomes import tool_outcome\nresult=[tool_outcome(m) for m in json.loads(${JSON.stringify(JSON.stringify(cases))})]`);
    expect(cases.map((c) => toolOutcome(c))).toEqual(want);
    expect(new Set(want as string[])).toEqual(new Set(["ok", "fail", "unknown"]));
  });

  it("_terminal_command_hint", () => {
    const inputs2 = ['{"command":"  git   status"}', '{"command":"   "}', '{"command":5}', "not json", "[]", null, ""];
    const want = pyAnalytics(inputs, dbPath, `result=[C._terminal_command_hint(x) for x in json.loads(${JSON.stringify(JSON.stringify(inputs2))})]`);
    expect(inputs2.map((c) => terminalCommandHint(c))).toEqual(want);
  });

  it("build_tool_reliability on the fixture DB", () => {
    const got = buildToolReliability(con);
    expect(got).toEqual(pyAnalytics(inputs, dbPath, "result=C.build_tool_reliability(con)"));
    const names = got.tools.map((t) => t["name"]);
    expect(names).toEqual(expect.arrayContaining(["terminal", "patch", "read_file"]));
    expect(got.terminal_top_fail_commands.length).toBeGreaterThan(1);
    // previous-window rows feed prev_fail_rate
    expect(got.tools.find((t) => t["name"] === "terminal")?.["prev_fail_rate"]).not.toBeNull();
    // 400-char content is truncated to 300 in the sample head
    expect(Object.values(got.tool_fail_samples).flat().some((x) => (x["head"] as string).length === 300)).toBe(true);
  });
});

describe("latency matches Python", () => {
  const cfg = () => {
    const saved = process.env["LLM_TELEMETRY_AGENT_HOME"];
    process.env["LLM_TELEMETRY_AGENT_HOME"] = join(inputs, "agent");
    try { return load(join(inputs, "config.json")); } finally {
      if (saved === undefined) delete process.env["LLM_TELEMETRY_AGENT_HOME"]; else process.env["LLM_TELEMETRY_AGENT_HOME"] = saved;
    }
  };

  it("compute_gaps splits idle gaps and drops negatives, unordered input", () => {
    const rows: TurnRow[] = [
      ["a", 100, "m1", "http://x/v1", 50], ["a", 90, "m1", "http://x/v1", null], ["a", 900, "m2", null, 10],
      ["a", 800, "m2", null, 10], ["b", 5, null, null, 0], ["b", 9.5, null, null, 4], ["c", 1, "m", "u", 1],
    ];
    const want = pyAnalytics(inputs, dbPath,
      `from llm_telemetry import latency as L\nr=json.loads(${JSON.stringify(JSON.stringify(rows))})\ng,i=L.compute_gaps([tuple(x) for x in r])\nresult=[g,i]`);
    const { gaps, idle } = computeGaps(rows);
    expect([gaps, idle]).toEqual(want);
    expect(idle.length).toBe(1);
  });

  it("canonical_endpoint with an alias", () => {
    const urls = ["http://192.168.1.11:11434/v1", "https://api.openai.com/v1", "", null, "no-authority"];
    const aliases = { "api.openai.com": "http://lan-box:1/v1" };
    const want = pyAnalytics(inputs, dbPath,
      `from llm_telemetry import bandwidth as B\nB._get_config().endpoint_aliases.update(json.loads(${JSON.stringify(JSON.stringify(aliases))}))\nresult=[B.canonical_endpoint(u) for u in json.loads(${JSON.stringify(JSON.stringify(urls))})]`);
    expect(urls.map((u) => canonicalEndpoint(u, aliases))).toEqual(want);
  });

  it("build_latency on the fixture DB", () => {
    const got = buildLatency(con, cfg());
    expect(got).toEqual(pyAnalytics(inputs, dbPath, "result=C.build_latency(con)"));
    expect(got.idle_n).toBeGreaterThan(0);
    expect(Object.keys(got.by_model).length).toBeGreaterThan(0);
    expect(got.by_model[Object.keys(got.by_model)[0] as string]?.n).toBeGreaterThan(0);
  });
});

describe("compression pressure and concurrency match Python", () => {
  it("build_compression_pressure rows (COMPRESSION_PRESSURE)", () => {
    const got = buildCompressionPressure(con);
    const want = pyAnalytics(inputs, dbPath,
      "result=[{'id':a,'title':b,'fallback_streak':c,'ineffective_count':d,'error':e or ''}"
      + " for a,b,c,d,e in con.execute(C.COMPRESSION_PRESSURE)]");
    expect(got).toEqual(want);
    expect(got.map((r) => r.id)).toEqual(["s-cron", "s-root", "s-child"]);
    expect(got.find((r) => r.id === "s-cron")?.title).toBe("Nightly");
  });

  it("concurrency_by_hour: multi-hour spans, open sessions, bad rows, subagents", () => {
    const now = Math.floor(Date.now() / 1000);
    const iv = [
      [now - 5 * 3600 - 17, now - 2 * 3600, 0], [now - 4 * 3600, now - 3 * 3600 - 5, 1], [now - 3600, null, 0],
      [null, now, 0], [now - 100, now - 200, 0], [now - 7200, now - 7200, 1], [now - 90 * 86400, now - 89 * 86400, 0],
    ];
    const want = pyAnalytics(inputs, dbPath,
      `iv=json.loads(${JSON.stringify(JSON.stringify(iv))})\nresult=C.concurrency_by_hour(iv, now=${now})`);
    expect(Object.fromEntries(concurrencyByHour(iv, now))).toEqual(want);
    expect(concurrencyByHour([], now).size).toBe(0);
  });

  it("concurrency payload on the fixture DB (sorted, hour/top/sub)", () => {
    const got = buildConcurrency(con);
    const want = pyAnalytics(inputs, dbPath,
      "b=C.concurrency_by_hour(con.execute(C.CONCURRENCY_INTERVALS))\n"
      + "result=[{'hour':k,'top':v['top'],'sub':v['sub']} for k,v in sorted(b.items())]");
    expect(got).toEqual(want);
    expect(got.length).toBeGreaterThan(3);
    expect(got.some((r) => r.sub > 0)).toBe(true);
  });
});

describe("recent tools and sessions match Python", () => {
  it("tools_recent and recent_sessions", () => {
    const want = pyAnalytics(inputs, dbPath,
      "result={'t':[{'tool':t,'calls':n} for t,n in con.execute(C.RECENT_TOOLS)],"
      + "'s':[dict(zip(C.RECENT_SESSIONS_COLS,r)) for r in con.execute(C.RECENT_SESSIONS)]}") as { t: unknown[]; s: unknown[] };
    const stmt = (sql: string) => { const q = con.prepare(sql); q.setReturnArrays(true); return q.all() as unknown as unknown[][]; };
    const t = stmt(SQL.RECENT_TOOLS).map(([tool, calls]) => ({ tool, calls }));
    const s = stmt(SQL.RECENT_SESSIONS).map((r) => Object.fromEntries(SQL.RECENT_SESSIONS_COLS.map((c, i) => [c, r[i]])));
    expect(s.length).toBeGreaterThan(0);
    expect(t).toEqual(want.t);
    expect(s).toEqual(want.s);
  });
});
