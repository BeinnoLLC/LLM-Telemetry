#!/usr/bin/env python3
"""Python-side producer for the Ollama probe parity case (T-16, LLMTELEMET-287).

Usage: produce_probe.py INPUTS_DIR OUT_DIR ARTIFACT

Runs the REAL `llm_telemetry.probe_hosts.main()` with only its machine/network
seams replaced by the canned answers in INPUTS_DIR/probe-canned.json: `get`
(HTTP), `subprocess.run` (the curl|jq capability lookup), `local_ips`,
`_primary_ips` and `machine_load`. Discovery, grouping, labelling, loopback-twin
collapse, usage SQL, the capabilities cache and the schema check are all the
real Python code.
"""
import json
import os
import subprocess
import sys
import types
import urllib.error


class _Ordered(set):
    """A set that iterates in the canned order (a real set's order is hash-random)."""

    def __init__(self, items):
        super().__init__(items)
        self._order = list(items)

    def __iter__(self):
        return iter(self._order)


def main(argv):
    if len(argv) != 3:
        sys.stderr.write("usage: produce_probe.py INPUTS_DIR OUT_DIR ARTIFACT\n")
        return 2
    inputs, out_dir, artifact = (os.path.abspath(argv[0]), argv[1], argv[2])
    os.environ["HOME"] = os.path.join(inputs, "home")
    os.environ["LLM_TELEMETRY_CONFIG"] = os.path.join(inputs, "config.json")
    os.environ["LLM_TELEMETRY_AGENT_HOME"] = os.path.join(inputs, "agent")
    with open(os.path.join(inputs, "probe-canned.json"), encoding="utf-8") as fh:
        canned = json.load(fh)
    now = os.environ.get("LLM_TELEMETRY_PARITY_NOW")
    if now:
        import time
        fixed = float(now)
        time.time = lambda: fixed
    from llm_telemetry import probe_hosts as P

    def fake_get(url, timeout=6):
        r = canned["responses"].get(url)
        if r is None:
            raise urllib.error.URLError("no canned response")
        if "error" in r:
            e = r["error"]
            if e["url_error"]:
                raise urllib.error.URLError(e["reason"])
            raise Exception(e["reason"])
        return r["body"], r["ms"]

    def fake_run(args, **kw):
        if args[0] == "curl":
            model = json.loads(args[-1])["model"]
            caps = canned["caps"].get(model)
            out = json.dumps({"capabilities": caps}) if caps is not None else ""
        elif args[0] == "jq":
            raw = kw.get("input") or ""
            out = json.dumps(json.loads(raw).get("capabilities") or []) if raw else ""
        else:
            raise FileNotFoundError(args[0])
        return types.SimpleNamespace(stdout=out, returncode=0)

    P.get = fake_get
    P.subprocess.run = fake_run
    P.local_ips = lambda: _Ordered(canned["local_ips"])
    P._primary_ips = lambda: list(canned["primary_ips"])
    P.machine_load = lambda: dict(canned["load"])
    os.makedirs(out_dir, exist_ok=True)
    target = os.path.join(out_dir, artifact)
    P.OUT = target
    P.CAPS_CACHE = os.path.join(out_dir, ".ollama-caps.json")
    P.main()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
