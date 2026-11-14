// LLMTELEMET-282 (T-3): delta logic, ported without diffdom.
//
// The Python dashboard patched whole HTML lists with web/js/diffdom.js; the
// migrated feed computes data-level change frames instead (React re-renders,
// no DOM diffing). These functions are direct ports of the server-side delta
// logic in src/llm_telemetry/hive.py: `diff_tasks` (event derivation between
// two snapshot task maps) and `_user_sig` (change detection for the user row).
// Spread order matches the Python dict literals exactly, because the frame
// fields those spreads produce are compared byte-for-byte in the parity test.
import type { CommFrame, TaskRow } from "./types";

/** Real status changes between two `tasks` maps (port of hive.py `diff_tasks`). */
export function diffTasks(
  old: Record<string, TaskRow>,
  next: Record<string, TaskRow>,
): Array<Record<string, unknown>> {
  const ev: Array<Record<string, unknown>> = [];
  for (const [tid, t] of Object.entries(next)) {
    const o = old[tid];
    if (o === undefined) {
      if (t.status !== "done") ev.push({ kind: "new", id: tid, ...t });
    } else if (o.status !== t.status) {
      ev.push({ kind: "status", id: tid, from: o.status, ...t });
    }
  }
  for (const [tid, o] of Object.entries(old)) {
    // a worker process that ended
    if (o.worker && !(tid in next)) {
      ev.push({ kind: "status", id: tid, ...o, from: o.status, status: "finished" });
    }
  }
  return ev;
}

/** Stable identity of a user row (port of hive.py `_user_sig`): every key but
 * `at`, sorted, JSON-encoded. `null`/absent users both sign as `"{}"` — Python
 * computes over `(usr or {}).items()`. */
export function userSig(user: unknown): string {
  const src =
    user !== null && typeof user === "object" && !Array.isArray(user)
      ? (user as Record<string, unknown>)
      : {};
  const clean: Record<string, unknown> = {};
  for (const k of Object.keys(src).sort()) {
    if (k !== "at") clean[k] = src[k];
  }
  return JSON.stringify(clean);
}

/** Comm identity for dedup (port of `c.get("id")`): missing and null are the
 * same key, and unlike string ids never dedupe each other across rows with
 * distinct numeric ids. */
export function commKey(c: CommFrame): string | number | null {
  return c.id === undefined ? null : c.id;
}
