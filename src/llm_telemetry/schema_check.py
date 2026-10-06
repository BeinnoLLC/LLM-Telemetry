"""Validate a payload against its JSON Schema (P1-02, #24).

The collector writes a payload and the page reads it; nothing used to compare
the two, so a rename on either side showed up only as an empty panel. The four
payloads are now pinned by ``schema/<tag>.schema.json``, and:

* the collectors validate at write time (``check``), so a shape the page cannot
  read is never written;
* ``tests/test_schema.py`` validates the committed samples and that the schema
  still describes them;
* ``tests/check_schema.js`` does the same from the consumer's side.

Deliberately a small subset of JSON Schema -- ``type``, ``required``,
``properties``, ``items``, ``additionalProperties`` -- implemented in full by a
hand-rolled validator so the runtime stays dependency-free (stdlib plus PyYAML).
A keyword outside that set is an error rather than being ignored: silently
skipping an unknown keyword is how a schema stops enforcing anything.

``required`` lists only the keys a consumer really dereferences and that are
present in every variant of a record, so adding a field is not a breaking
change and removing one a consumer reads is.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA_DIR = os.path.join(HERE, "schema")

# tag -> schema file. The four payloads the collectors write.
TAGS = ("analytics", "live", "ollama", "router")

# Keywords the validator understands. Anything else in a schema file is an
# error, so a typo or an unimplemented keyword cannot pass as "no constraint".
KEYWORDS = ("type", "required", "properties", "items", "additionalProperties")
METADATA = ("$schema", "title", "description")

_cache: dict = {}


class SchemaError(ValueError):
    """A payload does not satisfy its schema, or a schema is not valid."""


def schema_path(tag):
    return os.path.join(SCHEMA_DIR, "%s.schema.json" % tag)


def load(tag):
    """The schema for ``tag``, parsed once."""
    if tag not in TAGS:
        raise SchemaError("unknown payload %r (known: %s)" % (tag, ", ".join(TAGS)))
    if tag not in _cache:
        with open(schema_path(tag), encoding="utf-8") as fh:
            _cache[tag] = json.load(fh)
    return _cache[tag]


def _type_ok(value, want):
    """JSON Schema type test, with bool kept out of integer/number."""
    if want == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if want == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if want == "boolean":
        return isinstance(value, bool)
    if want == "object":
        return isinstance(value, dict)
    if want == "array":
        return isinstance(value, list)
    if want == "string":
        return isinstance(value, str)
    if want == "null":
        return value is None
    raise SchemaError("unknown type %r in schema" % want)


def _kind(value):
    """The JSON type name of a value, for error messages."""
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if value is None:
        return "null"
    if isinstance(value, list):
        return "array"
    return "object"


def _walk(schema, value, path, errors, where):
    if not isinstance(schema, dict):
        raise SchemaError("%s: schema node is %s, not an object" % (where, _kind(schema)))
    unknown = [k for k in schema if k not in KEYWORDS and k not in METADATA]
    if unknown:
        raise SchemaError("%s: unsupported schema keyword(s) %s; the validator "
                          "implements %s only (P1-02)" % (where, ", ".join(sorted(unknown)),
                                                          ", ".join(KEYWORDS)))
    want = schema.get("type")
    if want is not None:
        wants = [want] if isinstance(want, str) else list(want)
        if not any(_type_ok(value, w) for w in wants):
            errors.append("%s: expected %s, found %s" % (path or "<root>",
                                                         " or ".join(wants), _kind(value)))
            return                       # a wrong type makes children meaningless
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                errors.append("%s: required key %r is missing" % (path or "<root>", key))
        props = schema.get("properties")
        if props is not None:
            for key, sub in props.items():
                if key in value:
                    _walk(sub, value[key], "%s.%s" % (path, key) if path else key,
                          errors, where)
            extra = schema.get("additionalProperties")
            if extra is not True and extra is not None:
                for key, val in value.items():
                    if key not in props:
                        _walk(extra, val, "%s.%s" % (path, key) if path else key,
                              errors, where)
    elif isinstance(value, list) and schema.get("items"):
        for i, item in enumerate(value):
            _walk(schema["items"], item, "%s[%d]" % (path, i), errors, where)


def errors_for(payload, schema, where="schema"):
    """Every way ``payload`` fails ``schema`` (empty when it satisfies it)."""
    errs = []
    _walk(schema, payload, "", errs, where)
    return errs


def validate(payload, schema, where="schema", limit=8):
    """Raise SchemaError unless ``payload`` satisfies ``schema``."""
    errs = errors_for(payload, schema, where)
    if errs:
        more = "" if len(errs) <= limit else "\n  ... and %d more" % (len(errs) - limit)
        raise SchemaError("%s: %d problem(s)\n  %s%s"
                          % (where, len(errs), "\n  ".join(errs[:limit]), more))


def check(tag, payload):
    """Validate one of the four collector payloads; raise SchemaError if bad."""
    validate(payload, load(tag), where="%s payload" % tag)
    return payload


def main(argv=None):
    """CLI: validate the committed samples (all four, or the tags named)."""
    argv = list(sys.argv[1:] if argv is None else argv)
    reports = os.path.join(HERE, "..", "..", "examples", "reports")
    tags = argv or list(TAGS)
    bad = 0
    for tag in tags:
        if tag.startswith("-"):
            print("usage: python -m llm_telemetry.schema_check [tag ...]", file=sys.stderr)
            return 2
        path = os.path.join(reports, "%s-data.json" % tag)
        try:
            with open(path, encoding="utf-8") as fh:
                payload = json.load(fh)
            check(tag, payload)
        except (OSError, ValueError) as exc:
            print("FAIL %-10s %s" % (tag, exc))
            bad += 1
        else:
            print("OK   %-10s %s" % (tag, os.path.realpath(path)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
