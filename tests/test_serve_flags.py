#!/usr/bin/env python3
"""`serve` flags: --port/--bind/--dir/--open, defaults untouched (#147).

The server was hard-wired to port 8477 on 0.0.0.0, so a second instance, a
container behind a proxy, or a test that just needs a free port had no way in.
Flags fix that — but only if the *defaults* stay exactly where they were, or the
installed systemd unit and the README quietly start lying.

Nothing here binds a socket: parse_args/resolve/url_for are pure, which is what
keeping them separate from main() buys.
"""
import inspect
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

tmp = tempfile.mkdtemp(prefix="serve-flags-")
CFG = os.path.join(tmp, "config.json")
with open(CFG, "w") as fh:
    # A distinct port and bind, so a passing default proves it came from config.
    json.dump({"reports_dir": tmp, "port": 1234, "bind": "127.0.0.1"}, fh)
os.environ["LLM_TELEMETRY_CONFIG"] = CFG

from llm_telemetry import serve as S      # noqa: E402
from llm_telemetry import config as C     # noqa: E402

cfg = C.get()
extra = tempfile.mkdtemp(prefix="serve-dir-")

p = f = 0


def chk(ok, label, extra_note=None):
    global p, f
    if ok:
        p += 1
        print(f"  OK   {label}")
    else:
        f += 1
        print(f"  FAIL {label}" + (f"  ({extra_note})" if extra_note else ""))


def fails(argv):
    """argparse errors exit(2); resolve errors exit(1) via SystemExit."""
    try:
        S.resolve(S.parse_args(argv), cfg)
        return None
    except SystemExit as exc:
        return exc.code


# Defaults: no flags means yesterday's behaviour, read from config.
a = S.parse_args([])
chk(a.port is None and a.bind is None and a.dir is None and a.open_browser is False,
    "no flags leaves every override unset")
chk(S.resolve(a, cfg) == (1234, "127.0.0.1", tmp),
    "defaults come from config (port, bind) and the reports dir",
    S.resolve(a, cfg))

# Each flag on its own.
chk(S.resolve(S.parse_args(["--port", "9000"]), cfg)[0] == 9000, "--port sets the port")
chk(S.resolve(S.parse_args(["--bind", "127.0.0.2"]), cfg)[1] == "127.0.0.2", "--bind sets the bind")
chk(S.resolve(S.parse_args(["--dir", extra]), cfg)[2] == extra, "--dir sets the directory")
chk(S.parse_args(["--open"]).open_browser is True, "--open is recorded")
chk(S.parse_args([]).open_browser is False, "--open defaults to off")

# --port 0 must survive: it is a request for an ephemeral port, not "unset".
chk(S.resolve(S.parse_args(["--port", "0"]), cfg)[0] == 0,
    "--port 0 reaches the socket layer instead of being replaced by the default")

# The positional form predates the flags; scripts use it, so it still works.
chk(S.resolve(S.parse_args(["9100"]), cfg)[0] == 9100, "positional port still works")
chk(S.resolve(S.parse_args(["9100", "--bind", "::1"]), cfg) == (9100, "::1", tmp),
    "positional port combines with flags")

# Bad input fails loudly rather than silently serving the wrong thing.
chk(fails(["--port", "1", "2"]) == 2, "conflicting ports are refused")
chk(fails(["--port", "70000"]) == 2, "an out-of-range port is refused")
missing = fails(["--dir", os.path.join(tmp, "nope")])
chk(missing is not None and str(missing).endswith("nope"),
    "a missing directory is refused with its path", missing)
chk(S.resolve(S.parse_args(["--port", "0", "--dir", tmp]), cfg)[2] == tmp,
    "an explicit --dir that exists is accepted")

# The URL --open would use: loopback, never the wildcard.
chk(S.url_for("0.0.0.0", 8477) == "http://127.0.0.1:8477/dashboard.html",
    "a wildcard bind opens on loopback")
chk(S.url_for("::", 8477) == "http://[::1]:8477/dashboard.html",
    "an IPv6 wildcard bind opens on IPv6 loopback")
chk(S.url_for("", 8477) == "http://127.0.0.1:8477/dashboard.html", "an empty bind opens on loopback")
chk(S.url_for("192.168.1.9", 80) == "http://192.168.1.9:80/dashboard.html",
    "a specific bind is used as-is")

# Headless: --open must not pretend it worked.
chk(S.browser_available({"DISPLAY": ":0"}, "linux") is True, "X11 counts as a display")
chk(S.browser_available({"WAYLAND_DISPLAY": "wayland-0"}, "linux") is True, "Wayland counts")
chk(S.browser_available({}, "linux") is False, "a headless Linux box has no display")
chk(S.browser_available({}, "darwin") is True, "macOS is assumed to have one")

# The no-cache guarantee is the other reason this server exists; keep it.
src = inspect.getsource(S.NoCacheHandler.end_headers)
chk("no-store" in src and "no-cache" in src, "end_headers still sends no-store/no-cache")

# The installed unit passes no flags, so the defaults above are load-bearing.
unit = open(os.path.join(os.path.dirname(__file__), "..",
                         "systemd", "llm-telemetry-serve.service"), encoding="utf-8").read()
exec_line = next(l for l in unit.splitlines() if l.startswith("ExecStart="))
chk(exec_line.strip().endswith("llm-telemetry serve"),
    "the systemd unit still runs serve with no flags", exec_line.strip())
chk("--port" not in unit, "the unit does not pin a port, so config stays in charge")

# Self-checks: the pure helpers must be able to disagree with themselves.
chk(S.resolve(S.parse_args(["--port", "1"]), cfg)[0] != S.resolve(S.parse_args([]), cfg)[0],
    "an explicit port differs from the config default")
chk(S.url_for("0.0.0.0", 1) != S.url_for("10.0.0.1", 1), "wildcard and host URLs differ")

print()
print(f"{p} passed, {f} failed")
sys.exit(1 if f else 0)
