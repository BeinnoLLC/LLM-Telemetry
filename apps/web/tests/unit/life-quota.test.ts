// LLMTELEMET-292 (T-21 RUN A2): the Life quota contract. Fixtures are the
// repo's real sample artifact; no endpoint is contacted and no value is
// fabricated. Null readings are made by clearing a real reading to null.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import LifeQuota from "../../components/life-flow/LifeQuota";
import type { HomeSnapshot, JsonRecord, QuotaData } from "../../lib/home-board/types";
import { resolveLifeView } from "../../lib/life-flow/load-life";
import {
  availableProviders,
  lifeRows,
  providersOf,
  qvAttention,
  qvBar,
  qvKpis,
  qvLevel,
  qvPct,
  worstPercent,
  type QuotaProfile,
} from "../../lib/life-flow/quota";

const repoRoot = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));
const payload = JSON.parse(
  readFileSync(join(repoRoot, "examples/reports/quota-data.json"), "utf8"),
) as QuotaData;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const profiles = payload.profiles as NonNullable<QuotaData["profiles"]>;
const work = profiles.work as QuotaProfile;
const personal = profiles.personal as QuotaProfile;
const attention = qvAttention(payload);
const anthropic = providersOf(work).find((provider) => provider.id === "anthropic") as JsonRecord;
const anthropicWindows = anthropic.windows as JsonRecord[];
const worstReading = Math.max(
  ...anthropicWindows.map((window) => qvPct(window.used_percent) as number),
);

function snapshot(quota: QuotaData | null): HomeSnapshot {
  return { analytics: null, live: null, router: null, quota };
}

function renderHost(node: ReturnType<typeof createElement>): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToString(node);
  return host;
}

describe("Life snapshot selection", () => {
  it("keeps the current profile only when the quota artifact has it", () => {
    expect(resolveLifeView(snapshot(payload), "personal").name).toBe("personal");
    expect(resolveLifeView(snapshot(payload), "personal").profile).toBe(personal);
    // Home's merged "All" is not a quota profile: Python falls back to key 0.
    expect(resolveLifeView(snapshot(payload), "All").name).toBe("work");
    expect(resolveLifeView(snapshot(null)).profile).toBeNull();
  });
});

describe("quota derivation", () => {
  it("filters unavailable providers from meters but not from the KPIs", () => {
    const rows = lifeRows(work, attention);
    const available = availableProviders(work);
    expect(rows.map((row) => row.label)).toEqual(
      available.map((provider) => String(provider.label || provider.id || "")),
    );
    expect(rows.some((row) => row.label === "Nous Portal")).toBe(false);
    const kpis = qvKpis(work);
    const total = Object.keys(work.providers as Record<string, unknown>).length;
    expect(kpis[0]).toEqual({ value: total, label: "providers", cls: "" });
    expect(kpis[1].value).toBe(`${available.length}/${total}`);
    expect(kpis[1].cls).toBe("qv-kpi-warn");
  });

  it("uses the worst real window and rounds only noisy floats", () => {
    expect(worstPercent(anthropic)).toBe(worstReading);
    expect(qvPct(String(worstReading))).toBe(worstReading);
    expect(qvPct(null)).toBeNull();
    expect(qvPct("n/a")).toBeNull();
    const row = lifeRows(work, attention).find((item) => item.label === "Anthropic");
    expect(row?.status).toBe(`${worstReading}% used`);
    expect(row?.bar.width).toBe(worstReading);
    expect(row?.level).toBe(qvLevel(worstReading, attention));
  });

  it("marks a never-reported reading mute, never green", () => {
    const cleared = clone(work);
    const one = (cleared.providers as Record<string, JsonRecord>).anthropic;
    one.windows = [{ ...(anthropicWindows[0] as JsonRecord), used_percent: null }];
    const row = lifeRows(cleared, attention).find((item) => item.label === "Anthropic");
    expect(worstPercent(one)).toBeNull();
    expect(qvLevel(null, attention)).toBe("mute");
    expect(row?.status).toBe("no reading");
    expect(row?.statusClass).toBe("rt-mute");
    expect(row?.bar).toEqual({ label: "no reading", width: 0, level: "mute" });
    expect(qvBar(null, attention).label).toBe("no reading");
  });

  it("keeps singular labels for a one-provider profile", () => {
    const single = {
      ...clone(work),
      providers: { anthropic: clone(anthropic) },
    } as QuotaProfile;
    expect(lifeRows(single, attention)).toHaveLength(1);
    expect(qvKpis(single)[0]).toEqual({ value: 1, label: "provider", cls: "" });
    const host = renderHost(
      createElement(LifeQuota, { name: "work", profile: single, quota: payload }),
    );
    expect(host.querySelector("#lifequotasub")?.textContent).toBe("work · 1 provider");
  });
});

describe("LifeQuota markup", () => {
  it("renders one token-coloured metered row per available provider", () => {
    const rows = lifeRows(work, attention);
    const host = renderHost(
      createElement(LifeQuota, { name: "work", profile: work, quota: payload }),
    );
    const rendered = [...host.querySelectorAll(".qv-liferow")];
    expect(rendered).toHaveLength(rows.length);
    expect(host.querySelector("#lifequotasub")?.textContent).toBe(
      `work · ${rows.length} providers`,
    );
    const name = host.querySelector(".qv-wname") as HTMLElement;
    expect(name.getAttribute("style")).toContain("--prov-anthropic-fg");
    const track = host.querySelector(".qv-track") as HTMLElement;
    expect(track.getAttribute("role")).toBe("img");
    expect(track.getAttribute("aria-label")).toBe(rows[0].bar.label);
    const fill = track.querySelector(".qv-fill") as HTMLElement;
    expect(fill.style.width).toBe(`${rows[0].bar.width}%`);
    expect(fill.className).toContain(`qv-${rows[0].bar.level}`);
  });

  it("shows the exact empty state for missing or provider-less quota data", () => {
    for (const [name, profile, quota] of [
      ["", null, null],
      ["personal", personal, payload],
    ] as const) {
      const host = renderHost(
        createElement(LifeQuota, { name, profile, quota }),
      );
      expect(host.querySelector("#lifequotabody")?.textContent?.trim()).toBe(
        "No quota data cached for this profile.",
      );
      expect(host.querySelector(".qv-kpi")).toBeNull();
      expect(host.querySelector(".qv-liferow")).toBeNull();
    }
  });
});
