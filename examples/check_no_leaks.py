#!/usr/bin/env python3
"""Fail if the committed sample payloads contain anything identifying.

This repo is public and examples/reports/ IS committed (so a fresh clone renders
a populated dashboard). That makes the sample the one place where real
telemetry could escape. A manual eyeball missed a LAN IP once already — in
`health[].last_msg`, a second copy of a failure string whose `msg` twin was
scrubbed. So the check runs in CI.

Usage: python3 examples/check_no_leaks.py
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPORTS = os.path.join(HERE, "reports")
REPO_ROOT = os.path.abspath(os.path.join(HERE, ".."))
# P1-03 (#25): golden fixtures are frozen copies of the same scrubbed sample
# payloads, committed for the same public repo — the leak gate must cover
# them with the exact same rules, not a separate weaker check.
GOLDEN = os.path.join(HERE, "..", "tests", "fixtures", "golden")

# Anything that identifies a real person, host or workspace.
# 127.0.0.1 is explicitly allowed: it is a synthetic dead endpoint used to
# demonstrate the failure panel, not a real host on anyone's network.
# 127.0.0.1 / 0.0.0.0 are allowed: they are loopback + bind-any, not anyone's
# real host. Matching them is the job of an explicit allowlist, not a lookbehind
# (`(?<!127\.0\.0\.)` fails on "127.0.0.1" itself — the prefix is the match).
ALLOWED_IPS = {"127.0.0.1", "0.0.0.0", "255.255.255.255", "8.8.8.8"}
# Real dotted quads only: every octet 0-255, and not a slice of a longer run of
# dotted numbers. Inlined SVG path data (the Router tab's provider logos, #130)
# is full of "2.774.868.86"-style coordinate runs that the old \d{1,3} pattern
# reported as addresses. A genuine LAN IP such as 10.0.0.5 or 192.168.1.11
# still matches, including at the end of a sentence ("... at 10.0.0.5.").
_OCT = r"(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)"
IP_RE = re.compile(rf"(?<![\d.])(?:{_OCT}\.){{3}}{_OCT}(?!\d|\.\d)")

PATTERNS = [
    (r"llmstudio", "internal hostname"),
    (r"hazemhagrass", "author username"),
    (r"\bBeinno\b", "real profile name"),
    (r"\bPixelVent\b", "real profile name"),
    (r"sk-[A-Za-z0-9_-]{16,}", "API key"),
    (r"gh[pousr]_[A-Za-z0-9]{20,}", "GitHub token"),
    (r"Bearer\s+[A-Za-z0-9._-]{20,}", "bearer token"),
]


def bad_ips(text):
    """IPs in the text that are not in the allowlist."""
    return [ip for ip in IP_RE.findall(text) if ip not in ALLOWED_IPS]


def walk(o, path=""):
    if isinstance(o, dict):
        for k, v in o.items():
            yield from walk(v, f"{path}.{k}")
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from walk(v, f"{path}[{i}]")
    elif isinstance(o, str):
        yield path, o


def scan_dir(scan_dir, findings):
    for fn in sorted(os.listdir(scan_dir)):
        full = os.path.join(scan_dir, fn)
        # Only files git would actually publish. examples/reports/ also holds
        # gitignored local artifacts — pricing-cache.json is the real fetched
        # OpenRouter catalogue, not a sample — and this gate's whole job is to
        # protect the PUBLIC repo. Scanning an untracked file both cannot leak
        # anything and produced a false "missing sample marker" failure locally
        # that CI never sees (CI has no cache file). Content rules still apply to
        # any tracked file, so a committed payload that loses its marker is still
        # caught.
        if subprocess.run(["git", "ls-files", "--error-unmatch", os.path.relpath(full, REPO_ROOT)],
                          cwd=REPO_ROOT, capture_output=True).returncode != 0:
            continue
        if fn.endswith(".json"):
            with open(full) as f:
                try:
                    doc = json.load(f)
                except json.JSONDecodeError as e:
                    findings.append((fn, "-", f"invalid JSON: {e}"))
                    continue
            # A sample payload must SAY it is one, or a real payload could be
            # committed by accident and look identical to a reviewer.
            if not doc.get("sample"):
                findings.append((fn, "$.sample", "missing `sample: true` marker"))
            for path, val in walk(doc):
                for pat, label in PATTERNS:
                    if re.search(pat, val):
                        findings.append((fn, path, f"{label}: {val[:80]}"))
                for ip in bad_ips(val):
                    findings.append((fn, path, f"private/LAN IP address: {ip}"))
        elif fn.endswith(".html"):
            text = open(full, errors="replace").read()
            for pat, label in PATTERNS:
                m = re.search(pat, text)
                if m:
                    findings.append((fn, "-", f"{label}: {m.group(0)[:80]}"))
            for ip in sorted(set(bad_ips(text))):
                findings.append((fn, "-", f"private/LAN IP address: {ip}"))


def main():
    if not os.path.isdir(REPORTS):
        print("no examples/reports/ — nothing to check")
        return 0

    findings = []
    scan_dir(REPORTS, findings)
    if os.path.isdir(GOLDEN):
        scan_dir(GOLDEN, findings)

    if findings:
        print(f"LEAK CHECK FAILED — {len(findings)} finding(s):\n")
        for fn, path, msg in findings[:40]:
            print(f"  {fn}  {path}\n      {msg}")
        return 1

    print("leak check passed — sample payloads carry nothing identifying")
    return 0


if __name__ == "__main__":
    sys.exit(main())
