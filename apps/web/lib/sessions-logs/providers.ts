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

export function modelProvider(
  model: string,
  map: ReadonlyMap<string, string>,
): string {
  return map.get(short(model)) ?? provOf({ model: short(model) });
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
