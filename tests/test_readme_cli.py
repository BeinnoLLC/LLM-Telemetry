#!/usr/bin/env python3
"""The README's command table and the CLI parser must agree (#142).

The README table is the only command reference in the repo, so when the parser
gained `analytics`, `logs`, `session-timeline` and `config` — and lost the
`collect` name it never had — nothing failed. A reader following the docs ran a
command that does not exist and never heard about three that do.

This gate reads the parser out of `cli.py` and the table out of `README.md` and
requires the two sets to be equal, in both directions: an undocumented
subcommand is as much a bug as a documented one that does not exist.

It also checks the systemd enable block: a unit that ships in `systemd/` but is
never enabled is invisible work — the rankings timer sat unused that way, so a
fresh install never refreshed the Rankings tab.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# `sub.add_parser("name", ...)` / `p_x = sub.add_parser("name", ...)`.
PARSER = re.compile(r'add_parser\(\s*"([\w-]+)"')
# A row of the command table: | `llm-telemetry name` | does |
ROW = re.compile(r"^\|\s*`llm-telemetry ([\w-]+)`")
# Matching quotes: straight or typographic, as the page uses both.
ENABLED = re.compile(r"llm-telemetry-[\w-]+\.timer")

failed = 0
total = 0


def chk(cond, label, extra=""):
    global failed, total
    total += 1
    print(("  OK   " if cond else "  FAIL ") + label + (f"  ({extra})" if extra else ""))
    if not cond:
        failed += 1


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return fh.read()


cli = read("src/llm_telemetry/cli.py")
readme = read("README.md")

subcommands = set(PARSER.findall(cli))

# Scope the table parse to the command table itself: from its header row to the
# next top-level heading. Prose elsewhere legitimately mentions commands that
# are not rows (`llm-telemetry router` appears in the no-systemd paragraph).
lines = readme.splitlines()
start = next((i for i, ln in enumerate(lines) if ln.startswith("| Command |")), None)
chk(start is not None, "found the command table header")
end = next((i for i, ln in enumerate(lines[start + 1:], start + 1)
            if ln.startswith("## ")), len(lines))
table = "\n".join(lines[start:end])
block = table

documented = []
for ln in table.splitlines():
    m = ROW.match(ln)
    if m:
        documented.append(m.group(1))
chk(bool(documented), "found command rows in the table", f"{len(documented)} rows")

chk(not (subcommands - set(documented)),
    "every parser subcommand is documented",
    "undocumented: " + ", ".join(sorted(subcommands - set(documented))))
chk(not (set(documented) - subcommands),
    "every documented subcommand exists in the parser",
    "not in parser: " + ", ".join(sorted(set(documented) - subcommands)))

# The table must not document a name twice, and `cli.py` must not either.
dups = sorted({n for n in documented if documented.count(n) > 1})
chk(not dups, "no duplicated rows in the command table", ", ".join(dups))

# Every timer that ships in systemd/ is enabled in the documented block: the
# bash fence right after the `systemctl --user enable --now` line.
en = next((i for i, ln in enumerate(lines) if "enable --now" in ln), None)
chk(en is not None, "found the documented enable command")
enable_block = ""
if en is not None:
    chunk = []
    for ln in lines[en:]:
        if ln.strip().startswith("```") and chunk:
            break
        if ln.strip().startswith("```"):
            continue
        chunk.append(ln)
    enable_block = "\n".join(chunk)

timers = sorted(n for n in os.listdir(os.path.join(ROOT, "systemd"))
                if n.endswith(".timer"))
enabled = set(ENABLED.findall(enable_block))
chk(bool(timers), "found timer units", f"{len(timers)} units")
missing = sorted(t for t in timers if t not in enabled)
chk(not missing, "every shipped timer is enabled in the README block", ", ".join(missing))
chk(ENABLED.search("llm-telemetry-build.timer") is not None,
    "timer pattern catches a unit name")

# The gate must be able to fail, or it proves nothing.
smoke = PARSER.search('sub.add_parser("zzz", help="x")')
chk(smoke is not None and smoke.group(1) == "zzz", "parser pattern catches a subcommand")
smoke_row = ROW.match("| `llm-telemetry zzz` | does |")
chk(smoke_row is not None and smoke_row.group(1) == "zzz", "row pattern catches a table row")
chk(not ROW.match("| `llm-telemetry-router.timer` | does |"),
    "row pattern does not match a mention inside another path")
chk("zzz" not in subcommands, "the smoke name is not a real subcommand")

print()
print(f"{total - failed} passed, {failed} failed")
sys.exit(1 if failed else 0)
