// T-23 RUN A: one canonical reader for the live Python Sessions view and
// Next /sessions. Both pages go through this exact same function; only an
// explicitly documented, evidence-backed fixture exception is allowed to
// reconcile Python's monogram fallback with Next's SVG-only headers.
import type { Page } from "playwright";

export interface WeightButtonDom {
  axis: string;
  label: string;
  pressed: string | null;
}

export interface MatrixHeaderIcon {
  /** Canonical brand glyph: inline SVG path, or Python's monogram evidence. */
  kind: "svg" | "monogram" | "none";
  value: string;
}

export interface MatrixHeaderDom {
  label: string;
  icon: MatrixHeaderIcon;
  /** Stable provider identity, read from data-provider on both renderings. */
  provider: string | null;
}

export interface MatrixRowDom {
  label: string;
  /** Cells keyed by `project|model`, produced by data-key or derived equally. */
  cells: Record<string, string>;
  /** Sort value of the hidden "+N more" cell, from its data-v when present. */
  rest: string;
  total: string;
}

export interface SessionsDom {
  weight: WeightButtonDom[];
  note: string;
  empty: { text: string; hidden: boolean };
  headers: MatrixHeaderDom[];
  rows: MatrixRowDom[];
  footer: string[];
  interactive: { labels: number; cells: number };
}

export type SessionsSide = "python" | "next";

/** page.evaluate runs in either browser tab; no side-specific branching. */
export async function readSessionsDom(
  page: Page,
  _side: SessionsSide,
): Promise<SessionsDom> {
  void _side; // same reader for both pages; the label is caller-side context only
  return page.evaluate(() => {
    const clean = (value: string | null | undefined): string =>
      (value ?? "").replace(/\s+/g, " ").trim();
    const text = (element: Element | null | undefined): string =>
      clean(element?.textContent);

    const headerOf = (header: Element): MatrixHeaderDom => {
      const root = header.querySelector(".dt-sort") ?? header;
      // Only the label copy drops icon nodes; the icons are captured below as
      // first-class fields, so no header identity is hidden from the compare.
      const clone = root.cloneNode(true) as Element;
      clone.querySelectorAll(".dt-ar, svg, span[style*='font-size']").forEach((node) => node.remove());
      const label = text(clone);

      const path = root.querySelector("svg path")?.getAttribute("d") ?? null;
      const monogram = [...root.querySelectorAll("span")].find((node) =>
        /font-size/.test(node.getAttribute("style") ?? ""),
      );
      const icon: MatrixHeaderIcon = path
        ? { kind: "svg", value: path }
        : monogram
          ? { kind: "monogram", value: text(monogram) }
          : { kind: "none", value: "" };

      return {
        label,
        icon,
        provider: header.getAttribute("data-provider") ?? root.getAttribute("data-provider"),
      };
    };

    const weightGroup = document.querySelector("#projweight");
    const weight = [...(weightGroup?.querySelectorAll("button") ?? [])].map((button) => ({
      axis: button.getAttribute("data-w") ?? "",
      label: text(button),
      pressed: button.getAttribute("aria-pressed"),
    }));

    const note = document.querySelector("#projweightnote");
    const emptyNode = document.querySelector("#projmatrixempty");
    const table = document.querySelector("#projmatrix");
    const headers = [...(table?.querySelectorAll("thead th") ?? [])].map(headerOf);
    // The rest column is identified by its canonical header label; data-v is
    // the explicit sort value where present, with the rendered cell text as
    // the identical fallback for the unmodified Python rendering.
    const restIndex = headers.findIndex((header) => /^\+\d+ more$/.test(header.label));

    const rows = [...(table?.querySelectorAll("tbody tr") ?? [])].map((tr) => {
      const label = text(tr.children[0]);
      const cells: Record<string, string> = {};
      const dataCells = [...tr.children].slice(1, -1);
      dataCells.forEach((cell, index) => {
        const header = headers[index + 1]?.label ?? "";
        const key = cell.getAttribute("data-key") ?? `${label}|${header}`;
        cells[key] = text(cell);
      });
      const restCell =
        restIndex >= 0
          ? tr.children[restIndex]
          : [...tr.children].find((cell) => cell.hasAttribute("data-v"));
      return {
        label,
        cells,
        rest: restCell ? clean(restCell.getAttribute("data-v") ?? text(restCell)) : "",
        total: text(tr.children[tr.children.length - 1]),
      };
    });

    const footer = [...(table?.querySelectorAll("tfoot td") ?? [])].map(text);
    const interactive = {
      labels: table?.querySelectorAll('tbody tr > td:first-child[role="button"][tabindex="0"]').length ?? 0,
      cells: table?.querySelectorAll('tbody td[data-project][data-model][role="button"][tabindex="0"]').length ?? 0,
    };

    return {
      weight,
      note: text(note),
      empty: {
        text: text(emptyNode),
        hidden: emptyNode?.hasAttribute("hidden") ?? true,
      },
      headers,
      rows,
      footer,
      interactive,
    };
  });
}

// ---------------------------------------------------------------------------
// T-23 RUN D — project chart parity. The Python dashboard draws both charts
// with Chart.js on <canvas>, while the Next.js port is presentational SVG.
// There is no Canvas API in the parity harness, so pixel/canvas comparison is
// impossible. Instead we normalise BOTH renderings into this one descriptor:
// legend text, aria-pressed visibility, axis title, empty-state copy and every
// plotted value. On the Python side the values come from the live Chart.js
// config; on the Next side from the data-value / data-share attributes on each
// <rect>. In normalised/stacked mode Chart.js plots the percentage, so the
// descriptor compares that against data-share; in absolute mode it compares
// against data-value. data-value remains on every segment in every mode so no
// measurement is invented or dropped.

interface ChartLike {
  data: { labels: unknown[]; datasets: Array<{ label?: string; data?: unknown[] }> };
  options?: {
    scales?: {
      x?: { title?: { text?: string } };
      y?: { title?: { text?: string } };
    };
  };
}

interface ChartApiLike {
  getChart?: (canvas: Element | null) => ChartLike | null;
}

export interface ChartSegmentDom {
  value: number;
  share: number;
  hidden: boolean;
}

export interface ChartLegendEntryDom {
  label: string;
  pressed: string | null;
}

export interface DistributionChartDom {
  axisTitle: string;
  normalized: boolean;
  empty: { text: string; hidden: boolean };
  providers: ChartLegendEntryDom[];
  bars: Array<{
    project: string;
    total: number;
    visibleTotal: number;
    segments: ChartSegmentDom[];
  }>;
}

export interface TrendChartDom {
  axisTitle: string;
  stacked: boolean;
  empty: { text: string; hidden: boolean };
  series: ChartLegendEntryDom[];
  days: Array<{
    day: string;
    total: number;
    visibleTotal: number;
    segments: ChartSegmentDom[];
  }>;
}

export interface ProjectChartsDom {
  distribution: DistributionChartDom;
  trend: TrendChartDom;
}

export async function readProjectChartsDom(
  page: Page,
  side: "python" | "next",
): Promise<ProjectChartsDom> {
  return page.evaluate((which) => {
    const clean = (value: string | null | undefined): string =>
      (value ?? "").replace(/\s+/g, " ").trim();
    const text = (element: Element | null | undefined): string => clean(element?.textContent);
    const number = (value: unknown): number => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    // Three decimals is enough to catch a wrong weight without tripping over
    // float noise from a percentage division.
    const round = (value: number): number => Math.round(value * 1000) / 1000;
    const emptyOf = (id: string): { text: string; hidden: boolean } => {
      const node = document.querySelector(`#${id}`);
      return { text: text(node), hidden: node?.hasAttribute("hidden") ?? true };
    };
    const legendOf = (id: string): ChartLegendEntryDom[] =>
      [...(document.querySelector(`#${id}`)?.querySelectorAll("button") ?? [])].map((button) => ({
        label: text(button),
        pressed: button.getAttribute("aria-pressed"),
      }));
    const axisFromWeight = (): string => {
      const axis =
        document.querySelector('#projweight button[aria-pressed="true"]')?.getAttribute("data-w") ?? "cost";
      const labels: Record<string, string> = {
        cost: "Cost ($)",
        calls: "Calls",
        tokens: "Tokens",
        sessions: "Sessions",
      };
      return labels[axis] ?? "Cost ($)";
    };
    const sharesOf = (values: number[]): number[] => {
      const total = values.reduce((sum, value) => sum + value, 0);
      return values.map((value) => (total > 0 ? (100 * value) / total : 0));
    };
    const hiddenOf = (legend: ChartLegendEntryDom[], index: number): boolean =>
      legend[index]?.pressed === "false";

    const normalized = document.querySelector<HTMLInputElement>("#projdistnorm")?.checked ?? false;
    const stacked = document.querySelector<HTMLInputElement>("#projtrendstack")?.checked ?? false;
    const distEmpty = emptyOf("projdistempty");
    const trendEmpty = emptyOf("projtrendempty");

    let distribution: DistributionChartDom;
    let trend: TrendChartDom;

    if (which === "python") {
      const api = (window as unknown as { Chart?: ChartApiLike }).Chart;
      const distChart = api?.getChart?.(document.querySelector("#cProjDist")) ?? null;
      const distLegend = legendOf("projdistlegend");
      const distLabels = (distChart?.data.labels ?? []).map((label) => clean(String(label)));
      const distSets = distChart?.data.datasets ?? [];
      distribution = {
        axisTitle: clean(
          distChart?.options?.scales?.x?.title?.text ??
            (normalized ? "% of project total" : axisFromWeight()),
        ),
        normalized,
        empty: distEmpty,
        providers: distSets.map((dataset, index) => ({
          label: clean(dataset.label),
          pressed: distLegend[index]?.pressed ?? null,
        })),
        bars: distLabels.map((project, index) => {
          const values = distSets.map((dataset) => number(dataset.data?.[index]));
          const shares = sharesOf(values);
          const segments = values.map((value, seriesIndex) => ({
            value: round(normalized ? shares[seriesIndex]! : value),
            share: round(shares[seriesIndex]!),
            hidden: hiddenOf(distLegend, seriesIndex),
          }));
          return {
            project,
            total: round(segments.reduce((sum, segment) => sum + segment.value, 0)),
            visibleTotal: round(
              segments.reduce((sum, segment) => sum + (segment.hidden ? 0 : segment.value), 0),
            ),
            segments,
          };
        }),
      };

      const trendChart = api?.getChart?.(document.querySelector("#cProjTrend")) ?? null;
      const trendLegend = legendOf("projtrendlegend");
      const trendLabels = (trendChart?.data.labels ?? []).map((label) => clean(String(label)));
      const trendSets = trendChart?.data.datasets ?? [];
      trend = {
        axisTitle: clean(
          trendChart?.options?.scales?.y?.title?.text ??
            (stacked ? "% of day total" : axisFromWeight()),
        ),
        stacked,
        empty: trendEmpty,
        series: trendSets.map((dataset, index) => ({
          label: clean(dataset.label),
          pressed: trendLegend[index]?.pressed ?? null,
        })),
        days: trendLabels.map((day, index) => {
          const values = trendSets.map((dataset) => number(dataset.data?.[index]));
          const shares = sharesOf(values);
          const segments = values.map((value, seriesIndex) => ({
            value: round(stacked ? shares[seriesIndex]! : value),
            share: round(shares[seriesIndex]!),
            hidden: hiddenOf(trendLegend, seriesIndex),
          }));
          return {
            day,
            total: round(segments.reduce((sum, segment) => sum + segment.value, 0)),
            visibleTotal: round(
              segments.reduce((sum, segment) => sum + (segment.hidden ? 0 : segment.value), 0),
            ),
            segments,
          };
        }),
      };
    } else {
      const distSvg = document.querySelector("#cProjDist");
      const distLegend = legendOf("projdistlegend");
      distribution = {
        axisTitle: clean(
          distSvg?.getAttribute("data-axis-title") ??
            (normalized ? "% of project total" : axisFromWeight()),
        ),
        normalized,
        empty: distEmpty,
        providers: distLegend,
        bars: [...(distSvg?.querySelectorAll(".pc-bar") ?? [])].map((group) => {
          const segments = [...group.querySelectorAll(".pc-seg")].map((rect) => {
            const share = number(rect.getAttribute("data-share"));
            return {
              value: round(normalized ? share : number(rect.getAttribute("data-value"))),
              share: round(share),
              hidden: rect.getAttribute("data-hidden") === "true",
            };
          });
          return {
            project: clean(group.getAttribute("data-project")),
            total: round(segments.reduce((sum, segment) => sum + segment.value, 0)),
            visibleTotal: round(
              segments.reduce((sum, segment) => sum + (segment.hidden ? 0 : segment.value), 0),
            ),
            segments,
          };
        }),
      };

      const trendSvg = document.querySelector("#cProjTrend");
      const trendLegend = legendOf("projtrendlegend");
      trend = {
        axisTitle: clean(
          trendSvg?.getAttribute("data-axis-title") ??
            (stacked ? "% of day total" : axisFromWeight()),
        ),
        stacked,
        empty: trendEmpty,
        series: trendLegend,
        days: [...(trendSvg?.querySelectorAll(".pc-day") ?? [])].map((group) => {
          const segments = [...group.querySelectorAll(".pc-trend-seg")].map((rect) => {
            const share = number(rect.getAttribute("data-share"));
            return {
              value: round(stacked ? share : number(rect.getAttribute("data-value"))),
              share: round(share),
              hidden: rect.getAttribute("data-hidden") === "true",
            };
          });
          return {
            day: clean(group.getAttribute("data-day")),
            total: round(segments.reduce((sum, segment) => sum + segment.value, 0)),
            visibleTotal: round(
              segments.reduce((sum, segment) => sum + (segment.hidden ? 0 : segment.value), 0),
            ),
            segments,
          };
        }),
      };
    }

    return { distribution, trend };
  }, side);
}
