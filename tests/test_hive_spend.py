"""LST-270: per-face live model + spend join in llm_telemetry.hive. All timestamps are relative to now."""
import json
import os
import time

import pytest

from llm_telemetry import hive

FLEET = """family: acme
prefix: ac
orchestrators:
  - project: alpha
    name: alpha-brain
  - project: pal
    name: ac-pal
    assistant: true
    display: Pal
bots:
  git:
    display: Git Bot
"""


def write(path, obj):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj))
    os.replace(tmp, path)


def row(day, cls, mv, billed=0.0):
    return {"date": day, "model": "m", "cost_class": cls, "market_value_usd": mv, "billed_usd": billed}


@pytest.fixture
def env(tmp_path):
    now = time.time()
    today = time.strftime("%Y-%m-%d", time.localtime(now))
    old = time.strftime("%Y-%m-%d", time.localtime(now - 3 * 86400))
    home = tmp_path / "hermes"
    (home / "fleet").mkdir(parents=True)
    (home / "fleet" / "acme.yaml").write_text(FLEET)
    for p in ("ac-pal", "ac-git", "alpha-brain"):
        (home / "profiles" / p).mkdir(parents=True)
    rep = tmp_path / "reports"
    rep.mkdir()
    sess = lambda m, idle=5: {"id": "s", "model": m, "idle_s": idle, "base_url": "https://x"}  # noqa: E731
    write(rep / "live-data.json", {"profiles": {
        "ac-pal": {"live": [sess("claude-opus-5-5", 90), sess("claude-sonnet-5-5", 3)]},
        "alpha-brain": {"live": [sess("glm-4.7-flash:latest")]},
        "ac-git": {"live": []}},
        "agent_live": [{"engine": "claude", "title": "alpha", "model": "claude-sonnet-5-5", "cost_usd": 1.25,
                        "cost_class": "subscription"}]})
    write(rep / "analytics-data.json", {"profiles": {
        "ac-pal": {"rows": [row(today, "metered", 2.0, 2.0), row(today, "metered", 0.5, 0.5),
                            row(today, "subscription", 9.0), row(old, "metered", 100.0, 100.0)]},
        "alpha-brain": {"rows": [row(today, "local", 0.3)]},
        "ac-git": {"rows": [row(today, "subscription", 4.0)]}}})
    write(rep / "costs-data.json", {"models": [{"model": "claude-sonnet-5-5", "in_1m": 3.0, "out_1m": 15.0,
                                                "rate_origin": "catalog", "served_by": "anthropic", "cost": 9}]})
    write(rep / "ollama-data.json", {"hosts": [{"loaded": [{"name": "glm-4.7-flash:latest"}]}]})
    return home, rep, now


def snap(env, reports=True, hosts=(), boards=None):
    home, rep, now = env
    return hive.collect(home, now=now, scan=False, hosts=list(hosts),
                        boards=boards if boards is not None else {"alpha": []},
                        reports=rep if reports else False)


def faces(s):
    f = s["families"][0]
    return f["assistant"], f["bots"][0], f["brains"][0]


def test_join_model_and_spend(env):
    pal, git, alpha = faces(snap(env))
    assert pal["model"] == "claude-sonnet-5-5"        # newest live session wins
    assert pal["model_info"]["in_1m"] == 3.0
    assert pal["spend"]["usd"] == 2.5 and pal["spend"]["window"] == "today"
    assert pal["spend"]["cost_class"] == "metered"
    assert pal["spend"]["stale"] is False
    # the 3-day-old $100 row is outside the window
    assert pal["spend"]["usd"] < 100


def test_subscription_covered_excluded_from_est_cost(env):
    pal, git, _ = faces(snap(env))
    assert pal["spend"]["covered_by_subscription"] is True and pal["spend"]["covered_usd"] == 9.0
    assert pal["spend"]["label"] == "covered by subscription"
    assert pal["spend"]["usd"] == 2.5                  # 9.0 subscription not in usd
    assert git["spend"] == {"usd": 0.0, "window": "today", "cost_class": "subscription", "stale": False,
                            "covered_by_subscription": True, "covered_usd": 4.0, "label": "covered by subscription"}
    assert git["model"] is None                        # no live session: model stays null


def test_local_model_is_free_not_priced(env):
    _, _, alpha = faces(snap(env))
    assert alpha["model"] == "glm-4.7-flash:latest"
    assert alpha["model_info"]["local"] is True
    assert alpha["spend"]["usd"] == 0.0 and alpha["spend"]["cost_class"] == "local"


def test_agent_alias_and_unmapped_profile(env):
    boards = {"alpha": [{"id": "t1", "title": "x", "assignee": "git", "status": "running"},
                        {"id": "t2", "title": "y", "assignee": "ghost", "status": "running"}]}
    _, _, alpha = faces(snap(env, boards=boards))
    ag = {a["id"]: a for a in alpha["agents"]}
    assert ag["git"]["spend"]["covered_usd"] == 4.0    # mapped to bot ac-git
    assert ag["ghost"]["model"] is None and ag["ghost"]["spend"] is None   # data-less face


def test_missing_artifacts_spend_null(env):
    home, rep, now = env
    for f in rep.iterdir():
        f.unlink()
    for face in faces(snap(env)):
        assert face["spend"] is None and face["model"] is None and face["model_info"] is None


def test_corrupt_artifact_is_missing(env):
    home, rep, now = env
    (rep / "analytics-data.json").write_text("{not json")
    pal, _, _ = faces(snap(env))
    assert pal["spend"] is None and pal["model"] == "claude-sonnet-5-5"


def test_profile_absent_from_analytics_is_null_not_zero(env):
    home, rep, now = env
    write(rep / "analytics-data.json", {"profiles": {}})
    assert faces(snap(env))[0]["spend"] is None


def test_stale_artifacts(env):
    home, rep, now = env
    old = now - 7200
    os.utime(rep / "live-data.json", (old, old))
    os.utime(rep / "analytics-data.json", (old, old))
    pal, _, _ = faces(snap(env))
    assert pal["model"] is None                       # stale live-data is not "live"
    assert pal["spend"]["stale"] is True and pal["spend"]["usd"] == 2.5   # spend kept, flagged


def test_worker_subscription_label(env):
    w1 = {"id": "w1", "engine": "claude", "project": "alpha", "model": "claude-sonnet-5-5", "status": "running",
          "parent": "alpha-brain"}
    w2 = {"id": "w2", "engine": "codex", "project": "zzz", "model": "", "status": "running", "parent": "alpha-brain"}
    w3 = {"id": "w3", "engine": "pi", "project": "alpha", "model": "coder", "status": "running", "parent": "alpha-brain"}
    s = snap(env, hosts=[{"name": "local", "addr": "local", "hostname": "h", "online": True,
                          "checked_at": time.time(), "agents": [w1, w2, w3]}])
    ws = {w["id"]: w for w in s["families"][0]["brains"][0]["workers"]}
    assert ws["w1"]["spend"]["covered_by_subscription"] and ws["w1"]["spend"]["usd"] == 0.0
    assert ws["w1"]["spend"]["covered_usd"] == 1.25
    assert ws["w2"]["spend"]["usd"] is None and ws["w2"]["spend"]["cost_class"] == "subscription"
    assert ws["w2"]["model"] is None
    assert ws["w3"]["spend"] is None                   # pi worker: no joinable artifact, never invented
    assert ws["w1"]["model_info"]["in_1m"] == 3.0


def test_no_cache_rereads_each_snapshot(env):
    home, rep, now = env
    assert faces(snap(env))[0]["model"] == "claude-sonnet-5-5"
    live = json.loads((rep / "live-data.json").read_text())
    live["profiles"]["ac-pal"]["live"] = [{"model": "new-model", "idle_s": 1}]
    write(rep / "live-data.json", live)
    assert faces(snap(env))[0]["model"] == "new-model"


def test_read_artifact_atomic_replace_and_retry(tmp_path):
    p = tmp_path / "live-data.json"
    write(p, {"a": 1})
    now = time.time()
    assert hive.read_artifact(p, now)["data"] == {"a": 1}
    write(p, {"a": 2})
    assert hive.read_artifact(p, now)["data"] == {"a": 2}
    p.write_text("[1]")
    assert hive.read_artifact(p, now) is None          # not an object
    assert hive.read_artifact(tmp_path / "gone.json", now) is None


def test_read_artifact_retries_torn_read(tmp_path, monkeypatch):
    p = tmp_path / "live-data.json"
    p.write_text('{"a"')
    real_sleep = time.sleep

    def fix(_):
        p.write_text('{"a": 3}')
        real_sleep(0)
    monkeypatch.setattr(hive.time, "sleep", fix)
    assert hive.read_artifact(p, time.time())["data"] == {"a": 3}


def test_reports_false_skips_join(env):
    for f in faces(snap(env, reports=False)):
        assert f["spend"] is None and f["model"] is None
