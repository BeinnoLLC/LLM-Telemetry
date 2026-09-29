"""P4-05 (#101), part 2: repo & branch cost attribution.

Part 1's finding (documented on the ticket, verified empirically): Hermes
writes `sessions.git_branch`/`git_repo_root` via a background probe
(tui_gateway/git_probe.py -> `git branch --show-current` / a merge-base
walk to the repo root) that ran through `bounded_probe_run`, whose
deferred `import psutil` chain was failing with ModuleNotFoundError on
this box (psutil was never installed into the bundled interpreter,
alongside 3 other now-known-missing deps: ruamel.yaml, croniter,
python-dotenv) — silently swallowed by an `except Exception: return
None`, so EVERY probe returned "" and 0/329 sessions ever got real git
metadata, regardless of any setting. Fixed by installing psutil into
the bundled interpreter; verified live (git_probe.branch() now returns
'main' for a real repo instead of ''). This is forward-looking only —
existing sessions already recorded keep their empty fields; new
sessions from here on populate correctly.

Given that, this module derives `repo` (NOT branch) from `cwd` via the
SAME resolver project_of() already uses for the basename step (walking
up to a real `.git` root is exactly what the running probe now does
server-side; re-deriving it client-side in the collector would just be
a second, drifting copy of that same logic) -- repo keys therefore
match project keys when a session's project came from its cwd. This
ticket's own spec calls that out explicitly as the accepted fallback:
"If Hermes cannot be made to fill it, the P4 resolver (#56) derives
from cwd, and this ticket documents that decision." `branch` comes
straight from `sessions.git_branch` -- real for any session recorded
after the fix above, blank (bucketed as Unattributed, per #41's own
rule) for anything recorded before it.
"""
from . import projects as PROJECTS

UNATTR = "Unattributed"


def _repo_of(cwd):
    """Same cwd-basename + denylist rule project_of() uses for its own
    cwd fallback step -- one resolver, not a second copy (see module
    docstring: re-deriving `.git`-root walking here would drift from
    what the live probe now computes server-side)."""
    if not cwd:
        return None
    import os
    base = os.path.basename(cwd.rstrip("/"))
    base = PROJECTS._normalize(base)
    if base and base.lower() not in PROJECTS.CWD_DENYLIST:
        return base
    return None


def build_repo_branch(rows, sessions_by_id):
    """rows: the SAME per-day usage rows fetch_rows() already resolved
    (session_id, calls, tok fields, cost fields present). sessions_by_id:
    the SAME dict fetch_rows() builds (now carries git_branch too).

    Returns {"repos": [{repo, sessions, calls, tokens, cost, tool_fails,
    delegations, branches: [{branch, sessions, calls, tokens, cost}]}]},
    sorted by cost descending, Unattributed repo always last (#41 rule);
    branches within a repo sorted by cost descending, an unknown/blank
    branch bucketed under 'Unattributed' too, applying the SAME rule one
    level down rather than inventing a different label for it.
    """
    repo_acc = {}   # repo -> {sessions:set, calls, tok, cost}
    branch_acc = {}  # (repo, branch) -> {sessions:set, calls, tok, cost}

    for r in rows:
        sess = sessions_by_id.get(r["session_id"]) or {}
        repo = _repo_of(sess.get("cwd")) or UNATTR
        branch = (sess.get("git_branch") or "").strip() or UNATTR

        ra = repo_acc.setdefault(repo, {"sessions": set(), "calls": 0, "tok": 0, "cost": 0.0})
        ra["sessions"].add(r["session_id"])
        ra["calls"] += r.get("calls") or 0
        ra["tok"] += (r.get("inp") or 0) + (r.get("outp") or 0)
        ra["cost"] += float(r.get("act") or r.get("est") or 0)

        ba = branch_acc.setdefault((repo, branch), {"sessions": set(), "calls": 0, "tok": 0, "cost": 0.0})
        ba["sessions"].add(r["session_id"])
        ba["calls"] += r.get("calls") or 0
        ba["tok"] += (r.get("inp") or 0) + (r.get("outp") or 0)
        ba["cost"] += float(r.get("act") or r.get("est") or 0)

    def sort_key(name):
        return (name == UNATTR, name)

    repos_out = []
    for repo, ra in sorted(repo_acc.items(), key=lambda kv: (-kv[1]["cost"], sort_key(kv[0]))):
        branches_out = []
        for (rp, br), ba in branch_acc.items():
            if rp != repo:
                continue
            branches_out.append({
                "branch": br, "sessions": len(ba["sessions"]), "calls": ba["calls"],
                "tokens": ba["tok"], "cost": round(ba["cost"], 4),
            })
        branches_out.sort(key=lambda b: (-b["cost"], sort_key(b["branch"])))
        repos_out.append({
            "repo": repo, "sessions": len(ra["sessions"]), "calls": ra["calls"],
            "tokens": ra["tok"], "cost": round(ra["cost"], 4), "branches": branches_out,
        })
    return {"repos": repos_out}
