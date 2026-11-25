// T-22 RUN D: DOM readers shared by the Python/Next usage-cost parity spec.
// Every reader returns normalized *rendered* text (or a small data-* value),
// never a screenshot pixel. The strict equality comparison lives in the spec.
import type { Page } from "@playwright/test";

/** Provider glyphs are marks, not letters. Collapse them to word boundaries. */
const PROV_MARKS = /[\u2733\u25c8\u2726\u25c9\u25cf\u25a3\u2b21\u2601\u25c6\u25cb]/g;

/** One whitespace spelling for both renderers (React text nodes vs inline HTML). */
export function norm(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Strip the glyph prefix Python puts on provider names and served-by badges. */
export function stripMarks(value: string | null | undefined): string {
  return norm((value ?? "").replace(PROV_MARKS, " "));
}

export async function requiredText(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const hit = document.querySelector(sel);
    if (!hit) throw new Error(`missing element for ${sel}`);
    return (hit.textContent ?? "").replace(/\s+/g, " ").trim();
  }, selector);
}

export async function requiredAttr(
  page: Page,
  selector: string,
  attribute: string,
): Promise<string> {
  return page.evaluate(
    ({ sel, attr }) => {
      const hit = document.querySelector(sel);
      if (!hit) throw new Error(`missing element for ${sel}`);
      const value = hit.getAttribute(attr);
      if (value === null) throw new Error(`missing ${attr} on ${sel}`);
      return value.replace(/\s+/g, " ").trim();
    },
    { sel: selector, attr: attribute },
  );
}

export async function allTexts(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) =>
    [...document.querySelectorAll(sel)].map((el) =>
      (el.textContent ?? "").replace(/\s+/g, " ").trim(),
    ), selector,
  );
}

/** Each attribution row as an array of rendered fragment texts, not ajoin. */
export async function rowFragmentTexts(
  page: Page,
  selector: string,
): Promise<string[][]> {
  return page.evaluate((sel) =>
    [...document.querySelectorAll(sel)].map((row) =>
      [...row.children].map((child) => (child.textContent ?? "").replace(/\s+/g, " ").trim()),
    ), selector,
  );
}

/** Rendered cells of table rows, optionally dropping trailing bar/action cells. */
export async function tableRows(
  page: Page,
  selector: string,
  dropTail = 0,
): Promise<string[][]> {
  return page.evaluate(
    ({ sel, drop }) =>
      [...document.querySelectorAll(sel)].map((row) => {
        const cells = [...row.children];
        const body = drop > 0 ? cells.slice(0, -drop) : cells;
        return body.map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim());
      }),
    { sel: selector, drop: dropTail },
  );
}

/** Cells whose provider marks differ between SVG (Next) and glyph (Python). */
export function providerCells(rows: string[][], column: number): string[][] {
  return rows.map((cells) =>
    cells.map((cell, index) => (index === column ? stripMarks(cell) : cell)),
  );
}

/** Leaf count for a parity value, so the run can report exact comparison scope. */
export function leafCount(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + leafCount(item), 0);
  if (value !== null && typeof value === "object") {
    return Object.values(value).reduce<number>(
      (sum, item) => sum + leafCount(item),
      0,
    );
  }
  return 1;
}

export interface ParityLedger {
  comparisons: number;
  leaves: number;
  compare<T>(name: string, pythonValue: T, nextValue: T): void;
}

/** Creates a ledger that fails immediately on any mismatch and counts scope. */
export function parityLedger(
  assertEqual: (actual: unknown, expected: unknown) => void,
): ParityLedger {
  return {
    comparisons: 0,
    leaves: 0,
    compare<T>(name: string, pythonValue: T, nextValue: T): void {
      assertEqual(nextValue, pythonValue);
      this.comparisons += 1;
      this.leaves += leafCount(pythonValue);
    },
  };
}
