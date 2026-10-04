"""Quota collector (#115): the whitelist, the scrubber, and the shapes.

The dashboard never holds a provider credential, so the collector's whitelist is
the actual security boundary — anything the cache carries that is NOT in
_WINDOW_FIELDS / _BALANCE_FIELDS / provider()'s named keys must not survive into
the payload. These tests pin that boundary with the kinds of value a real cache
holds, so widening a field later is a deliberate act rather than an accident.

Nothing here touches the network, and no test value is a real credential: every
"secret" below is a synthetic shape standing in for one, and every committed
fixture is marked `sample: true` (see examples/check_no_leaks.py).
"""
import json

import pytest

from llm_telemetry import collect_quota as cq


# --- the scrubber -------------------------------------------------------------

@pytest.mark.parametrize("raw", [
    "sk-abcdef0123456789abcdef",
    "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123",
    "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
    "api_key: hunter2hunter2",
    "access-token= abcdefghijklmnop",
    "password = correcthorsebattery",
    "refresh_token: r-e-f-r-e-s-h",
    "a" * 60,
])
def test_scrub_removes_credential_shapes(raw):
    """Every credential shape must be gone, not merely shortened."""
    out = cq.scrub(raw)
    assert cq._SECRET_REPLACEMENT in out
    for frag in ("sk-abcdef", "ghp_ABCDEF", "Bearer eyJ", "hunter2",
                 "correcthorse", "r-e-f-r-e-s-h"):
        assert frag not in out


def test_scrub_keeps_innocent_text_readable():
    """Scrubbing must not destroy the descriptive text a human reads."""
    raw = "Resets at 2026-01-01T00:00:00Z. Rate limit: 60 requests/min."
    out = cq.scrub(raw)
    assert "Resets at" in out
    assert "60 requests/min" in out
    assert cq._SECRET_REPLACEMENT not in out


def test_scrub_caps_runaway_text():
    """A provider echoing a novel must not bloat the page; the cap is 400."""
    assert len(cq.scrub("x " * 5000)) == 400


def test_scrub_passes_through_non_strings():
    assert cq.scrub(None) is None
    assert cq.scrub({"a": 1}) is None


# --- coercion -----------------------------------------------------------------

@pytest.mark.parametrize("value", [None, True, False, "", "abc", "NaN", float("nan")])
def test_percent_rejects_non_numbers(value):
    """Bool is not a percentage here: `api_calls_available: false` must not
    silently become 0% used, which would read as 'plenty of headroom'."""
    assert cq._percent(value) is None


@pytest.mark.parametrize("value,expected", [(0, 0.0), (42, 42.0), ("87.456", 87.46),
                                            (100, 100.0)])
def test_percent_accepts_numbers(value, expected):
    assert cq._percent(value) == expected


def test_numstr_keeps_decimal_precision_verbatim():
    """Balance amounts are the provider's to format; float repr would lose
    cents on a large balance, so strings pass through untouched."""
    assert cq._numstr("1234.56789012") == "1234.56789012"
    assert cq._numstr("1,234.50") == "1,234.50"


def test_numstr_rejects_bool_and_objects():
    assert cq._numstr(True) is None
    assert cq._numstr(object()) is None


def test_numstr_scrubs_a_secret_shaped_amount():
    assert cq._SECRET_REPLACEMENT in cq._numstr("sk-abcdef0123456789abcdef")


# --- the whitelist ------------------------------------------------------------

def test_window_keeps_only_named_fields():
    raw = {"label": "5h", "reset_at": "2026-01-01T00:00:00Z", "used_percent": 12.5,
           "api_key": "sk-abcdef0123456789abcdef",
           "auth_token": "should-not-survive", "plan": "Pro"}
    out = cq.window(raw)
    assert set(out) <= set(cq._WINDOW_FIELDS)
    assert out["label"] == "5h"
    assert out["used_percent"] == 12.5
    assert "sk-abcdef" not in json.dumps(out)
    assert "should-not-survive" not in json.dumps(out)


def test_balance_keeps_only_named_fields():
    raw = {"currency": "USD", "total_balance": "12.34",
           "granted_balance": "10.00", "topped_up_balance": "2.34",
           "session_token": "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123"}
    out = cq.balance(raw)
    assert set(out) <= set(cq._BALANCE_FIELDS)
    assert out["currency"] == "USD"
    assert "ghp_ABCDEF" not in json.dumps(out)


def test_provider_drops_unknown_and_scrubs_free_text():
    """An unexpected cache key must not pass through, and free text a provider
    echoed back must be scrubbed."""
    raw = {"label": "Example", "plan": "free", "attention": False,
           "api_calls_available": True, "unavailable_reason": None,
           "windows": [{"label": "1d", "used_percent": 99, "reset_at": None,
                        "secret_key": "sk-abcdef0123456789abcdef"}],
           "account_balances": [{"currency": "USD", "total_balance": "1.00"}],
           "details": ["key sk-abcdef0123456789abcdef is yours"],
           "raw_response": {"everything": "including tokens"},
           "session_id": "sess_abcdef0123456789abcdef"}
    out = cq.provider("example", raw)
    blob = json.dumps(out)
    assert "secret_key" not in blob
    assert "raw_response" not in blob
    assert "sk-abcdef" not in blob
    assert cq._SECRET_REPLACEMENT in blob          # the reason it was replaced
    # 99% clears the 90% threshold, so this fixture is itself an attention case.
    assert out["attention"] is True
    assert out["max_used_percent"] == 99.0
    assert out["windows"][0]["used_percent"] == 99


def test_provider_marks_attention_from_the_worst_window():
    """The `attention` flag is the collector's own judgement, so the view never
    has to recompute the threshold: it ships with the payload."""
    hot = {"label": "Hot", "windows": [{"label": "5h", "used_percent": 10},
                                       {"label": "1d", "used_percent": 95}]}
    cool = {"label": "Cool", "windows": [{"label": "5h", "used_percent": 10}]}
    assert cq.provider("hot", hot)["attention"] is True
    assert cq.provider("cool", cool)["attention"] is False


def test_provider_with_no_windows_is_not_attention():
    """Nothing reported is not 'near limit'; it is simply unknown."""
    assert cq.provider("empty", {"label": "Empty"})["attention"] is False


def test_provider_preserves_explicit_unavailable_reason():
    out = cq.provider("down", {"label": "Down",
                               "unavailable_reason": "not logged in",
                               "api_calls_available": False})
    assert out["unavailable_reason"] == "not logged in"
    assert out["api_calls_available"] is False


# --- the cache reader ---------------------------------------------------------

def test_read_cache_missing_file_is_empty_not_an_error(tmp_path):
    """No plugin installed must not break a collection run."""
    assert cq.read_cache(tmp_path) in ({}, {"profiles": {}}, None)


def test_profile_payload_with_no_cache_is_empty(tmp_path):
    out = cq.profile_payload(tmp_path)
    assert out["providers"] == {}


# --- summary + payload --------------------------------------------------------

def test_summarise_counts_across_profiles():
    profiles = {
        "a": {"providers": {"x": {"attention": True, "unavailable_reason": None},
                            "y": {"attention": False, "unavailable_reason": "no key"}}},
        "b": {"providers": {"z": {"attention": False, "unavailable_reason": None}}},
    }
    s = cq.summarise(profiles)
    assert s["providers"] == 3
    assert s["attention"] == 1
    assert s["available"] == 2


def test_attention_threshold_is_a_single_float():
    """The view reads this number rather than restating it; a float here and an
    int there would silently change what 'near limit' means."""
    assert isinstance(cq.ATTENTION_PERCENT, float)
    assert 0 < cq.ATTENTION_PERCENT <= 100


def test_history_sample_contains_no_credentials():
    """History is append-only and long-lived, so it gets the same guarantee.
    Built through provider() rather than hand-written, so the test cannot assert
    a shape the collector never actually emits."""
    data = {"profiles": {"a": {"providers": {"x": cq.provider("x", {
        "label": "X", "plan": "free", "attention": False,
        "api_calls_available": True, "unavailable_reason": None,
        "details": ["key sk-abcdef0123456789abcdef"],
        "windows": [{"label": "5h", "used_percent": 10, "reset_at": None}],
        "account_balances": []})}}}}
    sample = cq.history_sample(1700000000, data)
    assert sample is not None          # empty input yields None: nothing to ledger
    assert "sk-abcdef" not in json.dumps(sample)
    # One compact row per profile/provider: {t, providers}, not the full payload.
    assert sample["t"] == 1700000000
    assert sample["providers"]["a"]["x"]["windows"]["5h"] == 10
    assert sample["providers"]["a"]["x"]["plan"] == "free"


def test_history_sample_is_none_when_there_is_nothing_to_record():
    """An all-empty ledger row would be noise in an append-only file."""
    assert cq.history_sample(1700000000, {"profiles": {}}) is None
    assert cq.history_sample(1700000000, {"profiles": {"a": {"providers": {}}}}) is None