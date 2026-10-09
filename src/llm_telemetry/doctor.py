#!/usr/bin/env python3
"""`llm-telemetry doctor` -- a read-only preflight over the whole pipeline (#143).

When the dashboard is empty, stale or wrong there is no single command that says
why. Every diagnosis so far was done by hand: is the config resolving, does the
agent DB exist, was the artifact rebuilt, is the timer even installed, does the
host answer? This walks the same chain a build walks, in order, and prints one
row per check with `ok`, `warn` or `fail`.

Read-only by construction: it opens SQLite files with a read-only URI, calls
`systemctl --user is-enabled` (a query), opens TCP sockets, and reads files. It
never writes, starts, enables or collects anything, so it is safe on a live host.
The one exception is not its own: loading the config ensures the reports
directory exists (`Config.__post_init__`), so running the doctor can create that
one directory if it is missing, and nothing else.

Exit code is 0 when every check is `ok` or `warn`, and 1 when any check is
`fail` -- so it can gate a deploy or a systemd unit.

Thresholds (artifacts): an artifact older than 1.5x its cadence is a `warn`
(one run probably missed) and older than 3x is a `fail` (the unit is probably
not installed or not enabled at all).

Cadences come from `systemd/*.timer`, not from guesswork:

    probe.timer     5s     ollama-data.json
    build.timer     60s    dashboard.html, analytics-data.json, live-data.json,
                           logs-data.json, costs.html, transcripts.json
    router.timer    1h     router-data.json
    quota.timer     1h     quota-data.json
    rankings.timer  1h     rankings-data.json, rankings.html, sample-catalog.json

The build unit also runs the hourly collectors every minute, which only ever
makes an artifact fresher than its cadence here -- the conservative direction,
so it cannot cause a false failure.
"""
import argparse
import glob
import json
import os
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.parse

from . import config as C
from .schema import SCHEMA_VERSION

OK, WARN, FAIL = "ok", "warn", "fail"

# artifact -> (unit whose timer writes it, cadence in seconds, required)
ARTIFACTS = [
    ("ollama-data.json", "probe", 5, True),
    ("dashboard.html", "build", 60, True),
    ("analytics-data.json", "build", 60, True),
    ("live-data.json", "build", 60, True),
    ("logs-data.json", "build", 60, False),
    ("costs.html", "build", 60, False),
    ("transcripts.json", "build", 60, False),
    ("router-data.json", "router", 3600, False),
    ("quota-data.json", "quota", 3600, False),
    ("rankings-data.json", "rankings", 3600, False),
    ("rankings.html", "rankings", 3600, False),
]

TIMER_UNITS = [
    "llm-telemetry-build.timer",
    "llm-telemetry-probe.timer",
    "llm-telemetry-router.timer",
    "llm-telemetry-quota.timer",
    "llm-telemetry-rankings.timer",
]

WARN_FACTOR, FAIL_FACTOR = 1.5, 3.0


def check(name, status, detail):
    return {"name": name, "status": status, "detail": detail}


def _sqlite_readonly(path):
    return sqlite3.connect(f"file:{urllib.parse.quote(path)}?mode=ro", uri=True, timeout=2)


def check_config(cfg):
    out = []
    src = (cfg.resolution or {}).get("config_file", "")
    out.append(check("config", OK if src and os.path.isfile(src) else WARN,
                     f"config file: {src}" if src and os.path.isfile(src)
                     else f"no config file at {src or '(none)'} -- using defaults"))

    home = cfg.agent_home
    out.append(check("agent home", OK if os.path.isdir(home) else FAIL,
                     home if os.path.isdir(home) else f"agent home not found: {home}"))

    live = cfg.live_profiles()
    mode = (cfg.resolution or {}).get("mode", "?")
    if not cfg.profiles:
        out.append(check("profiles", WARN,
                         f"no profiles configured or found (mode: {mode}) -- "
                         "the dashboard will have no usage"))
    else:
        missing = len(cfg.profiles) - len(live)
        out.append(check("profiles", OK if not missing else FAIL,
                         f"{len(cfg.profiles)} profile(s), {len(live)} with a database, "
                         f"mode: {mode}"))

    reports = str(cfg.reports_dir)
    if not os.path.isdir(reports):
        out.append(check("reports dir", FAIL, f"not a directory: {reports}"))
    else:
        out.append(check("reports dir", OK if os.access(reports, os.W_OK) else WARN,
                         reports + ("" if os.access(reports, os.W_OK) else " (not writable)")))
    return out


def check_agent_dbs(cfg):
    """Every *configured* profile needs a readable database.

    `live_profiles()` quietly drops a profile whose DB is absent (that is the
    right call for a collector, which should degrade to "not shown"), so this
    reads `cfg.profiles`: a profile that is configured and has no database is
    exactly the "why is my dashboard empty" case worth a `fail`.
    """
    out = []
    if not cfg.profiles:
        return [check("agent DBs", WARN, "no profiles to check")]
    for prof in cfg.profiles:
        path = prof.db
        if not os.path.isfile(path):
            home = prof.home if os.path.isdir(prof.home) else f"{prof.home} (no such directory)"
            out.append(check(f"db {prof.name}", FAIL, f"missing: {path} -- home {home}"))
            continue
        try:
            con = _sqlite_readonly(path)
            try:
                con.execute("SELECT count(*) FROM sqlite_master").fetchone()
            finally:
                con.close()
            out.append(check(f"db {prof.name}", OK, path))
        except sqlite3.Error as exc:
            out.append(check(f"db {prof.name}", FAIL, f"{path}: {exc}"))
    return out


def check_artifacts(cfg, now=None):
    now = time.time() if now is None else now
    out = []
    reports = cfg.reports_dir
    for name, unit, cadence, required in ARTIFACTS:
        path = os.path.join(str(reports), name)
        if not os.path.isfile(path):
            out.append(check(f"artifact {name}", FAIL if required else WARN,
                             f"missing ({unit}.timer writes it every {_human(cadence)})"))
            continue
        age = now - os.path.getmtime(path)
        if age > cadence * FAIL_FACTOR:
            out.append(check(f"artifact {name}", FAIL,
                             f"{_human(age)} old, cadence {_human(cadence)} "
                             f"-- is {unit}.timer enabled?"))
        elif age > cadence * WARN_FACTOR:
            out.append(check(f"artifact {name}", WARN,
                             f"{_human(age)} old, cadence {_human(cadence)}"))
        else:
            out.append(check(f"artifact {name}", OK, f"{_human(age)} old"))
    return out


def _human(seconds):
    if seconds < 90:
        return f"{int(seconds)}s"
    if seconds < 5400:
        return f"{int(seconds // 60)}m"
    return f"{seconds / 3600:.1f}h"


def _systemd_host():
    return os.path.isdir("/run/systemd/system")


def _installed_timers():
    """Where a user timer could be, in the order systemd looks."""
    out = {}
    for root in ("~/.config/systemd/user", "/etc/systemd/user", "/usr/lib/systemd/user"):
        for path in glob.glob(os.path.expanduser(os.path.join(root, "*.timer"))):
            out.setdefault(os.path.basename(path), path)
    return out


def check_timers(units=None, systemd=None, runner=None, installed=None):
    """Installed and enabled, as `systemctl --user is-enabled` reports it.

    A unit that was never installed is a `warn`, not a `fail`: plenty of hosts
    refresh the artifacts from something else (cron, a supervisor, another
    unit), and artifacts that are fresh prove the work is getting done. A unit
    that *is* installed but not enabled is a `fail` -- it is sitting right there
    and will never fire, which is exactly the state the rankings timer shipped
    in.
    """
    units = TIMER_UNITS if units is None else units
    systemd = _systemd_host() if systemd is None else systemd
    if not systemd:
        return [check("timers", WARN, "not a systemd host -- no timers to check")]
    installed = _installed_timers() if installed is None else installed
    if not installed:
        return [check("timers", WARN,
                      "no user timer units installed -- see the install block in README.md")]
    run = runner or (lambda u: subprocess.run(
        ["systemctl", "--user", "is-enabled", u],
        capture_output=True, text=True, timeout=5))
    out = []
    for unit in units:
        if unit not in installed:
            out.append(check(f"timer {unit}", WARN,
                             f"not installed ({installed.get(unit, 'not found')})"))
            continue
        try:
            proc = run(unit)
            state = (proc.stdout or proc.stderr).strip().splitlines()[-1:]
            state = state[0] if state else f"exit {proc.returncode}"
        except (OSError, subprocess.SubprocessError) as exc:
            state = f"unavailable: {exc}"
        out.append(check(f"timer {unit}", OK if state == "enabled" else FAIL, state))
    return out


def check_schema(cfg):
    """A payload built by an older collector must not be read as current."""
    reports = cfg.reports_dir
    out = []
    seen = False
    for name in ("analytics-data.json", "live-data.json"):
        path = os.path.join(str(reports), name)
        if not os.path.isfile(path):
            continue
        seen = True
        try:
            with open(path, encoding="utf-8") as fh:
                found = json.load(fh).get("schema_version")
        except (OSError, json.JSONDecodeError) as exc:
            out.append(check(f"schema {name}", FAIL, f"unreadable: {exc}"))
            continue
        out.append(check(f"schema {name}", OK if found == SCHEMA_VERSION else FAIL,
                         f"{found} (collectors write {SCHEMA_VERSION})"))
    if not seen:
        out.append(check("schema", WARN, "no payload to read a schema version from"))
    return out


def check_hosts(cfg, offline=False, discover=None):
    """TCP-connect every endpoint the probe would probe.

    The endpoint list comes from the same place the probe gets it --
    `probe_hosts.discover()`, which scans the profile configs for `base_url`
    lines -- so the doctor cannot drift from what the collector actually does.
    `cfg.inference_endpoints` is honoured first when someone set it explicitly.
    """
    if offline:
        return [check("hosts", WARN, "skipped (--offline)")]
    if discover is None:
        from .probe_hosts import discover as discover_
        discover = discover_
    endpoints = list(getattr(cfg, "inference_endpoints", []) or [])
    source = "configured"
    if not endpoints:
        try:
            endpoints = list(discover())
        except Exception as exc:                     # noqa: BLE001 - never fatal
            return [check("hosts", WARN, f"could not discover endpoints: {exc}")]
        source = "discovered from the profile configs"
    if not endpoints:
        return [check("hosts", WARN, "no inference endpoints to probe")]
    out = []
    for url in endpoints:
        parsed = urllib.parse.urlparse(url if "//" in url else f"//{url}")
        host, port = parsed.hostname or url, parsed.port
        port = port or (443 if parsed.scheme == "https" else 80)
        started = time.time()
        try:
            with socket.create_connection((host, port), timeout=2):
                ms = int((time.time() - started) * 1000)
            out.append(check(f"host {host}:{port}", OK, f"answered in {ms} ms ({source})"))
        except OSError as exc:
            out.append(check(f"host {host}:{port}", WARN, f"unreachable: {exc} ({source})"))
    return out


def run_checks(cfg=None, offline=False, now=None, systemd=None, units=None, runner=None,
               installed=None, discover=None):
    cfg = cfg or C.get()
    out = []
    out += check_config(cfg)
    out += check_agent_dbs(cfg)
    out += check_artifacts(cfg, now=now)
    out += check_timers(units=units, systemd=systemd, runner=runner, installed=installed)
    out += check_schema(cfg)
    out += check_hosts(cfg, offline=offline, discover=discover)
    return out


def render(checks):
    width = max(len(c["name"]) for c in checks)
    return "\n".join(f"  {c['status']:<4} {c['name']:<{width}}  {c['detail']}" for c in checks)


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="llm-telemetry doctor",
        description="Read-only preflight: config, agent DBs, artifacts, timers, schema, hosts.")
    ap.add_argument("--json", action="store_true", help="emit the checks as JSON")
    ap.add_argument("--offline", action="store_true", help="skip all network probes")
    args = ap.parse_args(sys.argv[1:] if argv is None else argv)

    checks = run_checks(offline=args.offline)
    failed = [c for c in checks if c["status"] == FAIL]
    warned = [c for c in checks if c["status"] == WARN]

    if args.json:
        json.dump({"checks": checks,
                   "counts": {OK: len(checks) - len(failed) - len(warned),
                              WARN: len(warned), FAIL: len(failed)},
                   "ok": not failed}, sys.stdout, indent=2)
        print()
    else:
        print(render(checks))
        print(f"\n  {len(checks) - len(failed) - len(warned)} ok, {len(warned)} warn, "
              f"{len(failed)} fail" + ("" if args.offline else ""))
        if failed:
            print("  fix the 'fail' rows first: they are what makes the dashboard empty or stale")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
