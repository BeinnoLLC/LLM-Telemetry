// T-23 RUN A: mounted DOM contract for the matrix (keyboard activation,
// provider SVGs instead of letters, sorting and the empty state).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProjectMatrix from "../../components/sessions-logs/ProjectMatrix";
import type { SessionRow } from "../../lib/sessions-logs/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (over: Partial<SessionRow>): SessionRow => ({ ...over });
let host: HTMLDivElement;
let root: Root;

function mount(rows: SessionRow[], axis: "cost" | "calls" | "tokens" | "sessions", onOpen = vi.fn()) {
  act(() => {
    root.render(createElement(ProjectMatrix, { rows, axis, onOpen }));
  });
  return onOpen;
}

const modelHeaders = (): HTMLElement[] =>
  [...host.querySelectorAll<HTMLElement>("#projmatrix thead th")].slice(1, -1);
const rowLabels = (): string[] =>
  [...host.querySelectorAll<HTMLElement>("#projmatrix tbody td:first-child")].map(
    (cell) => cell.textContent ?? "",
  );

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("ProjectMatrix DOM", () => {
  it("uses provider SVG paths in headers, never a letter monogram", () => {
    mount([
      row({ project: "atlas", model: "claude-sonnet-5", act: 3, provider: "anthropic" }),
      row({ project: "atlas", model: "stepfun/step-3.7-flash:free", act: 1 }),
    ], "cost");
    const headers = modelHeaders();
    expect(headers).toHaveLength(2);
    for (const header of headers) {
      const path = header.querySelector("svg.lvprovlogo path");
      expect(path, "header must carry an SVG provider mark").not.toBeNull();
      expect((path!.getAttribute("d") ?? "").length).toBeGreaterThan(8);
      expect(header.querySelector(".rt-mono, .qt-glyph")).toBeNull();
      expect(header.textContent?.replace(/[↕▲▼]/g, "").trim()).not.toMatch(/^[A-Z]{1,2}$/);
    }
    expect(headers[1].textContent).toContain("step-3.7-flash:free");
  });

  it("uses row provider evidence for the header identity, including custom local slots", () => {
    mount([
      row({
        project: "atlas",
        model: "mystery-model",
        provider: "custom",
        base_url: "https://example.invalid/v1",
        act: 1,
      }),
    ], "cost");
    // views.js:209: custom with no identifying URL is local, not cloud.
    expect(modelHeaders()[0].getAttribute("data-provider")).toBe("local");
  });

  it("separates empty cells from formatted zero cells", () => {
    mount([
      row({ project: "atlas", model: "a", act: 0 }),
      row({ project: "nova", model: "b", act: 5 }),
    ], "cost");
    const empty = [...host.querySelectorAll<HTMLElement>("#projmatrix tbody td[data-key]")]
      .find((cell) => cell.getAttribute("data-key") === "atlas|b")!;
    const zero = [...host.querySelectorAll<HTMLElement>("#projmatrix tbody td[data-key]")]
      .find((cell) => cell.getAttribute("data-key") === "atlas|a")!;
    expect(empty.textContent).toBe("—");
    expect(empty.getAttribute("role")).toBeNull();
    expect(zero.textContent).toBe("$0.00");
    expect(zero.getAttribute("role")).toBe("button");
    expect(zero.getAttribute("tabindex")).toBe("0");
  });

  it("activates row labels and cells with Enter and Space", () => {
    const onOpen = mount([
      row({ project: "atlas", model: "a", act: 2 }),
    ], "cost");
    const label = host.querySelector<HTMLElement>("#projmatrix tbody td:first-child")!;
    act(() => label.click());
    expect(onOpen).toHaveBeenCalledWith("atlas");

    const cell = host.querySelector<HTMLElement>("#projmatrix tbody td[data-key]")!;
    for (const key of ["Enter", " "]) {
      act(() => {
        cell.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      });
    }
    expect(onOpen).toHaveBeenCalledWith("atlas", "a");
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it("sorts rows from the column header and flips the glyph", () => {
    mount([
      row({ project: "atlas", model: "a", act: 1 }),
      row({ project: "nova", model: "a", act: 5 }),
    ], "cost");
    expect(rowLabels()).toEqual(["nova", "atlas"]);
    const button = host.querySelectorAll<HTMLButtonElement>("#projmatrix thead button")[1];
    expect(button.querySelector(".dt-ar")?.textContent).toBe("↕");
    act(() => button.click());
    expect(rowLabels()).toEqual(["atlas", "nova"]);
    expect(button.querySelector(".dt-ar")?.textContent).toBe("▲");
    act(() => button.click());
    expect(rowLabels()).toEqual(["nova", "atlas"]);
    expect(button.querySelector(".dt-ar")?.textContent).toBe("▼");
  });

  it("sorts the +N more column by the hidden rest value, not the grand total", () => {
    const rows: SessionRow[] = [];
    for (let index = 0; index < 8; index += 1) {
      rows.push(row({ project: "atlas", model: `m${index}`, act: 150 }));
      rows.push(row({ project: "nova", model: `m${index}`, act: 100 }));
    }
    // Tail is hidden; atlas has a smaller tail but a larger grand total.
    rows.push(row({ project: "atlas", model: "tail", act: 1 }));
    rows.push(row({ project: "nova", model: "tail", act: 50 }));
    mount(rows, "cost");

    const buttons = [...host.querySelectorAll<HTMLButtonElement>("#projmatrix thead button")];
    const restButton = buttons[buttons.length - 2];
    expect(restButton.textContent).toContain("+1 more");
    const restCell = host.querySelector<HTMLElement>("#projmatrix tbody tr td[data-v]")!;
    expect(restCell.textContent).toBe("$1.00");
    expect(restCell.getAttribute("data-v")).toBe("$1.00");

    act(() => restButton.click());
    expect(rowLabels()).toEqual(["atlas", "nova"]);
    act(() => restButton.click());
    expect(rowLabels()).toEqual(["nova", "atlas"]);

    // Sorting Total descending gives the opposite order: the rest column
    // cannot be a stand-in for the grand total.
    const totalButton = buttons[buttons.length - 1];
    expect(totalButton.textContent).toContain("Total");
    act(() => totalButton.click()); // asc
    act(() => totalButton.click()); // desc
    expect(rowLabels()).toEqual(["atlas", "nova"]);
  });

  it("keeps one scroll wrapper and shows the empty message only when empty", () => {
    mount([], "cost");
    expect(host.querySelectorAll("#projmatrixwrap")).toHaveLength(1);
    expect(host.querySelectorAll("#projmatrixwrap #projmatrixwrap")).toHaveLength(0);
    expect(host.querySelector("#projmatrixempty")?.hasAttribute("hidden")).toBe(false);
    expect(host.querySelector("#projmatrixempty")?.textContent).toBe(
      "No session activity in the selected range.",
    );
    mount([row({ project: "atlas", model: "a", act: 1 })], "cost");
    expect(host.querySelector("#projmatrixempty")?.hasAttribute("hidden")).toBe(true);
  });
});
