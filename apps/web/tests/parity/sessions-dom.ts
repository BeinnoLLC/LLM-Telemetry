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
