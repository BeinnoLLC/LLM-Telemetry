#!/usr/bin/env python3
"""Regenerate the plan mirror in docs/plans/1-architecture from the live board.

GitHub is the single source of truth; these pages are only a mirror of it. No
gate kept them in sync, so they drifted badly — the index advertised `55/118`
with 63 open, while the board held 150 issues with none open, and 39 rows still
read `⬜ Backlog` for shipped work (#144).

Usage:

    gh issue list --state all --limit 300 \
      --json number,title,state,milestone,url,labels \
      | python3 scripts/refresh-plan-mirror.py          # rewrite in place
    python3 scripts/refresh-plan-mirror.py board.json   # or from a file
    python3 scripts/refresh-plan-mirror.py --check board.json   # dry run

What is computed, and what is preserved:

* Status, progress bars and every count are computed from the board.
* `Type` and `Priority` are board-native project fields that
  `gh issue list` does not return, so they are preserved from the page being
  rewritten. For a ticket a page does not list yet, `Type` is derived from its
  labels and `Priority` is written as an em dash for a human to fill.
* Phase-to-page links are discovered from each page's own `**Milestone:**` line,
  so a new page is picked up automatically.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLANS = os.path.join(ROOT, "docs", "plans", "1-architecture")
INDEX = os.path.join(PLANS, "INDEX.md")
BASE_URL = "https://github.com/BeinnoLLC/LLM-Telemetry"

BAR_INDEX, BAR_PAGE = 24, 18
DONE, BACKLOG = "\u2705 Done", "\u2b1c Backlog"

# label -> Type, for tickets a page does not list yet.
TYPE_BY_LABEL = [
    ("documentation", "Docs"),
    ("bug", "Bug"),
    ("enhancement", "Feature"),
    ("epic", "Epic"),
    ("refactor", "Chore"),
    ("a11y", "Feature"),
    ("ui", "Feature"),
    ("qa", "Test"),
    ("tooling", "Chore"),
]


def bar(closed, total, width):
    """The progress bar the pages already use: full cells, then empty cells."""
    if total <= 0:
        return "\u2591" * width
    filled = round(width * closed / total)
    return "\u2588" * filled + "\u2591" * (width - filled)


def type_for(labels):
    names = {str(l.get("name", "")).lower() for l in labels or []}
    for label, kind in TYPE_BY_LABEL:
        if label in names:
            return kind
    return "\u2014"


def split_row(line):
    """`| a | b | c | d |` -> ['a', 'b', 'c', 'd'] (or None if not a row)."""
    if not line.startswith("|"):
        return None
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    return cells


def read_page(path):
    """Pull the milestone number, progress width and rows out of a page."""
    text = open(path, encoding="utf-8").read()
    ms = re.search(r"/milestone/(\d+)", text)
    width = len(re.search(r"`([\u2588\u2591]+)`", text).group(1))
    rows = []
    for line in text.splitlines():
        cells = split_row(line)
        if not cells or len(cells) != 4:
            continue
        link = re.match(r"\[(.*)\]\((.*)\)$", cells[0])
        if not link:
            continue
        num = re.search(r"/issues/(\d+)$", link.group(2))
        rows.append({
            "title": link.group(1),
            "url": link.group(2),
            "number": int(num.group(1)) if num else 0,
            "type": cells[1],
            "priority": cells[2],
        })
    return {"text": text, "milestone": int(ms.group(1)) if ms else None,
            "width": width, "rows": rows}


def render_page(page, issues):
    """Rebuild a phase page: progress line + table, rows in their existing order."""
    by_number = {i["number"]: i for i in issues}
    rows, seen = [], set()
    for row in page["rows"]:
        issue = by_number.get(row["number"])
        if issue is None:
            continue  # the ticket moved to another milestone; the board wins
        seen.add(row["number"])
        rows.append({**row, "state": issue["state"]})
    for issue in sorted(issues, key=lambda i: i["number"]):
        if issue["number"] in seen:
            continue
        rows.append({"title": issue["title"], "url": issue["url"],
                     "number": issue["number"], "type": type_for(issue.get("labels")),
                     "priority": "\u2014", "state": issue["state"]})

    closed = sum(1 for i in issues if i["state"] == "CLOSED")
    total = len(issues)
    progress = (f"**Progress:** `{bar(closed, total, page['width'])}` {closed}/{total}"
                f"  \u00b7  {closed} closed, {total - closed} open")
    text = re.sub(r"^\*\*Progress:\*\*.*$", progress, page["text"], count=1, flags=re.M)

    lines, body, in_table = [], [], False
    for line in text.splitlines():
        cells = split_row(line)
        if cells and len(cells) == 4 and line.startswith("| ["):
            in_table = True
            continue
        if in_table:
            if not line.startswith("|"):
                in_table = False
                body = [f"| [{r['title']}]({r['url']}) | {r['type']} | {r['priority']} | "
                        f"{DONE if r['state'] == 'CLOSED' else BACKLOG} |" for r in rows]
                lines.extend(body)
        lines.append(line)
    return "\n".join(lines) + "\n"


def render_index(text, phases, page_of):
    """Rebuild the index: overall line + one row per milestone, by number."""
    closed = sum(p["closed"] for p in phases)
    total = sum(p["total"] for p in phases)
    overall = (f"**Overall:** `{bar(closed, total, BAR_INDEX)}` {closed}/{total}"
               f"  \u00b7  {closed} closed, {total - closed} open, {total} tickets")
    text = re.sub(r"^\*\*Overall:\*\*.*$", overall, text, count=1, flags=re.M)

    rows = []
    for p in sorted(phases, key=lambda p: p["number"]):
        local = f"[page]({page_of[p['number']]}/INDEX.md)" if p["number"] in page_of else "\u2014"
        rows.append(f"| {p['title']} | `{bar(p['closed'], p['total'], 18)}` "
                    f"{p['closed']}/{p['total']} | {p['total']} | {local} | "
                    f"[milestone {p['number']}]({BASE_URL}/milestone/{p['number']}) |")

    # Replace the whole table block — its header row starts with `| Phase |`,
    # and a previous hand-edit had already eaten that header once (#144).
    header = "| Phase | Progress | Issues | Local page | Milestone |"
    lines = text.splitlines()
    start = next((i for i, ln in enumerate(lines)
                  if ln.startswith("| Phase |") or ln.startswith("| Phase ")), None)
    if start is None:
        return "\n".join(lines + ["", header, "|---|---|---|---|---|"] + rows) + "\n"
    end = start
    while end + 1 < len(lines) and lines[end + 1].startswith("|"):
        end += 1
    block = [header, "|---|---|---|---|---|"] + rows
    return "\n".join(lines[:start] + block + lines[end + 1:]) + "\n"


def main(argv):
    check = "--check" in argv
    rest = [a for a in argv if not a.startswith("--")]
    if rest:
        board = json.load(open(rest[0], encoding="utf-8"))
    else:
        board = json.load(sys.stdin)

    issues = []
    for i in board:
        ms = (i.get("milestone") or {}).get("number")
        if ms is None:
            continue
        issues.append({"number": i["number"], "title": i["title"], "state": i["state"],
                       "url": i["url"], "labels": i.get("labels"),
                       "milestone": ms})
    by_ms = {}
    for i in issues:
        by_ms.setdefault(i["milestone"], []).append(i)

    pages, page_of, changed, dupes = [], {}, [], {}
    for entry in sorted(os.listdir(PLANS)):
        path = os.path.join(PLANS, entry, "INDEX.md")
        if not os.path.isfile(path):
            continue
        page = read_page(path)
        if page["milestone"] is None:
            print(f"warn: {entry}/INDEX.md has no milestone link — skipped")
            continue
        pages.append((path, page))
        dupes.setdefault(page["milestone"], []).append(entry)
        page_of.setdefault(page["milestone"], entry)

    # Two pages claiming one milestone is a mirror bug of its own (the
    # phase-01/phase-02 pair both pointed at milestone 2); rewrite both so the
    # numbers agree, and link the index at the first alphabetically.
    for ms, entries in sorted(dupes.items()):
        if len(entries) > 1:
            print(f"warn: milestone {ms} is claimed by {len(entries)} pages: "
                  + ", ".join(entries))

    for path, page in pages:
        out = render_page(page, by_ms.get(page["milestone"], []))
        if out != page["text"]:
            changed.append(os.path.relpath(path, ROOT))
            if not check:
                open(path, "w", encoding="utf-8").write(out)

    index_text = open(INDEX, encoding="utf-8").read()
    titles = {}
    for i in board:
        ms = (i.get("milestone") or {})
        if ms.get("number"):
            titles[ms["number"]] = ms.get("title", "")
    phases = []
    for ms in sorted(by_ms):
        rows = by_ms[ms]
        phases.append({"number": ms,
                       "closed": sum(1 for i in rows if i["state"] == "CLOSED"),
                       "total": len(rows), "title": titles.get(ms, f"Phase {ms}")})

    out = render_index(index_text, phases, page_of)
    if out != index_text:
        changed.append(os.path.relpath(INDEX, ROOT))
        if not check:
            open(INDEX, "w", encoding="utf-8").write(out)

    print(("would rewrite: " if check else "rewrote: ") + (", ".join(changed) or "nothing"))
    print(f"{len(issues)} milestone tickets across {len(phases)} milestones")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
