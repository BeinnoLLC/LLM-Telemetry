// T-23 RUN C: one canonical DOM reader for the live Python Logs view and
// Next /logs. Both pages go through this identical function; only the frozen
// fixture's legacy "Failure" facet label is canonicalised to "Kind" so the
// two stacks' documented label spellings can be compared field-by-field.
import type { Page } from "playwright";

export interface LogsChipDom {
  facet: string;
  value: string;
  label: string;
  count: string;
  on: boolean;
  /** Provider brand SVG path on model chips; empty on every other facet. */
  svgPath: string;
}

export interface LogsFacetDom {
  label: string;
  chips: LogsChipDom[];
}

export interface LogsWindowDom {
  value: string;
  label: string;
  on: boolean;
}

export interface LogsRowDom {
  index: string;
  ts: string;
  tag: string;
  /** Preview text only; the meta span is read separately after expansion. */
  preview: string;
  open: boolean;
  meta: string;
  metaSvgPath: string;
}

export interface LogsDom {
  view: boolean;
  scope: string;
  count: string;
  cap: string;
  badge: string;
  note: string;
  searchPlaceholder: string;
  facets: LogsFacetDom[];
  windows: LogsWindowDom[];
  active: Array<{ facet: string; value: string; label: string }>;
  rows: LogsRowDom[];
}

export type LogsSide = "python" | "next";

/** Python's legacy visible label and Next's spec label name the same facet. */
export function canonicalLogsFacetLabel(label: string): string {
  const clean = label.replace(/:\s*$/, "").trim();
  return clean === "Failure" ? "Kind" : clean;
}

/** page.evaluate runs in either browser tab; no side-specific branching. */
export async function readLogsDom(page: Page, _side: LogsSide): Promise<LogsDom> {
  void _side; // the same reader for both; the label is caller-side context only
  const raw = await page.evaluate(() => {
    const clean = (value: string | null | undefined): string =>
      (value ?? "").replace(/\s+/g, " ").trim();
    const text = (element: Element | null | undefined): string => clean(element?.textContent);

    const chip = (element: Element): {
      facet: string;
      value: string;
      label: string;
      count: string;
      on: boolean;
      svgPath: string;
    } => {
      const clone = element.cloneNode(true) as Element;
      clone.querySelectorAll(".n, svg").forEach((node) => node.remove());
      return {
        facet: element.getAttribute("data-facet") ?? "",
        value: element.getAttribute("data-val") ?? "",
        label: text(clone),
        count: text(element.querySelector(".n")),
        on: element.classList.contains("on"),
        svgPath: element.querySelector("svg path")?.getAttribute("d") ?? "",
      };
    };

    const facets = [...document.querySelectorAll(".lgfacets > div")]
      .filter((row) => row.querySelector("[data-facet]"))
      .map((row) => ({
        label: text(row.querySelector(".lglbl")),
        chips: [...row.querySelectorAll("[data-facet]")].map(chip),
      }));

    const windows = [...document.querySelectorAll("[data-win]")].map((element) => ({
      value: element.getAttribute("data-win") ?? "",
      label: text(element),
      on: element.classList.contains("on"),
    }));

    const active = [...document.querySelectorAll("#lgactive [data-unfacet]")].map((element) => ({
      facet: element.getAttribute("data-unfacet") ?? "",
      value: element.getAttribute("data-val") ?? "",
      label: text(element),
    }));

    const rows = [...document.querySelectorAll("#lglist .lgev")].map((element) => {
      const msg = element.querySelector(".lgmsg");
      const previewClone = msg?.cloneNode(true) as Element | undefined;
      previewClone?.querySelectorAll(".lgmeta").forEach((node) => node.remove());
      const open = element.classList.contains("open");
      return {
        index: element.getAttribute("data-i") ?? "",
        ts: text(element.querySelector(".lgts")),
        tag: text(element.querySelector(".lgtag")),
        preview: text(previewClone),
        open,
        // Python ships the meta span on every row; gate it on .open so both
        // stacks expose exactly the same state-dependent information.
        meta: open ? text(element.querySelector(".lgmeta")) : "",
        metaSvgPath: open ? element.querySelector(".lgmeta svg path")?.getAttribute("d") ?? "" : "",
      };
    });

    return {
      view: document.querySelector('[data-view="Logs"]') !== null,
      scope: text(document.querySelector("#lgscope")),
      count: text(document.querySelector("#lgcount")),
      cap: text(document.querySelector("#lgcap")),
      badge: text(document.querySelector("#lgcountbadge")),
      note: text(document.querySelector("#lgnote")),
      searchPlaceholder: document.querySelector("#lgq")?.getAttribute("placeholder") ?? "",
      facets,
      windows,
      active,
      rows,
    };
  });

  return {
    ...raw,
    facets: raw.facets.map((facet) => ({
      ...facet,
      label: canonicalLogsFacetLabel(facet.label),
    })),
    active: raw.active.map((item) => ({
      ...item,
      label: item.label.replace("Failure:", "Kind:"),
    })),
  };
}
