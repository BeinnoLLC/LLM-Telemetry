// LLMTELEMET-292 (T-21 RUN C1): the Flow aggregation contract. Every row
// comes from the repo's real sample analytics artifact; no endpoint is called
// and no traffic is fabricated.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { AnalyticsData, AnalyticsRow } from "../../lib/home-board/types";
import {
  flowChats,
  flowData,
  flowFlatten,
  flowRows,
  flowSessions,
  flowTipRows,
  provOf,
  short,
} from "../../lib/life-flow/flow";

const repoRoot = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));
const payload = JSON.parse(
  readFileSync(join(repoRoot, "examples/reports/analytics-data.json"), "utf8"),
) as AnalyticsData;
const work = payload.profiles?.work as { rows?: AnalyticsRow[]; node_sessions?: Record<string, unknown> };
const rows = work.rows ?? [];
const calls = (list: readonly AnalyticsRow[]): number =>
  list.reduce((sum, row) => sum + Number(row.calls ?? 0), 0);
const cost = (list: readonly AnalyticsRow[]): number =>
  list.reduce((sum, row) => sum + Number(row.market_value_usd ?? 0), 0);

describe("Flow naming and provider resolution", () => {
  it("uses the last path segment and the strongest provider evidence", () => {
    expect(short("accounts/fireworks/models/kimi-k3")).toBe("kimi-k3");
    expect(short(null)).toBe("");
    // billing base URL beats the custom slot and the model name.
    expect(provOf("custom", "accounts/fireworks/models/kimi-k3", "https://api.fireworks.ai/inference/v1/"))
      .toBe("fireworks");
    expect(provOf("opencode-go", "glm-5.3", "https://opencode.ai/zen/go/v1/")).toBe("opencode-go");
    expect(provOf("custom", "qwen3.8:latest", "http://gpu-01.example.internal:11434/v1")).toBe("local");
    expect(provOf("", "claude-opus-5")).toBe("anthropic");
    expect(provOf("", "mystery")).toBe("cloud");
  });
});

describe("flowData", () => {
  it("returns an empty root for an empty range", () => {
    const root = flowData([]);
    expect(root).toEqual({
      id: "root", name: "all traffic", kind: "root", calls: 0, cost: 0, kids: [],
    });
    expect(flowFlatten(root)).toEqual({ nodes: [root], links: [] });
  });

  it("totals calls and market value from one real provider's rows", () => {
    const one = rows.filter((row) => row.provider === "anthropic");
    expect(one.length).toBeGreaterThan(1);
    const root = flowData(one);
    expect(root.calls).toBe(calls(one));
    expect(root.cost).toBeCloseTo(cost(one), 8);
    expect(root.kids).toHaveLength(1);
    expect(root.kids[0].name).toBe("anthropic");
    expect(root.kids[0].calls).toBe(calls(one));
    expect(root.kids[0].kids.length).toBeGreaterThan(1);
  });

  it("groups two real models under their provider with tasks underneath", () => {
    const two = rows.filter((row) =>
      row.provider === "anthropic" &&
      ["claude-opus-5", "claude-opus-4-7"].includes(String(row.model)),
    );
    const root = flowData(two);
    const provider = root.kids[0];
    expect(provider.kids.map((kid) => kid.name).sort()).toEqual(["claude-opus-4-7", "claude-opus-5"]);
    expect(provider.kids.map((kid) => [kid.name, kid.calls])).toEqual(
      provider.kids.map((kid) => [kid.name, calls(two.filter((r) => String(r.model) === kid.name))]),
    );
    expect(provider.kids.every((kid) => kid.kids.length > 0)).toBe(true);
    expect(provider.kids.every((kid) => kid.kids.every((task) => task.kind === "task" && task.parentModel === kid.name)))
      .toBe(true);
  });

  it("drops the task level at depth 2 but keeps the same totals", () => {
    const two = rows.filter((row) => row.provider === "anthropic");
    const deep = flowData(two, 3);
    const shallow = flowData(two, 2);
    expect(deep.calls).toBe(shallow.calls);
    expect(deep.cost).toBeCloseTo(shallow.cost, 8);
    expect(shallow.kids[0].kids.every((model) => model.kids.length === 0)).toBe(true);
    expect(deep.kids[0].kids.some((model) => model.kids.length > 0)).toBe(true);
  });

  it("orders providers and models by calls, descending", () => {
    const root = flowData(rows);
    expect(root.kids.length).toBeGreaterThan(1);
    expect([...root.kids].sort((a, b) => a.calls - b.calls).reverse().map((n) => n.calls))
      .toEqual(root.kids.map((n) => n.calls));
    for (const provider of root.kids) {
      expect([...provider.kids].sort((a, b) => a.calls - b.calls).reverse().map((n) => n.calls))
        .toEqual(provider.kids.map((n) => n.calls));
    }
    expect(root.calls).toBe(calls(rows));
    expect(root.cost).toBeCloseTo(cost(rows), 8);
  });

  it("flattens depth and parent links for the renderer", () => {
    const { nodes, links } = flowFlatten(flowData(rows.slice(0, 12)));
    expect(nodes[0].depth).toBe(0);
    expect(links).toHaveLength(nodes.length - 1);
    expect(nodes.slice(1).every((node) => node.depth === (node.kind === "prov" ? 1 : node.depth)))
      .toBe(true);
    expect(nodes.every((node) => node.depth! <= 3)).toBe(true);
  });

  it("reads only the loaded profile's rows and node_sessions", () => {
    expect(flowRows({ rows }).map((row) => row.model)).toEqual(rows.map((row) => row.model));
    expect(flowRows(null)).toEqual([]);
    expect(flowSessions({ node_sessions: work.node_sessions })).toBe(work.node_sessions);
    expect(flowSessions(null)).toBeNull();
  });
});

describe("Flow tooltip copy", () => {
  it("mirrors the Python calls, est. cost and child-count rows", () => {
    const root = flowData(rows);
    const provider = root.kids[0];
    const tip = flowTipRows(provider, root.calls);
    expect(tip[0][0]).toBe("calls");
    expect(String(tip[0][1])).toMatch(/^[\d,]+ \(\d+\.\d%\)$/);
    expect(tip[1]).toEqual(["est. cost", `$${provider.cost.toFixed(2)}`]);
    expect(tip[2]).toEqual(["models", provider.kids.length]);
  });

  it("uses real node_sessions chats, never synthetic ones", () => {
    const root = flowData(rows);
    const model = root.kids[0].kids[0];
    const chats = flowChats(model, rows, work.node_sessions);
    for (const chat of chats) {
      expect(chat.title.length).toBeGreaterThan(0);
      expect(chat.calls).toBeGreaterThan(0);
    }
    expect(chats.length).toBeLessThanOrEqual(4);
    expect(flowChats(root, rows, work.node_sessions)).toEqual([]);
    expect(flowChats(model, rows, null)).toEqual([]);
  });

  it("keeps chats on the model that actually served a shared task name", () => {
    const alpha = "hosts/acme/alpha-3";
    const beta = "hosts/acme/beta-3";
    const shared: AnalyticsRow[] = [
      { date: "2026-09-25", model: alpha, provider: "opencode-go", task: "main", calls: 3 },
      { date: "2026-09-25", model: alpha, provider: "opencode-go", task: "review", calls: 2 },
      { date: "2026-09-25", model: beta, provider: "opencode-go", task: "main", calls: 5 },
    ];
    const sessions: Record<string, unknown> = {
      [`${alpha}\tmain`]: [{ id: "a-main", title: "Alpha main chat", calls: 3 }],
      [`${alpha}\treview`]: [{ id: "a-review", title: "Alpha review chat", calls: 2 }],
      [`${beta}\tmain`]: [{ id: "b-main", title: "Beta main chat", calls: 5 }],
    };
    const root = flowData(shared);
    const models = root.kids[0].kids;
    expect(models.map((model) => model.name).sort()).toEqual(["alpha-3", "beta-3"]);
    const alphaNode = models.find((model) => model.name === "alpha-3")!;
    const betaNode = models.find((model) => model.name === "beta-3")!;
    const alphaTask = alphaNode.kids.find((task) => task.name === "main")!;
    const betaTask = betaNode.kids.find((task) => task.name === "main")!;
    expect(flowChats(alphaTask, shared, sessions).map((chat) => chat.id)).toEqual(["a-main"]);
    expect(flowChats(betaTask, shared, sessions).map((chat) => chat.id)).toEqual(["b-main"]);
    expect(flowChats(alphaNode, shared, sessions).map((chat) => chat.id).sort())
      .toEqual(["a-main", "a-review"]);
    expect(flowChats(betaNode, shared, sessions).map((chat) => chat.id)).toEqual(["b-main"]);
  });
});
