/** Port of `collect_repo_branch.py` (P4-05): repo & branch cost attribution. */

import { CWD_DENYLIST, normalize, type SessionInfo } from "./projects.js";
import { pyBasename, pyRound } from "./pySemantics.js";

export const UNATTR = "Unattributed";

export function repoOf(cwd: string | null | undefined): string | null {
  if (!cwd) return null;
  const base = normalize(pyBasename(cwd.replace(/\/+$/u, "")));
  if (base && !CWD_DENYLIST.has(base.toLowerCase())) return base;
  return null;
}

export interface UsageRow {
  session_id: string;
  calls?: number | null;
  inp?: number | null;
  outp?: number | null;
  act?: number | null;
  est?: number | null;
  [key: string]: unknown;
}

export interface BranchOut { branch: string; sessions: number; calls: number; tokens: number; cost: number }
export interface RepoOut {
  repo: string; sessions: number; calls: number; tokens: number; cost: number; branches: BranchOut[];
}

interface Acc { sessions: Set<string>; calls: number; tok: number; cost: number }
const newAcc = (): Acc => ({ sessions: new Set(), calls: 0, tok: 0, cost: 0 });

/** Python str ordering is by code point. */
function cmpStr(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const d = (x[i] as string).codePointAt(0)! - (y[i] as string).codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/** Python `(name == UNATTR, name)` tuple comparison. */
function cmpName(a: string, b: string): number {
  const d = Number(a === UNATTR) - Number(b === UNATTR);
  return d !== 0 ? d : cmpStr(a, b);
}

export function buildRepoBranch(
  rows: UsageRow[],
  sessionsById: Record<string, SessionInfo>,
): { repos: RepoOut[] } {
  const repoAcc = new Map<string, Acc>();
  const branchAcc = new Map<string, Map<string, Acc>>();
  const add = (a: Acc, r: UsageRow): void => {
    a.sessions.add(r.session_id);
    a.calls += r.calls || 0;
    a.tok += (r.inp || 0) + (r.outp || 0);
    a.cost += Number(r.act || r.est || 0);
  };
  for (const r of rows) {
    const sess = sessionsById[r.session_id] ?? {};
    const repo = repoOf(sess.cwd) ?? UNATTR;
    const branch = (sess.git_branch ?? "").trim() || UNATTR;
    let ra = repoAcc.get(repo);
    if (!ra) repoAcc.set(repo, (ra = newAcc()));
    add(ra, r);
    let bm = branchAcc.get(repo);
    if (!bm) branchAcc.set(repo, (bm = new Map()));
    let ba = bm.get(branch);
    if (!ba) bm.set(branch, (ba = newAcc()));
    add(ba, r);
  }
  const repos = [...repoAcc.entries()].sort(
    (a, b) => b[1].cost - a[1].cost || cmpName(a[0], b[0]),
  );
  return {
    repos: repos.map(([repo, ra]) => {
      const branches = [...(branchAcc.get(repo) ?? new Map<string, Acc>()).entries()]
        .map(([branch, ba]) => ({
          branch, sessions: ba.sessions.size, calls: ba.calls, tokens: ba.tok,
          cost: pyRound(ba.cost, 4),
        }))
        .sort((a, b) => b.cost - a.cost || cmpName(a.branch, b.branch));
      return {
        repo, sessions: ra.sessions.size, calls: ra.calls, tokens: ra.tok,
        cost: pyRound(ra.cost, 4), branches,
      };
    }),
  };
}
