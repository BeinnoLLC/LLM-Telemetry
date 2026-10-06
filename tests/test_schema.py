#!/usr/bin/env python3
"""The four payload schemas must describe the payloads, and keep describing them.

P1-02 (#24). The collectors write JSON and the page reads it; before this there
was nothing in between, so a rename on either side showed up as an empty panel
on a rendered page. Each check below is a different way that could come back:

  * the committed samples validate against ``schema/<tag>.schema.json``;
  * ``required`` means something -- deleting any required key is rejected, and
    naming that key in the message is what makes the failure actionable;
  * a required key is one a consumer really dereferences, so we never lock in a
    field nobody reads and never fail on a field we do not;
  * a *new* field is not a breaking change (``additionalProperties`` is open);
  * every keyword the schemas use is one the validator implements, so the
    hand-rolled subset cannot silently stop enforcing something;
  * the collectors validate before writing, so a bad payload is never written.

No build, no network: schemas and samples are files, so this runs in the normal
suite (tools/run_py_tests.py) and in CI.
"""
import copy
import glob
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "src"))
from llm_telemetry import schema_check as S  # noqa: E402

REPORTS = os.path.join(ROOT, "examples", "reports")
JS_DIR = os.path.join(ROOT, "src", "llm_telemetry", "web", "js")
_js = " ".join(open(p, encoding="utf-8").read() for p in glob.glob(os.path.join(JS_DIR, "*.js")))

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{('  ' + str(extra)) if extra else ''}")
    if ok:
        p += 1
    else:
        f += 1


def sample(tag):
    with open(os.path.join(REPORTS, "%s-data.json" % tag), encoding="utf-8") as fh:
        return json.load(fh)


def dereferenced(key):
    """True when some JS module names this key, as a property or a literal."""
    k = re.escape(key)
    return bool(re.search(r"\.%s\b" % k, _js) or re.search(r"[\"'`]%s[\"'`]" % k, _js))


def walk(node, steps=()):
    """Yield (steps, schema node) for every node in a schema.

    Steps are a tuple so a keyed map and an array are their own step: gluing
    them onto the parent key ("profiles{}") cannot be navigated back into the
    sample. path_of() renders them for messages.
    """
    yield steps, node
    if not isinstance(node, dict):
        return
    for key, sub in (node.get("properties") or {}).items():
        yield from walk(sub, steps + (key,))
    if node.get("items"):
        yield from walk(node["items"], steps + ("[]",))
    if isinstance(node.get("additionalProperties"), dict):
        yield from walk(node["additionalProperties"], steps + ("{}",))


def path_of(steps):
    out = ""
    for step in steps:
        out = step if not out else (out + step if step in ("[]", "{}") else out + "." + step)
    return out


def descend(data, steps):
    """Follow schema steps into the sample.

    ``{}`` (a keyed map) resolves to its first entry and ``[]`` (an array) to
    its first element, so a record the schema types inside a map can still be
    reached.
    """
    cur = data
    for step in steps:
        if step == "{}":
            cur = next(iter(cur.values())) if isinstance(cur, dict) and cur else None
        elif step == "[]":
            cur = cur[0] if isinstance(cur, list) and cur else None
        else:
            cur = cur.get(step) if isinstance(cur, dict) else None
        if cur is None:
            return None
    return cur


# ---- 1. the committed samples satisfy the schemas -------------------------
for tag in S.TAGS:
    data = sample(tag)
    try:
        S.check(tag, data)
        chk(True, f"{tag}: the committed sample matches its schema")
    except S.SchemaError as exc:
        chk(False, f"{tag}: the committed sample matches its schema", exc)

# The four are exactly the payloads the collectors write.
chk(len(S.TAGS) == 4 and set(S.TAGS) == {"analytics", "live", "ollama", "router"},
    "the registry covers the four collector payloads", S.TAGS)

# ---- 2. the keyword subset cannot silently diverge ------------------------
used = set()
for tag in S.TAGS:
    for _steps, node in walk(S.load(tag)):
        if isinstance(node, dict):
            used |= {k for k in node if k not in S.METADATA}
chk(used <= set(S.KEYWORDS), "every keyword in the schemas is implemented", sorted(used))
chk(used == set(S.KEYWORDS), "the schemas exercise the whole subset", sorted(used))

# An unimplemented keyword is an error, not a no-op: minLength here would
# otherwise be silently dropped and the schema would claim more than it checks.
try:
    S.errors_for({"a": ""}, {"type": "object", "properties": {"a": {"type": "string",
                                                                    "minLength": 1}}})
    chk(False, "an unsupported keyword is refused rather than ignored")
except S.SchemaError as exc:
    chk("minLength" in str(exc), "an unsupported keyword is refused rather than ignored", exc)

# ---- 3. required means something -----------------------------------------
# Deleting a required key must be rejected, and the message must name the key:
# that is what makes the write-time failure actionable. Every node two levels
# deep is tested, plus the first few deeper ones (the payload is 185 KB, so
# each mutation costs a full walk); the sample is sorted, not arbitrary.
for tag in S.TAGS:
    schema, data = S.load(tag), sample(tag)
    nodes = sorted(((steps, node) for steps, node in walk(schema)
                    if isinstance(node, dict) and node.get("required")),
                   key=lambda x: path_of(x[0]))
    chk(bool(nodes), f"{tag}: the schema states required keys somewhere", len(nodes))
    shallow = [x for x in nodes if len(x[0]) <= 2]
    picked = shallow + [x for x in nodes if x not in shallow][:6]
    tested, seen = 0, []
    for steps, node in picked:
        target = descend(data, steps)
        if not isinstance(target, dict):
            continue
        for key in node["required"]:
            if key not in target:
                continue
            broken = copy.deepcopy(data)
            spot = descend(broken, steps)
            assert isinstance(spot, dict), steps
            del spot[key]
            errs = S.errors_for(broken, schema, where=tag)
            if not any(key in e and "required" in e for e in errs):
                chk(False, f"{tag}: dropping {path_of(steps) or '<root>'}.{key} "
                           f"is rejected by name", errs[:2])
                break
            tested += 1
            seen.append(path_of(steps) or "<root>")
    chk(tested > 0, f"{tag}: dropping a required key is rejected ({tested} keys, "
                    f"{len(set(seen))} records)")

# required is not just "every key that happens to be there": anything required
# must be something the JS reads, or it is a field nobody can miss.
for tag in S.TAGS:
    dead = [f"{path_of(steps)}.{k}".lstrip(".") for steps, node in walk(S.load(tag))
            if isinstance(node, dict)
            for k in node.get("required", []) if not dereferenced(k)]
    chk(not dead, f"{tag}: every required key is read by the page", dead[:6])

# ---- 4. a new field is not a breaking change ------------------------------
for tag in S.TAGS:
    grown = copy.deepcopy(sample(tag))
    grown["a_field_added_later"] = {"nested": [1, 2, 3]}
    try:
        S.check(tag, grown)
        chk(True, f"{tag}: an added top-level field still validates")
    except S.SchemaError as exc:
        chk(False, f"{tag}: an added top-level field still validates", exc)

# ---- 5. a wrong type is caught, at depth, with a useful path -------------
for tag, path, bad in (("analytics", "generated", 12345),
                       ("analytics", "profiles.work.active", "yes"),
                       ("live", "ollama", []),
                       ("ollama", "hosts", "not-a-list"),
                       ("router", "vocab", 7)):
    data, node = sample(tag), None
    broken = copy.deepcopy(data)
    target = broken
    for step in path.split("."):
        target = target.get(step) if isinstance(target, dict) else None
    if target is None:
        chk(False, f"{tag}: wrong type at {path} is rejected", "path absent from sample")
        continue
    holder = broken
    for step in path.split(".")[:-1]:
        holder = holder[step]
    holder[path.split(".")[-1]] = bad
    errs = S.errors_for(broken, S.load(tag), where=tag)
    hit = [e for e in errs if e.startswith(path + ":")]
    chk(bool(hit), f"{tag}: wrong type at {path} is rejected", hit[:1])

# bool is not a number: JSON true must not satisfy an integer field.
chk(bool(S.errors_for(True, {"type": "integer"})), "bool fails an integer field")
chk(not S.errors_for(5, {"type": "integer"}), "an integer passes an integer field")
chk(not S.errors_for(5.5, {"type": "number"}), "a float passes a number field")

# ---- 6. the collectors validate before they write ------------------------
for module, tag in (("collect_analytics", "analytics"), ("collect_live", "live"),
                    ("probe_hosts", "ollama"), ("collect_router", "router")):
    src = open(os.path.join(ROOT, "src", "llm_telemetry", "%s.py" % module),
               encoding="utf-8").read()
    guard = src.find('check("%s"' % tag)
    dump = src.find("json.dump(")
    chk("from .schema_check import check" in src, f"{module} imports the validator")
    chk(guard != -1, f'{module} validates its payload (check("{tag}", ...))')
    chk(guard != -1 and dump != -1 and guard < dump,
        f"{module} validates before writing, not after")

# The validator is reached through the package, so it must not need a key or a
# network to load a schema.
chk(S.schema_path("analytics").endswith("schema/analytics.schema.json"),
    "schema paths resolve inside the package", S.schema_path("analytics"))
try:
    S.load("nope")
    chk(False, "an unknown payload name is refused")
except S.SchemaError as exc:
    chk("nope" in str(exc), "an unknown payload name is refused", exc)

# ---- 7. a malformed payload is never written -----------------------------
# The real write path with the builder swapped for a payload that is missing
# required keys: main() must raise before it creates the file. Static wiring
# (section 6) says the call is there; this says it actually stops the write.
#
# Pinned to the repo's own config and fixture home before collect_router is
# imported, so the test reads the sample, not whichever telemetry happens to be
# on the machine running it.
import tempfile  # noqa: E402

os.environ["LLM_TELEMETRY_CONFIG"] = os.path.join(ROOT, "examples", "sample-config.json")
os.environ["LLM_TELEMETRY_AGENT_HOME"] = os.path.join(ROOT, "examples", "agent-home")
from llm_telemetry import collect_router  # noqa: E402

tmpdir = tempfile.mkdtemp(prefix="schema-")
dest = os.path.join(tmpdir, "router-data.json")
real_build = collect_router.build
collect_router.build = lambda: {"schema_version": 1}
try:
    collect_router.main(dest)
    chk(False, "the collector refuses to write a payload that fails its schema")
except S.SchemaError as exc:
    chk("required key" in str(exc), "the collector refuses to write a payload that fails its schema",
        str(exc).splitlines()[0])
finally:
    collect_router.build = real_build
chk(not os.path.exists(dest), "nothing was written when validation failed")

# Positive control: the same path with the real builder writes and validates.
good = os.path.join(tmpdir, "ok.json")
collect_router.main(good)
chk(os.path.exists(good), "the same path still writes a valid payload")
with open(good, encoding="utf-8") as fh:
    S.check("router", json.load(fh))
chk(True, "what it wrote passes the schema")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
