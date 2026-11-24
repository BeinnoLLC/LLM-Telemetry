import type { Page } from "@playwright/test";

/** Canonical, order-independent Home numbers read from DOM text. Hidden
 * panels are included on purpose (Decision 2: Python keeps #qcard/#live-grid
 * in its hidden Life view). No visibility checks, no screenshot diffing. */
export interface HomeDom {
  livekpis: Record<string, { value: string; sub: string }>;
  kpis: string[];
  homecards: string[];
  series: { name: string; max: string; mean: string; last: string }[];
  live: {
    key: string;
    model: string;
    state: string;
    tokens: string;
    cost: string;
    phase: string;
    tools: string[];
    ago: string;
    elapsed: string;
  }[];
  queue: { queued: string; running: string; done: string; qsub: string };
}

const KEYS = ["sessions", "agents", "throughput", "alerts"] as const;

/** The Python oracle: text from the frozen dashboard.html served by the
 * ephemeral NoCacheHandler. Legend stats come from the real Chart.js table. */
export function pythonDom(page: Page): Promise<HomeDom> {
  return page.evaluate((keys) => {
    const t = (el: Element | null | undefined): string =>
      (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const q = (s: string): Element | null => document.querySelector(s);
    const livekpis: Record<string, { value: string; sub: string }> = {};
    keys.forEach((key) => {
      const card = q(`#livekpis [data-kpi="${key}"]`);
      livekpis[key] = {
        value: t(card?.querySelector(".stat-value")),
        sub: t(card?.querySelector(".stat-sub")),
      };
    });
    // #cHome6h is the first chart; later .lgt-wrap tables belong to other
    // Home charts and must not leak into the 6h comparison.
    const chartBox = q("#cHome6h")?.parentElement;
    const legend = chartBox?.nextElementSibling;
    const series = [...(legend?.querySelectorAll("table.lgt tbody tr[data-i]") ?? [])]
      .map((row) => {
        const cells = [...row.children].map((cell) => t(cell));
        return { name: cells[1], max: cells[2], mean: cells[3], last: cells[4] };
      })
      .filter((row) => row.name.length > 0);
    const live = [...document.querySelectorAll("#livelist .liverow")]
      .map((row) => {
        // Hermes keeps the id on its title button; PI/agent rows carry it
        // on the row itself (live.js:427, 519-540, 617-635).
        const id =
          row.querySelector("[data-tsession]")?.getAttribute("data-tsession") ??
          row.getAttribute("data-pisession") ??
          row.getAttribute("data-agentsession") ??
          "";
        const engine = row.getAttribute("data-engine");
        const pi = row.hasAttribute("data-pisession") ? "pi:" : "";
        const act = row.querySelector(":scope > .lvc-act");
        const nums = [...row.querySelectorAll(":scope > .lvc.lvnum")];
        return {
          key: engine ? `${engine}:${id}` : `${pi}${id}`,
          model: t(row.querySelector(".metacol .lvmodel")),
          state: t(row.querySelector(".lvst")),
          tokens: t(nums[0]),
          cost: t(nums[1]),
          phase: t(act?.querySelector(".lvphase")),
          tools: [...(act?.querySelectorAll(".lvtool") ?? [])].map((tool) =>
            t(tool) || tool.getAttribute("title") || "",
          ),
          ago: t(act?.querySelector(".lvago")),
          elapsed: t(row.querySelector(".lvel")),
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
    return {
      livekpis,
      kpis: [...document.querySelectorAll("#kpis .stat-value")].map(t),
      homecards: [...document.querySelectorAll("#homecards .hc-stat")].map(t),
      series,
      live,
      queue: {
        queued: t(q("#qt-n-queued")),
        running: t(q("#qt-n-running")),
        done: t(q("#qt-n-done")),
        qsub: t(q("#qsub")),
      },
    };
  }, [...KEYS]);
}

/** The Next page. The 6h legend exposes raw bucket totals in data attributes
 * so the same Max/Mean/Last statistics as Chart.js can be compared exactly. */
export function nextDom(page: Page): Promise<HomeDom> {
  return page.evaluate((keys) => {
    const t = (el: Element | null | undefined): string =>
      (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const q = (s: string): Element | null => document.querySelector(s);
    const compact = (n: number): string => {
      for (const [u, d] of [["B", 1e9], ["M", 1e6], ["K", 1e3]] as const) {
        if (n >= d) return (n / d).toFixed(1) + u;
      }
      return String(Math.round(n));
    };
    const stat = (values: number[], format: (n: number) => string) => ({
      max: format(Math.max(...values)),
      mean: format(values.reduce((a, b) => a + b, 0) / values.length),
      last: format(values[values.length - 1]),
    });
    const items = [...document.querySelectorAll(".series-legend-item")];
    const calls = items.map((item) => Number(item.getAttribute("data-calls")) || 0);
    const tokens = items.map((item) => Number(item.getAttribute("data-tokens")) || 0);
    const thousands = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
    const series = items.length
      ? [
          { name: "Calls", ...stat(calls, (n) => thousands.format(Math.round(n))) },
          { name: "Tokens", ...stat(tokens, compact) },
        ]
      : [];
    const livekpis: Record<string, { value: string; sub: string }> = {};
    keys.forEach((key) => {
      const card = q(`#livekpis [data-kpi="${key}"]`);
      livekpis[key] = {
        value: t(card?.querySelector(".stat-value")),
        sub: t(card?.querySelector(".stat-sub")),
      };
    });
    const live = [...document.querySelectorAll("#home-live-table .lvrow[data-key]")]
      .map((row) => {
        const act = row.querySelector(".lvc-act");
        return {
          key: row.getAttribute("data-key") ?? "",
          model: t(row.querySelector(".lv-model-name")),
          state: t(row.querySelector(".lv-state")),
          tokens: t(row.querySelector(".lv-num > .lv-stk > span")),
          cost: t(row.querySelector(".lv-cost .lv-stk > span")),
          phase: t(act?.querySelector(".lv-s2")),
          tools: [...(act?.querySelectorAll(".lv-tool") ?? [])].map((tool) =>
            tool.getAttribute("title") || t(tool),
          ),
          ago: t(act?.querySelector(".lv-activity-line")),
          elapsed: t(row.querySelector(".lv-elapsed")),
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
    return {
      livekpis,
      kpis: [...document.querySelectorAll("#kpis .stat-value")].map(t),
      homecards: [...document.querySelectorAll("#homecards .hc-stat")].map(t),
      series,
      live,
      queue: {
        queued: t(q("#qt-n-queued")),
        running: t(q("#qt-n-running")),
        done: t(q("#qt-n-done")),
        qsub: t(q("#qsub")),
      },
    };
  }, [...KEYS]);
}
