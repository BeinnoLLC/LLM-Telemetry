#!/usr/bin/env python3
"""P10-08 (#96): agents_alive wired into collect_live.build_live(), against
a real fixture DB with the real gateway_heartbeats/session_turn_leases
tables. Verification per the ticket's own criteria:
- one fresh + one 3-day-old heartbeat -> one alive, one dead/stale
- negative control: empty agents (no rows) -> agents == []
"""
import json
import os
import sqlite3
import sys
import tempfile
import time

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "src"))

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{('  ' + str(extra)) if extra is not None else ''}")
    if ok:
        p += 1
    else:
        f += 1


with tempfile.TemporaryDirectory() as root_dir:
    home = os.path.join(root_dir, "agent")
    os.makedirs(home, exist_ok=True)
    db_path = os.path.join(home, "state.db")
    con = sqlite3.connect(db_path)
    con.executescript(open(os.path.join(ROOT, "tests", "fixtures", "state_schema.sql")).read())

    now = int(time.time())
    con.execute("insert into gateway_heartbeats(backend_id, pid, started_at, last_heartbeat, profile, host) "
                "values('default@thishost:1:a', 1, ?, ?, 'default', ?)", (now - 3600, now - 5, "thishost"))
    con.execute("insert into gateway_heartbeats(backend_id, pid, started_at, last_heartbeat, profile, host) "
                "values('default@thishost:2:b', 2, ?, ?, 'default', ?)", (now - 300000, now - 259200, "thishost"))
    con.execute("insert into session_turn_leases(conversation_id, holder, acquired_at, expires_at) "
                "values('c1', 'pid=1:turn=x:platform=desktop', ?, ?)", (now - 10, now + 300))
    con.commit()
    con.close()

    cfg = os.path.join(root_dir, "cfg.json")
    with open(cfg, "w") as fh:
        json.dump({"agent_home": home, "reports_dir": os.path.join(root_dir, "r")}, fh)
    os.environ["LLM_TELEMETRY_CONFIG"] = cfg
    os.environ["LLM_TELEMETRY_OFFLINE"] = "1"
    os.environ.pop("LLM_TELEMETRY_AGENT_HOME", None)
    for mod in list(sys.modules):
        if mod.startswith("llm_telemetry"):
            del sys.modules[mod]
    import socket
    real_hostname = socket.gethostname
    socket.gethostname = lambda: "thishost"  # so pid=1 is checkable on "this host"
    try:
        from llm_telemetry import collect_live as CL  # noqa: E402
        # pid 1 exists forever on any real Linux box (init/systemd) so it's
        # deterministic; pid 2 is treated as confirmed-gone via a fake proc
        # override rather than relying on nothing-happens-to-have-that-pid.
        import llm_telemetry.agents_alive as AA

        real_build_agents = AA.build_agents

        def build_agents_fixed(heartbeats, leases, this_host, now=None, pid_exists=None):
            fake_pid_exists = lambda pid, host: (pid != 2)
            return real_build_agents(heartbeats, leases, this_host, now=now, pid_exists=fake_pid_exists)

        CL.agents_alive.build_agents = build_agents_fixed

        data = CL.build_live()
        profile_name = next(iter(data["profiles"]))
        agents = data["profiles"][profile_name]["agents"]
        chk(len(agents) == 2, f"2 agents from the 2-heartbeat fixture (got {len(agents)})", len(agents))

        fresh = next(a for a in agents if a["pid"] == 1)
        dead = next(a for a in agents if a["pid"] == 2)
        chk(fresh["state"] == "alive", "the fresh heartbeat is alive end-to-end through the real collector")
        chk(dead["state"] == "dead", "the 3-day-old heartbeat with a confirmed-gone pid is dead end-to-end")
        chk(fresh["leases"] == 1, "the real session_turn_leases row is counted against the matching pid")
        chk(dead["leases"] == 0, "the dead backend has zero leases")
        chk(dead["kill_hint"] == "kill 2", "the dead backend carries a real kill hint")
    finally:
        socket.gethostname = real_hostname
        for var in ("LLM_TELEMETRY_CONFIG", "LLM_TELEMETRY_OFFLINE"):
            os.environ.pop(var, None)

    # --- negative control: empty tables -> agents == [] ---
    con = sqlite3.connect(db_path)
    con.execute("delete from gateway_heartbeats")
    con.execute("delete from session_turn_leases")
    con.commit()
    con.close()
    os.environ["LLM_TELEMETRY_CONFIG"] = cfg
    os.environ["LLM_TELEMETRY_OFFLINE"] = "1"
    for mod in list(sys.modules):
        if mod.startswith("llm_telemetry"):
            del sys.modules[mod]
    from llm_telemetry import collect_live as CL2  # noqa: E402
    data2 = CL2.build_live()
    profile_name2 = next(iter(data2["profiles"]))
    chk(data2["profiles"][profile_name2]["agents"] == [],
        "an empty gateway_heartbeats table produces agents == [] (the ticket's own negative control)")
    for var in ("LLM_TELEMETRY_CONFIG", "LLM_TELEMETRY_OFFLINE"):
        os.environ.pop(var, None)

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
