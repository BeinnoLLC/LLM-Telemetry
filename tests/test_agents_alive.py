#!/usr/bin/env python3
"""P10-08 (#96): agents_alive unit tests, zero real I/O (pid_exists
injected). Verification per the ticket's own criteria:
- one fresh + one 3-day-old heartbeat -> one alive chip, one dead/stale
  chip, leases count rendered
- negative control: empty agents (covered in the collector/UI layers,
  this module simply returns [] for empty input, checked directly)
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))
from llm_telemetry.agents_alive import ALIVE_THRESHOLD_S, build_agents  # noqa: E402

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{('  ' + str(extra)) if extra is not None else ''}")
    if ok:
        p += 1
    else:
        f += 1


NOW = 1_800_000_000

heartbeats = [
    {"backend_id": "default@host1:100:abc", "pid": 100, "started_at": NOW - 3600,
     "last_heartbeat": NOW - 5, "profile": "default", "host": "host1"},
    {"backend_id": "default@host1:200:def", "pid": 200, "started_at": NOW - 300000,
     "last_heartbeat": NOW - 259200, "profile": "default", "host": "host1"},  # 3 days old
]
leases = [
    {"conversation_id": "c1", "holder": "pid=100:turn=abc:platform=desktop", "acquired_at": NOW - 10, "expires_at": NOW + 300},
    {"conversation_id": "c2", "holder": "pid=100:turn=def:platform=tui", "acquired_at": NOW - 5, "expires_at": NOW + 300},
]


def pid_exists_fresh_dead(pid, host):
    # pid 100 alive, pid 200 confirmed gone on this host.
    return pid == 100


agents = build_agents(heartbeats, leases, this_host="host1", now=NOW, pid_exists=pid_exists_fresh_dead)
chk(len(agents) == 2, "2 agents produced from the 2-heartbeat fixture", len(agents))

fresh = next(a for a in agents if a["pid"] == 100)
stale = next(a for a in agents if a["pid"] == 200)
chk(fresh["state"] == "alive", "the fresh (5s-old) heartbeat classifies as alive", fresh["state"])
chk(stale["state"] == "dead", "the 3-day-old heartbeat with a confirmed-gone pid classifies as dead (not just stale)", stale["state"])
chk(fresh["leases"] == 2, "the fresh backend's lease count is 2 (both leases' pid=100 matched)", fresh["leases"])
chk(stale["leases"] == 0, "the dead backend has zero leases (none held pid=200)", stale["leases"])
chk(stale["kill_hint"] == "kill 200", "a confirmed-dead same-host pid gets a copyable kill hint")
chk(fresh["kill_hint"] is None, "a live process NEVER gets a kill hint")

# Sort order: dead/stale first, alive last (most actionable at the top).
chk(agents[0]["pid"] == 200, "the dead/actionable backend sorts before the alive one")

# Age-only classification (no pid_exists override): a backend just over the
# 2x-interval threshold is "stale", not "dead" or still "alive", when its
# pid cannot be confirmed dead.
hb_borderline = [{"backend_id": "b", "pid": 999, "started_at": NOW - 1000,
                  "last_heartbeat": NOW - (ALIVE_THRESHOLD_S + 1), "profile": "default", "host": "host1"}]
agents_b = build_agents(hb_borderline, [], this_host="host1", now=NOW, pid_exists=lambda pid, host: True)
chk(agents_b[0]["state"] == "stale",
    "a heartbeat just past the 2x-interval threshold with a CONFIRMED-alive pid is stale, not dead", agents_b[0]["state"])

# Remote host: pid_exists returns None (unknown) for a different host — a
# stale remote backend must NEVER be asserted dead across a host boundary.
def pid_exists_remote_unknown(pid, host):
    return None if host != "host1" else True

hb_remote = [{"backend_id": "default@host2:50:x", "pid": 50, "started_at": NOW - 1000,
              "last_heartbeat": NOW - 300000, "profile": "default", "host": "host2"}]
agents_r = build_agents(hb_remote, [], this_host="host1", now=NOW, pid_exists=pid_exists_remote_unknown)
chk(agents_r[0]["state"] == "stale",
    "a stale REMOTE-host backend (unverifiable pid) is reported stale, never asserted dead across a host boundary", agents_r[0]["state"])
chk(agents_r[0]["kill_hint"] is None, "a remote unverifiable backend never gets a kill hint (would be a false-confidence suggestion)")

# Empty input -> empty output (the negative control's data-layer half; the
# UI-hiding half is covered in check_agents_alive.js).
chk(build_agents([], [], this_host="host1", now=NOW) == [],
    "an empty heartbeats fixture produces an empty agents list")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
