// T-23 RUN B: pure transcript render helpers, ported one-for-one from
// src/llm_telemetry/web/js/drawer.js tEscape/tRenderContent/tRenderMsg.
// The HTML is built from escaped text only; the modal supplies the broken-image
// fallback through React's capture-phase onError instead of an inline handler.
export type TranscriptRole = "user" | "assistant" | "tool";

export interface TranscriptMessage {
  role?: unknown;
  content?: unknown;
  ts?: unknown;
  tool_name?: unknown;
  tool_calls?: unknown;
}

export function escapeHtml(raw: unknown): string {
  return String(raw == null ? "" : raw)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderContent(raw: unknown): string {
  const text = escapeHtml(raw);
  const parts = text.split(/```([\s\S]*?)```/g);
  let out = "";
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      out += `<pre>${part}</pre>`;
      return;
    }
    const linked = part.replace(
      /(https?:\/\/[^\s<]+)/g,
      (_match: string, url: string) =>
        `<a href="${escapeHtml(url).replace(/"/g, "&quot;")}" target="_blank" rel="noopener noreferrer">${url}</a>`,
    );
    out += linked.replace(
      /(data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]+)/g,
      (_match: string, src: string) =>
        `<img class="timg" src="${src}" alt="attached image">`,
    );
  });
  return out;
}

function number(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  return 0;
}

function toolNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((call: unknown) => {
      if (!call || typeof call !== "object") return "";
      const record = call as Record<string, unknown>;
      const fn = record.function;
      const nested = fn && typeof fn === "object" ? (fn as Record<string, unknown>).name : "";
      const name = record.name || nested;
      return typeof name === "string" && name ? name : "";
    })
    .filter((name: string) => name.length > 0);
}

export function renderMessage(raw: unknown): string {
  const message = (raw && typeof raw === "object" ? raw : {}) as TranscriptMessage;
  const role: TranscriptRole =
    raw !== null &&
    typeof raw === "object" &&
    (raw as Record<string, unknown>).role === "user"
      ? "user"
      : raw !== null &&
          typeof raw === "object" &&
          (raw as Record<string, unknown>).role === "tool"
        ? "tool"
        : "assistant";
  const seconds = number(message.ts);
  const when = seconds ? new Date(seconds * 1000).toLocaleTimeString() : "";
  let body = renderContent(message.content);
  if (message.tool_calls) {
    const names = toolNames(message.tool_calls);
    const toolName = typeof message.tool_name === "string" ? message.tool_name : "";
    body += `<div class="ttoolcall">&#8594; ${escapeHtml(names.length ? names.join(", ") : toolName || "tool call")}</div>`;
  } else if (!message.content && message.tool_name) {
    body += `<div class="ttoolcall">&#8594; ${escapeHtml(message.tool_name)} result</div>`;
  }
  const label = `${role}${when ? ` · ${when}` : ""}`;
  return `<div class="tmsg role-${role}"><span class="trole">${label}</span>${body}</div>`;
}

export function emptyHTML(icon: string, message: string, hint: string): string {
  return (
    `<div class="empty"><div class="e-ico">${escapeHtml(icon)}</div>` +
    `<div class="e-msg">${escapeHtml(message)}</div>` +
    (hint ? `<div class="e-hint">${escapeHtml(hint)}</div>` : "") +
    `</div>`
  );
}

export function renderTranscript(messages: readonly unknown[]): string {
  return messages.map(renderMessage).join("");
}
