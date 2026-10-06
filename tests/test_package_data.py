#!/usr/bin/env python3
"""Every file the page builders read at runtime must ship in the wheel.

setuptools only packages non-.py files that `[tool.setuptools.package-data]`
names. The builders read the page shells, the CSS, the JS modules and the
module order from `src/llm_telemetry/web/` at build time, so a file missing
from that list builds fine from a source checkout and crashes with
FileNotFoundError once installed. Only the CSS used to be listed (#135).

This checks the globs statically, with no build or network, so it runs in the
normal suite.
"""
import fnmatch
import os
import sys
import tomllib

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
PKG = os.path.join(ROOT, "src", "llm_telemetry")
sys.path.insert(0, os.path.join(ROOT, "src"))
from llm_telemetry import webassets as W  # noqa: E402

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{('  ' + str(extra)) if extra else ''}")
    if ok:
        p += 1
    else:
        f += 1


with open(os.path.join(ROOT, "pyproject.toml"), "rb") as fh:
    globs = tomllib.load(fh)["tool"]["setuptools"]["package-data"]["llm_telemetry"]


def shipped(rel):
    # setuptools globs are matched per path; "*" does not cross "/".
    return any(fnmatch.fnmatch(rel, g) and rel.count("/") == g.count("/") for g in globs)


def rel(path):
    return os.path.relpath(os.path.abspath(path), PKG).replace(os.sep, "/")


# Every *_PATH constant webassets reads, plus every file under web/.
read_paths = sorted({rel(v) for k, v in vars(W).items()
                     if k.endswith("_PATH") and isinstance(v, str)})
chk(len(read_paths) >= 6, "webassets exposes its read paths", read_paths)
for r in read_paths:
    chk(os.path.isfile(os.path.join(PKG, r)), f"{r} exists in the source tree")
    chk(shipped(r), f"{r} is covered by package-data", globs)

web_files = []
for dp, _dn, fns in os.walk(os.path.join(PKG, "web")):
    for fn in fns:
        r = rel(os.path.join(dp, fn))
        if fn == "package.json":  # dev-only: ESLint's module-type hint
            continue
        web_files.append(r)
for r in sorted(web_files):
    chk(shipped(r), f"{r} ships")

# schema/*.json is data too: schema_check.py reads it at collection time, so a
# wheel missing it fails on the first collect rather than on a page render.
from llm_telemetry import schema_check as S  # noqa: E402
chk(rel(S.SCHEMA_DIR) == "schema", "schema_check points at the schema package dir",
    rel(S.SCHEMA_DIR))
schema_files = sorted(rel(os.path.join(dp, fn))
                      for dp, _dn, fns in os.walk(S.SCHEMA_DIR) for fn in fns)
chk(len(schema_files) == len(S.TAGS), "one schema file per payload", schema_files)
for r in schema_files:
    chk(shipped(r), f"{r} ships")
for tag in S.TAGS:
    chk(shipped(rel(S.schema_path(tag))), f"schema for {tag} is covered by package-data")

# Negative control: the old list (CSS only) must fail on the shells and JS.
old = ["web/css/*.css"]
miss = [r for r in read_paths
        if not any(fnmatch.fnmatch(r, g) and r.count("/") == g.count("/") for g in old)]
chk(any(r.endswith(".html") for r in miss) and any("js/" in r for r in miss),
    "the pre-#135 CSS-only list would have been caught", miss)

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
