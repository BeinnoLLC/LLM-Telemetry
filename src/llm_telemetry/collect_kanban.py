#!/usr/bin/env python3
"""Export the Hermes kanban boards for the dashboard's Kanban tab (LST-249).

Reads ``<agent_home>/kanban/boards/<board>/kanban.db`` read-only and writes, per
board, its tasks grouped by status. Only descriptive card fields are copied:
the free-text body, worker pids, claim locks and workspace paths stay out of the
payload. Archived boards (the ``_archived`` directory) are skipped.

A machine with no kanban directory writes an empty payload, so the tab renders
its own empty state rather than failing the build.
"""
import json
import os
import sqlite3
import sys
import time

from .config import get as _cfg
from .schema import stamp

CFG = _cfg()

# Columns in board order; any other status a board uses is appended after these.
STATUS_ORDER = ("triage", "todo", "ready", "running", "blocked", "review", "done")
FIELDS = ("id", "title", "assignee", "status", "priority", "created_at",
          "started_at", "completed_at", "block_kind")
MAX_DONE = 50  # newest finished cards per board; the rest is history


def boards_dir():
    return os.path.join(CFG.agent_home, "kanban", "boards")


def _read_board(path):
    uri = "file:%s?mode=ro" % path
    con = sqlite3.connect(uri, uri=True, timeout=5)
    con.row_factory = sqlite3.Row
    try:
        cols = {r["name"] for r in con.execute("PRAGMA table_info(tasks)")}
        want = [f for f in FIELDS if f in cols]
        if not {"id", "title", "status"} <= set(want):
            return None
        rows = [dict(r) for r in con.execute("SELECT %s FROM tasks" % ",".join(want))]
    finally:
        con.close()
    return rows


def board_payload(name, rows):
    cols = {}
    for r in rows:
        r["title"] = r.get("title") or "(untitled)"
        cols.setdefault(r["status"] or "todo", []).append(r)
    for status, cards in cols.items():
        if status == "done":
            cards.sort(key=lambda c: c.get("completed_at") or 0, reverse=True)
        else:
            cards.sort(key=lambda c: (-(c.get("priority") or 0), c.get("created_at") or 0))
    counts = {s: len(c) for s, c in cols.items()}
    if "done" in cols:
        cols["done"] = cols["done"][:MAX_DONE]
    order = [s for s in STATUS_ORDER if s in cols] + sorted(s for s in cols if s not in STATUS_ORDER)
    return {"name": name, "total": len(rows), "counts": counts,
            "columns": [{"status": s, "count": counts[s], "tasks": cols[s]} for s in order]}


def build():
    out = {"boards": [], "collected_at": int(time.time())}
    root = boards_dir()
    if os.path.isdir(root):
        for name in sorted(os.listdir(root)):
            db = os.path.join(root, name, "kanban.db")
            if name.startswith("_") or not os.path.isfile(db):
                continue
            try:
                rows = _read_board(db)
            except sqlite3.Error as e:
                print("kanban: skipping %s: %s" % (name, e), file=sys.stderr)
                continue
            if rows is not None:
                out["boards"].append(board_payload(name, rows))
    return stamp(out)


def main(dest=None):
    dest = dest or str(CFG.reports_dir / "kanban-data.json")
    data = build()
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    os.replace(tmp, dest)
    print("%s  (%d boards, %d tasks)" % (dest, len(data["boards"]), sum(b["total"] for b in data["boards"])))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
