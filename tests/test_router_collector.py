"""collect_router (#130): tiers, routing matrix, auth whitelist, decision log.

Runs the real profile_payload() against a throwaway agent home so every claim
the Router tab makes is pinned to collector behaviour, not to a fixture.
"""
import json
import os
import sys
import tempfile
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
os.environ.setdefault("LLM_TELEMETRY_CONFIG", os.path.join(ROOT, "examples", "sample-config.json"))
os.environ.setdefault("LLM_TELEMETRY_AGENT_HOME", os.path.join(ROOT, "examples", "agent-home"))
sys.path.insert(0, os.path.join(ROOT, "src"))

import yaml  # noqa: E402

from llm_telemetry import collect_router as CR  # noqa: E402

p = f = 0


def chk(ok, label, got=None):
    global p, f
    if ok:
        p += 1
        print(f"  OK   {label}")
    else:
        f += 1
        print(f"  FAIL {label}" + (f"  got: {got!r}" if got is not None else ""))


TOKEN = "sk-ant-oat01-ZZZTOPSECRETZZZ0123456789abcdef"
NOW = 1790000000


def stamp(minutes):
    return datetime.fromtimestamp(NOW - minutes * 60).strftime("%Y-%m-%d %H:%M:%S,123")


CFG = {
    "model": {"provider": "anthropic", "default": "claude-opus-5"},
    "custom_providers": [{"name": "box", "base_url": "http://10.0.0.5:11434/v1"}],
    "auxiliary": {"compression": {"provider": "box", "model": "qwen3:14b", "fallback_chain": [{}, {}]}},
    "tier_router": {
        "enabled": True, "default_tier": "normal",
        # A valid override, an unknown category and an unknown tier: only the
        # first may change the matrix (same rule as the agent).
        "routes": {"plan": {"easy": "plan"}, "bogus": {"easy": "trivial"}, "coding": {"easy": "nonsense"}},
        "classifier": {"pool": [{"provider": "opencode-go", "model": "space-bunny-free"}]},
        "tiers": {
            "normal": {"mode": "round_robin", "escalate_to": "complex",
                       "pool": [{"provider": "openai-codex", "model": "gpt-5.4-mini"}]},
            "complex": {"mode": "priority", "pool": [{"provider": "anthropic", "model": "claude-opus-5"}]},
            "trivial": {"pool": [{"provider": "box", "model": "qwen3:14b"}], "escalate_to": "normal"},
        },
    },
}
AUTH = {
    "providers": {"openai-codex": {"access_token": TOKEN}},
    "credential_pool": {
        "anthropic": [{"label": "someone@corp.example", "auth_type": "oauth", "source": "claude_code",
                       "access_token": TOKEN, "refresh_token": TOKEN, "secret_fingerprint": TOKEN,
                       "last_error_message": f"401 bad key {TOKEN}", "last_status": "dead"}],
        "opencode-go": [{"label": TOKEN, "auth_type": "api_key", "source": f"env:{TOKEN}",
                         "access_token": TOKEN, "last_status": "exhausted", "request_count": 9}],
    },
}
LOG = "\n".join([
    f"{stamp(5)} INFO [s1] agent.tier_router: tier_router: normal→normal (classifier:coding/medium) -> gpt-5.4-mini via openai-codex",
    f"{stamp(6)} INFO [s1] agent.tier_router: tier_router: normal→complex (classifier:coding/medium) -> claude-opus-5 via anthropic",
    f"{stamp(7)} INFO [s1] agent.tier_router: tier_router: normal→normal (default) -> gpt-5.4-mini via openai-codex",
    f"{stamp(8)} INFO [s1] agent.tier_router: tier_router: failed open (Anthropic credentials are rate-limited)",
    f"{stamp(9)} INFO [s1] agent.tier_router: tier_router: classifier space-bunny-free failed: Error code: 429",
    f"{stamp(10)} INFO [s1] agent.tier_router: tier_router: classifier budget exhausted; using default tier 'normal'",
    f"{stamp(8 * 1440)} INFO [s0] agent.tier_router: tier_router: complex→complex (classifier:plan/hard) -> claude-opus-5 via anthropic",
    "garbage line agent.tier_router: without a timestamp",
]) + "\n"

with tempfile.TemporaryDirectory() as home:
    os.makedirs(os.path.join(home, "logs"))
    with open(os.path.join(home, "config.yaml"), "w") as fh:
        yaml.safe_dump(CFG, fh)
    with open(os.path.join(home, "auth.json"), "w") as fh:
        json.dump(AUTH, fh)
    with open(os.path.join(home, ".env"), "w") as fh:
        fh.write(f"OPENCODE_GO_API_KEY={TOKEN}\nEMPTY_ONE=\n")
    with open(os.path.join(home, "logs", "agent.log"), "w") as fh:
        fh.write(LOG)
    out = CR.profile_payload(os.path.join(home, "config.yaml"), now=NOW)

raw = json.dumps(out)

print("secrets")
chk("ZZZTOPSECRET" not in raw, "no token survives from auth.json, .env, labels, sources or error text")
chk("someone@corp.example" not in raw, "raw email never published")
a = out["auth"]
chk(a["anthropic"]["creds"][0]["label"] == "s•••@corp.example", "OAuth email masked", a["anthropic"]["creds"][0]["label"])
chk(a["opencode-go"]["creds"][0]["label"] == "•••", "token-shaped label hidden", a["opencode-go"]["creds"][0]["label"])
chk(a["opencode-go"]["creds"][0]["source"] == "env", "token-shaped env source collapsed", a["opencode-go"]["creds"][0]["source"])
chk(set(a["anthropic"]["creds"][0]) == {"auth_type", "source", "last_status", "label", "requests"},
    "only whitelisted credential fields are copied", sorted(a["anthropic"]["creds"][0]))

print("auth types")
chk(a["anthropic"]["type"] == "oauth" and a["anthropic"]["creds"][0]["last_status"] == "dead", "anthropic: oauth, dead")
chk(a["opencode-go"]["type"] == "api_key", "opencode-go: api key")
chk(a["openai-codex"]["type"] == "oauth" and "signed in" in a["openai-codex"]["note"], "codex: oauth via providers block")
chk(a["box"]["type"] == "none" and a["box"]["prov"] == "local", "self-hosted slot: no auth", a["box"])

print("tier router")
tr = out["tier_router"]
chk([t["name"] for t in tr["tiers"]] == ["trivial", "normal", "complex"], "tiers in the agent's TIERS order",
    [t["name"] for t in tr["tiers"]])
chk(tr["routes"]["plan"]["easy"] == "plan", "valid route override applied")
chk("bogus" not in tr["routes"] and tr["routes"]["coding"]["easy"] == "trivial", "unknown category/tier overrides ignored")
normal = next(t for t in tr["tiers"] if t["name"] == "normal")
chk({"category": "coding", "level": "medium"} in normal["why"], "a tier's 'why' lists the routes that land on it")
chk(normal["escalated_from"] == ["trivial"], "escalated_from derived", normal["escalated_from"])
complex_ = next(t for t in tr["tiers"] if t["name"] == "complex")
chk(complex_["mode"] == "priority" and complex_["escalate_to"] is None, "mode + top-of-ladder kept")
chk(next(t for t in tr["tiers"] if t["name"] == "trivial")["mode"] == "priority", "mode defaults to priority (agent default)")
chk(tr["classifier"]["pool"][0]["model"] == "space-bunny-free", "classifier pool collected")
chk(out["tasks"][0]["fallbacks"] == 2, "aux task fallback depth counted")

print("decisions")
d = out["decisions"]
chk(d["total"] == 3, "decisions inside the 7-day window only", d["total"])
chk(d["escalations"] == 1 and d["defaulted"] == 1, "escalation + default-tier counted", (d["escalations"], d["defaulted"]))
chk(d["by_route"] == {"coding/medium": 2}, "classifier routes counted", d["by_route"])
chk(d["by_tier"] == {"normal": 2, "complex": 1}, "by_tier counts the tier USED", d["by_tier"])
chk(d["failed_open"] == 1 and d["budget_exhausted"] == 1 and d["classifier_failures"] == {"space-bunny-free": 1},
    "router health lines counted")
chk(d["recent"][0]["ts"] > d["recent"][-1]["ts"], "recent is newest first")

print("router off / missing log")
with tempfile.TemporaryDirectory() as home:
    with open(os.path.join(home, "config.yaml"), "w") as fh:
        yaml.safe_dump({"model": {"provider": "nous", "default": "x"}}, fh)
    off = CR.profile_payload(os.path.join(home, "config.yaml"), now=NOW)
chk(off["tier_router"] is None and off["decisions"] is None, "no tier_router -> no chart, no decisions")
chk(off["auth"]["nous"]["type"] == "unknown", "slot with no credential is 'unknown'")

print(f"\ntest_router_collector.py  {p} passed, {f} failed")
sys.exit(1 if f else 0)
