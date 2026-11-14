// @vitest-environment node
// LLMTELEMET-282 (T-3): frame-level parity with the Python polling output.
//
// The Python reference is the real src/llm_telemetry/hive.py `HiveFeed` (the
// ring/since/diff engine behind serve.py's `/api/hive*`), driven in a
// subprocess over snapshots derived from the same example artifacts
// (examples/reports/live-data.json). Every ring frame and every `?since=`
// polling reply must match the Node port exactly (minus collect_s, which is
// wall-clock noise on both sides).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  collectFromLiveArtifact,
  LiveFeed,
  type CollectSnapshot,
  type TaskRow,
} from "../../lib/live-feed";

const repoRoot = dirname(
  dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))),
);

const PY_DRIVER = [
  "import json, sys",
  "src, fixture_path = sys.argv[1], sys.argv[2]",
  "sys.path.insert(0, src)",
  "from llm_telemetry import hive",
  'data = json.load(open(fixture_path))',
  'snaps = data["snapshots"]',
  'idx = {"i": 0}',
  "def collect():",
  '    s = snaps[idx["i"]]',
  '    idx["i"] += 1',
  "    return s",
  "feed = hive.HiveFeed(collect, interval=3600, ring=8)",
  "for _ in snaps:",
  "    feed.tick()",
  'seq = feed.snapshot()["seq"]',
  "ns = list(range(0, seq + 3)) + [-1, 99999]",
  'out = {"seq": seq, "snapshot": feed.snapshot(),',
  '       "since": {str(n): feed.since(n) for n in ns}}',
  "sys.stdout.write(json.dumps(out))",
].join("\n");

function pythonBin(): string {
  if (process.env.LST_PYTHON) return process.env.LST_PYTHON;
  const candidates = [
    join(repoRoot, ".venv/bin/python"),
    join(repoRoot, "../../.venv/bin/python"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return "python3";
}

/** Deterministic tick sequence over the real example artifact: status flips,
 * one new session, one worker departure (-> "finished"), one new-but-done
 * session (no frame, the diff_tasks rule), comm dedup and a user change. */
function fixtureSnapshots(): CollectSnapshot[] {
  const artifact = JSON.parse(
    readFileSync(join(repoRoot, "examples/reports/live-data.json"), "utf8"),
  ) as Record<string, unknown>;
  const base = collectFromLiveArtifact(artifact, 1700000000);
  const snaps: CollectSnapshot[] = [];
  let tasks: Record<string, TaskRow> = { ...(base.tasks ?? {}) };
  const keys = Object.keys(tasks).sort();
  for (let i = 0; i < 12; i++) {
    const next: Record<string, TaskRow> = { ...tasks };
    if (i === 3) {
      next["parity:new1"] = {
        family: "root",
        brain: "b",
        board: "B",
        agent: "n1",
        status: "running",
        title: "parity newcomer",
        worker: true,
      };
    }
    if (i === 5 && keys.length > 0) delete next[keys[0]]; // worker gone
    if (i === 7) {
      next["parity:done1"] = {
        family: "root",
        brain: "b",
        board: "B",
        agent: "d1",
        status: "done",
        title: "born done",
        worker: true,
      };
    }
    if (i === 9 && keys.length > 1) delete next[keys[1]];
    const k = keys[i % Math.max(1, keys.length)];
    if (k !== undefined && next[k] !== undefined) {
      next[k] = { ...next[k], status: `phase-${i}` };
    } else {
      next[`parity:extra-${i}`] = {
        family: "root",
        brain: "b",
        board: "B",
        agent: `e${i}`,
        status: "running",
        title: "late arrival",
        worker: true,
      };
    }
    // bc:1 early (deduped at i=4, then evicted from the ring); bc:2 inside the
    // final ring window so the parity sweep compares comm frames too.
    const comms =
      i === 2 || i === 4
        ? [{ id: "bc:1", from: "hazem", to: "donna", text: "hi" }]
        : i >= 10
          ? [{ id: "bc:2", from: "donna", to: "hazem", text: "done" }]
          : [];
    const user = i >= 8 ? { state: "busy", at: 0 } : null;
    snaps.push({ ...base, at: 1700000000 + i, tasks: next, comms, user });
    tasks = next;
  }
  return snaps;
}

/** collect_s is wall-clock noise on both sides; everything else must match. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stripVolatile(value: any): unknown {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value && typeof value === "object") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "collect_s") continue;
      out[k] = stripVolatile(v);
    }
    return out;
  }
  return value;
}

describe("live-feed parity vs the Python HiveFeed on examples/reports", () => {
  it("produces identical frames and ?since= polling output", async () => {
    const snaps = fixtureSnapshots();
    const fixtureDir = mkdtempSync(join(tmpdir(), "lst-282-parity-"));
    const fixturePath = join(fixtureDir, "snapshots.json");
    writeFileSync(fixturePath, JSON.stringify({ snapshots: snaps }));

    // Node side: same snapshots, same ring size, manual ticks.
    let i = 0;
    const feed = new LiveFeed(() => snaps[i++], { ring: 8 });
    for (let n = 0; n < snaps.length; n++) await feed.tick();
    const seq = (feed.snapshot() as { seq: number }).seq;
    const ns = [...Array(seq + 3).keys(), -1, 99999];
    const tsOut = {
      seq,
      snapshot: feed.snapshot(),
      since: Object.fromEntries(ns.map((n) => [String(n), feed.since(n)])),
    };

    // Python side: the reference HiveFeed over the identical fixture file.
    const py = execFileSync(
      pythonBin(),
      ["-c", PY_DRIVER, join(repoRoot, "src"), fixturePath],
      {
        env: { ...process.env, PYTHONPATH: join(repoRoot, "src") },
        timeout: 60000,
        encoding: "utf8",
      },
    );
    const pyOut = JSON.parse(py) as unknown;

    expect(seq).toBeGreaterThan(8); // the ring really overflowed
    expect(stripVolatile(tsOut)).toEqual(stripVolatile(pyOut));
  }, 90000);
});
