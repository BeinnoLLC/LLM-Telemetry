import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as SQL from "../../src/analyticsSql.js";
import {
  buildOutcomes, buildSessionsTree, classifyProfile, collectAnalytics, enrichRows, fetchHourRows, fetchRows,
} from "../../src/collectAnalytics.js";
import { load } from "../../src/config.js";
import { cachedCatalog } from "../../src/pricing.js";
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
