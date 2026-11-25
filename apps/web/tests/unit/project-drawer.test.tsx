// T-23 RUN B: drawer aggregation, act/est separation, top-6 cuts, provider SVG
// marks and the shared focus trap (Esc/scrim/restore).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProjectDrawer, { type ProjectDrawerProps } from "../../components/sessions-logs/ProjectDrawer";
import type { SessionRow } from "../../lib/sessions-logs/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (over: Partial<SessionRow>): SessionRow => ({ ...over });
let host: HTMLDivElement;
let root: Root;

function mount(over: Partial<ProjectDrawerProps>): void {
  act(() => {
    root.render(
      createElement(ProjectDrawer, {
        rows: [],
        project: "atlas",
        onClose: vi.fn(),
        onSession: vi.fn(),
        ...over,
      }),
    );
  });
}

function sections(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>("#pdbody .pdsection")];
}

function section(label: string): HTMLElement {
  const found = sections().find((node) => node.textContent?.includes(label));
  if (!found) throw new Error(`missing section: ${label}`);
  return found;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("ProjectDrawer", () => {
  it("aggregates distinct sessions, calls, tokens and cache without summing act and est", () => {
    mount({
      rows: [
        row({
          project: "atlas",
          model: "m1",
          provider: "anthropic",
          date: "2026-01-02",
          session_id: "s1",
          calls: 2,
          inp: 10,
          outp: 20,
          cread: 3,
          cwrite: 4,
          act: 1.25,
          task: "plan",
        }),
        row({
          project: "atlas",
          model: "m2",
          provider: "openai",
          date: "2026-01-01",
          session_id: "s2",
          calls: 3,
          inp: 5,
          outp: 6,
          cread: 1,
          cwrite: 2,
          est: 0.75,
          task: "build",
        }),
        row({ project: "atlas", model: "m1", session_id: "s1", act: 99, date: "2026-01-02" }),
        row({ project: "nova", model: "m3", session_id: "s3", act: 50 }),
      ],
    });
    const totals = section("Totals").textContent ?? "";
    expect(totals).toContain("Sessions2");
    expect(totals).toContain("Calls5");
    expect(totals).toContain("Tokens in / out15 / 26");
    expect(totals).toContain("Cache read / write4 / 6");
    expect(totals).toContain("Cost — actual$100.25");
    expect(totals).toContain("Cost — estimated$0.75 (est.)");
    expect(totals).not.toContain("$101.00");
    expect(totals).toContain("First seen2026-01-01");
    expect(totals).toContain("Last seen2026-01-02");
    expect(section("Recent sessions").textContent).toContain("s1 · 2026-01-02");
  });

  it("keeps only the top six models and tasks, sorted by cost, and notes empty session ids", () => {
    const rows = Array.from({ length: 7 }, (_, index) =>
      row({
        project: "atlas",
        model: `model-${index}`,
        provider: "anthropic",
        task: `task-${index}`,
        act: index + 1,
      }),
    );
    mount({ rows });
    const models = section("Model breakdown");
    const tasks = section("Task / tool mix");
    expect(models.querySelectorAll(".pdstat")).toHaveLength(6);
    expect(tasks.querySelectorAll(".pdstat")).toHaveLength(6);
    expect(models.querySelector(".pdstat .k")?.textContent).toContain("model-6");
    expect(tasks.querySelector(".pdstat .k")?.textContent).toContain("task-6");
    expect(section("Recent sessions").textContent).toContain(
      "No individual session ids in this range.",
    );
  });

  it("uses provider SVG paths in every breakdown row, never a letter monogram", () => {
    mount({
      rows: [
        row({ project: "atlas", model: "claude-sonnet-5", provider: "anthropic", act: 2 }),
        row({ project: "atlas", model: "gpt-5", provider: "openai", act: 1 }),
      ],
    });
    for (const label of ["Model breakdown", "Provider breakdown"]) {
      const icons = section(label).querySelectorAll("svg.lvprovlogo path");
      expect(icons.length).toBeGreaterThan(0);
      icons.forEach((icon) => expect((icon.getAttribute("d") ?? "").length).toBeGreaterThan(8));
      expect(section(label).querySelector(".rt-mono, .qt-glyph")).toBeNull();
    }
  });

  it("opens a real session with its owning profile, never the merged All name", () => {
    const onSession = vi.fn();
    mount({
      rows: [row({ project: "atlas", session_id: "s-work", act: 1 })],
      profile: "All",
      opener: { id: "s-work", profile: "work" },
      sessionProfiles: { "s-work": "work" },
      onSession,
    });
    const chip = section("Recent sessions").querySelector<HTMLElement>(".ttitlebtn");
    expect(chip?.tagName).toBe("BUTTON");
    expect(chip?.getAttribute("data-tsession")).toBe("s-work");
    expect(chip?.getAttribute("data-tprofile")).toBe("work");
    expect(chip?.getAttribute("data-tprofile")).not.toBe("All");
    act(() => chip?.click());
    expect(onSession).toHaveBeenCalledWith("s-work", "work", "s-work");
  });

  it("traps Tab, closes on Escape and scrim, and restores focus to the opener", () => {
    const opener = document.createElement("button");
    opener.textContent = "atlas";
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    // A real recent session exists in the loaded artifact, but this project
    // has none in range: the note stays a div and the opener only supplies
    // the real profile fallback.
    mount({ onClose, profile: "All", opener: { id: "s-work", profile: "work" } });
    const drawer = host.querySelector<HTMLElement>("#pdrawer")!;
    const scrim = host.querySelector<HTMLElement>("#pdscrim")!;
    const body = host.querySelector<HTMLElement>("#pdbody")!;
    expect(drawer.getAttribute("aria-hidden")).toBe("false");
    expect(document.activeElement).toBe(body);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.activeElement).toBe(host.querySelector("#pdclose"));
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(host.querySelector("#pdclose"));
    // The "no session ids" note is a plain div in Python; it must not become a
    // focusable empty button on Next (dashboard.css:1206 hides the panel too).
    const note = section("Recent sessions").querySelector<HTMLElement>(".pdsessrow");
    expect(note?.tagName).toBe("DIV");
    expect(note?.hasAttribute("tabindex")).toBe(false);
    expect(note?.dataset.tsession ?? "").toBe("");

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => root.render(createElement(ProjectDrawer, {
      rows: [],
      project: null,
      onClose,
      onSession: vi.fn(),
    })));
    expect(drawer.getAttribute("aria-hidden")).toBe("true");
    expect(document.activeElement).toBe(opener);

    opener.focus();
    mount({ onClose });
    act(() => scrim.click());
    expect(onClose).toHaveBeenCalledTimes(2);
    opener.remove();
  });
});
