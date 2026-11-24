// LLMTELEMET-291 (T-20 RUN E1): assertions from flow.js queue shaping —
// keyed depot slots, in-flight rows, recent sessions, seed, fit and qsub.
// Fixtures use collector-shaped data; no demo/synthetic queue entries.
import { describe, expect, it } from "vitest";

import { buildTaskQueue, qtFit, qtSeed } from "../../lib/home-board/queue";
import type { HomeSnapshot } from "../../lib/home-board/types";

const snapshot = (queues: [string, number][] = [["box-a", 2], ["box-b", 1]]): HomeSnapshot => ({
  analytics: {
    profiles: {
      work: {
        recent_sessions: [
          { id: "done-1", title: "Finished one", last_model: "claude-opus-5", last_ts: 200, tokens: 90 },
          { id: "done-2", title: "Finished two", model: "qwen3:8b", last_ts: 100, tokens: 40 },
        ],
      },
    },
  },
  live: {
    profiles: {
      work: {
        live: [
          { id: "h-1", title: "Hermes task", model: "claude-opus-5", idle_s: 15, phase: "editing" },
        ],
      },
    },
    pi_live: [{ session_id: "pi-1", title: "Pi task", model: "glm-5", idle_s: 8, phase: "reading" }],
    agent_live: [
      { engine: "claude", session_id: "c-1", title: "Claude task", model: "claude-opus-4-5", idle_s: 3, phase: "running" },
    ],
    ollama: { hosts: queues.map(([label, queue]) => ({ label, queue, up: true })) },
  },
  router: null,
  quota: null,
});

describe("task queue shaping (RUN E1)", () => {
  it("builds depot, running and yard balls from real feeds", () => {
    const q = buildTaskQueue(snapshot(), "work");
    expect(q.queued.map((ball) => ball.key)).toEqual(["q:box-a:0", "q:box-a:1", "q:box-b:0"]);
    expect(q.running.map((ball) => ball.key)).toEqual(["claude:c-1", "pi:pi-1", "s:h-1"]);
    expect(q.done.map((ball) => ball.key)).toEqual(["s:done-1", "s:done-2"]);
    expect(q.counts).toEqual({ queued: 3, running: 3, done: 2 });
    expect(q.qsub).toBe("backed up on box-a, box-b");
  });

  it("reports a clear fleet with the exact host count", () => {
    expect(buildTaskQueue(snapshot([["box-a", 0], ["box-b", 0]]), "work").qsub)
      .toBe("fleet clear · 2 hosts");
    expect(buildTaskQueue(snapshot([["box-a", 0]]), "work").qsub)
      .toBe("fleet clear · 1 host");
    expect(buildTaskQueue(snapshot([]), "work").qsub).toBe("");
  });

  it("keeps the pile seed stable across two polls", () => {
    const first = buildTaskQueue(snapshot(), "work");
    const second = buildTaskQueue(snapshot(), "work");
    const keys = [...first.queued, ...first.running, ...first.done].map((ball) => ball.key);
    expect(keys.map(qtSeed)).toEqual([...second.queued, ...second.running, ...second.done].map((ball) => qtSeed(ball.key)));
    expect(new Set(keys.map(qtSeed)).size).toBe(keys.length);
    expect(qtSeed("q:box-a:0")).toBeCloseTo(qtSeed("q:box-a:0"), 12);
  });

  it("fits small piles and rolls the rest into +N", () => {
    const small = qtFit(["q:a:0", "q:a:1"], 220, 200);
    expect(small.keys).toEqual(["q:a:0", "q:a:1"]);
    expect(small.overflow).toBe(0);
    expect(small.more).toBe("");
    expect(small.balls).toHaveLength(2);

    const many = qtFit(Array.from({ length: 60 }, (_, i) => `q:box:${i}`), 120, 100);
    expect(many.overflow).toBeGreaterThan(0);
    expect(many.keys.length + many.overflow).toBe(60);
    expect(many.more).toBe(`+${many.overflow}`);
    expect(many.balls.length).toBe(many.keys.length);
  });
});
