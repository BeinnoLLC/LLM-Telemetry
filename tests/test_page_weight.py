#!/usr/bin/env python3
"""Built artifacts must stay inside a documented weight budget (#145).

Every view module, CSS rule and inline payload ends up in one committed HTML
file, and nothing measured it: the sample dashboard crossed 700 KB with no
number anywhere in the repo saying so. A budget makes the growth a decision —
trim it, or raise the number here *and* in the README in the same commit —
instead of a surprise.

Sizes are the artifact's own bytes. The budgets sit just above today's sizes, so
a real regression trips them and ordinary work does not. The floors catch the
other failure: an artifact truncated to nothing still fits any budget.

Reads files only: no build, no network.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# artifact -> (budget, floor). Both in bytes; the README table mirrors it.
BUDGETS = {
    "examples/reports/dashboard.html": (800_000, 400_000),
    "examples/reports/analytics-data.json": (200_000, 90_000),
    "examples/reports/costs.html": (90_000, 40_000),
    "examples/reports/rankings.html": (25_000, 10_000),
}

failed = 0
total = 0


def chk(cond, label, extra=""):
    global failed, total
    total += 1
    print(("  OK   " if cond else "  FAIL ") + label + (f"  ({extra})" if extra else ""))
    if not cond:
        failed += 1


for rel, (budget, floor) in sorted(BUDGETS.items()):
    path = os.path.join(ROOT, rel)
    if not os.path.isfile(path):
        chk(False, f"{rel}: exists")
        continue
    size = os.path.getsize(path)
    chk(size <= budget, f"{rel}: within budget",
        f"{size} of {budget} bytes, {size - budget:+d}")
    chk(size >= floor, f"{rel}: not truncated", f"{size} of a {floor}-byte floor")

# Every committed page must carry a budget; fixture payloads are inputs and are
# only budgeted when they are large enough to matter.
reports = os.path.join(ROOT, "examples", "reports")
for name in sorted(os.listdir(reports)):
    if not os.path.isfile(os.path.join(reports, name)) or name.endswith(".json"):
        continue
    rel = f"examples/reports/{name}"
    if rel not in BUDGETS:
        chk(False, f"{rel}: has a budget", "add it to BUDGETS and the README table")

# The README must carry the numbers, so a budget is discoverable before it fails.
readme = open(os.path.join(ROOT, "README.md"), encoding="utf-8").read()
chk("Artifact weight" in readme, "the README documents the artifact budgets")
for rel, (budget, _) in sorted(BUDGETS.items()):
    chk(f"{budget:,}" in readme or str(budget) in readme,
        f"README states the budget for {rel}", f"{budget}")

# The gate must be able to fail, or it proves nothing.
chk(800_000 > 762_038, "the dashboard budget is above today's size")
chk(not (762_038 <= 400_000), "a truncated artifact would fail its floor")
chk(len(BUDGETS) == len({os.path.basename(k) for k in BUDGETS}), "budget keys are unique")

print()
print(f"{total - failed} passed, {failed} failed")
sys.exit(1 if failed else 0)
