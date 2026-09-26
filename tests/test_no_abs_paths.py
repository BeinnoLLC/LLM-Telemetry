#!/usr/bin/env python3
"""No absolute or user-specific paths anywhere in the source.

A hard-coded `/home/<someone>` works on exactly one machine and fails silently
everywhere else — and in this project it also leaks the operator's username
into a repo that ships sanitized fixtures. Paths belong in config.py (which
expands `~` and `$VARS`) or in an environment variable.

This guard runs over the tracked tree, not the working directory, so scratch
files and local experiments never trip it.
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# A POSIX home path, or any Windows drive path. Matched anywhere in a line.
BAD = re.compile(r"(/home/[a-z][\w.-]*|/Users/[A-Za-z][\w.-]*|[A-Z]:\\\\)")

# Docs legitimately quote real paths when describing a deployment.
SKIP_DIRS = ("docs/",)
SKIP_FILES = ("tests/test_no_abs_paths.py",)

failed = 0
total = 0


def chk(cond, label, extra=""):
    global failed, total
    total += 1
    print(("  OK   " if cond else "  FAIL ") + label + (f"  ({extra})" if extra else ""))
    if not cond:
        failed += 1


tracked = subprocess.run(["git", "-C", ROOT, "ls-files"],
                         capture_output=True, text=True, check=True).stdout.split()
scanned = 0
offenders = []
for rel in tracked:
    if rel.startswith(SKIP_DIRS) or rel in SKIP_FILES:
        continue
    path = os.path.join(ROOT, rel)
    try:
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
    except (UnicodeDecodeError, FileNotFoundError):
        continue
    scanned += 1
    for n, line in enumerate(text.splitlines(), 1):
        m = BAD.search(line)
        if m:
            offenders.append(f"{rel}:{n}: {m.group(0)}")

chk(scanned > 20, "scanned the tracked tree", f"{scanned} files")
chk(not offenders, "no absolute/user-specific paths in tracked source",
    "; ".join(offenders[:4]) if offenders else "")

# The guard must be able to fail, or it proves nothing.
chk(bool(BAD.search("db = '/home/someone/.hermes/state.db'")), "pattern catches a POSIX home path")
chk(bool(BAD.search('D = "/Users/dev/reports"')), "pattern catches a macOS home path")
chk(not BAD.search('p = os.path.expanduser("~/.hermes/reports")'), "tilde paths are allowed")
chk(not BAD.search('REPO="${LLM_TELEMETRY_REPO:-$HOME/x}"'), "env-var paths are allowed")

print()
print(f"{total - failed} passed, {failed} failed")
sys.exit(1 if failed else 0)
