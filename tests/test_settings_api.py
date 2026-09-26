#!/usr/bin/env python3
"""Settings write-through (P7-03, #67): POST /api/settings on the serve process.

Runs the real server on an ephemeral loopback port against a temporary config
file, never the developer's real one. Proves:
  * a save lands in the config file the collectors read, and the collector
    path (energy.tariff via config.load) sees the new value;
  * other keys in the file survive a save;
  * bad input is refused with a reason (unknown key, non-number, out of range,
    wrong content type, missing CSRF header);
  * a non-loopback client cannot write (checked at the handler level).
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

tmp = tempfile.mkdtemp(prefix="settings-")
CFG = os.path.join(tmp, "config.json")
with open(CFG, "w") as fh:
    json.dump({"reports_dir": tmp, "endpoint_aliases": {"a.example": "10.0.0.1:1"},
               "electricity_rate_kwh": 0.047}, fh)
os.environ["LLM_TELEMETRY_CONFIG"] = CFG
os.environ.pop("XDG_CONFIG_HOME", None)

from llm_telemetry import serve as S      # noqa: E402
from llm_telemetry import config as C     # noqa: E402
from llm_telemetry import energy as E     # noqa: E402

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    if ok:
        p += 1
    else:
        f += 1
    print(f"  {'OK  ' if ok else 'FAIL'} {label}" + (f"  {extra}" if extra is not None else ""))


srv = ThreadingHTTPServer(("127.0.0.1", 0), partial(S.NoCacheHandler, directory=tmp))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{port}/api/settings"


def call(method, body=None, headers=None, raw=None):
    h = {"Content-Type": "application/json", "X-LLM-Telemetry": "1"}
    h.update(headers or {})
    h = {k: v for k, v in h.items() if v is not None}
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BASE, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


try:
    code, j = call("GET")
    chk(code == 200 and j["values"]["electricity_rate_kwh"] == 0.047, "GET reports the configured tariff", j.get("values"))
    chk(j.get("writable") is True, "loopback client is told it may write")
    chk(not j.get("config_file", "").startswith(os.path.expanduser("~") + os.sep),
        "GET never returns an absolute home path", j.get("config_file"))

    code, j = call("POST", {"electricity_rate_kwh": 0.12, "gpu_draw_watts": 400})
    chk(code == 200, "valid save accepted", (code, j.get("error")))
    on_disk = json.load(open(CFG))
    chk(on_disk.get("electricity_rate_kwh") == 0.12 and on_disk.get("gpu_draw_watts") == 400,
        "save lands in the config file the collectors read", {k: on_disk.get(k) for k in S.SETTINGS})
    chk(on_disk.get("endpoint_aliases") == {"a.example": "10.0.0.1:1"} and on_disk.get("reports_dir") == tmp,
        "other keys in the file survive the save")
    kwh, gw, hw = E.tariff(C.load(CFG))
    chk((kwh, gw, hw) == (0.12, 400.0, 90.0), "the collectors' power model sees the saved values", (kwh, gw, hw))
    chk(j.get("values", {}).get("electricity_rate_kwh") == 0.12, "response echoes the values now in effect")

    before = open(CFG).read()
    for body, label in (
        ({"currency": "EUR"}, "unknown key refused"),
        ({"electricity_rate_kwh": "0.1"}, "string number refused"),
        ({"electricity_rate_kwh": True}, "boolean refused"),
        ({"electricity_rate_kwh": 0}, "zero tariff refused (typo guard)"),
        ({"gpu_draw_watts": 100000}, "absurd wattage refused"),
        ({}, "empty body refused"),
    ):
        code, j = call("POST", body)
        chk(code == 400 and j.get("error"), label, (code, j.get("error")))
    code, j = call("POST", raw=b"{not json")
    chk(code == 400, "malformed JSON refused", code)
    code, j = call("POST", {"electricity_rate_kwh": 0.2}, headers={"X-LLM-Telemetry": None})
    chk(code == 403, "missing CSRF header refused", code)
    code, j = call("POST", {"electricity_rate_kwh": 0.2}, headers={"Content-Type": "text/plain"})
    chk(code == 415, "non-JSON content type refused (a plain form post cannot write)", code)
    code, _ = call("OPTIONS")
    chk(code == 405, "cross-origin preflight is never approved", code)
    chk(open(CFG).read() == before, "no refused request changed the file")

    # Non-loopback client: exercise the handler's guard directly.
    class Fake(S.NoCacheHandler):
        def __init__(self):  # no socket; only the guard is under test
            self.client_address = ("192.168.1.50", 5000)
    lan = Fake()
    chk(lan._loopback() is False, "a LAN client is not loopback")
    lan.client_address = ("127.0.0.1", 1)
    chk(lan._loopback() is True, "127.0.0.1 is loopback")
    lan.client_address = ("::1", 1, 0, 0)
    chk(lan._loopback() is True, "::1 is loopback")

    # End to end: a LAN client's POST is refused and the file is untouched.
    import io
    class LanPost(S.NoCacheHandler):
        def __init__(self, body):
            self.client_address = ("192.168.1.50", 5000)
            self.path = "/api/settings"
            self.headers = {"X-LLM-Telemetry": "1", "Content-Type": "application/json",
                            "Content-Length": str(len(body))}
            self.rfile = io.BytesIO(body)
            self.sent = None
        def _json(self, code, obj):
            self.sent = (code, obj)
    before = open(CFG).read()
    h = LanPost(json.dumps({"electricity_rate_kwh": 0.5}).encode())
    h.do_POST()
    chk(h.sent and h.sent[0] == 403, "a LAN client's save is refused", h.sent)
    chk(open(CFG).read() == before, "a LAN client cannot change the config file")
finally:
    srv.shutdown()

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
