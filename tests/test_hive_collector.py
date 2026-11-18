"""LST-268: Hive collector (llm_telemetry.hive). All timestamps are relative to now."""
import json
import logging
import os
import re
import sqlite3
import time

import pytest
import yaml

from llm_telemetry import hive
from llm_telemetry.schema import SCHEMA_VERSION

FLEET = """family: acme
prefix: ac
orchestrators:
  - project: alpha
    name: alpha-brain
    folder: /x/alpha
  - project: nowinv
    name: nowinv-brain
  - project: pal
    name: ac-pal
    assistant: true
    display: Pal
    family_title: Acme Co
bots:
  git:
    tier: complex
    display: Git Bot
    pool:
      - provider: x
  missing:
    display: Nope
"""


def mkdb(path, ddl, rows=()):
    path.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(path)
    c.executescript(ddl)
    for sql, args in rows:
        c.execute(sql, args)
    c.commit()
    c.close()


@pytest.fixture
def home(tmp_path):
    now = time.time()
    h = tmp_path / "hermes"
    (h / "fleet").mkdir(parents=True)
    (h / "fleet" / "acme.yaml").write_text(FLEET)
    for p in ("ac-pal", "ac-git", "alpha-brain"):
        (h / "profiles" / p).mkdir(parents=True)
    # assistant state.db: a human message 30 s ago, no reply yet, no lease
    mkdb(h / "profiles" / "ac-pal" / "state.db",
         "create table messages(id integer primary key, role text, content text, timestamp real, display_kind text);"
         "create table session_turn_leases(expires_at real);",
         [("insert into messages(role,content,timestamp,display_kind) values('user','hello',?,'')", (now - 30,))])
    # brain board
    mkdb(h / "kanban" / "boards" / "alpha" / "kanban.db",
         "create table tasks(id text, title text, assignee text, status text);"
         "create table task_comments(id integer primary key, task_id text, author text, body text, created_at real);"
         "create table task_events(id integer primary key, task_id text, kind text, created_at real);",
         [("insert into tasks values('t1','Build it','coder','running')", ()),
          ("insert into tasks values('t2','Wait','coder','blocked')", ()),
          ("insert into tasks values('t3','Old','coder','archived')", ()),
          ("insert into tasks values('t4','Shipped','qa','done')", ()),
          ("insert into task_comments(task_id,author,body,created_at) values('t1','coder','token=abcd1234 hi',?)", (now - 60,)),
          ("insert into task_events(task_id,kind,created_at) values('t1','completed',?)", (now - 50,))])
    return h


def worker(**kw):
    w = {"id": "w1-host", "pid": 1, "engine": "claude", "role": "coder", "model": "m", "project": "alpha",
         "ticket": "LST-1", "task": "do it", "status": "running", "secs": 100, "age": 100,
         "parent": "alpha-brain", "host": "local"}
    w.update(kw)
    return w


def host(*agents):
    return {"name": "local", "addr": "local", "hostname": "h", "online": True, "checked_at": time.time(),
            "agents": list(agents)}


def test_parse_fleet_spec():
    s = hive.parse_fleet_spec(FLEET)
    assert s["family"] == "acme" and s["prefix"] == "ac"
    assert [o["name"] for o in s["orchestrators"]] == ["alpha-brain", "nowinv-brain", "ac-pal"]
    assert s["orchestrators"][2]["assistant"] is True
    assert set(s["bots"]) == {"git", "missing"} and s["bots"]["git"]["display"] == "Git Bot"


def test_parse_fleet_spec_inline_flow_mappings():
    s = hive.parse_fleet_spec(
        "family: pv\norchestrators:\n"
        "  - {project: pixelvent-launchpad, name: pixelvent-launchpad-brain, folder: /x/pl}\n"
        "  - {project: 'a, b', name: \"q-brain\", display: 'Hi: there, you', assistant: false}\n"
        "  - {project: pal, name: pv-pal, assistant: true}  # c\n"
        "bots:\n  git:\n    display: G\n")
    o = s["orchestrators"]
    assert [x["name"] for x in o] == ["pixelvent-launchpad-brain", "q-brain", "pv-pal"]
    assert o[0]["project"] == "pixelvent-launchpad" and o[0]["folder"] == "/x/pl"
    assert o[1]["project"] == "a, b" and o[1]["display"] == "Hi: there, you" and o[1]["assistant"] is False
    assert o[2]["assistant"] is True and set(s["bots"]) == {"git"}


def test_load_families_roster(home):
    (fam,) = hive.load_families(home)
    assert fam["id"] == "acme" and fam["label"] == "Acme Co"
    assert fam["assistant"] == {"id": "ac-pal", "label": "Pal"}
    assert [b[0] for b in fam["brains"]] == ["alpha-brain", "nowinv-brain"]
    assert fam["brains"][1][2] == "NowInv"
    assert fam["bots"] == [("ac-git", "Git Bot")]  # bot without a profile dir is skipped


def test_load_families_no_fleet(tmp_path):
    assert hive.load_families(tmp_path) == []


def test_snapshot_shape_and_json(home):
    now = time.time()
    snap = hive.collect(home, now=now, scan=False, hosts=[host(worker(), worker(id="w2", status="queued", secs=5))])
    assert snap["schema_version"] == SCHEMA_VERSION
    json.dumps(snap)
    (fam,) = snap["families"]
    brain = fam["brains"][0]
    assert brain["counts"]["running"] == 1 and brain["counts"]["blocked"] == 1 and brain["counts"]["done"] == 1
    assert [a["id"] for a in brain["agents"]] == ["coder"]  # archived + done excluded from live agents
    assert len(brain["workers"]) == 2
    assert brain["idle"] is None  # empty profile dir: no activity files
    assert fam["assistant"]["idle"] < 5
    assert f"acme:t4" in snap["tasks"] and "acme:t3" not in snap["tasks"]
    assert snap["tasks"]["acme:alpha-brain:w1-host"]["worker"] is True
    assert snap["unattributed"] == []


def test_unattributed_workers(home):
    snap = hive.collect(home, now=time.time(), scan=False, hosts=[host(worker(parent="stranger"))])
    assert [w["id"] for w in snap["unattributed"]] == ["w1-host"]
    assert "root:unattributed:w1-host" in snap["tasks"]


def test_pressure_formula():
    assert hive.pressure({}, [])["pressure"] == 0
    p = hive.pressure({"blocked": 1, "running": 1}, [worker(), worker(status="queued")])
    assert p["score"] == 2 + 1.5 + 1.5 + 1  # 6.0
    assert p["pressure"] == pytest.approx(0.9) and p["level"] == "full blaze"
    long = hive.pressure({}, [worker(secs=4000)])
    assert long["score"] == 4 and long["max_age"] == 4000
    assert hive.score_to_pressure(3) == 0.5 and hive.score_to_pressure(99) == 1.0
    assert hive.flame_level(0.55) == "smoulder" and hive.flame_level(0.1) == "none"


def test_pressure_in_snapshot(home):
    snap = hive.collect(home, now=time.time(), scan=False, hosts=[host(worker())])
    pr = snap["pressure"]["b:acme:alpha-brain"]
    assert pr["kind"] == "brain" and pr["score"] == 2 + 1.5 + 1  # 1 running worker, 1 blocked, 1 running task
    assert snap["pressure"]["a:acme"]["pressure"] == 0


def test_user_state_waiting_then_idle(home):
    now = time.time()
    (fam,) = hive.load_families(home)
    st = hive.user_state([fam], home, now)
    link = st["links"][0]
    assert link["state"] == "waiting" and link["last_user_at"] == pytest.approx(now - 30, abs=1)
    assert st["state"] == "waiting"
    assert "bot chat dir missing" in link["errors"]
    st2 = hive.user_state([fam], home, now + 600)  # same data, 10 min later
    assert st2["state"] == "idle"


def test_user_state_sending_reply_question(home):
    now = 1000.0
    base = {"last_user_at": None, "last_reply_at": None, "reply_text": "", "turn": False, "turn_src": ""}
    assert hive.link_state({**base, "last_user_at": now - 2}, now)[0] == "sending"
    assert hive.link_state({**base, "last_user_at": now - 20, "last_reply_at": now - 3}, now)[0] == "reply"
    q = {**base, "last_user_at": now - 60, "last_reply_at": now - 30, "reply_text": "Shall I proceed?"}
    assert hive.link_state(q, now)[0] == "question"
    assert hive.link_state({**base, "turn": True, "turn_src": "turn lease"}, now)[0] == "waiting"


def test_injected_user_rows_ignored(home):
    now = time.time()
    c = sqlite3.connect(home / "profiles" / "ac-pal" / "state.db")
    c.execute("delete from messages")
    c.execute("insert into messages(role,content,timestamp,display_kind) values('user','[IMPORTANT: Background x]',?,'')", (now - 1,))
    c.execute("insert into messages(role,content,timestamp,display_kind) values('user','hi',?,'cron')", (now - 1,))
    c.commit()
    c.close()
    p = hive.probe_profile(home, "ac-pal", now)
    assert p["last_user_at"] is None


def test_comms_window_and_redaction(home):
    now = time.time()
    (fam,) = hive.load_families(home)
    items = hive.comms([fam], home, now)
    kinds = {i["kind"] for i in items}
    assert {"comment", "event"} <= kinds
    cm = next(i for i in items if i["kind"] == "comment")
    assert "abcd1234" not in cm["text"] and "[redacted]" in cm["text"]
    assert hive.comms([fam], home, now + 2 * hive.COMM_WINDOW) == []


def test_bot_chat_delivery(home):
    now = time.time()
    d = home / "profiles" / "ac-pal" / "runtime" / "bot_live_delivery"
    d.mkdir(parents=True)
    (d / "a.json").write_text(json.dumps({"delivery_id": "abc", "message": "ping?", "reply": "pong", "author": {"name": "hazem"}}))
    (d / "bad.json").write_text("{not json")
    (fam,) = hive.load_families(home)
    items = hive.comms([fam], home, now)
    ask = next(i for i in items if i["id"] == "bc:abc")
    assert ask["from"] == "hazem" and ask["to"] == "ac-pal"
    assert any(i["id"] == "bc:abc:r" for i in items)
    p = hive.probe_profile(home, "ac-pal", now)
    assert "bot chat (1)" in p["sources"] and p["last_reply_at"] is not None


def test_open_sessions_and_last_activity(home):
    now = time.time()
    rt = home / "profiles" / "ac-git" / "runtime"
    rt.mkdir(parents=True)
    (rt / "active_sessions.json").write_text(json.dumps({"entries": [1, 2]}))
    assert hive.open_sessions(home, "ac-git") == 2 and hive.open_sessions(home, "nobody") == 0
    os.utime(rt / "active_sessions.json", (now - 100, now - 100))
    assert hive.last_activity(home, "ac-git", now) == pytest.approx(100, abs=2)
    assert hive.last_activity(home, "nobody", now) is None


def test_scan_host_unreachable_is_offline(monkeypatch):
    def boom(*a, **k):
        raise OSError("no ssh")
    monkeypatch.setattr(hive.subprocess, "run", boom)
    h = hive.scan_host("10.invalid", timeout=1)
    assert h["online"] is False and h["agents"] == []


def test_scan_local_returns_agents_list():
    h = hive.scan_host("local")
    assert h["online"] is True and isinstance(h["agents"], list)


def test_classify_via_scanner_source():
    ns = {"__name__": "t"}
    exec(hive._SCANNER_CODE, ns)
    c = ns["classify"](["/usr/bin/python3", "/bin/pi-worker", "root", "coder", "proj", "fix LST-12 now"], "/")
    assert c["kind"] == "worker" and c["engine"] == "pi" and c["role"] == "coder"
    assert ns["classify"](["/usr/bin/vim", "x"], "/") is None


def test_collect_real_scan_smoke(home):
    snap = hive.collect(home, hosts=[])
    json.dumps(snap)
    assert snap["hosts"][0]["name"] == "local"


# Roster fix: ~/.hermes/fleet/*.yaml is PyYAML-dumped (zero-indent list items,
# folded multi-line scalars), which the hand reader cannot follow. load_families
# must use yaml.safe_load, report malformed specs, and fall back to the hand
# reader only when PyYAML is unavailable.
ROOT_STYLE = {
    "family": "root",
    "parent_home": "~/.hermes",
    "prefix": "beinno",
    "max_running": 4,
    "tracking_rule": ("Tickets live in Plane (plane.beinno.com) ONLY; assign ticket work to "
                      "beinno-plane. GitHub is for code only (branches, PRs, CI, releases); "
                      "never create, edit or mirror GitHub issues or Projects items."),
    "orchestrators": [
        {"project": "hazem-resume", "name": "beinno-resume-brain", "folder": "/x/hazem-resume-latex",
         "about": ("Hazem resume maintenance; use beinno-resume-updates specialist. "
                   "Evidence-backed updates only; compile and inspect PDF.")},
        {"project": "llm-telemetry", "name": "llm-telemetry-brain", "folder": "/x/LLM-Telemtry"},
        {"project": "horus", "name": "horus-brain", "folder": "/x/horus"},
        {"project": "donna", "name": "beinno-donna", "assistant": True, "display": "Donna",
         "family_title": "Beinno", "folder": "/x/beinno-donna/workspace",
         "group": ["llm-telemetry-brain", "horus-brain"]},
    ],
    "bots": {
        "git": {"tier": "complex", "display": "Git",
                "job": ("Git and pull-request specialist for every Beinno project: "
                        "branches, merges, pull requests."),
                "pool": [{"provider": "anthropic", "model": "claude-opus-5-5"}]},
        "designer": {"tier": "complex", "display": "Designer",
                     "job": ("Expert product and visual designer: turn product goals "
                             "into high-quality UX flows.")},
        "missing": {"display": "Nope"},
    },
}
# Exactly how root.yaml lands on disk: PyYAML-dumped, zero-indent list items.
ROOT_YAML = yaml.dump(ROOT_STYLE, sort_keys=False, default_flow_style=False, width=60)


@pytest.fixture
def root_home(tmp_path):
    h = tmp_path / "hermes"
    (h / "fleet").mkdir(parents=True)
    (h / "fleet" / "root.yaml").write_text(ROOT_YAML)
    for p in ("beinno-donna", "beinno-git", "beinno-designer"):
        (h / "profiles" / p).mkdir(parents=True)
    return h


def test_load_families_pyyaml_root_roster(root_home):
    # the fixture really is root-style: zero-indent list items + a folded about field
    assert "\n- project: " in ROOT_YAML
    assert re.search(r"about: .*\n\s+\S", ROOT_YAML)
    (fam,) = hive.load_families(root_home)
    assert fam["id"] == "root" and fam["label"] == "Beinno"
    assert fam["assistant"] == {"id": "beinno-donna", "label": "Donna"}
    assert [b[0] for b in fam["brains"]] == ["beinno-resume-brain", "llm-telemetry-brain", "horus-brain"]
    assert fam["brains"][1][2] == "LLM Telemetry"
    assert dict(fam["bots"]) == {"beinno-git": "Git", "beinno-designer": "Designer"}


def test_load_families_reports_malformed_spec(root_home, caplog):
    (root_home / "fleet" / "broken.yaml").write_text("family: broken\norchestrators:\n- {name: x\n  bad: [\n")
    with caplog.at_level(logging.WARNING, logger="llm_telemetry.hive"):
        fams = hive.load_families(root_home)
    assert [f["id"] for f in fams] == ["root"]   # the good family still loads
    assert any("fleet parse error" in r.getMessage() and "broken.yaml" in r.getMessage()
               for r in caplog.records)


def test_read_fleet_spec_falls_back_without_pyyaml(monkeypatch):
    monkeypatch.setattr(hive, "yaml", None)
    s = hive.read_fleet_spec(FLEET)
    assert s["family"] == "acme" and [o["name"] for o in s["orchestrators"]] == [
        "alpha-brain", "nowinv-brain", "ac-pal"]


def test_unreadable_board_keeps_last_good_read(home, monkeypatch):
    now = time.time()
    first = hive.collect(home, now=now, scan=False, hosts=[])
    assert "acme:t4" in first["tasks"]
    monkeypatch.setattr(hive, "read_board", lambda h, b: None)   # sqlite hiccup this tick
    again = hive.collect(home, now=now + 5, scan=False, hosts=[])
    assert "acme:t4" in again["tasks"] and again["families"][0]["brains"][0]["counts"]["done"] == 1
    assert hive.diff_tasks(first["tasks"], again["tasks"]) == []   # no phantom events from the hiccup
