#!/usr/bin/env python3
"""T-19 (LLMTELEMET-290) response oracle.

Drives the REAL `src/llm_telemetry/serve.py` handler methods with a fake
socket/headers/rfile and fake clock, PID probe and child starter, then prints
the captured status + JSON body for the TypeScript parity harness.

Everything is scoped to temp directories supplied by the harness: no real
config, no build process, no network and no production service is touched.
"""

import contextlib
import io
import json
import os
import stat
import sys
from unittest import mock


def main() -> None:
    src, spec_path = sys.argv[1:3]
    sys.path.insert(0, src)
    from llm_telemetry import serve as S  # noqa: E402

    with open(spec_path, encoding="utf-8") as fh:
        spec = json.load(fh)

    for key in ("LLM_TELEMETRY_CONFIG", "XDG_CONFIG_HOME", "HOME"):
        os.environ.pop(key, None)
    os.environ.update(spec.get("env", {}))
    # time.time() is a float in the real handler; JSON fixtures may use ints.
    spec["now"] = float(spec["now"])
    refresh = spec.get("refresh", {
        "pid": None, "started": 0, "last_result": None, "last_at": None,
    })
    for key in ("started", "last_at"):
        if refresh[key] is not None:
            refresh[key] = float(refresh[key])
    S.DIRECTORY = spec["reportsDir"]
    S._REFRESH.clear()
    S._REFRESH.update(refresh)

    class FakeHeaders(dict):
        def get(self, key, default=None):
            for k, v in self.items():
                if k.lower() == str(key).lower():
                    return v
            return default

    class FakePopen:
        def __init__(self, cmd, **kwargs):
            spawn_calls.append(cmd)
            if spec.get("spawnError"):
                raise OSError(spec["spawnError"])
            self.pid = spec.get("spawnPid", 4242)

    def fake_kill(pid, sig):
        if pid in spec.get("alivePids", []) and sig == 0:
            return None
        raise OSError("no such process")

    spawn_calls: list[list[str]] = []
    captured: dict = {}

    class FakeHandler:
        def _json(self, code, obj):
            captured["status"] = code
            captured["body"] = obj

    handler = object.__new__(S.NoCacheHandler)
    handler._json = FakeHandler()._json
    handler.client_address = (spec["peer"], 54321)
    handler.headers = FakeHeaders(spec.get("headers", {}))
    handler.rfile = io.BytesIO(spec.get("body", "").encode("utf-8"))
    handler.path = spec.get("path", "/api/settings")

    with mock.patch("time.time", lambda: spec["now"]), \
            mock.patch("os.kill", fake_kill), \
            mock.patch("subprocess.Popen", FakePopen), \
            contextlib.redirect_stderr(io.StringIO()):
        route = spec["route"]
        if route == "settings_get":
            S.NoCacheHandler.do_GET(handler)
        elif route == "settings_post":
            S.NoCacheHandler.do_POST(handler)
        elif route == "refresh_post":
            S.NoCacheHandler._refresh(handler)
        else:
            raise ValueError(f"unknown route: {route}")

    cfg = S.config_path()
    extra = {
        "config_path": cfg,
        "spawn_calls": spawn_calls,
        "mode": stat.S_IMODE(os.stat(cfg).st_mode) if os.path.exists(cfg) else None,
        "raw": open(cfg, encoding="utf-8").read() if os.path.exists(cfg) else None,
        "refresh": dict(S._REFRESH),
    }
    sys.stdout.write(json.dumps({"status": captured["status"],
                                 "body": captured["body"],
                                 "raw": json.dumps(captured["body"]),
                                 "extra": extra}))


if __name__ == "__main__":
    main()
