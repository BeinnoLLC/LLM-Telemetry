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


def test_account_copies_only_whitelisted_fields():
    """The account whitelist is the guarantee, so test it as one: a pool entry
    carries whatever the plugin puts there, including secrets."""
    acct = cq.account({
        "id": "acct-1", "label": "primary", "status": "bogus", "last_status": "ok",
        "priority": 0, "request_count": 12, "access_token": "sk-live-abcdefghijkl",
        "refresh_token": "rt-live-abcdefghijkl", "unexpected": "surprise",
    })
    assert acct is not None
    assert set(acct) == set(cq._ACCOUNT_FIELDS) | {
        "status", "models", "in_use", "usage", "priority", "request_count"}
    assert "access_token" not in acct and "refresh_token" not in acct
    assert "secret_fingerprint" not in acct  # a hash of a secret is still secret-shaped
    assert "unexpected" not in acct
    assert "sk-live" not in json.dumps(acct)


def test_account_reads_the_cache_spelling_as_well_as_the_pool_one():
    """The cache normalises `last_status`/`model_cooldowns`; a file written by a
    different plugin version is routine, so both spellings must read."""
    from_cache = cq.account({"id": "a", "status": "exhausted", "models": ["gpt-5"]})
    from_pool = cq.account(
        {"id": "a", "last_status": "exhausted", "model_cooldowns": {"gpt-5": {}}})
    assert from_cache is not None and from_pool is not None
    assert from_cache["status"] == from_pool["status"] == "exhausted"
    assert from_cache["models"] == from_pool["models"] == ["gpt-5"]


def test_in_use_marks_one_key_and_defaults_to_false():
    """Several keys can sit under one provider; the view has to show which one
    the next request would actually use."""
    marked = cq.account({"id": "a", "in_use": True})
    unmarked = cq.account({"id": "a"})
    truthy = cq.account({"id": "a", "in_use": "yes"})
    assert marked is not None and unmarked is not None and truthy is not None
    assert marked["in_use"] is True
    assert unmarked["in_use"] is False
    # Only a real boolean counts -- a truthy string is not a verdict.
    assert truthy["in_use"] is False


def test_per_key_usage_is_whitelisted_and_defaults_to_empty():
    """`[]` means "not measured for this key", never "this key has no usage"."""
    acct = cq.account({"id": "a", "usage": [
        {"label": "weekly", "used_percent": 12.5, "reset_at": "2026-01-01"},
        {"used_percent": 3},  # no label -> not a window
        "nonsense",
    ]})
    unmeasured = cq.account({"id": "a"})
    malformed = cq.account({"id": "a", "usage": "nope"})
    assert acct is not None and unmeasured is not None and malformed is not None
    assert [w["label"] for w in acct["usage"]] == ["weekly"]
    assert acct["usage"][0]["used_percent"] == 12.5
    assert unmeasured["usage"] == []
    assert malformed["usage"] == []


def test_a_spent_key_never_carries_a_credential_value():
    """The per-key path adds fields, so re-assert the whitelist on it too."""
    acct = cq.account({
        "id": "acct-1", "status": "exhausted", "in_use": True,
        "usage": [{"label": "weekly", "used_percent": 1.0}],
        "access_token": "«redacted:sk-…»", "refresh_token": "rt-live-abcdefghijkl",
    })
    assert acct is not None
    blob = json.dumps(acct)
    assert "sk-live" not in blob and "rt-live" not in blob


def test_account_requires_an_identity_and_never_uses_the_label():
    """`id` is the identity. Two pool accounts may share a label -- keying on it
    would merge them, which is the bug the account dimension exists to fix."""
    assert cq.account({"label": "no-id-here"}) is None
    assert cq.account("not-a-dict") is None
    assert cq.account({"id": ""}) is None
    out = cq.provider("p", {"accounts": [
        {"id": "a", "label": "shared"}, {"id": "b", "label": "shared"}]})
    assert [a["id"] for a in out["accounts"]] == ["a", "b"]
    assert len(out["accounts"]) == 2


def test_accounts_are_ordered_by_priority_with_unset_last():
    """Priority is the router's fallthrough order, so the view can render the
    accounts as the chain a request would actually walk."""
    out = cq.provider("p", {"accounts": [
        {"id": "third", "priority": 20},
        {"id": "first", "priority": 0},
        {"id": "unset"},
        {"id": "second", "priority": 5},
    ]})
    assert [a["id"] for a in out["accounts"]] == ["first", "second", "third", "unset"]


def test_provider_without_accounts_yields_an_empty_list():
    """Old caches have no `accounts` key; the view must get `[]`, never None."""
    assert cq.provider("p", {"windows": []})["accounts"] == []
    assert cq.provider("p", {"accounts": None})["accounts"] == []


def test_account_status_is_whitelisted_and_absent_reads_as_unknown():
    """`dead` must stay distinguishable from `exhausted`: one needs a re-login,
    the other resets itself. An unrecognised verdict is not silently 'ok'."""
    assert cq.account({"id": "a", "last_status": "dead"})["status"] == "dead"
    assert cq.account({"id": "a", "last_status": "exhausted"})["status"] == "exhausted"
    assert cq.account({"id": "a", "last_status": "invented"})["status"] is None
    assert cq.account({"id": "a"})["status"] is None


def test_account_models_list_is_bounded_and_scrubbed():
    """`model_cooldowns` is a dict upstream; only its model names are useful and
    a provider must not be able to size the payload."""
    acct = cq.account({"id": "a", "model_cooldowns": {f"m{i}": {} for i in range(30)}})
    assert acct["models"] == [f"m{i}" for i in range(cq._MAX_ACCOUNT_MODELS)]
    assert cq.account({"id": "a", "model_cooldowns": "nope"})["models"] == []
    assert cq.account({"id": "a"})["models"] == []


def test_summarise_counts_accounts_and_usable_ones():
    """The headline number is the fleet, not the row count: a provider can have
    several accounts and only some of them usable."""
    profiles = {"a": {"providers": {"x": {
        "attention": False, "unavailable_reason": None, "accounts": [
            {"id": "1", "status": "ok"},
            {"id": "2", "status": "exhausted"},
            {"id": "3", "status": "dead"},
            {"id": "4", "status": None},
        ]}}}}
    s = cq.summarise(profiles)
    assert s["accounts"] == 4
    assert s["accounts_usable"] == 2
    # The pre-existing counters must not be disturbed by the new dimension.
    assert s["providers"] == 1 and s["available"] == 1 and s["attention"] == 0


def test_summarise_tolerates_providers_that_predate_accounts():
    """A provider dict built by an older collector has no `accounts` key."""
    s = cq.summarise({"a": {"providers": {"x": {"attention": False,
                                               "unavailable_reason": None}}}})
    assert s["accounts"] == 0 and s["accounts_usable"] == 0