import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { inputsConfig } from "../../parity/cases.js";
import { resolvePython } from "../../parity/pythonProducer.js";
import { buildAll, writeSessionFiles } from "../../src/collectSessionTimeline.js";
import { buildSpans, buildTimeline } from "../../src/sessionTimeline.js";
import { makeTmpDir } from "./helpers.js";

let inputs = "";

beforeAll(() => {
  inputs = makeTmpDir("timeline-fixture-");
  const py = resolvePython(process.cwd());
  if (py === null) throw new Error("no python");
  const res = spawnSync(py, ["parity/py/make_timeline_fixture.py", inputs], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(res.stderr);
});

describe("session_timeline (pure)", () => {
  it("merges consecutive assistant rows of one model into one run, new model starts a new one", () => {
    const spans = buildSpans([
      { role: "assistant", timestamp: 1, model: "a" }, { role: "assistant", timestamp: 2, model: "a" },
      { role: "assistant", timestamp: 3, model: "b" }, { role: "assistant", timestamp: 4, model: null },
    ]);
    expect(spans.map((s) => [s.lane, s.label, s.start, s.end])).toEqual([["model", "a", 1, 2], ["model", "b", 3, 3]]);
  });
  it("tool failures are flagged; delegations fall back to the documented labels", () => {
    const spans = buildSpans(
      [{ role: "tool", timestamp: 5, tool_name: "terminal", outcome: "fail" }],
      [{ dispatched_at: 6, completed_at: null, status: "running", child_id: null }],
    );
    expect(spans.find((s) => s.lane === "tool")).toMatchObject({ failed: true, meta: { outcome: "fail" } });
    expect(spans.find((s) => s.lane === "delegation")).toMatchObject({
      label: "(delegation)", color_key: "(unknown)", failed: true, start: 6, end: 6, meta: { status: "running" },
    });
  });
  it("orders by start then lane, and a span never ends before it starts", () => {
    const spans = buildSpans([{ role: "user", timestamp: 3 }], [], [{ start: 3, end: 1 }]);
    expect(spans.map((s) => s.lane)).toEqual(["compaction", "user"]);
    expect(spans[0]!.end).toBe(3);
  });
  it("a running session extends the axis to now; an ended one keeps its end", () => {
    const base = { id: "x", title: null, source: null, started_at: 10, end_reason: null, models: [] as string[],
      input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, estimated_cost_usd: 0, actual_cost_usd: 0 };
    expect(buildTimeline({ ...base, ended_at: null }, [], [], [], 99)).toMatchObject({ running: true, axis_end: 99, title: "(untitled)" });
    expect(buildTimeline({ ...base, ended_at: 50 }, [], [], [], 99)).toMatchObject({ running: false, axis_end: 50 });
  });
});

describe("collect_session_timeline", () => {
  it("builds a timeline per in-scope session; the 40-day-old session is out of scope", () => {
    const all = buildAll({ cfg: inputsConfig(inputs) });
    const alpha = all["alpha"]!;
    expect(Object.keys(alpha)).toContain("s-root");
    expect(Object.keys(alpha)).not.toContain("s-old");
    expect(alpha["s-live"]!["running"]).toBe(true);
  });
  it("maxSessions caps the newest-first scope", () => {
    const all = buildAll({ cfg: inputsConfig(inputs), maxSessions: 1 });
    expect(Object.keys(all["alpha"]!).length).toBe(1);
  });
  it("writes <profile>/<id>.json files identical in content to the Python writer", () => {
    const py = resolvePython(process.cwd()) as string;
    const pyDir = makeTmpDir("timeline-py-");
    const nodeDir = makeTmpDir("timeline-node-");
    const code = "import os,sys,time\nos.environ['HOME']=sys.argv[1]+'/home'\n" +
      "os.environ['LLM_TELEMETRY_CONFIG']=sys.argv[1]+'/config.json'\nos.environ['LLM_TELEMETRY_AGENT_HOME']=sys.argv[1]+'/agent'\n" +
      "from llm_telemetry import collect_session_timeline as C\nprint(C.write_session_files(sys.argv[2]))\n";
    const res = spawnSync(py, ["-I", "-c", code, inputs, pyDir], { encoding: "utf8" });
    expect(res.status, res.stderr).toBe(0);
    const n = writeSessionFiles(nodeDir, { cfg: inputsConfig(inputs) });
    expect(n).toBe(Number(res.stdout.trim()));
    for (const profile of fs.readdirSync(pyDir)) {
      expect(fs.readdirSync(join(nodeDir, profile)).sort()).toEqual(fs.readdirSync(join(pyDir, profile)).sort());
      for (const f of fs.readdirSync(join(pyDir, profile))) {
        const a = JSON.parse(fs.readFileSync(join(pyDir, profile, f), "utf8")) as Record<string, unknown>;
        const b = JSON.parse(fs.readFileSync(join(nodeDir, profile, f), "utf8")) as Record<string, unknown>;
        // axis_end of a running session is the wall clock of each run.
        if (a["running"]) { delete a["axis_end"]; delete b["axis_end"]; }
        expect(b, `${profile}/${f}`).toEqual(a);
      }
    }
  });
});
