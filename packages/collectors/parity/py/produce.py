#!/usr/bin/env python3
"""Python-side fixture producer for the parity harness (T-5, LLMTELEMET-284).

Runs the fixture through the real Python write-path pieces, read-only:
``llm_telemetry.schema.stamp()`` (shared schema_version), the write-time
``llm_telemetry.schema_check.check()`` gate, and the collectors' atomic-write
and JSON-serialization convention (``<path>.tmp`` + ``os.replace``,
``json.dump(..., separators=(",", ":"), default=str)`` — see collect_live.py's
``__main__``). Imports only; this script never modifies the Python tree.

Usage: produce.py FIXTURE OUT_DIR ARTIFACT TAG
    TAG = schema tag (analytics|live|ollama|router) or "-" for none.
"""

import json
import os
import sys

from llm_telemetry.schema import stamp
from llm_telemetry.schema_check import check


def main(argv):
    if len(argv) != 4:
        sys.stderr.write("usage: produce.py FIXTURE OUT_DIR ARTIFACT TAG\n")
        return 2
    fixture, out_dir, artifact, tag = argv
    with open(fixture, encoding="utf-8") as fh:
        payload = json.load(fh)
    if not isinstance(payload, dict):
        sys.stderr.write("produce.py: fixture root must be a JSON object\n")
        return 1
    stamp(payload)
    if tag != "-":
        check(tag, payload)
    os.makedirs(out_dir, exist_ok=True)
    target = os.path.join(out_dir, artifact)
    tmp = target + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"), default=str)
    os.replace(tmp, target)
    sys.stdout.write(target + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
