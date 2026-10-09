#!/usr/bin/env python3
"""The plan mirror must not lie about itself (#144).

docs/plans/1-architecture mirrors the GitHub board. It has no network in CI, so
it cannot re-ask GitHub — but it *can* be checked for internal consistency, which
is what caught the real drift: the index said `55/118`, phase pages said 63 open,
and 39 rows still read `⬜ Backlog` for shipped work.

What this checks, offline:

* each progress line agrees with the statuses of the rows on the same page;
* a page's milestone link is well formed and unique to that page;
* the index totals are the sum of the index rows, and each row agrees with the
  page it links to;
* bars are drawn with the formula the pages claim (round(width * closed / total));
* no row carries a status outside the two the mirror uses.

What it cannot check: whether the mirror matches tonight's board. That is what
`scripts/refresh-plan-mirror.py` is for; this gate keeps the file honest between
refreshes and fails loudly on a hand-edit that contradicts its own header.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLANS = os.path.join(ROOT, "docs", "plans", "1-architecture")
INDEX = os.path.join(PLANS, "INDEX.md")

DONE, BACKLOG = "\u2705 Done", "\u2b1c Backlog"
STATUSES = {DONE, BACKLOG}
BAR = re.compile(r"`([\u2588\u2591]+)`")
PROGRESS = re.compile(r"^\*\*Progress:\*\*.*$", re.M)
OVERALL = re.compile(r"^\*\*Overall:\*\*.*$", re.M)
COUNTS = re.compile(r"`[\u2588\u2591]+`\s+(\d+)/(\d+)\s+\u00b7\s+(\d+) closed, (\d+) open")
ROW = re.compile(r"^\|\s*\[(?P<title>.+)\]\((?P<url>https?://[^)\s]+)\)\s*\|(?P<rest>.*)\|\s*$")

failed = 0
total = 0


def chk(cond, label, extra=""):
    global failed, total
    total += 1
    print(("  OK   " if cond else "  FAIL ") + label + (f"  ({extra})" if extra else ""))
    if not cond:
        failed += 1


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def counts_of(text, pattern):
    """(closed, total, closed_col, open_col) from a progress/overall line."""
    line = pattern.search(text)
    if not line:
        return None
    m = COUNTS.search(line.group(0))
    if not m:
        return None
    return int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))


def bar_ok(text, closed, open_n):
    """The bar must be the documented formula, and its length must hold still."""
    b = BAR.search(text)
    if not b:
        return False, "no bar"
    cells = b.group(1)
    tot = closed + open_n
    expect = round(len(cells) * closed / tot) if tot else 0
    filled = cells.count("\u2588")
    return filled == expect, f"{filled} filled, expected {expect} of {len(cells)}"


def rows_of(text):
    out = []
    for line in text.splitlines():
        m = ROW.match(line)
        if not m:
            continue
        if m.group("title").startswith("Phase "):  # the index table, not a ticket
            continue
        cells = m.group("rest").split("|")
        out.append({"url": m.group("url"), "status": cells[-1].strip()})
    return out


pages = []
for entry in sorted(os.listdir(PLANS)):
    path = os.path.join(PLANS, entry, "INDEX.md")
    if os.path.isfile(path):
        pages.append((entry, path))

chk(bool(pages), "found phase pages", f"{len(pages)} pages")

seen_ms = {}
pages_data = {}
for entry, path in pages:
    text = read(path)
    rows = rows_of(text)
    ms = re.search(r"/milestone/(\d+)", text)
    chk(ms is not None, f"{entry}: has a milestone link")
    n = int(ms.group(1)) if ms else -1
    seen_ms.setdefault(n, []).append(entry)

    bad = sorted({r["status"] for r in rows} - STATUSES)
    chk(not bad, f"{entry}: statuses are only Done/Backlog", ", ".join(bad))

    done = sum(1 for r in rows if r["status"] == DONE)
    open_n = sum(1 for r in rows if r["status"] == BACKLOG)
    nums = [r["url"].rsplit("/", 1)[-1] for r in rows]
    chk(len(set(nums)) == len(nums), f"{entry}: no ticket listed twice")

    c = counts_of(text, PROGRESS)
    chk(c is not None, f"{entry}: progress line parses")
    if c:
        chk((c[0], c[1]) == (done, done + open_n),
            f"{entry}: progress matches its rows",
            f"line {c[0]}/{c[1]}, rows {done}/{done + open_n}")
        chk(c[2] == c[0] and c[3] == open_n,
            f"{entry}: closed/open words match the fraction")
        ok, why = bar_ok(text, c[0], c[3])
        chk(ok, f"{entry}: bar is drawn with the documented formula", why)
    pages_data[entry] = {"rows": rows, "ms": n}

# The index must sum to its own rows and agree with each page it links to.
index = read(INDEX)
idx_rows = []
for line in index.splitlines():
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    if len(cells) == 5 and cells[0].startswith("Phase "):
        m = re.search(r"`([\u2588\u2591]+)`\s+(\d+)/(\d+)", cells[1])
        idx_rows.append({"title": cells[0], "closed": int(m.group(2)),
                         "total": int(m.group(3)), "page": cells[3]})
chk(bool(idx_rows), "found index rows", f"{len(idx_rows)} rows")

c = counts_of(index, OVERALL)
chk(c is not None, "index overall line parses")
if c:
    chk(c[0] == sum(r["closed"] for r in idx_rows),
        "index overall closed equals the sum of its rows",
        f"{c[0]} vs {sum(r['closed'] for r in idx_rows)}")
    chk(c[1] == sum(r["total"] for r in idx_rows),
        "index overall total equals the sum of its rows")
    chk(c[3] == c[1] - c[0], "index open count is total minus closed")
    ok, why = bar_ok(index, c[0], c[3])
    chk(ok, "index bar is drawn with the documented formula", why)

for row in idx_rows:
    link = re.search(r"\(([^)]+)/INDEX\.md\)", row["page"])
    if not link:
        continue
    entry = link.group(1).rstrip("/")
    chk(entry in pages_data, f"index links an existing page: {entry}")
    if entry in pages_data:
        p = pages_data[entry]
        done = sum(1 for r in p["rows"] if r["status"] == DONE)
        chk((row["closed"], row["total"]) == (done, len(p["rows"])),
            f"index row for {entry} matches the page",
            f"{row['closed']}/{row['total']} vs {done}/{len(p['rows'])}")

for ms, entries in sorted(seen_ms.items()):
    if len(entries) > 1:
        print(f"  note  milestone {ms} is claimed by {len(entries)} pages: "
              + ", ".join(entries))

# The gate must be able to fail, or it proves nothing.
probe = "**Progress:** `\u2588\u2588\u2591\u2591` 1/2  \u00b7  1 closed, 1 open"
chk(counts_of(probe, PROGRESS) == (1, 2, 1, 1), "counts pattern reads a progress line")
good = bar_ok(probe, 1, 1)
chk(good[0], "bar formula accepts a bar drawn from the formula", good[1])
chk(bar_ok(probe.replace("\u2588\u2588", "\u2588\u2591"), 1, 1)[0] is False,
    "bar formula catches a wrong bar")
over = counts_of("**Overall:** `\u2591` 9/9  \u00b7  8 closed, 1 open", OVERALL)
chk(over is not None and over[0] == 9 and over[2] == 8, "counts pattern reads an overall line")
title_row = ROW.match("| [a `[]` title](https://example.test/issues/1) | Feature | P1 | \u2705 Done |")
chk(title_row is not None and title_row.group("title") == "a `[]` title",
    "row pattern survives brackets inside a title")

print()
print(f"{total - failed} passed, {failed} failed")
sys.exit(1 if failed else 0)
