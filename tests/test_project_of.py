#!/usr/bin/env python3
"""project_of(): session -> project key resolution (P4-01, #56)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
os.environ.setdefault(
    "LLM_TELEMETRY_CONFIG",
    os.path.join(os.path.dirname(__file__), "..", "examples", "sample-config.json"))

from llm_telemetry.projects import project_of, CWD_DENYLIST

p = f = 0


def chk(ok, msg):
    global p, f
    print(("  OK   " if ok else "  FAIL ") + msg)
    p, f = (p + 1, f) if ok else (p, f + 1)


titles = [f"ahwa-health-gate · Sep {d} {h:02d}:{m:02d}" for d in (24, 25) for h in range(12) for m in (0, 30)][:25]
resolved = {project_of(title=t, cwd=None) for t in titles}
chk(resolved == {"ahwa-health-gate"}, f"25 timestamped cron titles all resolve to a single key, got {resolved}")

chk(project_of(title="Nowinv", cwd=None) == "Nowinv", "a title with no ' · ' separator resolves to its own text")
chk(project_of(title="Nowinv", cwd=None) != "nowinv", "case is preserved, not lowercased")

for bad_cwd in ("/opt", "/tmp", "/home", None, "", "/usr", "/var", "/root"):
    r = project_of(title=None, cwd=bad_cwd)
    chk(r is None, f"cwd={bad_cwd!r} resolves to None, not a fake project name, got {r!r}")

chk(project_of(title=None, cwd="/srv/workspace/nowinv") == "nowinv",
    "a real project directory's basename is used when there is no title")
chk(project_of(title=None, cwd="/opt/../srv/workspace/Nowinv/") == "Nowinv",
    "a trailing slash doesn't break basename resolution, and case is preserved")

chk(project_of(title=None, cwd=None) is None, "no title and no cwd resolves to None")
chk(project_of(title="", cwd="") is None, "empty strings resolve to None, not an empty-string project key")
chk(project_of(title="   ", cwd="/opt") is None,
    "a whitespace-only title falls through to cwd resolution, which then hits the denylist -> None")

chk(project_of(title="Nowinv", cwd="/opt") == "Nowinv",
    "title stem wins over cwd when both are present")

chk(project_of(title="  My   Project  · timestamp", cwd=None) == "My Project",
    "internal whitespace in the title stem is collapsed and the stem is trimmed")

chk(CWD_DENYLIST == frozenset({"opt", "tmp", "home", "usr", "var", "root", ""}),
    f"CWD_DENYLIST is the exact measured+documented set, got {CWD_DENYLIST}")

for weird in ("日本語 · foo", "a" * 5000, "·", " · ", "/a/b/c/d/e/../../f"):
    try:
        project_of(title=weird, cwd=weird)
        chk(True, f"no exception on adversarial input {weird[:20]!r}...")
    except Exception as e:
        chk(False, f"raised on adversarial input {weird[:20]!r}: {e}")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
