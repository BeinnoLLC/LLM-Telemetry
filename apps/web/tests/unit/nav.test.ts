import { describe, expect, it } from "vitest";
import {
  ALL_VIEWS,
  legacyHashToPath,
  NAV_GROUPS,
  resolveSlug,
} from "../../lib/nav";

describe("legacy nav data (T-20)", () => {
  it("lists every view exactly once across NAV_GROUPS", () => {
    expect(NAV_GROUPS).toEqual([
      { name: "Live", views: ["Home", "Life", "Flow", "Hive"] },
      { name: "Usage & Costs", views: ["Usage", "Cost", "Prices", "Sessions"] },
      { name: "Models & Providers", views: ["Router", "Rankings", "Quota", "Health"] },
      { name: "Tasks & Queue", views: ["Kanban", "Orchestration"] },
      { name: "System", views: ["Detail", "Logs", "Settings"] },
    ]);
    const views = NAV_GROUPS.flatMap((group) => group.views);
    expect(new Set(views).size).toBe(views.length);
    expect(views).toHaveLength(17);
    expect([...ALL_VIEWS].sort()).toEqual([...views].sort());
  });

  it("maps the live alias to Home", () => {
    expect(resolveSlug("live")).toBe("/");
    expect(legacyHashToPath("#/live")).toBe("/");
  });

  it("falls back to Home for an unknown slug", () => {
    expect(resolveSlug("not-a-view")).toBe("/");
    expect(legacyHashToPath("#/not-a-view")).toBe("/");
  });

  it("keeps legacy query strings", () => {
    expect(legacyHashToPath("#/usage?s=bandwidth")).toBe("/usage?s=bandwidth");
  });
});
