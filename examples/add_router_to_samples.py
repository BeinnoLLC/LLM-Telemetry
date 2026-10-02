#!/usr/bin/env python3
"""Regenerate the sample router payload through the REAL collector (#130).

Builds a throwaway agent home per sample profile, with a synthetic config.yaml,
an auth.json full of fake tokens, a .env and an agent log of routing decisions.
It then runs collect_router.profile_payload() on it. So the fixture is exactly
what the collector emits, and the leak gate plus test_router_collector.py prove
that the fake tokens never survive.

    python examples/add_router_to_samples.py

Deterministic: decision timestamps and collected_at are pinned to NOW below.
"""
import json
import os
import sys
import tempfile
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("LLM_TELEMETRY_CONFIG", os.path.join(HERE, "sample-config.json"))
os.environ.setdefault("LLM_TELEMETRY_AGENT_HOME", os.path.join(HERE, "agent-home"))
sys.path.insert(0, os.path.join(HERE, "..", "src"))

import yaml  # noqa: E402

from llm_telemetry import collect_router as CR  # noqa: E402
from llm_telemetry.schema import SCHEMA_VERSION  # noqa: E402

OUT = os.path.join(HERE, "reports", "router-data.json")
NOW = 1790000000          # 2026-09-21: pinned so the fixture is byte-stable
GPU1 = "http://gpu-01.example.internal:11434/v1"
GPU2 = "http://gpu-02.example.internal:11434/v1"

FAKE_TOKEN = "sk-ant-oat01-FAKEFAKEFAKEFAKEFAKEFAKEFAKE0123456789"


def hop(p, m):
    return {"provider": p, "model": m}


WORK = {
    "model": {"provider": "anthropic", "default": "claude-opus-5", "reasoning_effort": "medium"},
    "custom_providers": [{"name": "gpu-01", "base_url": GPU1}, {"name": "gpu-02", "base_url": GPU2}],
    "fallback_providers": [hop("anthropic", "claude-sonnet-5"), hop("opencode-go", "glm-5.3")],
    "auxiliary": {
        "compression": {"provider": "opencode-go", "model": "glm-5.3-flash",
                        "fallback_chain": [hop("gpu-01", "qwen3-coder:30b")]},
        "approval": {"provider": "gpu-01", "model": "qwen3.8:latest"},
        "title_generation": {"provider": "gpu-02", "model": "gpt-oss:20b"},
        "vision": {"provider": "gemini", "model": "gemini-2.5-flash"},
    },
    "delegation": {"provider": "opencode-go", "model": "glm-5.3", "max_concurrent_children": 4,
                   "fallback_chain": [hop("openai-codex", "gpt-5.4-mini")]},
    "tier_router": {
        "enabled": True, "default_tier": "normal", "cooldown_s": 120, "restore_primary": True,
        "routes": {"plan": {"easy": "plan"}},
        "classifier": {"pool": [hop("opencode-go", "space-bunny-free"), hop("gpu-01", "qwen3.8:latest")],
                       "timeout_s": 12, "history_turns": 4},
        "tiers": {
            "trivial": {"mode": "round_robin", "escalate_to": "normal",
                        "pool": [hop("opencode-go", "glm-5.3-flash"), hop("gpu-01", "qwen3-coder:30b")],
                        "fallback": [hop("gpu-02", "gpt-oss:20b")]},
            "monitoring": {"mode": "round_robin", "escalate_to": "automation",
                           "pool": [hop("gpu-01", "llama3.1:latest"), hop("gpu-02", "llama3.1:latest")]},
            "test": {"mode": "round_robin", "escalate_to": "normal",
                     "pool": [hop("openai-codex", "gpt-5.4-mini"), hop("opencode-go", "glm-5.3")]},
            "automation": {"mode": "round_robin", "escalate_to": "normal",
                           "pool": [hop("opencode-go", "deepseek-v4.1-flash")]},
            "research": {"mode": "round_robin", "escalate_to": "complex",
                         "pool": [hop("gemini", "gemini-2.5-flash"), hop("opencode-go", "kimi-k2.7-code")]},
            "writing": {"mode": "round_robin", "escalate_to": None,
                        "pool": [hop("anthropic", "claude-sonnet-5")]},
            "normal": {"mode": "round_robin", "escalate_to": "complex",
                       "pool": [hop("openai-codex", "gpt-5.4-mini"), hop("opencode-go", "glm-5.3")],
                       "fallback": [hop("anthropic", "claude-sonnet-5")]},
            "complex": {"mode": "priority", "escalate_to": None,
                        "pool": [hop("anthropic", "claude-opus-5"), hop("openai-codex", "gpt-5.6-sol")]},
            "plan": {"mode": "priority", "escalate_to": "complex",
                     "pool": [hop("anthropic", "claude-opus-5")]},
        },
    },
}
PERSONAL = {
    "model": {"provider": "openai-codex", "default": "gpt-5.6-luna"},
    "fallback_providers": [hop("nous", "stepfun/step-3.7-flash"), hop("fireworks", "accounts/fireworks/models/kimi-k3")],
    "auxiliary": {"title_generation": {"provider": "nous", "model": "stepfun/step-3.7-flash"}},
}

# Every credential carries a fake secret in every field the real file has, so
# the fixture proves the collector's whitelist rather than assuming it.
AUTH = {
    "version": 1,
    "providers": {"openai-codex": {"access_token": FAKE_TOKEN, "refresh_token": FAKE_TOKEN}},
    "credential_pool": {
        "anthropic": [{"id": "a1", "label": "claude_code", "auth_type": "oauth", "source": "claude_code",
                       "access_token": FAKE_TOKEN, "refresh_token": FAKE_TOKEN, "last_status": "ok",
                       "secret_fingerprint": "f1ngerpr1nt0123", "request_count": 812}],
        "opencode-go": [{"id": "o1", "label": "OPENCODE_GO_API_KEY", "auth_type": "api_key",
                         "source": "env:OPENCODE_GO_API_KEY", "access_token": FAKE_TOKEN,
                         "last_status": "exhausted", "request_count": 4410}],
        "openai-codex": [{"id": "c1", "label": "dev@example.com", "auth_type": "oauth",
                          "source": "device_code", "access_token": FAKE_TOKEN, "last_status": "ok",
                          "request_count": 1290}],
        "gemini": [{"id": "g1", "label": "GEMINI_API_KEY", "auth_type": "api_key",
                    "source": "env:GEMINI_API_KEY", "access_token": FAKE_TOKEN, "request_count": 77}],
        "nous": [{"id": "n1", "label": FAKE_TOKEN, "auth_type": "api_key", "source": "manual",
                  "access_token": FAKE_TOKEN, "request_count": 15}],
    },
}
ENV = "OPENCODE_GO_API_KEY=FAKEFAKEFAKE\nGEMINI_API_KEY=FAKEFAKEFAKE\nFIREWORKS_API_KEY=FAKEFAKEFAKE\n"

# (minutes before NOW, tier, used, reason, model, provider) - a realistic week:
# mostly trivial/normal, one escalation, a few default-tier turns.
DECISIONS = [
    (5, "normal", "normal", "classifier:coding/medium", "gpt-5.4-mini", "openai-codex"),
    (9, "trivial", "trivial", "classifier:coding/easy", "glm-5.3-flash", "opencode-go"),
    (14, "monitoring", "monitoring", "classifier:monitoring/easy", "llama3.1:latest", "gpu-01"),
    (31, "plan", "plan", "classifier:plan/medium", "claude-opus-5", "anthropic"),
    (47, "test", "test", "classifier:test/medium", "glm-5.3", "opencode-go"),
    (80, "normal", "complex", "classifier:coding/medium", "claude-opus-5", "anthropic"),
    (95, "normal", "normal", "default", "glm-5.3", "opencode-go"),
    (130, "research", "research", "classifier:research/medium", "gemini-2.5-flash", "gemini"),
    (200, "writing", "writing", "classifier:writing/medium", "claude-sonnet-5", "anthropic"),
    (260, "automation", "automation", "classifier:data/medium", "deepseek-v4.1-flash", "opencode-go"),
    (400, "complex", "complex", "classifier:coding/hard", "claude-opus-5", "anthropic"),
] + [(500 + 37 * i, "trivial", "trivial", "classifier:coding/easy",
      ("glm-5.3-flash", "qwen3-coder:30b")[i % 2], ("opencode-go", "gpu-01")[i % 2]) for i in range(24)] \
  + [(600 + 41 * i, "normal", "normal", "classifier:coding/medium",
      ("gpt-5.4-mini", "glm-5.3")[i % 2], ("openai-codex", "opencode-go")[i % 2]) for i in range(18)] \
  + [(700 + 53 * i, "monitoring", "monitoring", "classifier:monitoring/medium",
      "llama3.1:latest", ("gpu-01", "gpu-02")[i % 2]) for i in range(9)]
NOISE = [
    (20, "tier_router: failed open (switch_model: no base_url resolved for provider 'gpu-02')"),
    (300, "tier_router: classifier space-bunny-free failed: Error code: 429"),
    (301, "tier_router: classifier space-bunny-free failed: Error code: 429"),
    (900, "tier_router: classifier budget exhausted; using default tier 'normal'"),
]


def ts(minutes):
    return datetime.fromtimestamp(NOW - minutes * 60).strftime("%Y-%m-%d %H:%M:%S,000")


def make_home(root, name, cfg, auth=None, env=None, log=None):
    home = os.path.join(root, name)
    os.makedirs(os.path.join(home, "logs"), exist_ok=True)
    with open(os.path.join(home, "config.yaml"), "w") as f:
        yaml.safe_dump(cfg, f, sort_keys=False)
    if auth:
        with open(os.path.join(home, "auth.json"), "w") as f:
            json.dump(auth, f)
    if env:
        with open(os.path.join(home, ".env"), "w") as f:
            f.write(env)
    if log:
        with open(os.path.join(home, "logs", "agent.log"), "w") as f:
            f.write(log)
    return os.path.join(home, "config.yaml")


def decision_log():
    lines = [(m, f"{ts(m)} INFO [sess_sample] agent.tier_router: tier_router: {t}→{u} ({r}) -> {mo} via {p}")
             for m, t, u, r, mo, p in DECISIONS]
    lines += [(m, f"{ts(m)} INFO [sess_sample] agent.tier_router: {body}") for m, body in NOISE]
    # A decision OUTSIDE the 7-day window, which must not be counted.
    lines.append((8 * 24 * 60, f"{ts(8 * 24 * 60)} INFO [old] agent.tier_router: tier_router: "
                               "complex→complex (classifier:coding/hard) -> claude-opus-5 via anthropic"))
    lines.sort(key=lambda x: -x[0])
    return "\n".join(x for _, x in lines) + "\n"


def main():
    with tempfile.TemporaryDirectory() as root:
        profiles = {
            "work": CR.profile_payload(make_home(root, "work", WORK, AUTH, ENV, decision_log()), now=NOW),
            "personal": CR.profile_payload(make_home(root, "personal", PERSONAL, {"credential_pool": {
                "openai-codex": AUTH["credential_pool"]["openai-codex"]}}, ENV), now=NOW),
        }
    out = {"profiles": profiles,
           "vocab": {"categories": list(CR.CATEGORIES), "levels": list(CR.LEVELS),
                     "category_doc": CR.CATEGORY_DOC, "level_doc": CR.LEVEL_DOC},
           "collected_at": NOW, "sample": True, "schema_version": SCHEMA_VERSION}
    raw = json.dumps(out)
    assert "FAKEFAKE" not in raw and "f1ngerpr1nt" not in raw and "dev@example.com" not in raw, \
        "a fake secret survived the collector"
    with open(OUT, "w") as f:
        f.write(raw)
    w = profiles["work"]
    print(f"{OUT}  (work: {len(w['tier_router']['tiers'])} tiers, "
          f"{w['decisions']['total']} decisions; personal: router off)")


if __name__ == "__main__":
    main()
