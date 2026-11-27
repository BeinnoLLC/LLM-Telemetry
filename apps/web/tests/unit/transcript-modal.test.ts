// T-23 RUN B: transcript render helpers and the mounted modal contract —
// roles/tool calls/images, empty/error strings, focus trap and no text inputs.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadMock } = vi.hoisted(() => ({ loadMock: vi.fn() }));
vi.mock("../../lib/sessions-logs/load", () => ({ loadTranscript: loadMock }));

import TranscriptModal, {
  type TranscriptSession,
} from "../../components/sessions-logs/TranscriptModal";
import {
  emptyHTML,
  escapeHtml,
  renderContent,
  renderMessage,
} from "../../lib/sessions-logs/transcript";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session: TranscriptSession = { id: "sess-1", profile: "work", title: "sess-1" };
let host: HTMLDivElement;
let root: Root;

function mount(value: TranscriptSession | null, onClose = vi.fn()) {
  act(() => {
    root.render(createElement(TranscriptModal, { session: value, onClose }));
  });
  return onClose;
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  loadMock.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("transcript render helpers", () => {
  it("escapes text and keeps links, fenced code and data images distinct", () => {
    const html = renderContent('<b>x</b> ```code``` https://example.invalid/p data:image/png;base64,AAAA');
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("<pre>code</pre>");
    expect(html).toContain('href="https://example.invalid/p"');
    expect(html).toContain('<img class="timg"');
  });

  it("normalises roles, tool calls, tool results and the broken-image fallback source", () => {
    const call = renderMessage({ role: "assistant", tool_calls: [{ name: "grep" }] });
    expect(call).toContain('class="tmsg role-assistant"');
    expect(call).toContain("&#8594; grep");
    expect(renderMessage({ role: "tool", tool_name: "read" })).toContain("&#8594; read result");
    expect(renderMessage({ role: "system", content: "hi" })).toContain("role-assistant");
    expect(emptyHTML("!", "Could not load this transcript.", "HTTP 503")).toContain(
      '<div class="e-hint">HTTP 503</div>',
    );
    expect(escapeHtml("&<>")).toBe("&amp;&lt;&gt;");
  });
});

describe("TranscriptModal DOM", () => {
  it("renders messages with role classes, tool calls and image fallback nodes", async () => {
    loadMock.mockResolvedValueOnce([
      { role: "user", content: "hello https://example.invalid/x", ts: 1760000000 },
      { role: "assistant", content: "```code```" },
      { role: "assistant", tool_calls: [{ name: "grep" }] },
      { role: "tool", tool_name: "read" },
      { role: "system", content: "data:image/png;base64,AAAA" },
    ]);
    mount(session);
    await settle();
    const messages = [...host.querySelectorAll<HTMLElement>("#tbody .tmsg")];
    expect(messages).toHaveLength(5);
    expect(messages[0].className).toContain("role-user");
    expect(messages[0].textContent).toContain("user ·");
    expect(messages[1].querySelector("pre")?.textContent).toBe("code");
    expect(messages[2].querySelector(".ttoolcall")?.textContent).toContain("grep");
    expect(messages[3].querySelector(".ttoolcall")?.textContent).toContain("read result");
    expect(messages[4].className).toContain("role-assistant");
    expect(host.querySelector("#tsub")?.textContent).toBe("5 messages · most recent tail");
    expect(host.querySelector("input, textarea, [contenteditable]")).toBeNull();

    const image = host.querySelector<HTMLImageElement>("#tbody img.timg")!;
    expect(image).not.toBeNull();
    act(() => {
      image.dispatchEvent(new Event("error", { bubbles: true }));
    });
    expect(image.classList.contains("tbroken")).toBe(true);
    expect(host.textContent).toContain("<broken image>");
  });

  it("shows the empty state when the session has no messages", async () => {
    loadMock.mockResolvedValueOnce([]);
    mount(session);
    await settle();
    expect(host.querySelector("#tbody .e-msg")?.textContent).toBe(
      "No recent messages captured for this session yet.",
    );
    expect(host.querySelector("#tbody .e-hint")?.textContent).toBe(
      "The transcript window refreshes with the collector cycle.",
    );
    expect(host.querySelector("#tsub")?.textContent).toBe("");
  });

  it("shows the error state with the fetch status, not a spinner", async () => {
    loadMock.mockRejectedValueOnce(new Error("HTTP 503"));
    mount(session);
    await settle();
    expect(host.querySelector("#tbody .e-ico")?.textContent).toBe("!");
    expect(host.querySelector("#tbody .e-msg")?.textContent).toBe(
      "Could not load this transcript.",
    );
    expect(host.querySelector("#tbody .e-hint")?.textContent).toBe("HTTP 503");
  });

  it("traps Tab, closes on Escape and scrim, and restores focus to the opener", async () => {
    loadMock.mockResolvedValueOnce([]);
    const opener = document.createElement("button");
    opener.textContent = "sess-1";
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    mount(session, onClose);
    await settle();
    const modal = host.querySelector<HTMLElement>("#tmodal")!;
    const scrim = host.querySelector<HTMLElement>("#tscrim")!;
    const body = host.querySelector<HTMLElement>("#tbody")!;
    expect(modal.getAttribute("aria-hidden")).toBe("false");
    expect(document.activeElement).toBe(body);
    const timeline = host.querySelector<HTMLElement>("#ttimelinebtn")!;
    const close = host.querySelector<HTMLElement>("#tclose")!;
    expect(timeline.onclick).toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.activeElement).toBe(timeline);
    act(() => close.focus());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.activeElement).toBe(timeline);
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(close);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => root.render(createElement(TranscriptModal, { session: null, onClose })));
    expect(modal.getAttribute("aria-hidden")).toBe("true");
    expect(document.activeElement).toBe(opener);

    opener.focus();
    loadMock.mockResolvedValueOnce([]);
    mount(session, onClose);
    await settle();
    act(() => scrim.click());
    expect(onClose).toHaveBeenCalledTimes(2);
    opener.remove();
  });
});
