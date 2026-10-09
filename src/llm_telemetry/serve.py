#!/usr/bin/env python3
"""Static server for the analytics reports, with caching disabled.

Python's stock http.server sends only Last-Modified, so browsers happily serve a
stale dashboard.html from disk cache after a rebuild — which looks exactly like
"the feature was never shipped". Explicit no-store headers make every reload
fetch the current build.

Settings write-through (P7-03, #67)
-----------------------------------
The dashboard is static files, so the Settings page has no backend of its own.
This server adds exactly one write endpoint, ``POST /api/settings``, which
merges the power-model keys into the config file the collectors read. It is
deliberately narrow:

* loopback clients only -- the server binds 0.0.0.0 so the LAN can *view* the
  dashboard, but only this machine may change its config;
* a custom request header is required, which forces a CORS preflight this
  server never approves, so another site open in the browser cannot post here;
* only whitelisted numeric keys, range-checked; every other key in the file is
  preserved;
* the write is atomic (temp file + rename), so a crash never leaves half a
  config behind.

``GET /api/settings`` returns the values in effect and where they live, so the
page shows what is really configured rather than what it was built with.

Flags (P14, #147)
-----------------
``--port``/``--bind``/``--dir``/``--open``, with defaults unchanged (config
``port`` 8477, ``bind`` 0.0.0.0, the reports dir) so the systemd unit and the
README keep working. The positional port form (``serve 9000``) is still
accepted: it was the only way to move the server before this and scripts exist
that use it. ``--port 0`` asks the OS for a free port and prints it -- the only
way to run the server twice in a test without picking a number yourself.
"""
import argparse
import ipaddress
import json
import os
import sys
import tempfile
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from . import config as C

DIRECTORY = str(C.get().reports_dir)

# key -> (min, max). Sanity rails, not opinions: a tariff of 0 or a 100 kW GPU
# is a typo, and a typo here silently rewrites every local cost.
SETTINGS = {
    "electricity_rate_kwh": (0.0001, 10.0),
    "gpu_draw_watts": (1.0, 5000.0),
    "host_overhead_watts": (0.0, 5000.0),
    # P7-05 (#112): refresh intervals. Seconds, validated min/max so a typo
    # (e.g. "5" meant as minutes) can't hammer the collector or a live poll
    # into a busy-loop; the live poll's own floor (1s) still leaves plenty
    # of headroom below the analytics rebuild's own ~1min cadence.
    "live_poll_interval_s": (1.0, 60.0),
    "analytics_rebuild_interval_s": (10.0, 600.0),
}
HEADER = "X-LLM-Telemetry"


def config_path():
    """The config file the collectors read: the first existing candidate, else
    the user default location (created on first save)."""
    cands = C._candidate_paths()
    for p in cands:
        if os.path.exists(p):
            return p
    return cands[-1]


def _tilde(p):
    home = os.path.expanduser("~")
    return "~" + p[len(home):] if p.startswith(home + os.sep) else p


def validate(body):
    """-> (clean dict, error or None). Unknown keys are an error, not ignored:
    a silently dropped field reads as 'saved' when it was not."""
    if not isinstance(body, dict) or not body:
        return None, "expected a JSON object"
    unknown = sorted(set(body) - set(SETTINGS))
    if unknown:
        return None, "unknown setting(s): " + ", ".join(unknown)
    out = {}
    for k, v in body.items():
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            return None, f"{k} must be a number"
        lo, hi = SETTINGS[k]
        if not (lo <= float(v) <= hi):
            return None, f"{k} must be between {lo:g} and {hi:g}"
        out[k] = float(v)
    return out, None


def save(clean, path=None):
    """Merge `clean` into the config file atomically; returns the path."""
    path = path or config_path()
    raw = {}
    if os.path.exists(path):
        with open(path) as fh:
            raw = json.load(fh)
        if not isinstance(raw, dict):
            raise ValueError("config file is not a JSON object")
    raw.update(clean)
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".config-", suffix=".json")
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(raw, fh, indent=2)
            fh.write("\n")
        if os.path.exists(path):
            os.chmod(tmp, os.stat(path).st_mode & 0o777)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    return path


def current(path=None):
    """Power-model values in effect, read fresh from disk (not the cache)."""
    cfg = C.load(path)
    return {k: float(getattr(cfg, k)) for k in SETTINGS}


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # the journal does not need a line per poll

    def _json(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _loopback(self):
        try:
            return ipaddress.ip_address(self.client_address[0]).is_loopback
        except ValueError:
            return False

    def do_GET(self):
        if self.path.split("?")[0] == "/api/settings":
            return self._json(200, {"values": current(),
                                    "config_file": _tilde(config_path()),
                                    "writable": self._loopback()})
        return super().do_GET()

    def do_POST(self):
        if self.path.split("?")[0] != "/api/settings":
            return self._json(404, {"error": "not found"})
        if not self._loopback():
            return self._json(403, {"error": "settings can only be changed from this machine"})
        if self.headers.get(HEADER) != "1":
            return self._json(403, {"error": f"missing {HEADER} header"})
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            return self._json(415, {"error": "expected application/json"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n > 4096:
            return self._json(413, {"error": "body too large"})
        try:
            body = json.loads(self.rfile.read(n) or b"null")
        except ValueError:
            return self._json(400, {"error": "body is not valid JSON"})
        clean, err = validate(body)
        if err:
            return self._json(400, {"error": err})
        try:
            path = save(clean)
        except (OSError, ValueError) as e:
            return self._json(500, {"error": f"could not write config: {e}"})
        return self._json(200, {"saved": clean, "config_file": _tilde(path),
                                "values": current()})

    def do_OPTIONS(self):
        # Never approve a cross-origin preflight: that is what keeps the
        # custom-header requirement an effective CSRF guard.
        self.send_response(405)
        self.end_headers()


def parse_args(argv):
    """Flag parsing, separated from binding so it can be tested in isolation.

    `--port 0` is honoured as the OS's ephemeral-port request, which is why the
    default is None rather than the config value: 0 and "unset" must not look
    the same.
    """
    ap = argparse.ArgumentParser(
        prog="llm-telemetry serve",
        description="Serve the report directory with caching disabled.")
    ap.add_argument("port_pos", nargs="?", type=int, metavar="PORT",
                    help="port to listen on (same as --port; kept for scripts)")
    ap.add_argument("--port", type=int, default=None,
                    help=f"port to listen on, 0 for a free one (default: config, {C.get().port})")
    ap.add_argument("--bind", default=None,
                    help=f"address to bind (default: config, {C.get().bind})")
    ap.add_argument("--dir", default=None, metavar="PATH",
                    help=f"directory to serve (default: config reports dir, {DIRECTORY})")
    ap.add_argument("--open", action="store_true", dest="open_browser",
                    help="open the dashboard in a browser once listening")
    args = ap.parse_args(argv)

    if args.port_pos is not None and args.port is not None and args.port_pos != args.port:
        ap.error(f"port given twice with different values: {args.port_pos} and {args.port}")
    args.port = args.port if args.port is not None else args.port_pos
    if args.port is not None and not 0 <= args.port <= 65535:
        ap.error(f"port must be between 0 and 65535, got {args.port}")
    return args


def resolve(args, cfg=None):
    """(port, bind, directory) with config defaults filled in."""
    cfg = cfg or C.get()
    directory = args.dir or DIRECTORY
    if not os.path.isdir(directory):
        raise SystemExit(f"serve: not a directory to serve: {directory}")
    return (cfg.port if args.port is None else args.port,
            args.bind or cfg.bind,
            directory)


def url_for(bind, port):
    """The URL a browser can actually use for a given bind address.

    A server bound to 0.0.0.0 or :: is reachable on loopback; browsers do not
    reliably treat the wildcard as a host, so the URL names loopback instead.
    """
    host = "127.0.0.1" if bind in ("", "0.0.0.0") else ("::1" if bind == "::" else bind)
    if ":" in host:
        host = f"[{host}]"
    return f"http://{host}:{port}/dashboard.html"


def browser_available(env=None, platform=None):
    """Whether a browser can be opened at all (no X/Wayland on a headless box)."""
    env = os.environ if env is None else env
    platform = sys.platform if platform is None else platform
    if platform.startswith("linux"):
        return bool(env.get("DISPLAY") or env.get("WAYLAND_DISPLAY"))
    return True


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    port, bind, directory = resolve(args)
    handler = partial(NoCacheHandler, directory=directory)
    with ThreadingHTTPServer((bind, port), handler) as httpd:
        # server_address is the truth: with --port 0 only the OS knows the port.
        actual = httpd.server_address[1]
        print(f"serving {directory} on {bind}:{actual}", flush=True)
        if args.port == 0:
            print(f"port: {actual} (chosen by the OS, --port 0)", flush=True)
        url = url_for(bind, actual)
        if args.open_browser:
            if browser_available():
                print(f"opening {url}", flush=True)
                webbrowser.open(url)
            else:
                print(f"no display available -- open {url} yourself", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
