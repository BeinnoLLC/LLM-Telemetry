#!/usr/bin/env python3
"""P3-02 (#32): 'pytest runs in CI' is a named acceptance checkbox. The 38
existing test_*.py files are deliberately script-style (print + sys.exit),
not pytest's assert/fixture style, and rewriting all of them is out of
scope here -- this makes `pytest` itself the CI entrypoint by running each
one as its own subprocess and turning a nonzero exit into a real pytest
failure with the script's own stdout attached, so a `pytest` run in CI
(or locally) means something real rather than being a wrapper that always
passes.

tools/run_py_tests.py remains the fast local loop (no pytest dependency);
this file is what CI's "Python suites" step now runs.
"""
import os
import subprocess
import sys

import pytest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
TESTS_DIR = os.path.dirname(os.path.abspath(__file__))

SCRIPTS = sorted(
    f for f in os.listdir(TESTS_DIR)
    if f.startswith("test_") and f.endswith(".py") and f != os.path.basename(__file__)
)


@pytest.mark.parametrize("script", SCRIPTS)
def test_script(script):
    r = subprocess.run([sys.executable, os.path.join(TESTS_DIR, script)],
                        cwd=ROOT, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        pytest.fail(f"{script} exited {r.returncode}\n--- stdout ---\n{r.stdout}\n--- stderr ---\n{r.stderr}",
                    pytrace=False)
