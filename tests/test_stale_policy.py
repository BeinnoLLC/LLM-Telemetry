"""Stale-rate policy (LST-204/205/207): ages come from payload timestamps, relative to now."""
import json
import os
import sys
import time
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from llm_telemetry import doctor as D  # noqa: E402
from llm_telemetry import stale as S  # noqa: E402

H = 3600


def _write(d, name, payload):
    with open(os.path.join(d, name), "w") as fh:
        json.dump(payload, fh)


def _reports(tmp_path, price_age_h=1, rank_age_h=1, router_age_h=0.1, quota_age_h=0.1,
             analytics_age_h=0.0, rank_error=None):
    now = time.time()
    d = str(tmp_path)
    iso = lambda hours: time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(now - hours * H))
    _write(d, "pricing-cache.json", {"fetched_at": iso(price_age_h), "last_error": None})
    rk = {"status": "ok", "fetched_at": iso(rank_age_h)}
    if rank_error:
        rk["last_error"] = {"reason": rank_error}
    _write(d, "rankings-data.json", rk)
    _write(d, "router-data.json", {"collected_at": int(now - router_age_h * H)})
    _write(d, "quota-data.json", {"collected_at": int(now - quota_age_h * H)})
    _write(d, "analytics-data.json", {"generated": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(now - analytics_age_h * H))})
    return d, now


def test_fresh_sources_not_stale(tmp_path):
    d, now = _reports(tmp_path)
    out = S.compute(d, now=now, env={})
    assert set(out) == {"prices", "rankings", "router", "quota", "analytics"}
    assert not any(r["stale"] for r in out.values())
    assert out["prices"]["policy_s"] == 24 * H and out["rankings"]["policy_s"] == 12 * H


def test_default_policies_flag_old_sources(tmp_path):
    d, now = _reports(tmp_path, price_age_h=25, rank_age_h=13, rank_error="HTTP 503")
    out = S.compute(d, now=now, env={})
    assert out["prices"]["stale"] and out["rankings"]["stale"]
    assert out["rankings"]["last_error"] == "HTTP 503"
    assert out["prices"]["age_s"] == 25 * H


def test_env_knobs_override_and_bad_values_fall_back(tmp_path):
    d, now = _reports(tmp_path, price_age_h=25)
    env = {"LLM_TELEMETRY_STALE_PRICES_H": "48", "LLM_TELEMETRY_STALE_RANKINGS_H": "junk"}
    out = S.compute(d, now=now, env=env)
    assert out["prices"]["policy_s"] == 48 * H and not out["prices"]["stale"]
    assert out["rankings"]["policy_s"] == 12 * H


def test_missing_artifact_is_unknown_not_stale(tmp_path):
    out = S.compute(str(tmp_path), now=time.time(), env={})
    assert all(r["age_s"] is None and not r["stale"] for r in out.values())


def _cfg(d):
    return SimpleNamespace(reports_dir=d)


def test_doctor_freshness_ok(tmp_path):
    d, now = _reports(tmp_path)
    rows = D.check_freshness(_cfg(d), now=now, env={})
    assert len(rows) == 5 and all(r["status"] == D.OK for r in rows)


def test_doctor_freshness_fails_when_stale_and_exit_nonzero(tmp_path, monkeypatch, capsys):
    d, now = _reports(tmp_path, price_age_h=30)
    rows = D.check_freshness(_cfg(d), now=now, env={})
    bad = [r for r in rows if r["status"] == D.FAIL]
    assert [r["name"] for r in bad] == ["freshness prices"]
    assert "llm-telemetry-prices.timer" in bad[0]["detail"]
    monkeypatch.setattr(D, "run_checks", lambda offline=False: rows)
    assert D.main(["--offline"]) == 1
    monkeypatch.setattr(D, "run_checks", lambda offline=False: [r for r in rows if r["status"] == D.OK])
    assert D.main(["--offline"]) == 0
