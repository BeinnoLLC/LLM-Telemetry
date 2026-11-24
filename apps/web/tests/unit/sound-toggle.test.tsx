// LLMTELEMET-291 (T-20 RUN F2): the button contract with a real engine and
// jsdom's localStorage (jsdom has no AudioContext; the engine tolerates that).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import SoundToggle from "../../components/home/SoundToggle";
import { createSoundEngine } from "../../lib/home/sound";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("SoundToggle (RUN F2)", () => {
  it("starts ON and persists mute/unmute through the engine", () => {
    const engine = createSoundEngine({
      createAudioContext: () => { throw new Error("no audio in jsdom"); },
      storage: window.localStorage,
    });
    act(() => root.render(createElement(SoundToggle, { engine })));
    const button = host.querySelector("button");
    expect(button, "button is missing").not.toBeNull();
    expect(button!.getAttribute("aria-pressed")).toBe("true");
    expect(button!.getAttribute("aria-label")).toMatch(/sound on/i);

    act(() => button!.click());
    expect(button!.getAttribute("aria-pressed")).toBe("false");
    expect(window.localStorage.getItem("lt-sound")).toBe("0");

    act(() => button!.click());
    expect(button!.getAttribute("aria-pressed")).toBe("true");
    expect(window.localStorage.getItem("lt-sound")).toBe("1");
  });
});
