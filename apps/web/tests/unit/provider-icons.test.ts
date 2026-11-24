// LLMTELEMET-291 (T-20 RUN E1): the hard UI rule — queue balls and the
// legend carry provider SVG paths, never letters or two-letter monograms.
import { describe, expect, it } from "vitest";

import {
  HEXAGON_PATH,
  RT_SVG,
  providerIcon,
  providerOf,
  type ProviderIconKind,
} from "../../lib/home/provider-icons";

describe("SVG-only provider icons (RUN E1)", () => {
  it("uses the Anthropic brand path for Claude models", () => {
    expect(providerOf("claude-opus-5")).toBe("anthropic");
    expect(providerIcon("claude-opus-5", "r")).toBe(RT_SVG.anthropic);
  });

  it("uses the Ollama path for depot balls without a model and for the legend", () => {
    expect(providerIcon(null, "q")).toBe(RT_SVG.ollama);
    expect(providerIcon("", "q")).toBe(RT_SVG.ollama);
    expect(providerIcon(null, "legend")).toBe(RT_SVG.ollama);
  });

  it("uses a neutral hexagon for an unknown provider", () => {
    expect(providerIcon("totally-unknown-model", "d")).toBe(HEXAGON_PATH);
    expect(providerOf("totally-unknown-model")).toBe("cloud");
  });

  it("never returns a letter or monogram for any ball kind", () => {
    const kinds: ProviderIconKind[] = ["q", "r", "d", "legend"];
    const models = ["claude-opus-5", "gpt-5-codex", "qwen3:8b", "kimi-k3:cloud", "mystery", null];
    for (const kind of kinds) {
      for (const model of models) {
        const path = providerIcon(model, kind);
        expect(path.startsWith("M"), `${kind}/${model} is not SVG path data`).toBe(true);
        expect(path).not.toMatch(/^[A-Za-z]{1,2}$/);
        expect(path).not.toContain("<span");
      }
    }
  });
});
