#!/usr/bin/env python3
"""Run every tests/test_*.py and report failures.

Each test file is a standalone script that prints its own summary and exits
non-zero on failure, so the runner is a subprocess fan-out rather than pytest
(pytest is deliberately not a dependency of this repo).

Usage:
  .venv/bin/python tools/run_py_tests.py          # quiet: only failures
  .venv/bin/python tools/run_py_tests.py -v       # show each file's last line
"""
import glob
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = os.path.join(ROOT, ".venv", "bin", "python")
VERBOSE = "-v" in sys.argv


def main():
    files = sorted(glob.glob(os.path.join(ROOT, "tests", "test_*.py")))
    if not files:
        print("no tests/test_*.py found")
        return 1

    failed = []
    for path in files:
        name = os.path.basename(path)
        try:
            p = subprocess.run(
                [PY, path], cwd=ROOT, capture_output=True, text=True, timeout=300)
        except subprocess.TimeoutExpired:
            failed.append((name, "TIMEOUT after 300s"))
            print(f"FAIL {name}: TIMEOUT after 300s")
            continue

        out = (p.stdout or "") + (p.stderr or "")
        last = next((ln.strip() for ln in reversed(out.splitlines())
                     if ln.strip() and not ln.startswith("config:")), "")
        # Trust the exit code, and cross-check the printed summary so a test
        # that prints FAIL but exits 0 cannot slip through.
        printed_fail = ("FAIL" in last) or ("FAILED" in last)
        if p.returncode != 0 or printed_fail:
            failed.append((name, last or f"exit {p.returncode}"))
            print(f"FAIL {name}: {last or 'exit ' + str(p.returncode)}")
        elif VERBOSE:
            print(f"ok   {name}: {last}")

    total = len(files)
    print(f"\n{total - len(failed)}/{total} python test files passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
