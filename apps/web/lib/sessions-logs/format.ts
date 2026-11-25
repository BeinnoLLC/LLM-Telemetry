// T-23 RUN A: pure display helpers ported from the Python dashboard's
// bundled JS (charts.js:192-197, palette.js:164,218). No invented values.
import type { NumLike } from "../home-board/types";
import type { WeightAxis, WeightLabel } from "./types";

/** Port of the +x || 0 coercion used throughout the legacy aggregations. */
export const num = (value: unknown): number => +(value as number) || 0;

/** PROJ_WEIGHT_LABELS.cost.fmt — always two decimals, including real zeros. */
export function fmtMoney(value: NumLike): string {
  return "$" + num(value).toFixed(2);
}

/** PROJ_WEIGHT_LABELS.calls/sessions.fmt — grouped integer (en-US oracle). */
export function fmtInt(value: NumLike): string {
  return Math.round(num(value)).toLocaleString("en-US");
}

/** The oracle's token formatter is also a grouped integer (charts.js:195). */
export const fmtTokens = fmtInt;

/** palette.js:164 — keep only the final path segment of a model id. */
export const short = (model: unknown): string =>
  model == null ? "" : String(model).split("/").pop() ?? "";

/** Zone-less UTC day used by log/transcript links; never a local-time guess. */
export function dateOf(value: NumLike): string {
  const n = num(value);
  if (!n) return "";
  const ms = n > 1e12 ? n : n * 1000;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

/** palette.js:218 — attribute-safe escaping for titles and data attributes. */
export function escA(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Exact PROJ_WEIGHT_LABELS table from charts.js:192-197. */
export const WEIGHT_LABELS: Record<WeightAxis, WeightLabel> = {
  cost: { axis: "Cost ($)", unit: "$", fmt: fmtMoney },
  calls: { axis: "Calls", unit: "calls", fmt: fmtInt },
  tokens: { axis: "Tokens", unit: "tokens", fmt: fmtTokens },
  sessions: { axis: "Sessions", unit: "sessions", fmt: fmtInt },
};

/** views.js:747-753. The extra sentence is the sessions-only note; the
 * "Showing <axis>." prefix is present on every axis in the Python oracle. */
export function weightNote(axis: WeightAxis): string {
  const prefix = `Showing ${WEIGHT_LABELS[axis].axis.toLowerCase()}. `;
  return axis === "sessions"
    ? prefix +
        "Sessions weighting is the mode most likely to show a large Unattributed share — that is expected and not hidden."
    : prefix;
}
