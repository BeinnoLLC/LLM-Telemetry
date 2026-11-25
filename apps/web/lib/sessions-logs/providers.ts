// T-23 RUN A: name-based provider resolution for matrix headers. Reuses the
// T-20 SVG paths; never emits a letter or two-letter monogram. The Python
// oracle resolves MODEL_PROV from every row's provider/base_url (views.js:
// 167-252), so a name-only guess is not enough here.
import {
  HEXAGON_PATH,
  RT_LOGO,
  RT_SVG,
} from "../home-board/provider-icons";
import { short } from "./format";
import type { SessionRow } from "./types";

// config.py:71 defaults, injected as __LOCAL_HOSTS__ in the built dashboard.
const LOCAL_HOSTS = [
  "127.0.0.1",
  "localhost",
  "::1",
  "192.168.",
  "10.",
  "172.16.",
  "172.17.",
  "172.18.",
  "172.19.",
  "172.2",
  "172.30.",
  "172.31.",
  ".local",
  ".internal",
  ".lan",
];
const LOCAL_RE = /^(qwen|gpt-oss|deepseek-r1|nemotron|llama|mistral|phi|gemma)/i;
const CLOUD_SUFFIX = /(:|-|\.)cloud$/i;

/** views.js:180-213 — strongest evidence first: URL, provider, then name. */
export function provOf(row: Pick<SessionRow, "provider" | "base_url" | "model">): string {
  const url = String(row.base_url ?? "").toLowerCase();
  if (url) {
    if (url.includes("fireworks.ai")) return "fireworks";
    if (url.includes("opencode.ai")) return "opencode-go";
    if (url.includes("api.anthropic.com")) return "anthropic";
    if (url.includes("openai.com") || url.includes("chatgpt.com")) return "openai-codex";
    if (url.includes("openrouter.ai")) return "openrouter";
    if (url.includes("nousresearch")) return "nous";
    if (url.includes("ollama.com")) return "ollama-cloud";
    if (LOCAL_HOSTS.some((host) => url.includes(host))) return "local";
  }
  const key = String(row.provider ?? "").toLowerCase().trim();
  if (key && key !== "custom") return key;
  const model = String(row.model ?? "").toLowerCase();
  if (model.includes("fireworks")) return "fireworks";
  if (CLOUD_SUFFIX.test(model)) return "ollama-cloud";
  if (!model.includes("/") && LOCAL_RE.test(model)) return "local";
  if (model.includes("claude")) return "anthropic";
  if (model.includes("glm") || model.includes("kimi") || model.includes("minimax")) {
    return "opencode-go";
  }
  if (model.startsWith("stepfun/") || model.startsWith("step-") || model.includes("hermes-")) {
    return "nous";
  }
  if (model.startsWith("gpt-")) return "openai-codex";
  // views.js:209 — a custom OpenAI-compatible slot with no identifying URL
  // belongs to the local endpoint, not to a guessed remote provider. Keep
  // this after every model heuristic so a named model still wins.
  if (key === "custom") return "local";
  // Nothing identified it, so it is remote — not local hardware.
  return "cloud";
}

/** views.js:229-252 — short model -> provider, first row wins (MODEL_PROV). */
export function buildModelProviders(rows: readonly SessionRow[]): Map<string, string> {
  const map = new Map<string, string>();
  rows.forEach((row) => {
    const name = short(row.model);
    if (!map.has(name)) map.set(name, provOf(row));
  });
  return map;
}

/**
 * Provider for a shortened model label.
 *
 * Pass the rows, not just a model name: the row's provider/base_url is the
 * evidence Python uses, and a bare `provOf({ model })` would silently discard
 * it. A prebuilt `buildModelProviders(rows)` map is accepted too for callers
 * that already computed it.
 */
export function modelProvider(model: string, rows: readonly SessionRow[]): string;
export function modelProvider(model: string, map: ReadonlyMap<string, string>): string;
export function modelProvider(
  model: string,
  evidence: readonly SessionRow[] | ReadonlyMap<string, string>,
): string {
  const name = short(model);
  // `buildModelProviders` keeps the first row's evidence for each model —
  // exactly the Python derivation — so the row's provider and base_url win.
  const map: ReadonlyMap<string, string> = Array.isArray(evidence)
    ? buildModelProviders(evidence)
    : (evidence as ReadonlyMap<string, string>);
  return map.get(name) ?? provOf({ provider: "", base_url: "", model: name });
}

/** routerview.js:37-59 — RT_LOGO.svg resolved through RT_SVG; providers with
 * no brand path get the neutral hexagon, never a monogram letter. */
export function providerPath(provider: string): string {
  const svg = RT_LOGO[provider];
  return svg ? RT_SVG[svg] : HEXAGON_PATH;
}

/** Colour always comes from the shared token sheet, never a hex literal. */
export function providerColorVar(provider: string): string {
  return `--prov-${provider}`;
}
