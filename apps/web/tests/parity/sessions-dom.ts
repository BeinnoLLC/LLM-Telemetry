// T-23 RUN A: one canonical reader for the live Python Sessions view and
// Next /sessions. Extends the T-20 home-dom helpers; both pages must yield
// byte-identical values through the same selectors before toEqual is allowed.
import type { Page } from "playwright";

export interface WeightButtonDom {
  axis: string;
  label: string;
  pressed: string | null;
}

export interface MatrixRowDom {
  label: string;
  /** Cells keyed by `project|model`, produced by data-key or derived equally. */
  cells: Record<string, string>;
  total: string;
}

export interface SessionsDom {
  weight: WeightButtonDom[];
  note: string;
  empty: { text: string; hidden: boolean };
  headers: string[];
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

    const headerText = (header: Element): string => {
      const root = header.querySelector(".dt-sort") ?? header;
      const clone = root.cloneNode(true) as Element;
      clone.querySelectorAll(".dt-ar").forEach((node) => node.remove());
      // Python providers without a brand SVG render a ≤2-char inline
      // monogram span; Next uses a neutral SVG instead. Both are chrome,
      // never part of the comparable model label.
      clone.querySelectorAll("span").forEach((node) => {
        const style = node.getAttribute("style") ?? "";
        if (/font-size/.test(style) && clean(node.textContent).length <= 2) {
          node.remove();
        }
      });
      return text(clone);
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
    const headers = [...(table?.querySelectorAll("thead th") ?? [])].map(headerText);

    const rows = [...(table?.querySelectorAll("tbody tr") ?? [])].map((tr) => {
      const label = text(tr.children[0]);
      const cells: Record<string, string> = {};
      const dataCells = [...tr.children].slice(1, -1);
      dataCells.forEach((cell, index) => {
        const header = headers[index + 1] ?? "";
        const key = cell.getAttribute("data-key") ?? `${label}|${header}`;
        cells[key] = text(cell);
      });
      return { label, cells, total: text(tr.children[tr.children.length - 1]) };
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
