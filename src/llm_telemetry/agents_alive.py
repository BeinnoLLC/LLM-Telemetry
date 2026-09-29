#!/usr/bin/env python3
"""P10-08 (#96): agents alive — heartbeats, turn leases, stale backends.

Pure functions only; the /proc liveness check (the only part that reads
the actual OS) is isolated behind a single injectable function so this
module has zero I/O in its tests.
"""
from __future__ import annotations
import time

# The gateway heartbeats roughly once a minute; "alive" is anything inside
# 2x that window (a single missed beat is normal jitter, two in a row is a
# real signal) — same 2x-interval rule the ticket itself specifies.
HEARTBEAT_INTERVAL_S = 60
ALIVE_THRESHOLD_S = HEARTBEAT_INTERVAL_S * 2


def _default_pid_exists(pid, host, this_host):
    """Real liveness check: /proc/<pid> exists. Only meaningful for a
    backend on THIS host — a stale row from another host in the fleet
    cannot be checked from here, so it is reported stale/dead by age
    alone, never asserted dead-by-pid across a host boundary."""
    if host != this_host:
        return None  # unknown — cannot check
    import os
    return os.path.exists(f"/proc/{pid}")


def build_agents(heartbeats, leases, this_host, now=None, pid_exists=None):
    """heartbeats: [{backend_id, pid, started_at, last_heartbeat, profile,
    host}]. leases: [{conversation_id, holder, acquired_at, expires_at}]
    where holder encodes 'pid=<N>:...' (the gateway's own lease-holder
    format) — leases are counted per backend by matching that pid against
    each heartbeat's pid, NOT by conversation_id (leases carry no backend
    id of their own).

    now/pid_exists are injected (never read internally) so a fixture
    produces the exact same classification at any wall-clock time and
    without touching the real filesystem.
    """
    now = now if now is not None else time.time()
    pid_exists = pid_exists or (lambda pid, host: _default_pid_exists(pid, host, this_host))

    lease_counts = {}
    for lease in leases:
        holder = lease.get("holder") or ""
        pid = None
        for part in holder.split(":"):
            if part.startswith("pid="):
                try:
                    pid = int(part[4:])
                except ValueError:
                    pid = None
                break
        if pid is not None:
            lease_counts[pid] = lease_counts.get(pid, 0) + 1

    agents = []
    for hb in heartbeats:
        age = now - hb["last_heartbeat"]
        state = "alive" if age <= ALIVE_THRESHOLD_S else "stale"
        # A same-host pid that no longer exists is definitively dead — this
        # overrides an "alive"-by-age classification too: a heartbeat can
        # be recent because the row is stale data, but a vanished pid on
        # THIS host is unambiguous ground truth.
        alive_check = pid_exists(hb["pid"], hb["host"])
        if alive_check is False:
            state = "dead"
        agents.append({
            "backend": hb["backend_id"],
            "profile": hb["profile"],
            "host": hb["host"],
            "pid": hb["pid"],
            "last_heartbeat": hb["last_heartbeat"],
            "age_s": round(age, 1),
            "state": state,
            "leases": lease_counts.get(hb["pid"], 0),
            # A kill hint is only ever offered for a CONFIRMED-dead,
            # same-host pid — never suggested for a live process or an
            # unreachable remote host we cannot verify.
            "kill_hint": (f"kill {hb['pid']}" if state == "dead" else None),
        })
    agents.sort(key=lambda a: (a["state"] != "dead", a["state"] != "stale", a["age_s"]))
    return agents
