// LLMTELEMET-292 (T-21 RUN C1): pure Flow aggregation, ported from
// src/llm_telemetry/web/js/flow.js:558-625. Calls are the size metric;
// market_value_usd rides along for the tooltip. No live endpoint, no sampled
// or invented rows: everything here derives from one loaded snapshot.
import type { AnalyticsRow, JsonRecord, NumLike } from "../home-board/types";
import { HEXAGON_PATH, RT_LOGO, RT_SVG, providerIcon } from "../home-board/provider-icons";

/** config.py:71 — the same local-host evidence views.js:192 uses. */
export const LOCAL_HOST_PATTERNS = [
  "127.0.0.1", "localhost", "::1",
  "192.168.", "10.", "172.16.", "172.17.", "172.18.", "172.19.",
  "172.2", "172.30.", "172.31.", ".local", ".internal", ".lan",
];
const LOCAL_RE = /^(qwen|gpt-oss|deepseek-r1|nemotron|llama|mistral|phi|gemma)/i;
const CLOUD_SUFFIX = /(:|-|\.)cloud$/i;

export type FlowKind = "root" | "prov" | "model" | "task";

export interface FlowNode {
  id: string;
  name: string;
  kind: FlowKind;
  calls: number;
  cost: number;
  kids: FlowNode[];
  /** Task branch inherits its model's colour (flow.js:617). */
  parentModel?: string;
  depth?: number;
  x?: number;
  y?: number;
}

export interface FlowLink {
  s: FlowNode;
  t: FlowNode;
}

export const FLOW_DEPTH_DEFAULT = 3;
export type FlowDepth = 2 | 3;

/** palette.js:164 — model names are last path segments, never renamed. */
export function short(model: NumLike | string | null | undefined): string {
  return model == null ? "" : String(model).split("/").pop() ?? "";
}

/** views.js:167-212 — strongest evidence first, exactly as the Python view. */
export function provOf(p: unknown, model: unknown, url: unknown = ""): string {
  const u = String(url ?? "").toLowerCase();
  if (u) {
    if (u.includes("fireworks.ai")) return "fireworks";
    if (u.includes("opencode.ai")) return "opencode-go";
    if (u.includes("api.anthropic.com")) return "anthropic";
    if (u.includes("openai.com") || u.includes("chatgpt.com")) return "openai-codex";
    if (u.includes("openrouter.ai")) return "openrouter";
    if (u.includes("nousresearch")) return "nous";
    if (u.includes("ollama.com")) return "ollama-cloud";
    if (LOCAL_HOST_PATTERNS.some((host) => u.includes(host))) return "local";
  }
  const key = String(p ?? "").toLowerCase().trim();
  if (key && key !== "custom") return key;
  const m = String(model ?? "").toLowerCase();
  if (m.includes("fireworks")) return "fireworks";
  if (CLOUD_SUFFIX.test(m)) return "ollama-cloud";
  const isSlug = m.includes("/");
  if (!isSlug && LOCAL_RE.test(m)) return "local";
  if (m.includes("claude")) return "anthropic";
  if (m.includes("glm") || m.includes("kimi") || m.includes("minimax")) return "opencode-go";
  if (m.startsWith("stepfun/") || m.startsWith("step-") || m.includes("hermes-")) return "nous";
  if (m.startsWith("gpt-")) return "openai-codex";
  if (key === "custom") return "local";
  return "cloud";
}

function number(value: NumLike): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** flow.js:558-585. The public shape is unchanged; depth is passed in
 * explicitly instead of reading the Python module's mutable global. */
export function flowData(
  rows: readonly AnalyticsRow[],
  depth: FlowDepth = FLOW_DEPTH_DEFAULT,
): FlowNode {
  const root: FlowNode = { id: "root", name: "all traffic", kind: "root", calls: 0, cost: 0, kids: [] };
  const providers = new Map<string, FlowNode>();
  for (const row of rows) {
    const pk = provOf(row.provider, row.model, row.base_url);
    const mk = short(row.model);
    const cost = number(row.market_value_usd);
    const calls = number(row.calls);
    root.calls += calls;
    root.cost += cost;

    let provider = providers.get(pk);
    if (!provider) {
      provider = { id: `p:${pk}`, name: pk, kind: "prov", calls: 0, cost: 0, kids: [] };
      providers.set(pk, provider);
      root.kids.push(provider);
    }
    provider.calls += calls;
    provider.cost += cost;

    let model = provider.kids.find((kid) => kid.name === mk);
    if (!model) {
      model = {
        id: `p:${pk}|m:${mk}`,
        name: mk,
        kind: "model",
        calls: 0,
        cost: 0,
        kids: [],
      };
      provider.kids.push(model);
    }
    model.calls += calls;
    model.cost += cost;

    if (depth >= 3) {
      const taskName = row.task || "main";
      let task = model.kids.find((kid) => kid.name === taskName);
      if (!task) {
        task = {
          id: `${model.id}|t:${taskName}`,
          name: taskName,
          kind: "task",
          calls: 0,
          cost: 0,
          kids: [],
          parentModel: mk,
        };
        model.kids.push(task);
      }
      task.calls += calls;
      task.cost += cost;
    }
  }
  const sort = (node: FlowNode): void => {
    node.kids.sort((a, b) => b.calls - a.calls);
    node.kids.forEach(sort);
  };
  sort(root);
  return root;
}

/** flow.js:591-600. Mutates the tree with depth and parent pointers for the
 * renderer, exactly as the Python walk does. */
export function flowFlatten(root: FlowNode): { nodes: FlowNode[]; links: FlowLink[] } {
  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];
  const walk = (node: FlowNode, depth: number, parent: FlowNode | null): void => {
    node.depth = depth;
    nodes.push(node);
    if (parent) {
      links.push({ s: parent, t: node });
      if (node.kind === "task") node.parentModel = parent.name;
    }
    node.kids.forEach((kid) => walk(kid, depth + 1, node));
  };
  walk(root, 0, null);
  return { nodes, links };
}

const TOKEN_MODEL_COLOURS = [
  "var(--pal-indigo)",
  "var(--pal-mint)",
  "var(--pal-amber)",
  "var(--pal-rose)",
  "var(--accent2)",
  "var(--kind-hermes)",
  "var(--kind-pi)",
  "var(--kind-claude)",
  "var(--kind-codex)",
] as const;

const PROVIDER_TOKENS: Record<string, string> = {
  anthropic: "var(--prov-anthropic)",
  "openai-codex": "var(--prov-openai)",
  openai: "var(--prov-openai)",
  gemini: "var(--prov-gemini)",
  local: "var(--prov-local)",
  "ollama-cloud": "var(--prov-ollama-cloud)",
  openrouter: "var(--prov-openrouter)",
  copilot: "var(--prov-copilot)",
  "opencode-go": "var(--prov-opencode-go)",
  deepseek: "var(--prov-deepseek)",
  nous: "var(--prov-nous)",
  fireworks: "var(--prov-fireworks)",
  moa: "var(--prov-moa)",
};

/** flow.js:603-610, with CSS tokens instead of the Python hsl() literals. */
export function flowColor(node: FlowNode): string {
  if (node.kind === "root") return "var(--accent)";
  if (node.kind === "prov") return PROVIDER_TOKENS[node.name] ?? "var(--prov-unknown)";
  const name = node.kind === "task" ? node.parentModel ?? node.name : node.name;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return TOKEN_MODEL_COLOURS[Math.abs(hash) % TOKEN_MODEL_COLOURS.length];
}

/** Every node mark is an SVG path from the T-20 provider-icon module, never
 * a letter. Model nodes use the real model; other kinds resolve from the
 * provider key through the same module's brand table. */
export function flowNodeMark(node: FlowNode, modelHint = ""): string {
  if (node.kind === "model" || node.kind === "task") {
    return providerIcon(modelHint || node.name, "r");
  }
  const brand = RT_LOGO[node.name];
  return brand ? RT_SVG[brand] : HEXAGON_PATH;
}

export interface FlowChat {
  id: string;
  title: string;
  calls: number;
}

/** flow.js:602-617 — node_sessions is keyed by FULL model id + task. The
 * Python tree stores short names, so rows supply the full ids. */
export function flowChats(
  node: FlowNode,
  rows: readonly AnalyticsRow[],
  sessions: Record<string, unknown> | null | undefined,
): FlowChat[] {
  if (!sessions || (node.kind !== "task" && node.kind !== "model")) return [];
  const full = [...new Set(rows.map((row) => String(row.model ?? "")).filter(Boolean))];
  const keys: string[] = [];
  if (node.kind === "task") {
    full.forEach((model) => keys.push(`${model}\t${node.name}`));
  } else {
    full.forEach((model) => node.kids.forEach((task) => keys.push(`${model}\t${task.name}`)));
  }
  const by = new Map<string, FlowChat>();
  for (const key of keys) {
    const entries = sessions[key];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries as JsonRecord[]) {
      const id = String(entry?.id ?? "");
      const chat = by.get(id) ?? { id, title: String(entry?.title ?? ""), calls: 0 };
      chat.calls += number(entry?.calls as NumLike);
      by.set(id, chat);
    }
  }
  return [...by.values()].sort((a, b) => b.calls - a.calls).slice(0, 4);
}

/** flow.js:954-968: the exact tooltip rows and order. */
export function flowTipRows(node: FlowNode, rootCalls: number): Array<[string, string | number]> {
  const pct = rootCalls ? (node.calls / rootCalls) * 100 : 0;
  const rows: Array<[string, string | number]> = [
    ["calls", `${node.calls.toLocaleString()} (${pct.toFixed(1)}%)`],
    ["est. cost", `$${node.cost.toFixed(2)}`],
  ];
  if (node.kids.length) {
    rows.push([node.kind === "prov" ? "models" : "tasks", node.kids.length]);
  }
  return rows;
}

/** The loaded snapshot's Flow profile rows; empty when the artifact is absent. */
export function flowRows(profile: JsonRecord | null | undefined): AnalyticsRow[] {
  const rows = profile?.rows;
  return Array.isArray(rows) ? (rows as AnalyticsRow[]) : [];
}

export function flowSessions(profile: JsonRecord | null | undefined): Record<string, unknown> | null {
  const sessions = profile?.node_sessions;
  return sessions && typeof sessions === "object" ? sessions as Record<string, unknown> : null;
}
