// T-23 RUN A: weighting axis contract, ported from
// tests/check_project_weight.js (Python oracle: charts.js:189-217).
import { beforeEach, describe, expect, it } from "vitest";

import { readWeight, saveWeight, weightValue } from "../../lib/sessions-logs/aggregate";
import { WEIGHT_LABELS, fmtInt, fmtMoney, fmtTokens, weightNote } from "../../lib/sessions-logs/format";
import { WEIGHT_AXES, type SessionRow, type WeightAxis } from "../../lib/sessions-logs/types";

const row = (over: Partial<SessionRow> = {}): SessionRow => ({
  model: "claude-sonnet-5",
  project: "atlas",
  calls: 2,
  inp: 100,
  outp: 40,
  cread: 10,
  cwrite: 5,
  act: 1.25,
  session_id: "s1",
  ...over,
});

describe("weight axis labels and formatters", () => {
  it("keeps the four axes in the Python order with exact axis strings", () => {
    expect(WEIGHT_AXES).toEqual(["cost", "calls", "tokens", "sessions"]);
    expect(WEIGHT_LABELS.cost.axis).toBe("Cost ($)");
    expect(WEIGHT_LABELS.calls.axis).toBe("Calls");
    expect(WEIGHT_LABELS.tokens.axis).toBe("Tokens");
    expect(WEIGHT_LABELS.sessions.axis).toBe("Sessions");
  });

  it("formats money with two decimals and integers with grouping", () => {
    expect(fmtMoney(0)).toBe("$0.00");
    expect(fmtMoney(1.2)).toBe("$1.20");
    expect(WEIGHT_LABELS.cost.fmt(1234.5)).toBe("$1234.50");
    expect(fmtInt(12345)).toBe("12,345");
    expect(fmtTokens(12)).toBe(fmtInt(12));
    expect(WEIGHT_LABELS.calls.fmt(0)).toBe("0");
  });

  it("adds the sessions explanation only on the sessions axis", () => {
    expect(weightNote("cost")).toBe("Showing cost ($). ");
    expect(weightNote("sessions")).toContain("Showing sessions. ");
    expect(weightNote("sessions")).toContain("Unattributed share");
    for (const axis of ["cost", "calls", "tokens"] as WeightAxis[]) {
      expect(weightNote(axis)).not.toContain("Unattributed");
    }
  });
});

describe("weightValue", () => {
  it("uses actual cost, then estimated cost, never both", () => {
    expect(weightValue([row({ act: 2, est: 9 }), row({ act: 0, est: 3 })], "cost")).toBe(5);
  });

  it("sums calls and all four token counters", () => {
    expect(weightValue([row(), row()], "calls")).toBe(4);
    expect(weightValue([row()], "tokens")).toBe(155);
  });

  it("counts distinct session ids and one unit per anonymous row", () => {
    const rows = [
      row({ session_id: "s1" }),
      row({ session_id: "s1" }),
      row({ session_id: "s2" }),
      row({ session_id: "" }),
      row({ session_id: null }),
    ];
    expect(weightValue(rows, "sessions")).toBe(4);
    expect(weightValue([], "sessions")).toBe(0);
  });
});

describe("hermes-dash-projweight persistence", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to cost and restores a valid saved axis", () => {
    expect(readWeight()).toBe("cost");
    saveWeight("tokens");
    expect(localStorage.getItem("hermes-dash-projweight")).toBe("tokens");
    expect(readWeight()).toBe("tokens");
  });

  it("ignores an unknown saved axis", () => {
    localStorage.setItem("hermes-dash-projweight", "banana");
    expect(readWeight()).toBe("cost");
  });
});
