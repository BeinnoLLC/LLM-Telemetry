#!/usr/bin/env python3
"""Generate the deterministic quota parity fixture (T-16, LLMTELEMET-287).

Usage: make_quota_fixture.py OUT_DIR

Two profiles: alpha has a rich quota_cache.json (every window/balance/account
shape the whitelist handles, plus token-shaped secrets that must be dropped or
scrubbed), beta-bot has no cache, gamma has an unparseable one.
"""
import json
import os
import sys

CACHE_ALPHA = """{
 "fetched_at": "2026-11-17T10:00:00Z",
 "providers": {
  "zeta": "not-a-dict",
  "anthropic": {
   "label": "Anthropic Claude", "plan": "max-5x", "unavailable_reason": null,
   "api_calls_available": true,
   "secret_extra_key": "sk-ant-api03-ABCDEFGHIJKLMNOP",
   "windows": [
     {"label": "5h", "reset_at": "2026-11-17T15:00:00Z", "used_percent": 42.567},
     {"label": "7d", "reset_at": "2026-11-20T00:00:00Z", "used_percent": "93.5"},
     {"label": "bad", "used_percent": true},
     {"label": "", "used_percent": 5},
     {"used_percent": 7},
     "junk"
   ],
   "details": ["plan ok", "Authorization: bearer abcdefghijklmnop123", "api_key = sk-live-12345678abcd",
               "token ghp_abcdefghijklmnopqrstuv end", "x2345678901234567890123456789012345678901234567890y", 5, null, ""],
   "accounts": [
    {"id": "acct-b", "label": "Second", "priority": 2, "request_count": 10, "status": "ok", "in_use": true,
     "access_token": "sk-SECRETSECRET1234", "refresh_token": "rt-SECRET",
     "usage": [{"label": "5h", "used_percent": 12}], "models": ["m1", "m2", "", null]},
    {"id": "acct-a", "label": "First", "priority": "1", "request_count": 3.0, "last_status": "exhausted",
     "last_error_code": 429, "last_error_reason": "rate limited", "last_error_reset_at": 1.5,
     "expires_at_ms": 1790000000000, "source": "oauth", "auth_type": "oauth",
     "model_cooldowns": {"opus": 12, "sonnet": 3}},
    {"id": "acct-c", "label": "Second", "priority": null, "request_count": 0, "status": "weird"},
    {"id": "acct-d", "priority": "abc", "status": "dead", "in_use": "yes", "usage": "nope"},
    {"id": "acct-e", "priority": 1.0, "request_count": 2.5, "models": ["a","b","c","d","e","f","g","h","i","j"]},
    {"label": "no identity"},
    "junk"
   ]
  },
  "deepseek": {
   "label": "DeepSeek", "unavailable_reason": "no api key",
   "account_balances": [
     {"currency": "USD", "total_balance": "12.50", "granted_balance": 0, "topped_up_balance": 5.0},
     {"currency": "CNY", "total_balance": 100.25},
     {"granted_balance": "7"},
     {"currency": false}
   ],
   "windows": [], "accounts": []
  },
  "openrouter": {"windows": [{"label": "credits", "used_percent": 90}], "details": "abc"},
  "ollama": {"windows": [{"label": "w", "used_percent": 1e-7}, {"label": "x", "used_percent": 0}]}
 }
}
"""

CACHE_GAMMA_EMPTY = '{"providers": {}}'


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def main(argv):
    if len(argv) != 1:
        sys.stderr.write("usage: make_quota_fixture.py OUT_DIR\n")
        return 2
    out = os.path.abspath(argv[0])
    agent = os.path.join(out, "agent")
    profiles = []
    for name in ("alpha", "beta-bot", "gamma", "delta"):
        home = os.path.join(agent, "profiles", name)
        os.makedirs(home, exist_ok=True)
        open(os.path.join(home, "state.db"), "wb").close()
        profiles.append({"name": name, "home": home})
    write(os.path.join(agent, "profiles", "alpha", "quota_cache.json"), CACHE_ALPHA)
    write(os.path.join(agent, "profiles", "gamma", "quota_cache.json"), CACHE_GAMMA_EMPTY)
    write(os.path.join(agent, "profiles", "delta", "quota_cache.json"), "{not json")
    cfg = {"agent_home": agent, "profiles": profiles, "reports_dir": os.path.join(out, "reports")}
    write(os.path.join(out, "config.json"), json.dumps(cfg, indent=1))
    sys.stdout.write(out + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
