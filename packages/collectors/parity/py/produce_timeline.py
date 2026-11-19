#!/usr/bin/env python3
"""Python-side producer for the session-timeline parity case (T-16, LLMTELEMET-287).

Usage: produce_timeline.py INPUTS_DIR OUT_DIR ARTIFACT

The real collector writes one file per session (`sessions/<profile>/<id>.json`),
which a one-artifact harness cannot diff. This runs the REAL
`collect_session_timeline.build_all()` and writes the merged view
`{profiles: {<profile>: {<session id>: <stamped timeline>}}}`; the Node side
produces the same merged view from its own `buildAll()`. The per-file layout is
checked separately in the vitest suite.
"""
import json
import os
import sys


def main(argv):
    if len(argv) != 3:
        sys.stderr.write("usage: produce_timeline.py INPUTS_DIR OUT_DIR ARTIFACT\n")
        return 2
    inputs, out_dir, artifact = (os.path.abspath(argv[0]), argv[1], argv[2])
    os.environ["HOME"] = os.path.join(inputs, "home")
    os.environ["LLM_TELEMETRY_CONFIG"] = os.path.join(inputs, "config.json")
    os.environ["LLM_TELEMETRY_AGENT_HOME"] = os.path.join(inputs, "agent")
    now = os.environ.get("LLM_TELEMETRY_PARITY_NOW")
    if now:
        import time
        fixed = float(now)
        time.time = lambda: fixed
    from llm_telemetry import collect_session_timeline
    from llm_telemetry.schema import stamp
    all_data = collect_session_timeline.build_all()
    for sessions in all_data.values():
        for t in sessions.values():
            stamp(t)
    data = stamp({"profiles": all_data})
    os.makedirs(out_dir, exist_ok=True)
    target = os.path.join(out_dir, artifact)
    tmp = target + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"), default=str)
    os.replace(tmp, target)
    sys.stdout.write(target + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
