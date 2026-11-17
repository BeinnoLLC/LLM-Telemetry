import { describe, expect, it } from "vitest";
import { buildAttribution } from "../../src/costAttribution.js";
import { projectOf, projectOfSession } from "../../src/projects.js";
import { buildRepoBranch } from "../../src/repoBranch.js";
import { pyCall } from "./pyOracle.js";

// Fixture dates derive from now, never fixed epochs.
const day = (back: number): string => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);

const SESSIONS = {
  root: { title: "Big refactor", cwd: "/srv/proj-a", parent_session_id: null, git_branch: "main" },
  kid: { title: null, cwd: null, parent_session_id: "root", git_branch: "" },
  cron1: { title: "nightly · Sep 25 12:04", cwd: "/tmp", parent_session_id: null, git_branch: " dev " },
  cron2: { title: "nightly · Sep 26 12:04", cwd: "/opt/", parent_session_id: null },
  loop1: { title: null, cwd: null, parent_session_id: "loop2" },
  loop2: { title: null, cwd: "/home", parent_session_id: "loop1" },
  orphan: { title: "é · x", cwd: "/srv/proj-b/", parent_session_id: "gone" },
};

const ROWS = [
  { date: day(1), session_id: "root", source: "tui", market_value_usd: 1.2345678, inp: 10, outp: 5, cread: 3, calls: 2, est: 1.2 },
  { date: day(1), session_id: "kid", source: "subagent", market_value_usd: 0.5, inp: 4, outp: 1, cread: 0, calls: 1, act: 0.4 },
  { date: day(2), session_id: "cron1", source: "cron", market_value_usd: 0.25, inp: 100, outp: 1, cread: 9, calls: 7 },
  { date: day(3), session_id: "cron2", source: "cron", market_value_usd: 0.75, inp: 1, outp: 1, cread: 1, calls: 1 },
  { date: day(3), session_id: "loop1", source: "", market_value_usd: 0.1, inp: 1, outp: 1, cread: 1, calls: 1 },
  { date: day(3), session_id: "orphan", source: "desktop", market_value_usd: 0, inp: 0, outp: 0, cread: 0, calls: 0 },
  { date: day(3), session_id: null, source: "desktop", market_value_usd: 0.3333335, inp: 1, outp: 0, cread: 0 },
];
const TOOLS = [
  { tool_name: "terminal", session_id: "root", tokens: 1000 },
  { tool_name: "terminal", session_id: "kid", tokens: 50 },
  { tool_name: null, session_id: "nosuch", tokens: 5 },
  { tool_name: "read_file", session_id: "cron1", tokens: 7 },
];

describe("cost_attribution parity with Python", () => {
  it("build_attribution matches field by field", () => {
    expect(buildAttribution(ROWS, SESSIONS, TOOLS)).toEqual(
      pyCall("cost_attribution", "build_attribution", [ROWS, SESSIONS, TOOLS]),
    );
  });
  it("default tool rows", () => {
    expect(buildAttribution(ROWS, SESSIONS)).toEqual(
      pyCall("cost_attribution", "build_attribution", [ROWS, SESSIONS]),
    );
  });
});

describe("projects parity with Python", () => {
  const cases: [string | null, string | null][] = [
    ["ahwa-health-gate · Sep 25 12:04", null], ["  spaced   out  ", "/x"], [null, "/srv/Nowinv/"],
    [null, "/tmp"], [null, "/opt/"], [null, null], ["", "/a/b"], [" · lead", "/a/b"],
  ];
  it("project_of", () => {
    for (const [t, c] of cases) {
      expect(projectOf(t, c)).toEqual(pyCall("projects", "project_of", [t, c]));
    }
  });
  it("project_of_session incl. cycles and orphans", () => {
    for (const sid of [...Object.keys(SESSIONS), "missing"]) {
      expect(projectOfSession(sid, SESSIONS)).toEqual(
        pyCall("projects", "project_of_session", [sid, SESSIONS]),
      );
    }
  });
});

describe("collect_repo_branch parity with Python", () => {
  it("build_repo_branch", () => {
    expect(buildRepoBranch(ROWS.filter((r) => r.session_id) as never, SESSIONS)).toEqual(
      pyCall("collect_repo_branch", "build_repo_branch", [ROWS.filter((r) => r.session_id), SESSIONS]),
    );
  });
});
