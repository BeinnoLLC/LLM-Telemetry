#!/usr/bin/env python3
"""doctor: the preflight tells the truth about a healthy, a broken and a stale tree (#143).

Each scenario is a real temp agent home and a real temp reports directory, so
the checks run against files on disk rather than against mocks. Nothing here
touches the developer's config: LLM_TELEMETRY_CONFIG points at a throwaway file
before the config singleton is first read.

Hand-derived from the check table in src/llm_telemetry/doctor.py:

  fail  agent home / a configured profile with no DB / an artifact >3x cadence /
        a payload whose schema_version is not the collectors' / a disabled timer
  warn  no config file / no profiles at all / an optional artifact missing /
        an artifact between 1.5x and 3x its cadence / an uninstalled timer /
        an unreachable host / anything skipped by --offline
  ok    everything in place
"""
import contextlib
import io
import json
import os
import socket
import sqlite3
import sys
import tempfile
import time
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

tmp = tempfile.mkdtemp(prefix="doctor-")
HOME = os.path.join(tmp, "agent-home")
REPORTS = os.path.join(tmp, "reports")
CFG = os.path.join(tmp, "config.json")
os.makedirs(os.path.join(HOME, "profiles", "alpha"), exist_ok=True)
os.makedirs(REPORTS, exist_ok=True)

with open(CFG, "w") as fh:
    json.dump({"reports_dir": REPORTS, "agent_home": HOME,
               "profiles": [{"name": "alpha", "home": os.path.join(HOME, "profiles", "alpha")}],
               "port": 65535}, fh)
os.environ["LLM_TELEMETRY_CONFIG"] = CFG

from llm_telemetry import doctor as D      # noqa: E402
from llm_telemetry import config as C      # noqa: E402
from llm_telemetry.schema import SCHEMA_VERSION   # noqa: E402

ALPHA_DB = os.path.join(HOME, "profiles", "alpha", "state.db")
CFG_ = C.load(CFG)

p = f = 0


def chk(ok, label, extra_note=None):
    global p, f
    if ok:
        p += 1
        print(f"  OK   {label}")
    else:
        f += 1
        print(f"  FAIL {label}" + (f"  ({extra_note})" if extra_note else ""))


def make_db(path, table="sessions"):
    con = sqlite3.connect(path)
    con.execute(f"CREATE TABLE IF NOT EXISTS {table} (id INTEGER PRIMARY KEY)")
    con.commit()
    con.close()


def write_payload(name, body):
    with open(os.path.join(REPORTS, name), "w") as fh:
        json.dump(body, fh)


def touch(name, age=0):
    path = os.path.join(REPORTS, name)
    with open(path, "w") as fh:
        fh.write("<html></html>")
    when = time.time() - age
    os.utime(path, (when, when))
    return path


def statuses(rows):
    return {r["name"]: r["status"] for r in rows}


def by_status(rows, status):
    return [r["name"] for r in rows if r["status"] == status]


def healthy():
    """Every artifact fresh, every required payload current, timers enabled."""
    make_db(ALPHA_DB)
    for name, _unit, _cadence, _req in D.ARTIFACTS:
        touch(name, 0)
    write_payload("analytics-data.json", {"schema_version": SCHEMA_VERSION})
    write_payload("live-data.json", {"schema_version": SCHEMA_VERSION})
    return D.run_checks(cfg=CFG_, offline=True, systemd=True,
                        installed={u: "/x/" + u for u in D.TIMER_UNITS},
                        runner=lambda u: SimpleNamespace(stdout="enabled\n"))


# --- a healthy tree --------------------------------------------------------
rows = healthy()
chk(D.OK in statuses(rows).values() and not by_status(rows, D.FAIL),
    "a healthy tree has no fail rows", ", ".join(by_status(rows, D.FAIL)))
chk(statuses(rows).get("db alpha") == D.OK, "the profile's DB is checked and passes")
chk(statuses(rows).get("artifact dashboard.html") == D.OK, "a fresh artifact is ok")
chk(statuses(rows).get("timer llm-telemetry-build.timer") == D.OK,
    "an installed, enabled timer is ok")
chk(statuses(rows).get("schema analytics-data.json") == D.OK, "a current payload schema is ok")
chk(statuses(rows).get("hosts") == D.WARN and "--offline" in D.render(rows),
    "no host is probed unless asked")
chk(len(rows) == len(D.run_checks(cfg=CFG_, offline=True, systemd=True,
                                  installed={u: "/x/" + u for u in D.TIMER_UNITS},
                                  runner=lambda u: SimpleNamespace(stdout="enabled\n"))),
    "the doctor is deterministic in the number of rows it reports")

# --- a missing DB ---------------------------------------------------------
os.remove(ALPHA_DB)
rows = D.run_checks(cfg=CFG_, offline=True, systemd=False)
chk(statuses(rows).get("db alpha") == D.FAIL, "a configured profile with no DB fails")
chk(("db alpha") in by_status(rows, D.FAIL), "the failing row names the profile")
chk("profiles" in statuses(rows) and statuses(rows)["profiles"] == D.FAIL,
    "the profile count row fails while a database is missing")
chk(statuses(rows).get("timers") == D.WARN, "a non-systemd host only warns about timers")

# --- a stale artifact ----------------------------------------------------
make_db(ALPHA_DB)
touch("dashboard.html", age=601)          # cadence 60s, fail at >3x = 180s
rows = D.run_checks(cfg=CFG_, offline=True, systemd=False)
chk(statuses(rows).get("artifact dashboard.html") == D.FAIL,
    "an artifact older than 3x its cadence fails", statuses(rows).get("artifact dashboard.html"))
chk("is build.timer enabled?" in D.render(rows), "the detail points at the timer")

touch("logs-data.json", age=120)          # cadence 60s, warn at >1.5x = 90s
rows = D.run_checks(cfg=CFG_, offline=True, systemd=False)
chk(statuses(rows).get("artifact logs-data.json") == D.WARN,
    "an artifact between 1.5x and 3x its cadence warns")

os.remove(os.path.join(REPORTS, "dashboard.html"))
rows = D.run_checks(cfg=CFG_, offline=True, systemd=False)
chk(statuses(rows).get("artifact dashboard.html") == D.FAIL, "a missing artifact fails")

touch("dashboard.html", 0)
os.remove(os.path.join(REPORTS, "costs.html"))
rows = D.run_checks(cfg=CFG_, offline=True, systemd=False)
chk(statuses(rows).get("artifact costs.html") == D.WARN,
    "a missing optional artifact only warns")

# --- schema --------------------------------------------------------------
write_payload("analytics-data.json", {"schema_version": "0-old"})
rows = D.run_checks(cfg=CFG_, offline=True, systemd=False)
chk(statuses(rows).get("schema analytics-data.json") == D.FAIL,
    "a payload from an older collector fails")
chk("0-old" in D.render(rows), "the detail shows the version it found")
write_payload("analytics-data.json", {"schema_version": SCHEMA_VERSION})

# --- an unreadable DB ----------------------------------------------------
with open(ALPHA_DB, "wb") as fh:
    fh.write(b"this is not a database")
rows = D.run_checks(cfg=CFG_, offline=True, systemd=False)
chk(statuses(rows).get("db alpha") == D.FAIL, "a corrupt DB fails rather than crashing")
chk("db alpha" in by_status(rows, D.FAIL), "the corrupt DB is reported as a fail")
os.remove(ALPHA_DB)
make_db(ALPHA_DB)

# --- timers --------------------------------------------------------------
installed = {u: "/x/" + u for u in D.TIMER_UNITS}
rows = D.run_checks(cfg=CFG_, offline=True, systemd=True, installed=installed,
                    runner=lambda u: SimpleNamespace(stdout="disabled\n"))
chk(all(statuses(rows)[f"timer {u}"] == D.FAIL for u in D.TIMER_UNITS),
    "an installed but disabled timer fails")

rows = D.run_checks(cfg=CFG_, offline=True, systemd=True, installed={}, runner=None)
chk(statuses(rows).get("timers") == D.WARN and "no user timer units" in D.render(rows),
    "a host with no unit files at all warns once")

partial_installed = {u: "/x/" + u for u in D.TIMER_UNITS[:2]}
rows = D.run_checks(cfg=CFG_, offline=True, systemd=True, installed=partial_installed,
                    runner=lambda u: SimpleNamespace(stdout="enabled\n"))
chk(statuses(rows)["timer llm-telemetry-quota.timer"] == D.WARN,
    "a unit that was never installed warns, it does not fail the run")

# --- hosts, without leaving the machine ----------------------------------
srv = socket.socket()
srv.bind(("127.0.0.1", 0))
srv.listen(1)
open_port = srv.getsockname()[1]
CFG_.inference_endpoints = [f"127.0.0.1:{open_port}", "127.0.0.1:1"]
rows = D.run_checks(cfg=CFG_, offline=False, systemd=False, installed={})
chk(statuses(rows)[f"host 127.0.0.1:{open_port}"] == D.OK,
    "a listening endpoint is probed and reported ok")
chk(statuses(rows)["host 127.0.0.1:1"] == D.WARN, "a closed port only warns")
chk("answered in" in D.render(rows), "the ok host row carries a latency")
CFG_.inference_endpoints = []

# Without an explicit list the doctor probes what the probe would probe.
rows = D.run_checks(cfg=CFG_, offline=False, systemd=False, installed={},
                    discover=lambda: [f"127.0.0.1:{open_port}"])
chk("discovered from the profile configs" in D.render(rows),
    "the endpoints come from the probe's own discovery when none are configured")
chk(statuses(rows)[f"host 127.0.0.1:{open_port}"] == D.OK,
    "a discovered endpoint is probed like a configured one")

rows = D.run_checks(cfg=CFG_, offline=False, systemd=False, installed={}, discover=lambda: [])
chk(statuses(rows).get("hosts") == D.WARN, "nothing to probe is a warn, not a fail")

def _boom():
    raise OSError("no profile configs")

rows = D.run_checks(cfg=CFG_, offline=False, systemd=False, installed={}, discover=_boom)
chk(statuses(rows).get("hosts") == D.WARN and "could not discover" in D.render(rows),
    "a failing discovery is reported, not raised")
srv.close()

# --- the exit code and the two output shapes -----------------------------
os.remove(ALPHA_DB)                        # one fail is enough to change the exit code
out = io.StringIO()
with contextlib.redirect_stdout(out):
    rc = D.main(["--offline"])
text = out.getvalue()
chk(rc == 1, "a failing tree exits 1", rc)
chk("fail" in text and "ok," in text, "the text report carries a summary")
chk("fix the 'fail' rows" in text, "the text report says what to fix first")

healthy()
out = io.StringIO()
with contextlib.redirect_stdout(out):
    rc = D.main(["--json", "--offline"])
doc = json.loads(out.getvalue())
chk(rc == 0, "a healthy tree exits 0", rc)
chk(set(doc) == {"checks", "counts", "ok"}, "the JSON shape is checks/counts/ok", sorted(doc))
chk(doc["ok"] is True and doc["counts"]["fail"] == 0, "the JSON says nothing failed")
chk(all({"name", "status", "detail"} == set(c) for c in doc["checks"]),
    "every JSON check carries name/status/detail")
chk(all(c["status"] in (D.OK, D.WARN, D.FAIL) for c in doc["checks"]),
    "every JSON status is one of the three words")

# Self-checks: the helpers must be able to disagree.
chk(D._human(5) == "5s" and D._human(300) == "5m" and D._human(7200) == "2.0h",
    "_human formats seconds, minutes and hours")
chk(D.ARTIFACTS[0][2] == 5 and D.ARTIFACTS[1][2] == 60,
    "the cadence table starts at the probe's 5s and the build's 60s")
chk(not any(a[2] == 0 for a in D.ARTIFACTS), "no artifact has a zero cadence")
chk(all(u.endswith(".timer") for u in D.TIMER_UNITS), "the timer list holds timer units")

print()
print(f"{p} passed, {f} failed")
sys.exit(1 if f else 0)
