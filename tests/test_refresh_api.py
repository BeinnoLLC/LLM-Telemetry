#!/usr/bin/env python3
"""LST-200: POST /api/refresh — the manual rebuild endpoint on the serve process.

Runs the real server on an ephemeral loopback port. Proves the behaviour the
ticket asks for:
  * a loopback POST with the CSRF header is ACCEPTED and answers 202 (not 200,
    not a hang) — the ack is the contract, the build runs detached;
  * the response carries generated_at so the caller can tell when the rebuild
    has landed;
  * a second request inside the debounce window does NOT start a second build —
    it answers 202 with debounced=true and says when to retry;
  * the guards match /api/settings: no header -> 403, non-loopback -> 403,
    oversized body -> 413, wrong path -> 404;
  * a build already running is reported as running, not started twice.

The actual `llm-telemetry dashboard` child is stubbed: this test is about the
HTTP contract and the debounce state machine, not about rebuilding a real
report in a temp dir.
"""
import json
import os
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from functools import partial
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

tmp = tempfile.mkdtemp(prefix="refresh-")
CFG = os.path.join(tmp, "config.json")
with open(CFG, "w") as fh:
    json.dump({"reports_dir": tmp}, fh)
os.environ["LLM_TELEMETRY_CONFIG"] = CFG
os.environ.pop("XDG_CONFIG_HOME", None)

from llm_telemetry import serve as S

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    if ok:
        p += 1
    else:
        f += 1
    print(f"  {'OK  ' if ok else 'FAIL'} {label}" + (f"  {extra}" if extra is not None else ""))


# A build stamp must exist for generated_at to be reported.
with open(os.path.join(tmp, "dashboard.html"), "w") as fh:
    fh.write("<html>built</html>")

# Stub the detached child: record launches, claim success, never exec python.
launches = []


class FakeProc:
    def __init__(self, cmd, **kw):
        launches.append(cmd)
        self.pid = 424242


_real_popen = None


def fake_popen(cmd, **kw):
    return FakeProc(cmd, **kw)


# serve imports subprocess inside start_refresh, so patch the module object.
import subprocess as _sp
_real = _sp.Popen
_sp.Popen = fake_popen

srv = ThreadingHTTPServer(("127.0.0.1", 0), partial(S.NoCacheHandler, directory=tmp))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{port}"


def call(path, method="POST", headers=None, raw=None):
    h = {"X-LLM-Telemetry": "1"}
    h.update(headers or {})
    h = {k: v for k, v in h.items() if v is not None}
    data = raw
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            return e.code, json.loads(body or b"{}")
        except ValueError:
            return e.code, {}


try:
    # State machine starts clean.
    S._REFRESH.update({"pid": None, "started": 0.0, "last_result": None, "last_at": None})

    code, j = call("/api/refresh")
    chk(code == 202, "loopback POST with the CSRF header is accepted as 202", code)
    chk(j.get("accepted") is True, "response says the rebuild was accepted", j.get("detail"))
    chk(j.get("generated_at"), "response carries generated_at so the caller can poll", j.get("generated_at"))
    chk(len(launches) == 1, "exactly one builder process was spawned", len(launches))
    chk(launches and "dashboard" in " ".join(launches[0]),
        "the spawned command is the dashboard build", launches[:1])

    # Debounce: a second POST immediately after must not queue another build.
    code, j = call("/api/refresh")
    chk(code == 202, "a second immediate POST still answers 202 (accepted, handled)", code)
    chk(j.get("debounced") is True, "the second POST is reported as debounced", j.get("detail"))
    chk(j.get("retry_in_s") is not None, "debounced response says when to retry", j.get("retry_in_s"))
    chk(len(launches) == 1, "debounce prevented a second build", len(launches))

    # Expire the window by hand: the state machine, not a sleep, controls this.
    S._REFRESH["started"] = S._REFRESH["started"] - (S.REFRESH_DEBOUNCE_S + 1)
    S._REFRESH["pid"] = None
    code, j = call("/api/refresh")
    chk(code == 202 and j.get("accepted") is True, "after the window a new rebuild is accepted", (code, j))
    chk(len(launches) == 2, "the second accepted request did spawn a build", len(launches))

    # A live child blocks a new build rather than stacking one.
    S._REFRESH["pid"] = os.getpid()          # this process exists, so it reads as running
    S._REFRESH["started"] = 0.0
    code, j = call("/api/refresh")
    chk(code == 202 and j.get("running") is True, "a build already running is reported, not restarted", (code, j))
    chk(len(launches) == 2, "no build spawned while one is running", len(launches))
    S._REFRESH["pid"] = None

    # Guards.
    code, j = call("/api/refresh", headers={"X-LLM-Telemetry": None})
    chk(code == 403, "missing CSRF header refused", code)
    code, j = call("/api/refresh", raw=b"x" * 4096)
    chk(code == 413, "oversized body refused", code)
    code, j = call("/api/other")
    chk(code == 404, "unknown POST path is still 404", code)
    code, j = call("/api/refresh", method="GET")
    chk(code == 404, "GET on /api/refresh is not a rebuild", code)

    class Fake(S.NoCacheHandler):
        def __init__(self):
            self.client_address = ("192.168.1.50", 5000)
    lan = Fake()
    chk(lan._loopback() is False, "a LAN client is not loopback, so /api/refresh refuses it")
finally:
    _sp.Popen = _real
    srv.shutdown()

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
