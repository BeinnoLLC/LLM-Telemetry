/** Port of `projects.py` (P4-01): resolve a session to a project key. Pure. */

import { pyBasename } from "./pySemantics.js";

export const CWD_DENYLIST: ReadonlySet<string> = new Set(["opt", "tmp", "home", "usr", "var", "root", ""]);

/** Trim and collapse whitespace; never lowercases. Empty -> null. */
export function normalize(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim().replace(/\s+/gu, " ");
  return t === "" ? null : t;
}

export function projectOf(title?: string | null, cwd?: string | null): string | null {
  if (title) {
    const stem = normalize(title.split(" · ", 1)[0] ?? "");
    if (stem) return stem;
  }
  if (cwd) {
    const base = normalize(pyBasename(cwd.replace(/\/+$/u, "")));
    if (base && !CWD_DENYLIST.has(base.toLowerCase())) return base;
  }
  return null;
}

export const MAX_PARENT_DEPTH = 20;

export interface SessionInfo {
  title?: string | null;
  cwd?: string | null;
  parent_session_id?: string | null;
  git_branch?: string | null;
  [key: string]: unknown;
}

export function projectOfSession(
  sessionId: string | null | undefined,
  sessionsById: Record<string, SessionInfo>,
): string | null {
  const visited = new Set<string>();
  let sid: string | null | undefined = sessionId;
  let depth = 0;
  while (sid !== null && sid !== undefined && !visited.has(sid) && depth <= MAX_PARENT_DEPTH) {
    visited.add(sid);
    const row = sessionsById[sid];
    if (row === undefined) return null;
    const resolved = projectOf(row.title, row.cwd);
    if (resolved) return resolved;
    sid = row.parent_session_id;
    depth += 1;
  }
  return null;
}
