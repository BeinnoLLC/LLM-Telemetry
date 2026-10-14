"""Resolve a session to a project key (P4-01, #56).

One resolver, defined here exactly once. Every consumer (collect_analytics,
the dashboard, future project views) calls project_of() — no second copy of
the stem rule, because two copies drift.

Resolution order:
  1. `title` stem — split on the " · " separator (the cron job's own
     timestamp-suffix convention: "ahwa-health-gate · Sep 25 12:04"), take
     the first segment. Collapses N near-identical timestamped titles into
     one project key.
  2. `cwd` basename, excluding CWD_DENYLIST (non-project roots measured on
     the live DB: /opt, /tmp, /home, and a few standard Unix dirs that would
     never be a real project name).
  3. None — an unattributed session is an honest category, not a guess.
     Never invent a key; a wrong label in a cost report is worse than a
     blank one (P4-04 gives "unattributed" its own visible bucket, but that
     string is a presentation choice, not part of this resolver's output).

Deliberately out of scope: inferring a project from prompt text or asking a
model to name it.

project_of() is pure: takes primitives (title, cwd), touches no database,
no clock, no I/O. Case is preserved (no lowercasing) — "Nowinv" displays as
the user wrote it; case-collision handling ("Workspace" vs "workspace") is
deliberately deferred, matching the ticket's own open question.
"""
import os
import re

CWD_DENYLIST = frozenset({"opt", "tmp", "home", "usr", "var", "root", ""})

_WS_RE = re.compile(r"\s+")


def _normalize(s):
    """Trim and collapse internal whitespace. Never lowercases (see module
    docstring): case is a display concern, not a resolution concern."""
    if not s:
        return None
    s = _WS_RE.sub(" ", s.strip())
    return s or None


def project_of(title=None, cwd=None):
    """Resolve a session's project key, or None if none can be honestly
    attributed.

    Accepts primitives rather than a row/dict/ORM object on purpose: it
    keeps the function trivially pure and reusable from SQL result tuples,
    dict rows, or a future dataclass without an adapter layer.
    """
    if title:
        stem = title.split(" · ", 1)[0]
        stem = _normalize(stem)
        if stem:
            return stem

    if cwd:
        base = os.path.basename(cwd.rstrip("/"))
        base = _normalize(base)
        if base and base.lower() not in CWD_DENYLIST:
            return base

    return None


MAX_PARENT_DEPTH = 20


def project_of_session(session_id, sessions_by_id):
    """Resolve a session's project, walking up parent_session_id when the
    session itself has no usable title/cwd (P4-03,

    sessions_by_id: {session_id: {"title": ..., "cwd": ...,
    "parent_session_id": ...}}. A subagent has no title of its own but
    knows who spawned it — that parent link is a fact in the database, not
    an inference, so walking it introduces zero guesswork (unlike inferring
    a project from prompt text, which stays out of scope).

    Bounded by MAX_PARENT_DEPTH and a visited-set: a self-referential or
    cyclic parent_session_id must not hang the collector — it terminates
    and returns None (a subagent whose ancestry is broken or whose root is
    itself unattributed stays unattributed; no fallback invention).
    """
    visited = set()
    sid = session_id
    depth = 0
    while sid is not None and sid not in visited and depth <= MAX_PARENT_DEPTH:
        visited.add(sid)
        row = sessions_by_id.get(sid)
        if row is None:
            return None
        resolved = project_of(row.get("title"), row.get("cwd"))
        if resolved:
            return resolved
        sid = row.get("parent_session_id")
        depth += 1
    return None
