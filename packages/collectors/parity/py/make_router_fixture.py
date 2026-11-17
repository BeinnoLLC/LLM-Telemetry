#!/usr/bin/env python3
"""Generate the deterministic router parity fixture (T-16, LLMTELEMET-287).

Usage: make_router_fixture.py OUT_DIR

Writes, under OUT_DIR, config.json plus two profiles (alpha: full tier router,
MoA, delegation, oauth/api-key pools, .env, agent.log decisions; beta-bot: a
bare config resolved from env). Log timestamps are `now - offset` in local time
so the 7-day decision window always contains them. auth.json carries
token-shaped secrets that must NEVER appear in the artifact.
"""
import json
import os
import sys
import time

H = 3600
D = 86400

ALPHA_YAML = """\
model:
  provider: custom
  default: claude-opus-4
  base_url: https://api.anthropic.com/v1
  reasoning_effort: high
fallback_providers:
  - provider: opencode-go
    model: glm-5
  - provider: ollama-lan
    model: qwen3-coder
  - provider: ollama-cloud
    model: gpt-oss:120b
auxiliary:
  compression:
    provider: ollama-lan
    model: llama3
    fallback_chain: [a, b]
  vision:
    provider: gemini
    model: gemini-2.5-pro
  approval:
    provider: openrouter
    model: deepseek/deepseek-chat
  junk: not-a-dict
delegation:
  provider: openrouter
  model: qwen/qwen3-coder
  max_concurrent_children: 4
  fallback_chain: [x]
moa:
  presets:
    default:
      fanout: parallel
      reference_models:
        - {provider: openrouter, model: model-a}
        - {provider: fireworks, model: model-b}
      aggregator: {provider: anthropic, model: claude-sonnet}
compression:
  enabled: yes
  threshold: 0.5
custom_providers:
  - name: ollama-lan
    api: http://192.168.1.11:11434/v1
  - name: corp
    base_url: https://llm.corp.example.com/v1
    key_env: CORP_KEY
  - name: inline-key
    api: https://example.org/v1
    api_key: sk-not-a-real-key-123
tier_router:
  enabled: true
  default_tier: normal
  cooldown_s: 30
  restore_primary: true
  classifier:
    timeout_s: 8
    history_turns: 3
    pool:
      - {provider: ollama-lan, model: llama3}
  routes:
    coding: {hard: plan, medium: bogus-tier, ultra: normal}
    unknown-cat: {easy: normal}
  tiers:
    trivial:
      mode: round_robin
      pool:
        - {provider: ollama-lan, model: qwen3-coder}
      fallback:
        - {provider: openrouter, model: qwen/qwen3-coder}
    normal:
      pool:
        - {provider: anthropic, model: claude-sonnet}
        - {provider: corp, model: corp-model}
      escalate_to: complex
    complex:
      pool:
        - {provider: anthropic, model: claude-opus-4}
        - {provider: inline-key, model: custom-x}
    zeta-extra:
      escalate_to: normal
      pool: []
"""

BETA_YAML = """\
model:
  provider: openai
  default: gpt-4o
auxiliary:
  title_generation:
    provider: deepseek
    model: deepseek-chat
"""

AUTH = {
    "credential_pool": {
        "anthropic": [
            {"auth_type": "oauth", "source": "oauth:claude", "label": "dev@example.com",
             "last_status": "ok", "request_count": 42,
             "access_token": "sk-ant-oat01-SECRETSECRETSECRET0123456789"},
            {"auth_type": "api_key", "source": "env:ANTHROPIC_API_KEY",
             "label": "ANTHROPIC_API_KEY", "request_count": 7.9,
             "api_key": "sk-ant-api03-LEAKLEAKLEAKLEAK"},
        ],
        "openrouter": [
            {"auth_type": "api_key", "source": "env:openrouter key!", "label": "or-1234567890abcdef1234567890ab",
             "last_status": "exhausted", "request_count": 3},
        ],
        "opencode-go": [
            {"auth_type": "oauth", "source": "manual", "label": "Team Account", "request_count": None},
            "not-a-dict",
        ],
    },
    "providers": {"gemini": {"access_token": "ya29.GEMINISECRET"}},
}

ENV = """\
# comment
OPENROUTER_API_KEY=sk-or-v1-SECRETVALUE
export FIREWORKS_API_KEY="fw_secret"
EMPTY_ONE=
QUOTED_EMPTY=''
CORP_KEY2=value
no-equals-line
"""


def decision(ts, tier, used, reason, model, prov):
    return (f"{ts} INFO [sess_1] agent.tier_router: tier_router: {tier}→{used} "
            f"({reason}) -> {model} via {prov}")


def build_agent_log(home, now):
    def ts(off):
        return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(now - int(off)))
    lines = [
        decision(ts(5 * H), "normal", "normal", "classifier:coding/medium", "claude-sonnet", "anthropic"),
        decision(ts(4 * H), "normal", "complex", "classifier:coding/hard", "claude-opus-4", "anthropic"),
        decision(ts(3 * H), "trivial", "trivial", "default tier", "qwen3-coder", "ollama-lan"),
        decision(ts(2 * H), "normal", "normal", "classifier:research/medium", "claude-sonnet", "anthropic"),
        decision(ts(1 * H), "plan", "plan", "classifier:plan/hard", "m" * 80, "p" * 40),
        decision(ts(50 * 60), "normal", "normal", "classifier:" + "r" * 60, "claude-sonnet", "anthropic"),
        decision(ts(9 * D), "normal", "normal", "classifier:coding/easy", "old-model", "anthropic"),
        ts(30 * 60) + " WARNING [s] agent.tier_router: tier_router: failed open (timeout)",
        ts(29 * 60) + " WARNING [s] agent.tier_router: tier_router: classifier budget exhausted",
        ts(28 * 60) + " WARNING [s] agent.tier_router: tier_router: classifier llama3 failed: boom",
        ts(27 * 60) + " WARNING [s] agent.tier_router: tier_router: classifier llama3 returned unparseable text",
        ts(26 * 60) + " WARNING [s] agent.tier_router: tier_router: something else",
        "9999-99-99 99:99:99 WARNING [s] agent.tier_router: tier_router: failed open (bad date)",
        "not a log line mentioning agent.tier_router: nothing",
        ts(10 * 60) + " INFO unrelated line",
    ]
    os.makedirs(os.path.join(home, "logs"), exist_ok=True)
    with open(os.path.join(home, "logs", "agent.log"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    # a rotated log must be read too
    with open(os.path.join(home, "logs", "agent.log.1"), "w", encoding="utf-8") as fh:
        fh.write(decision(ts(6 * H), "trivial", "trivial", "classifier:data/easy", "rot-model", "ollama-lan") + "\r\n")


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def main(argv):
    if len(argv) != 1:
        sys.stderr.write("usage: make_router_fixture.py OUT_DIR\n")
        return 2
    out = os.path.abspath(argv[0])
    now = int(time.time())
    agent = os.path.join(out, "agent")
    profiles = []
    for name, yml in (("alpha", ALPHA_YAML), ("beta-bot", BETA_YAML)):
        home = os.path.join(agent, "profiles", name)
        write(os.path.join(home, "config.yaml"), yml)
        open(os.path.join(home, "state.db"), "wb").close()  # existence only
        profiles.append({"name": name, "home": home})
    alpha = os.path.join(agent, "profiles", "alpha")
    write(os.path.join(alpha, "auth.json"), json.dumps(AUTH))
    write(os.path.join(alpha, ".env"), ENV)
    build_agent_log(alpha, now)
    write(os.path.join(agent, "profiles", "beta-bot", ".env"), "DEEPSEEK_API_KEY=x\nOPENAI_API_KEY=\n")
    cfg = {"agent_home": agent, "profiles": profiles,
           "reports_dir": os.path.join(out, "reports")}
    write(os.path.join(out, "config.json"), json.dumps(cfg, indent=1))
    sys.stdout.write(out + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
