#!/usr/bin/env python3
"""P5-06 (#55): the sample build must never read the developer's real agent.

Two guards, both runnable locally where a real ~/.hermes DOES exist (that is
the whole point: a check that only passes on a clean CI box proves nothing):

1. Reproducibility: build the sample dashboard twice, once pointing
   LLM_TELEMETRY_AGENT_HOME at an empty fixture home and once at a home that
   holds a decoy profile with a distinctive name. The outputs must be
   byte-identical. If the build read the agent home at all, the decoy would
   change it.

2. Fixture markers: every profile name in the rendered dashboard must be one
   of the committed fixture profiles. A real profile name leaking in fails.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import hashlib

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
REPORTS = os.path.join(ROOT, "examples", "reports")
FIXTURE_PROFILES = {"work", "personal"}

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{('  ' + str(extra)) if extra is not None else ''}")
    if ok:
        p += 1
    else:
        f += 1


def build(agent_home, out):
    env = {**os.environ, "LLM_TELEMETRY_NO_COLLECT": "1",
           "LLM_TELEMETRY_CONFIG": os.path.join(ROOT, "examples", "sample-config.json"),
           "LLM_TELEMETRY_AGENT_HOME": agent_home}
    r = subprocess.run([sys.executable, "-m", "llm_telemetry.build_dashboard", out],
                       cwd=ROOT, env=env, capture_output=True, text=True, timeout=240)
    if r.returncode:
        print(r.stderr[-1200:])
    return hashlib.sha256(open(out, "rb").read()).hexdigest() if r.returncode == 0 else None


with tempfile.TemporaryDirectory() as root:
    empty = os.path.join(root, "empty-home")
    os.makedirs(empty)
    decoy = os.path.join(root, "decoy-home")
    os.makedirs(os.path.join(decoy, "profiles", "decoyprofilezz"))
    for d in (decoy, os.path.join(decoy, "profiles", "decoyprofilezz")):
        open(os.path.join(d, "state.db"), "w").close()

    a = build(empty, os.path.join(root, "a.html"))
    b = build(decoy, os.path.join(root, "b.html"))
    chk(a is not None and b is not None, "sample build runs with an explicit fixture agent home")
    chk(a == b, "output is identical whatever agent home is present",
        f"{(a or '')[:12]} vs {(b or '')[:12]}")
    chk("decoyprofilezz" not in open(os.path.join(root, "b.html")).read(),
        "a profile in the agent home never reaches the sample page")

# The committed sample dashboard: profile names are fixture names only.
html = open(os.path.join(REPORTS, "dashboard.html")).read()
m = re.search(r"let DATA = (\{.*?\});\n", html, re.S)
data = json.loads(m.group(1)) if m else {}
names = set(data.get("profiles", {}))
chk(bool(names), "sample dashboard embeds its profiles", sorted(names))
chk(names <= FIXTURE_PROFILES, "only fixture profile names in the sample dashboard",
    sorted(names - FIXTURE_PROFILES))
for fn in ("analytics-data.json", "live-data.json", "router-data.json"):
    doc = json.load(open(os.path.join(REPORTS, fn)))
    extra = set(doc.get("profiles", {})) - FIXTURE_PROFILES
    chk(not extra, f"{fn}: only fixture profile names", sorted(extra))

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
