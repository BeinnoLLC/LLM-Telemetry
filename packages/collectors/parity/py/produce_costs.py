#!/usr/bin/env python3
"""Python-side producer for the costs parity case (T-17, LLMTELEMET-288).

Usage: produce_costs.py INPUTS_DIR OUT_DIR ARTIFACT

Points HOME, LLM_TELEMETRY_CONFIG, LLM_TELEMETRY_CATALOG and
LLM_TELEMETRY_AGENT_HOME at the generated inputs, sets NO_COLLECT so the real
build() reads the fixed analytics-data.json instead of running a collector,
then calls llm_telemetry.build_costs.build() and writes the artifact with the
same atomic-write/serialization convention as produce_analytics.py.
"""
import json
import os
import sys


def main(argv):
    if len(argv) != 3:
        sys.stderr.write("usage: produce_costs.py INPUTS_DIR OUT_DIR ARTIFACT\n")
        return 2
    inputs, out_dir, artifact = (os.path.abspath(argv[0]), argv[1], argv[2])
    os.environ["HOME"] = os.path.join(inputs, "home")
    os.environ["LLM_TELEMETRY_CONFIG"] = os.path.join(inputs, "config.json")
    os.environ["LLM_TELEMETRY_CATALOG"] = os.path.join(inputs, "catalog.json")
    os.environ["LLM_TELEMETRY_AGENT_HOME"] = os.path.join(inputs, "agent")
    os.environ["LLM_TELEMETRY_NO_COLLECT"] = "1"
    from llm_telemetry import build_costs

    data = build_costs.build()
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
