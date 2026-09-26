#!/usr/bin/env python3
"""P5-05 (#54): a profile created after the config was written must appear.

Uses a temporary fixture agent home, never the developer's real ~/.hermes:
build, add a profile directory, rebuild, and assert the profile count CHANGED
and the new profile's rows are counted (including in the merged All view,
which is computed from DATA.profiles on the page, so presence in the payload
is what makes it count there). Asserting the change is the point: a future
cache of the profile list would silently fail this test.

Each build runs in a fresh interpreter, exactly as the CLI does.
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


def make_profile(d, calls):
    """A state.db with the REAL agent schema (tests/fixtures/state_schema.sql)
    and one synthetic usage row, so the collector's actual queries run."""
    os.makedirs(d, exist_ok=True)
    con = sqlite3.connect(os.path.join(d, "state.db"))
    con.executescript(open(os.path.join(ROOT, "tests", "fixtures", "state_schema.sql")).read())
    con.execute("insert into sessions(id, source, started_at) values('s1', 'cli', 1790000000)")
    con.execute("""insert into session_model_usage(session_id, model, billing_provider,
        billing_base_url, task, api_call_count, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, reasoning_tokens,
        estimated_cost_usd, actual_cost_usd, last_seen)
        values('s1','test-model','local','http://127.0.0.1:11434/v1','main',?,1000,100,0,0,0,0,0,1790000000)""",
                (calls,))
    con.commit()
    con.close()


def collect(cfg, out):
    env = {**os.environ, "LLM_TELEMETRY_CONFIG": cfg, "LLM_TELEMETRY_OFFLINE": "1"}
    env.pop("LLM_TELEMETRY_AGENT_HOME", None)
    r = subprocess.run([PY, "-m", "llm_telemetry.collect_analytics", "-o", out],
                       cwd=ROOT, env=env, capture_output=True, text=True, timeout=240)
    if r.returncode:
        print(r.stderr[-1500:])
    return json.load(open(out)) if r.returncode == 0 else None


with tempfile.TemporaryDirectory() as root:
    home = os.path.join(root, "agent")
    make_profile(home, calls=5)
    cfg = os.path.join(root, "cfg.json")
    with open(cfg, "w") as fh:
        json.dump({"agent_home": home, "reports_dir": os.path.join(root, "r")}, fh)
    out = os.path.join(root, "a.json")

    first = collect(cfg, out)
    chk(first is not None, "first build succeeds against the fixture home")
    before = sorted((first or {}).get("profiles", {}))
    chk(before == ["default"], "fixture starts with one profile", before)

    # Created AFTER the config was written; the config is not touched.
    make_profile(os.path.join(home, "profiles", "late"), calls=7)
    second = collect(cfg, out)
    after = sorted((second or {}).get("profiles", {}))
    chk(len(after) != len(before), "profile count changed after adding a profile dir",
        f"{len(before)} -> {len(after)}")
    chk("late" in after, "the new profile appears with no config edit", after)
    rows = ((second or {}).get("profiles", {}).get("late") or {}).get("rows", [])
    chk(sum(r.get("calls", 0) for r in rows) == 7, "the new profile's rows are counted",
        sum(r.get("calls", 0) for r in rows))
    total = sum(r.get("calls", 0) for pr in (second or {}).get("profiles", {}).values()
                for r in pr.get("rows", []))
    chk(total == 12, "both profiles' traffic reaches the payload the All view merges", total)

    # P5-04 (#53): a corrupt state.db is reported, not fatal and not silent.
    bad = os.path.join(home, "profiles", "broken")
    os.makedirs(bad)
    with open(os.path.join(bad, "state.db"), "wb") as fh:
        fh.write(b"this is not a sqlite database" * 64)
    third = collect(cfg, out)
    chk(third is not None, "a corrupt profile database does not crash the build")
    failed = [x["name"] for x in ((third or {}).get("resolution") or {}).get("failed", [])]
    chk(failed == ["broken"], "the corrupt profile is reported as unreadable", failed)
    chk(sorted((third or {}).get("profiles", {})) == ["default", "late"],
        "the readable profiles still collect", sorted((third or {}).get("profiles", {})))
    res_txt = json.dumps((third or {}).get("resolution"))
    chk(os.path.expanduser("~") not in res_txt, "the report carries no absolute home path")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
