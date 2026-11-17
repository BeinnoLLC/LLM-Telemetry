#!/usr/bin/env python3
"""Python-side producer for the rankings parity case (T-16, LLMTELEMET-287).

Usage: produce_rankings.py INPUTS_DIR OUT_DIR ARTIFACT

Runs the REAL `llm_telemetry.collect_rankings.collect()` with an injected
fetcher that returns INPUTS_DIR/rankings-response.json (no network, a dummy
key, a pinned `today`), then the same atomic write as produce.py.
"""
import datetime
import json
import os
import sys

TODAY = datetime.date(2026, 11, 17)


def main(argv):
    if len(argv) != 3:
        sys.stderr.write("usage: produce_rankings.py INPUTS_DIR OUT_DIR ARTIFACT\n")
        return 2
    inputs, out_dir, artifact = (os.path.abspath(argv[0]), argv[1], argv[2])
    os.environ["HOME"] = os.path.join(inputs, "home")
    os.environ["LLM_TELEMETRY_CONFIG"] = os.path.join(inputs, "config.json")
    from llm_telemetry import collect_rankings

    def fetcher(start, end, key):
        with open(os.path.join(inputs, "rankings-response.json"), encoding="utf-8") as fh:
            return json.load(fh), None

    data = collect_rankings.collect(today=TODAY, env={"OPENROUTER_API_KEY": "dummy"},
                                    fetcher=fetcher, previous=None)
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
