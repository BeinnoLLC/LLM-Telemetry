#!/usr/bin/env python3
"""Export each profile's ROUTER configuration for the dashboard help page.

Reads the same config the agent reads, so the help page cannot drift from
reality the way hand-written docs do.
"""
import json, os, sys

try:
    import yaml
except ImportError:
    sys.exit("pyyaml required")

from .config import get as _cfg
from .schema import stamp

CFG = _cfg()
PROFILES = {p.name: p.config for p in CFG.live_profiles()}

# Friendly explanations, keyed by auxiliary task name.
TASK_DOC = {
    "main": "Your actual conversation - the model that reads and answers you.",
    "compression": "Summarises old turns when the context window fills up.",
    "approval": "Judges whether a risky command should ask you first.",
    "title_generation": "Names each session in the sidebar.",
    "triage_specifier": "Picks which specialist handles an incoming request.",
    "background_review": "Reviews finished work and updates skills/memory.",
    "vision": "Reads images you attach.",
}


def prov_of(provider, model, base_url):
    """Resolve to the SAME provider keys the dashboard palette uses.

    Mirrors provOf() in build_dashboard.py: URL first (authoritative), then the
    config slot name, then the model shape. 'custom' means OpenAI-compatible
    and says nothing about who runs it, so it is only used as a weak hint.
    """
    u = (base_url or "").lower()
    if u:
        if "fireworks.ai" in u: return "fireworks"
        if "opencode.ai" in u: return "opencode-go"
        if "api.anthropic.com" in u: return "anthropic"
        if "openai.com" in u or "chatgpt.com" in u: return "openai-codex"
        if "openrouter.ai" in u: return "openrouter"
        if "nousresearch" in u: return "nous"
        if any(s in u for s in CFG.local_host_patterns):
            return "local"
    key = (provider or "").lower().strip()
    if key.startswith("ollama"): return "local"
    if key and key != "custom": return key
    m = (model or "").lower()
    if m.startswith(("qwen", "gpt-oss", "deepseek-r1", "nemotron", "llama", "mistral")):
        return "local"
    return key or "?"


def entry(provider, model, base_url, providers):
    """One routing hop, resolved against custom_providers for its real URL."""
    slot = providers.get(provider) or {}
    url = base_url or slot.get("api") or slot.get("base_url") or ""
    return {"provider": provider or "", "model": model or "",
            "url": url, "prov": prov_of(provider, model, url)}


def build():
    out = {"profiles": {}}
    for name, path in PROFILES.items():
        if not os.path.exists(path):
            continue
        with open(path) as f:
            c = yaml.safe_load(f) or {}
        raw_provs = c.get("custom_providers") or {}
        # custom_providers is a DICT in one profile and a LIST of {name: {...}}
        # entries in the other. Normalise to a dict keyed by slot name, or the
        # URL lookup silently falls back to "" and every hop loses its endpoint.
        if isinstance(raw_provs, list):
            providers = {}
            for it in raw_provs:
                if not isinstance(it, dict):
                    continue
                if "name" in it and isinstance(it.get("name"), str) and len(it) > 1:
                    providers[it["name"]] = it
                else:
                    providers.update(it)
        else:
            providers = raw_provs

        m = c.get("model") or {}
        primary = entry(m.get("provider"), m.get("default"), m.get("base_url"), providers)
        primary["effort"] = m.get("reasoning_effort") or ""

        chain = [entry(f.get("provider"), f.get("model"), f.get("base_url"), providers)
                 for f in (c.get("fallback_providers") or [])]

        tasks = []
        aux = c.get("auxiliary") or {}
        for tk, tv in aux.items():
            if not isinstance(tv, dict):
                continue
            e = entry(tv.get("provider"), tv.get("model"), tv.get("base_url"), providers)
            e["task"] = tk
            e["doc"] = TASK_DOC.get(tk, "")
            tasks.append(e)
        tasks.sort(key=lambda t: t["task"])

        moa = c.get("moa") or {}
        preset = (moa.get("presets") or {}).get("default") or {}
        refs = [entry(r.get("provider"), r.get("model"), None, providers)
                for r in (preset.get("reference_models") or [])]
        agg = preset.get("aggregator") or {}
        moa_out = {
            "refs": refs,
            "agg": entry(agg.get("provider"), agg.get("model"), None, providers) if agg else None,
            "fanout": preset.get("fanout") or "",
        } if refs else None

        comp = c.get("compression") or {}
        out["profiles"][name] = {
            "primary": primary,
            "chain": chain,
            "tasks": tasks,
            "moa": moa_out,
            "compression": {"threshold": comp.get("threshold"),
                            "enabled": bool(comp.get("enabled"))},
            "endpoints": {k: (v or {}).get("api", "") for k, v in providers.items()},
        }
    return stamp(out)


if __name__ == "__main__":
    dest = sys.argv[1] if len(sys.argv) > 1 else str(CFG.reports_dir / "router-data.json")
    data = build()
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    os.replace(tmp, dest)
    n = len(data["profiles"])
    hops = sum(len(p["chain"]) for p in data["profiles"].values())
    print(f"{dest}  ({n} profiles, {hops} fallback hops)")
