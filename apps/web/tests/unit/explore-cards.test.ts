// LLMTELEMET-291 (T-20 RUN C1): Explore strip values and shared formatters.
// The expected numbers are derived by hand from the date-scoped rows below,
// mirroring views.js:1014-1122 and palette.js:150-162.
import { describe, expect, it } from "vitest";

import { fmt, fmtB, money } from "../../lib/home/format";
import {
  analyticsTotals,
  exploreCards,
  quotaStat,
  routerStat,
} from "../../lib/home/kpis";
import type { AnalyticsProfile, QuotaData, RouterData } from "../../lib/home/types";

const profile: AnalyticsProfile = {
  rows: [
    {
      date: "2026-09-19", model: "vendor/a", calls: 10, inp: 100, outp: 300,
      cread: 300, market_value_usd: 1.25, up_bytes: 1000, lan_up_bytes: 500,
      down_bytes: 200, project: "Nowinv", act: 5, est: 0, priced: true,
    },
    {
      date: "2026-09-19", model: "vendor/b", calls: 5, inp: 50, outp: 100,
      cread: 50, market_value_usd: 0.75, up_bytes: 200, down_bytes: 100,
      project: "", act: 1, est: 0, priced: true,
    },
    {
      date: "2026-09-20", model: "vendor/c", calls: 99, inp: 900, outp: 900,
      cread: 0, market_value_usd: 9.99, project: "Later", act: 9, est: 0,
      priced: true,
    },
  ],
  sessions: [
    { date: "2026-09-19", sessions: 3 },
    { date: "2026-09-20", sessions: 10 },
  ],
  health: [{ ok: 19, fail: 1 }, { ok: 78, fail: 2 }],
  failures_recent: [{ id: "f1" }],
};
const inR = (date?: string) => !!date && date <= "2026-09-19";
const router: RouterData = {
  profiles: {
    work: { tier_router: { enabled: true, tiers: [{}, {}] }, decisions: { total: 62 } },
    other: { tier_router: { enabled: false, tiers: [] } },
  },
};
const quota: QuotaData = {
  profiles: {
    work: {
      providers: {
        anthropic: { attention: 0, unavailable_reason: null },
        openai: { attention: 1, unavailable_reason: null },
      },
    },
    other: { providers: {} },
  },
  summary: { available: 4, providers: 5 },
};
const card = (title: string) => {
  const found = exploreCards(profile, "work", inR, router, quota, 0.12)
    .find((item) => item.title === title);
  if (!found) throw new Error(`missing ${title}`);
  return found.value;
};

describe("shared formatters", () => {
  it("matches palette.js:150-162 exactly", () => {
    expect(fmt(2500)).toBe("2.5K");
    expect(fmt("999")).toBe("999");
    expect(fmtB(0)).toBe("0 B");
    expect(fmtB(1024)).toBe("1.00 KB");
    expect(fmtB(15360)).toBe("15.0 KB");
    expect(fmtB(1099511627776)).toBe("1.00 TB");
    expect(money(0)).toBe("—");
    expect(money(12.5)).toBe("$12.50");
  });
});

describe("Explore cards", () => {
  it("derives every card from the same date-scoped rows", () => {
    // views.js:1014-1122; the 2026-09-20 row must not enter any value.
    const cards = exploreCards(profile, "work", inR, router, quota, 0.12);
    expect(cards.map((item) => item.title)).toEqual([
      "Flow", "Router", "Quota", "Usage", "Sessions", "Cost", "Health",
      "Detail", "Settings", "Bandwidth (est.)", "Prices",
    ]);
    expect(card("Flow")).toBe("2 models");
    expect(card("Router")).toBe("2 tiers · 62 decisions");
    expect(card("Quota")).toBe("1/2 near limit");
    expect(card("Usage")).toBe("15 calls");
    expect(card("Sessions")).toBe("Nowinv · 17% unattributed");
    expect(card("Cost")).toBe("$2.00");
    expect(card("Health")).toBe("97.0% · 1 recent");
    expect(card("Detail")).toBe("2 rows");
    expect(card("Settings")).toBe("$0.12 / kWh");
    expect(card("Bandwidth (est.)")).toBe("↑ 1.66 KB / ↓ 300 B");
    expect(card("Prices")).toBe("per 1M tokens");
    expect(cards.every((item) => item.value.trim().length > 0)).toBe(true);
  });

  it("uses the fleetRouter/fleetQuota stat strings", () => {
    expect(routerStat(router, "All")).toBe("1/2 profiles routed");
    expect(quotaStat(quota, "All")).toBe("4/5 available");
    expect(quotaStat({ profiles: { work: { providers: {} } } }, "work")).toBe("not cached");
    expect(quotaStat(null, "work")).toBe("No data");
  });

  it("uses em dashes, not invented zeroes, for missing analytics rows", () => {
    const cards = exploreCards(null, "work", undefined, null, null);
    for (const title of ["Flow", "Usage", "Sessions", "Cost", "Health", "Detail", "Bandwidth (est.)", "Settings"]) {
      expect(cards.find((item) => item.title === title)?.value).toBe("—");
    }
    expect(cards.find((item) => item.title === "Router")?.value).toBe("No data");
    expect(cards.find((item) => item.title === "Quota")?.value).toBe("No data");
  });

  it("computes the six KPI totals from the same date-scoped rows", () => {
    const totals = analyticsTotals(profile, inR);
    expect(totals.map((item) => item.value)).toEqual([15, 550, 70, 3, 97, 2]);
    expect(totals.map((item) => item.display)).toEqual([
      "15", "550", "70%", "3", "97%", "$2.00",
    ]);
  });
});
