#!/usr/bin/env python3
"""Derive src/llm_telemetry/schema/<tag>.schema.json from observed payloads.

P1-02 (#24). The contract has to describe what the collectors really produce,
so it is derived from evidence rather than from the payload shape I imagine:
one or more variants per tag (the committed sample, plus a fresh payload from a
real run when one is available), merged.

Rules, each one earned by a false failure the first draft produced:

  number, never integer   JSON has one number type. `resend[3].last` is 12 in
                          one payload and 12.4 in another; a schema that pinned
                          `integer` from the sample rejected a real collection.
  one null implies nothing  `moa` is null when unset and an object when set, so
                          a field seen only as null gets no type constraint.
                          Null plus a type becomes a union with null.
  required = intersection  A key is required only when every observed variant
                          has it *and* a consumer reads it. `decisions.by_tier`
                          entries carry `plan` only when known; requiring it
                          rejected a real payload.
  extra keys are allowed   additionalProperties stays open, so adding a field
                          is never a breaking change.
  keyed maps collapse      A dict keyed by data -- profile, model, provider or
                          route names -- becomes additionalProperties, not a
                          list of pinned names. Otherwise the schema leaks
                          instance data into a public repo (it did: real model
                          ids) and rejects the next model that appears. A
                          key is treated as data when it is not a plain
                          snake_case identifier, plus an explicit list for the
                          ones that are (profile names).
  properties intersect     A field only one payload carries is not named: the
                          schema describes the stable core, and anything else
                          is accepted as an extra key.

Run it with CUR_OUT set to a directory holding payloads from a real run
(one <tag>-data.json per payload). Without it the schema is derived from the
committed sample alone, which pins instance-keyed names the second variant
would have collapsed -- handy for a smoke check, not for committing.

Usage:
  CUR_OUT=/dir/with/fresh/payloads python3 tools/gen_schemas.py
"""
import glob
import json
import os
import re

ROOT = os.environ.get("REPO_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORTS = os.path.join(ROOT, "examples", "reports")
SCHEMA_DIR = os.path.join(ROOT, "src", "llm_telemetry", "schema")
CUR = os.environ.get("CUR_OUT")          # freshly collected payloads, if any
_js = " ".join(open(p, encoding="utf-8").read()
               for p in glob.glob(os.path.join(ROOT, "src", "llm_telemetry", "web", "js", "*.js")))

MAP_PATHS = (re.compile(r"^profiles$"), re.compile(r"^profiles\.[^.]+\.node_sessions$"))


FIELD_RE = re.compile(r"^[a-z][a-z0-9_]*$")


def field_like(key):
    """True for a name that looks like a record's own field, not a data key."""
    return bool(FIELD_RE.match(key))


def dereferenced(key):
    """True when some JS module names this key (property, index or literal)."""
    k = re.escape(key)
    return bool(re.search(r"\.%s\b" % k, _js) or re.search(r"[\"'`]%s[\"'`]" % k, _js))


def type_of(v):
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, (int, float)):
        return "number"          # JSON has no separate integer type
    if isinstance(v, str):
        return "string"
    if v is None:
        return "null"
    return None


def is_map(path, v):
    """True when a dict is keyed by data rather than describing a record."""
    if v and any(r.match(path) for r in MAP_PATHS):
        return True
    if not isinstance(v, dict) or not v:
        return False
    return any(not field_like(k) for k in v)


def infer(v, path):
    """Internal schema (types as a set, required as a set) for one value."""
    t = type_of(v)
    if t is not None:
        return {"type": {t}}
    if isinstance(v, list):
        if not v:
            return {"type": {"array"}}
        item = None
        for e in v:
            item = merge(item, infer(e, path + "[]"))
        return {"type": {"array"}, "items": item}
    if isinstance(v, dict):
        if is_map(path, v):
            val = None
            for sub in v.values():
                val = merge(val, infer(sub, path + ".{}"))
            return {"type": {"object"}, "additionalProperties": val}
        props, req = {}, set()
        for k, val in v.items():
            # No leading dot: the path is matched against MAP_PATHS ("^profiles$"
            # never matched ".profiles", so profile names were pinned as fields).
            props[k] = infer(val, (path + "." + k) if path else k)
            if dereferenced(k):
                req.add(k)
        return {"type": {"object"}, "properties": props, "required": req}
    raise AssertionError((type(v), path))


def merge(a, b):
    """Merge two internal schemas: types union, required intersects."""
    if a is None:
        return b
    if b is None:
        return a
    out = {}
    ta, tb = set(a.get("type", ())), set(b.get("type", ()))
    if ta | tb:
        out["type"] = ta | tb
    pa, pb = a.get("properties"), b.get("properties")
    if pa is not None or pb is not None:
        # Only fields every payload carries: a key that appears in one is either
        # new or instance data, and either way it is not part of the contract.
        # required is always an intersection -- taking a union here required
        # rate_limit in health[].kinds records that legitimately lack it.
        # A list, not a set: iterating a set is hash order, so the emitted file
        # churned between runs. Order comes from the payload.
        common = [k for k in (pa or ()) if k in (pb or {})] \
            if pa is not None and pb is not None else []
        out["properties"] = {k: merge(pa[k], pb[k]) for k in common}
        out["required"] = set(a.get("required", ())) & set(b.get("required", ()))
    if a.get("items") or b.get("items"):
        out["items"] = merge(a.get("items"), b.get("items"))
    if a.get("additionalProperties") or b.get("additionalProperties"):
        out["additionalProperties"] = merge(a.get("additionalProperties"),
                                            b.get("additionalProperties"))
    return out


def clean(sch):
    """Internal schema -> emitted schema."""
    out = {}
    ts = set(sch.get("type", ())) - {"null"}
    if not ts:
        return {}                # only ever seen as null: no type information
    # null is always allowed alongside the observed type: the collectors emit it
    # for a value they could not determine, so a schema that forbids null would
    # reject the collector's own output.
    out["type"] = sorted(ts | {"null"})
    if "properties" in sch or sch.get("type") == {"object"}:
        out["properties"] = {k: clean(v) for k, v in (sch.get("properties") or {}).items()}
        if sch.get("required"):
            out["required"] = sorted(sch["required"])
        # A record never constrains keys it does not name: anything added later
        # must stay valid. Only a pure keyed map types its values.
        out["additionalProperties"] = True
    if not out.get("properties") and isinstance(sch.get("additionalProperties"), dict):
        out.pop("additionalProperties", None)
        out["additionalProperties"] = clean(sch["additionalProperties"])
    if sch.get("items"):
        out["items"] = clean(sch["items"])
    elif sch.get("type") == {"array"}:
        out["items"] = {}
    return out


PAYLOADS = [
    ("analytics", "The dashboard's main payload, written by collect_analytics.py."),
    ("live", "Live agent and host state, written by collect_live.py."),
    ("ollama", "Probed inference hosts, written by probe_hosts.py."),
    ("router", "Router decisions, written by collect_router.py."),
]

os.makedirs(SCHEMA_DIR, exist_ok=True)
for tag, note in PAYLOADS:
    variants = [os.path.join(REPORTS, "%s-data.json" % tag)]
    if CUR and os.path.exists(os.path.join(CUR, "%s-data.json" % tag)):
        variants.append(os.path.join(CUR, "%s-data.json" % tag))
    body = None
    for path in variants:
        with open(path, encoding="utf-8") as fh:
            body = merge(body, infer(json.load(fh), ""))
    assert body is not None
    out = {"$schema": "http://json-schema.org/draft-07/schema#",
           "title": "%s payload" % tag,
           "description": note}
    out.update(clean(body))
    dest = os.path.join(SCHEMA_DIR, "%s.schema.json" % tag)
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
        fh.write("\n")
    print("%-9s %6d B  variants=%d  root required=%s"
          % (tag, os.path.getsize(dest), len(variants), sorted(body["required"])))
