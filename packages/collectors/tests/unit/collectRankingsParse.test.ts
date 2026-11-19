import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { isoToTs, minRefetchS, parseTokens } from "../../src/collectRankings.js";
import { resolvePython } from "../../parity/pythonProducer.js";
import { pyCall } from "./pyOracle.js";

// Batched CPython oracle: one process per table. null = Python raised.
function pyBatch(snippet: string, cases: string[]): (number | null)[] {
  const py = resolvePython(process.cwd());
  if (py === null) throw new Error("no python with llm_telemetry (set LLM_TELEMETRY_PARITY_PYTHON)");
  const code =
    "import sys,json,datetime\n" +
    "out=[]\n" +
    "for c in json.load(sys.stdin):\n" +
    "    try: out.append(" + snippet + ")\n" +
    "    except Exception: out.append(None)\n" +
    "sys.stdout.write(json.dumps(out))\n";
  const res = spawnSync(py, ["-I", "-c", code], { input: JSON.stringify(cases), encoding: "utf8", timeout: 60_000 });
  if (res.status !== 0) throw new Error(`python oracle failed: ${res.stderr}`);
  return JSON.parse(res.stdout) as (number | null)[];
}

const INTS = [
  "123", " 42 ", "1_000", "1__0", "_1", "1_", "+1_0", "+_1", "١٢٣", "７", "१२३", "1 0", " 123 ",
  "\u0085123", "﻿123", "\u001c123", "-0", "+0", "", "   ", "1.0", "1e3", "٠", "1_000_000", "++1", "--1",
  "+-1", "1_0_0", "١_٢٣", "１２３", "-٥", "\u{1d7d9}\u{1d7da}", "3600",
];

describe("minRefetchS parses like Python int()", () => {
  const want = pyBatch("int(c)", INTS);
  INTS.forEach((s, i) => {
    it(JSON.stringify(s), () => {
      const env = { LLM_TELEMETRY_RANKINGS_TTL: s } as NodeJS.ProcessEnv;
      const w = want[i];
      if (w === null) expect(() => minRefetchS(env)).toThrow();
      else expect(minRefetchS(env)).toBe(w);
    });
  });
});

describe("parseTokens parity with collect_rankings.parse_tokens", () => {
  const vals: unknown[] = [...INTS, "\u001c7\u001d", "﻿7", null, 5, 2.5, true, "x"];
  vals.forEach((v) => {
    it(JSON.stringify(v), () => {
      expect(parseTokens(v)).toBe(pyCall("collect_rankings", "parse_tokens", [v]));
    });
  });
});

const TS = [
  "2024-03-01", "20240301", "2024-03", "2024", "2024-03-01T12:34:56", "2024-03-01 12:34:56", "2024-03-01T12:34",
  "2024-03-01T12", "2024-03-01T123456", "20240301T123456", "2024-03-01T12:34:56.789", "2024-03-01T12:34:56.1234567",
  "2024-03-01T12:34:56,5", "2024-03-01T12:34:56+03:00", "2024-03-01T12:34:56+0300", "2024-03-01T12:34:56+03",
  "2024-03-01T12:34:56Z", "2024-03-01T12:34:56z", "2024-03-01T12:34:56+03:00:30", " 2024-03-01", "2024-03-01 ",
  "2024-02-30", "2024-02-29", "2023-02-29", "2024-13-01", "2024-03-01T25:00:00", "2024-03-01T12:34:56.", "2024-03-01T",
  "2024-03-01X12:34:56", "2024-W10-1", "2024-060", "2024-03-01T12:34:56.123456789012", "2024-03-01T12:34:56-00:30",
  "2024-03-01t12:34:56", "0001-01-01", "0099-01-01", "1900-01-01", "9999-01-01", "2024-03-01T1234",
  "2024-03-01T12:34:56,123", "2024-03-01T123456,5", "2024-03-01T12.5", "2024-03-01T12:34:60",
  "2024-03-01T12:34:56.123456+03", "2024-03-01T12:34:56+030030", "2024-03-01T12:34:56+03:30:15", "20240301123456",
  "2024-03-01T12:34:56+", "2024-03-01T12:34:56+0", "2024-03-01T12:34:56+00", "2024-03-01T12:34:56-00:00",
  "2024-03-01T12:34:56 Z", "2024-03-01T12:34:56Z ", "2024-03-01T00:00:00.000001", "2024-03-01T24:00:00",
  "2024-03-01T12:60:00", "2024-03-01T12:34:56+24:00", "2024-03-01T12:34:56+03:60", "",
];

describe("asTs parity with datetime.fromisoformat().timestamp()", () => {
  const want = pyBatch("datetime.datetime.fromisoformat(c).timestamp()", TS);
  TS.forEach((s, i) => {
    it(JSON.stringify(s), () => {
      expect(isoToTs(s)).toBe(want[i] ?? 0);
    });
  });
});
