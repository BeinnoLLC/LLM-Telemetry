#!/usr/bin/env python3
"""P4-05 (#101), part 2: repo & branch attribution -- real fixture DB + the
real collect_analytics.build() end-to-end.
"""
import json
import os
import sqlite3
import subprocess
import sys
import tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
PY = sys.executable

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{('  ' + str(extra)) if extra is not None else ''}")
    if ok:
        p += 1
    else:
        f += 1


with tempfile.TemporaryDirectory() as root:
    home = os.path.join(root, "agent")
    os.makedirs(home, exist_ok=True)
    con = sqlite3.connect(os.path.join(home, "state.db"))
    con.executescript(open(os.path.join(ROOT, "tests", "fixtures", "state_schema.sql")).read())

    now = 1790000000
    # Two repos, three branches total: nowinv/main (2 sessions), nowinv/feat
    # (1 session), ahwa/main (1 session). Plus one session with no cwd at
    # all -> Unattributed repo AND Unattributed branch.
    sessions = [
        ("s1", "/srv/workspace/nowinv", "main", "claude-opus-5", 40, 0.80),
        ("s2", "/srv/workspace/nowinv", "main", "claude-opus-5", 20, 0.40),
        ("s3", "/srv/workspace/nowinv", "feat/checkout", "glm-5.3", 10, 0.05),
        ("s4", "/srv/workspace/ahwa", "main", "claude-opus-5", 15, 0.30),
        ("s5", None, None, "claude-opus-5", 5, 0.02),
    ]
    for sid, cwd, branch, model, calls, cost in sessions:
        con.execute("insert into sessions(id, source, started_at, ended_at, title, model, cwd, git_branch) "
                    "values(?, 'desktop', ?, ?, ?, ?, ?, ?)",
                    (sid, now - 3600, now - 1800, f"session {sid}", model, cwd, branch))
        con.execute("insert into session_model_usage(session_id, model, billing_provider, "
                    "billing_base_url, task, api_call_count, input_tokens, output_tokens, "
                    "cache_read_tokens, cache_write_tokens, reasoning_tokens, "
                    "estimated_cost_usd, actual_cost_usd, last_seen) "
                    "values (?,?,'anthropic','','main',?,?,?,0,0,0,?,?,?)",
                    (sid, model, calls, calls * 100, calls * 50, cost, cost, now - 1800))
    con.commit()
    con.close()

    cfg = os.path.join(root, "cfg.json")
    with open(cfg, "w") as fh:
        json.dump({"agent_home": home, "reports_dir": os.path.join(root, "r")}, fh)
    out = os.path.join(root, "a.json")

    env = {**os.environ, "LLM_TELEMETRY_CONFIG": cfg, "LLM_TELEMETRY_OFFLINE": "1"}
    env.pop("LLM_TELEMETRY_AGENT_HOME", None)
    r = subprocess.run([PY, "-m", "llm_telemetry.collect_analytics", "-o", out],
                       cwd=ROOT, env=env, capture_output=True, text=True, timeout=240)
    if r.returncode:
        print(r.stderr[-2000:])
    chk(r.returncode == 0, "the real collector runs end-to-end against the fixture DB")
    doc = json.load(open(out))
    rb = doc["profiles"]["default"]["repo_branch"]
    repos = {r["repo"]: r for r in rb["repos"]}

    chk(len(rb["repos"]) == 3, "3 distinct repos resolved (nowinv, ahwa, Unattributed)", list(repos))
    chk("nowinv" in repos and "ahwa" in repos and "Unattributed" in repos, "all 3 expected repo keys present")

    nowinv = repos.get("nowinv")
    chk(nowinv and nowinv["sessions"] == 3, "nowinv aggregates all 3 of its sessions", nowinv["sessions"] if nowinv else None)
    chk(nowinv and nowinv["cost"] == round(0.80 + 0.40 + 0.05, 4),
        "nowinv's repo-level cost is the EXACT sum of its own branches' costs", nowinv["cost"] if nowinv else None)
    branch_sum = round(sum(b["cost"] for b in nowinv["branches"]), 4) if nowinv else None
    chk(nowinv and nowinv["cost"] == branch_sum,
        "per-repo total equals the sum of its own branch totals (the ticket's own named acceptance check)",
        (nowinv["cost"] if nowinv else None, branch_sum))

    nowinv_branches = {b["branch"]: b for b in nowinv["branches"]} if nowinv else {}
    chk(nowinv_branches.get("main", {}).get("cost") == 1.20, "nowinv/main aggregates s1+s2 correctly (0.80+0.40)")
    chk(nowinv_branches.get("main", {}).get("sessions") == 2, "nowinv/main counts exactly its 2 real sessions")
    chk(nowinv_branches.get("feat/checkout", {}).get("cost") == 0.05, "nowinv/feat-checkout is its own separate branch bucket")

    ahwa = repos.get("ahwa")
    chk(ahwa and ahwa["cost"] == 0.30 and ahwa["sessions"] == 1, "ahwa/main is correctly isolated from nowinv")

    unattr = repos.get("Unattributed")
    chk(unattr is not None, "the ticket's own named acceptance check: unattributed row present when a session has no cwd")
    chk(unattr and unattr["sessions"] == 1 and unattr["cost"] == 0.02,
        "the no-cwd session (s5) lands in Unattributed, not silently dropped")
    chk(unattr and unattr["branches"][0]["branch"] == "Unattributed",
        "a repo with no real branch data also gets its own Unattributed branch bucket (same rule, one level down)")

    # Sort order: cost descending, Unattributed always last (#41's own rule),
    # never mixed into the middle of the ranking regardless of its cost.
    order = [r["repo"] for r in rb["repos"]]
    chk(order[-1] == "Unattributed", "Unattributed always sorts last regardless of its cost rank", order)
    chk(order[0] == "nowinv", "repos are sorted by cost descending otherwise (nowinv $1.25 > ahwa $0.30)", order)

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
