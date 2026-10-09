#!/usr/bin/env python3
"""The committed sample artifacts must be reproducible from the sample inputs (#151).

`examples/reports/*.html` are committed, so every clone reads them as truth —
but nothing proved they still matched what the documented sample flow produces.
They could drift for months: a template fix shipped without re-running the flow
leaves a page that no longer represents the code, and a reviewer cannot tell by
looking.

This test rebuilds each page into a temporary directory from the committed
fixtures (never touching `examples/`) and compares byte for byte.

One field in the pages is genuinely time-dependent — the `Generated <date>`
line — and `normalise()` is the only place that forgives it. Everything else,
including the ranking windows and the price sheet, comes from the pinned inputs
and must match exactly.

Needs no network and no real agent home.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORTS = os.path.join(ROOT, "examples", "reports")

failed = 0
total = 0


def chk(cond, label, extra=""):
    global failed, total
    total += 1
    print(("  OK   " if cond else "  FAIL ") + label + (f"  ({extra})" if extra else ""))
    if not cond:
        failed += 1


GENERATED = re.compile(r"Generated \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}")


def normalise(text):
    """The one place that forgives a build-time field. Keep it that small."""
    return GENERATED.sub("Generated <timestamp>", text)


def width_and_offset(a, b):
    """How far two texts agree, for a useful failure message."""
    n = min(len(a), len(b))
    i = 0
    while i < n and a[i] == b[i]:
        i += 1
    line = a.count("\n", 0, i) + 1
    return i, line


# The sample flow, exactly as README.md documents it. Inputs are copied beside
# the output because the builders read their sidecar JSON from the output dir.
def build(name, module, out_dir):
    env = dict(os.environ, PYTHONPATH=os.path.join(ROOT, "src"),
               LLM_TELEMETRY_NO_COLLECT="1",
               LLM_TELEMETRY_CONFIG="examples/sample-config.json",
               LLM_TELEMETRY_AGENT_HOME="examples/agent-home",
               LLM_TELEMETRY_CATALOG=os.path.join(out_dir, "sample-catalog.json"),
               PYTHONDONTWRITEBYTECODE="1")
    cmd = [sys.executable, "-m", module, os.path.join(out_dir, name)]
    proc = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, text=True)
    return proc, " ".join(cmd)


targets = [
    ("dashboard.html", "llm_telemetry.build_dashboard"),
    ("costs.html", "llm_telemetry.build_costs"),
    ("rankings.html", "llm_telemetry.build_rankings"),
]

tmp = tempfile.mkdtemp(prefix="sample-artifacts-")
try:
    for name in os.listdir(REPORTS):
        if name.endswith(".json"):
            shutil.copy2(os.path.join(REPORTS, name), os.path.join(tmp, name))

    for name, module in targets:
        proc, cmd = build(name, module, tmp)
        built = os.path.join(tmp, name)
        committed = os.path.join(REPORTS, name)
        if proc.returncode != 0 or not os.path.isfile(built):
            tail = (proc.stderr or proc.stdout).strip().splitlines()
            chk(False, f"{name}: builds from the sample inputs", tail[-1] if tail else "no output")
            continue
        chk(True, f"{name}: builds from the sample inputs")
        got = normalise(open(built, encoding="utf-8").read())
        want = normalise(open(committed, encoding="utf-8").read())
        if got == want:
            chk(True, f"{name}: matches the committed artifact")
        else:
            off, line = width_and_offset(got, want)
            chk(False, f"{name}: matches the committed artifact",
                f"first difference at line {line} (offset {off})")
            print(f"        built:     {got[off:off + 90]!r}")
            print(f"        committed: {want[off:off + 90]!r}")
            print(f"        rebuild:   {cmd}")
finally:
    shutil.rmtree(tmp, ignore_errors=True)

chk("Generated 2026-01-02 03:04:05" != normalise("Generated 2026-01-02 03:04:05"),
    "normalise() hides the build timestamp")
chk(normalise("Generated 2026-01-02 03:04:05") == normalise("Generated 2027-11-12 23:59:59"),
    "normalise() treats two timestamps as equal")
chk(normalise("Generated yesterday") == "Generated yesterday",
    "normalise() leaves a non-timestamp alone")

print()
print(f"{total - failed} passed, {failed} failed")
sys.exit(1 if failed else 0)
