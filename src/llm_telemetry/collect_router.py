#!/usr/bin/env python3
"""Export each profile's ROUTER configuration for the dashboard's Router tab.

Reads the same config the agent reads, so the tab cannot drift from reality
the way hand-written docs do. Per profile it reports:

* primary model, fallback chain, auxiliary tasks, delegation, MoA preset
* the tier router (#130): classifier pool, every tier's pool/fallback/mode/
  escalation, and the category x level -> tier routing matrix
* how each provider authenticates — type, credential SOURCE and pool status.
  Only whitelisted descriptive fields are copied out of auth.json; a token,
  key or secret value can never reach the payload (tests/test_router_collector.py
  feeds real-looking tokens and asserts none survive).
* the router's real decisions over the last 7 days, parsed from the agent log,
  which is the honest answer to "why did this model run?"

Run hourly by systemd/llm-telemetry-router.timer; the every-minute dashboard
build only re-collects when router-data.json is missing or stale.
"""
import glob
import json
import os
import re
import sys
import time
from datetime import datetime

try:
    import yaml
except ImportError:
    sys.exit("pyyaml required")

from .config import get as _cfg
from .schema import stamp

CFG = _cfg()

# Friendly explanations, keyed by auxiliary task name.
TASK_DOC = {
    "main": "Your actual conversation - the model that reads and answers you.",
    "compression": "Summarises old turns when the context window fills up.",
    "approval": "Judges whether a risky command should ask you first.",
    "title_generation": "Names each session in the sidebar.",
    "triage_specifier": "Picks which specialist handles an incoming request.",
    "background_review": "Reviews finished work and updates skills/memory.",
    "review": "Reviews finished work and updates skills/memory.",
    "kanban_decomposer": "Breaks a kanban card into sub-tasks.",
    "vision": "Reads images you attach.",
    "tier_classifier": "Labels each turn '<category> <level>' so the router can pick a tier.",
    "delegation": "Runs subagents spawned with delegate_task.",
}

# ---- Tier router vocabulary --------------------------------------------------
# Mirrors agent/tier_router.py in Hermes (CATEGORIES, LEVELS, DEFAULT_ROUTES and
# the classifier's own definitions). Bundled rather than imported because the
# collector also runs in containers where the agent package is not installed.
# A profile's tier_router.routes is overlaid on DEFAULT_ROUTES exactly the way
# the agent does it (unknown keys ignored).
TIERS = ("trivial", "monitoring", "test", "automation", "research", "writing",
         "normal", "complex", "plan")
CATEGORIES = ("coding", "test", "research", "writing", "data", "monitoring", "plan")
LEVELS = ("easy", "medium", "hard")
DEFAULT_ROUTES = {
    "coding":     {"easy": "trivial", "medium": "normal",     "hard": "complex"},
    "test":       {"easy": "test",    "medium": "test",       "hard": "normal"},
    "research":   {"easy": "trivial", "medium": "research",   "hard": "complex"},
    "writing":    {"easy": "trivial", "medium": "writing",    "hard": "writing"},
    "data":       {"easy": "trivial", "medium": "automation", "hard": "normal"},
    "monitoring": {"easy": "monitoring", "medium": "monitoring", "hard": "automation"},
    "plan":       {"easy": "normal",  "medium": "plan",       "hard": "plan"},
}
CATEGORY_DOC = {
    "coding": "Writing, changing or debugging code, config, infra, shell, git.",
    "test": "Writing, running or fixing tests; coverage; e2e specs; test output.",
    "research": "Finding information, comparing options, reading docs, summarising.",
    "writing": "Emails, docs, posts, announcements, proposals, messages to people.",
    "data": "Data processing, spreadsheets, transforms, scripts that automate a chore.",
    "monitoring": "Status checks, logs, health checks, cron jobs, alerts.",
    "plan": "Architecture, design decisions, roadmaps, ticket breakdown.",
}
LEVEL_DOC = {
    "easy": "One-liner or lookup, a yes/no, a 'keep going' follow-up.",
    "medium": "Ordinary work, even if it takes many steps. The usual answer.",
    "hard": "Genuinely hard: unknown root cause, big refactor, security, high stakes.",
}
TIER_DOC = {
    "trivial": "One-liners and lookups: the cheapest, fastest models.",
    "monitoring": "Status checks, logs and cron jobs.",
    "test": "Writing, running and fixing tests.",
    "automation": "Data processing and chore scripts.",
    "research": "Finding information, comparing options, summarising.",
    "writing": "Emails, docs and posts.",
    "normal": "Ordinary work: the usual answer for most turns.",
    "complex": "Genuinely hard problems; the top of the escalation ladder.",
    "plan": "Architecture, design and roadmaps.",
}

# ---- Auth ---------------------------------------------------------------------
# Env vars each provider reads when nothing is in the credential pool. Only the
# variable NAME is ever reported, and only whether it is set.
PROVIDER_ENV = {
    "anthropic": ("ANTHROPIC_API_KEY", "ANTHROPIC_TOKEN"),
    "opencode-go": ("OPENCODE_GO_API_KEY",),
    "opencode-zen": ("OPENCODE_ZEN_API_KEY",),
    "openrouter": ("OPENROUTER_API_KEY",),
    "gemini": ("GEMINI_API_KEY", "GOOGLE_API_KEY"),
    "fireworks": ("FIREWORKS_API_KEY",),
    "ollama-cloud": ("OLLAMA_API_KEY",),
    "copilot": ("GH_TOKEN", "GITHUB_TOKEN"),
    "openai": ("OPENAI_API_KEY",),
    "deepseek": ("DEEPSEEK_API_KEY",),
    "xai": ("XAI_API_KEY",),
}
# Descriptive credential fields that are safe to publish. Everything else in an
# auth.json entry (access_token, refresh_token, agent_key, secret_fingerprint,
# error messages that may echo request bodies, ...) is dropped by construction.
_CRED_FIELDS = ("auth_type", "source", "last_status")
_EMAIL_RE = re.compile(r"^([^@\s])[^@\s]*(@[^@\s]+)$")
_ENV_NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]{2,}$")
_SAFE_LABEL_RE = re.compile(r"^[\w .:@+-]{1,40}$")


def _safe_label(label):
    """An account label for display: env-var names and short slugs pass, emails
    are masked to their first letter + domain, anything token-shaped is hidden."""
    s = str(label or "").strip()
    if not s:
        return ""
    m = _EMAIL_RE.match(s)
    if m:
        return f"{m.group(1)}•••{m.group(2)}"
    if _ENV_NAME_RE.match(s):
        return s
    # Long unbroken alphanumerics look like a key someone pasted as a label.
    if len(s) > 24 and " " not in s and re.search(r"\d", s):
        return "•••"
    return s if _SAFE_LABEL_RE.match(s) else "•••"


def _safe_source(src):
    s = str(src or "")
    if s.startswith("env:"):
        name = s[4:]
        return "env:" + name if _ENV_NAME_RE.match(name) else "env"
    return s if re.match(r"^[a-z_:-]{1,24}$", s) else "other"


def prov_of(provider, model, base_url):
    """Resolve to the SAME provider keys the dashboard palette uses.

    Mirrors provOf() in views.js: URL first (authoritative), then the config
    slot name, then the model shape. 'custom' means OpenAI-compatible and says
    nothing about who runs it, so it is only used as a weak hint.
    """
    u = (base_url or "").lower()
    if u:
        if "fireworks.ai" in u:
            return "fireworks"
        if "opencode.ai" in u:
            return "opencode-go"
        if "api.anthropic.com" in u:
            return "anthropic"
        if "openai.com" in u or "chatgpt.com" in u:
            return "openai-codex"
        if "openrouter.ai" in u:
            return "openrouter"
        if "nousresearch" in u:
            return "nous"
        if "ollama.com" in u:
            return "ollama-cloud"
        if "generativelanguage.googleapis.com" in u:
            return "gemini"
        if any(s in u for s in CFG.local_host_patterns) or "localhost" in u or "127.0.0.1" in u:
            return "local"
    key = (provider or "").lower().strip()
    if key == "ollama-cloud":
        return key
    if key.startswith("ollama"):
        return "local"
    if key and key != "custom":
        return key
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


def _entries(items, providers):
    return [entry(x.get("provider"), x.get("model"), x.get("base_url"), providers)
            for x in (items or []) if isinstance(x, dict)]


def _norm_providers(raw_provs):
    # custom_providers is a DICT in one profile and a LIST of {name: {...}}
    # entries in the other. Normalise to a dict keyed by slot name, or the URL
    # lookup silently falls back to "" and every hop loses its endpoint.
    if isinstance(raw_provs, list):
        providers = {}
        for it in raw_provs:
            if not isinstance(it, dict):
                continue
            if "name" in it and isinstance(it.get("name"), str) and len(it) > 1:
                providers[it["name"]] = it
            else:
                providers.update(it)
        return providers
    return raw_provs if isinstance(raw_provs, dict) else {}


# ---- Tier router ----------------------------------------------------------------

def routes_for(tr):
    """DEFAULT_ROUTES overlaid with config tier_router.routes (unknown keys ignored)."""
    routes = {c: dict(lv) for c, lv in DEFAULT_ROUTES.items()}
    for cat, lv in (tr.get("routes") or {}).items():
        if cat not in routes or not isinstance(lv, dict):
            continue
        for level, tier in lv.items():
            if level in LEVELS and isinstance(tier, str) and tier in TIERS:
                routes[cat][level] = tier
    return routes


def tier_router(c, providers):
    tr = c.get("tier_router") or {}
    if not tr:
        return None
    routes = routes_for(tr)
    tiers_cfg = tr.get("tiers") or {}
    tiers = []
    # Tier order: the agent's own TIERS order, then anything config adds.
    for name in [t for t in TIERS if t in tiers_cfg] + [t for t in tiers_cfg if t not in TIERS]:
        tv = tiers_cfg.get(name) or {}
        why = [{"category": cat, "level": lv}
               for cat in CATEGORIES for lv in LEVELS if routes[cat][lv] == name]
        tiers.append({
            "name": name,
            "doc": TIER_DOC.get(name, ""),
            "mode": tv.get("mode") or "priority",
            "escalate_to": tv.get("escalate_to"),
            "escalated_from": sorted(t for t, v in tiers_cfg.items()
                                     if (v or {}).get("escalate_to") == name),
            "pool": _entries(tv.get("pool"), providers),
            "fallback": _entries(tv.get("fallback"), providers),
            "why": why,
        })
    cl = tr.get("classifier") or {}
    return {
        "enabled": bool(tr.get("enabled")),
        "default_tier": tr.get("default_tier") or "normal",
        "cooldown_s": tr.get("cooldown_s"),
        "restore_primary": bool(tr.get("restore_primary")),
        "classifier": {"pool": _entries(cl.get("pool"), providers),
                       "timeout_s": cl.get("timeout_s"),
                       "history_turns": cl.get("history_turns")},
        "tiers": tiers,
        "routes": routes,
        "custom_routes": sorted(f"{cat}/{lv}" for cat, lvs in (tr.get("routes") or {}).items()
                                if isinstance(lvs, dict) for lv in lvs),
    }


# ---- Auth -------------------------------------------------------------------------

def _env_names(home):
    """Names (never values) of non-empty variables in the profile's .env."""
    names = set()
    p = os.path.join(home, ".env")
    if os.path.exists(p):
        with open(p, errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                if v.strip().strip("'\""):
                    names.add(k.strip().removeprefix("export ").strip())
    return names


def auth_for(home, used, providers):
    """{provider_slot: {type, creds:[...], local, note}} for every slot in use."""
    try:
        with open(os.path.join(home, "auth.json")) as f:
            a = json.load(f) or {}
    except (OSError, ValueError):
        a = {}
    pool = a.get("credential_pool") or {}
    oauth = a.get("providers") or {}
    env = _env_names(home)
    out = {}
    for slot, prov in sorted(used.items()):
        creds = []
        for e in pool.get(slot) or []:
            if not isinstance(e, dict):
                continue
            c: dict = {k: str(e.get(k) or "") for k in _CRED_FIELDS}
            c["source"] = _safe_source(c["source"])
            c["label"] = _safe_label(e.get("label"))
            c["requests"] = int(e.get("request_count") or 0)
            creds.append(c)
        cp = providers.get(slot) or {}
        note = ""
        if creds:
            types = {c["auth_type"] for c in creds}
            kind = "oauth" if types == {"oauth"} else "api_key" if types == {"api_key"} else "mixed"
        elif slot in oauth:
            kind, note = "oauth", "signed in (auth.json)"
        elif prov == "local":
            kind, note = "none", "self-hosted endpoint, no key"
        elif any(k in cp for k in ("api_key", "key", "apiKey")):
            kind, note = "api_key", "inline in config"
        elif cp.get("key_env") or cp.get("api_key_env"):
            name = cp.get("key_env") or cp.get("api_key_env")
            kind = "api_key"
            note = f"env:{name}" + ("" if name in env else " (not set)")
        else:
            names = [n for n in PROVIDER_ENV.get(slot, PROVIDER_ENV.get(prov, ())) if n in env]
            if names:
                kind, note = "api_key", "env:" + ", ".join(names)
            else:
                kind, note = "unknown", "no credential found for this slot"
        out[slot] = {"prov": prov, "type": kind, "creds": creds, "note": note}
    return out


# ---- Decisions (agent log) ---------------------------------------------------------
# "2026-10-03 00:55:02,077 INFO [sid] agent.tier_router: tier_router: normal→normal
#  (classifier:coding/medium) -> gpt-5.4-mini via openai-codex"
_DEC_RE = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\S* \w+ \[[^\]]*\] agent\.tier_router: "
                     r"tier_router: (\w+)→(\w+) \(([^)]*)\) -> (.+?) via (\S+)\s*$")
_TS_RE = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)")
DECISION_WINDOW_S = 7 * 86400
RECENT_N = 15


def decisions(home, now=None):
    files = sorted(glob.glob(os.path.join(home, "logs", "agent.log*")))
    if not files:
        return None
    now = now or time.time()
    cutoff = now - DECISION_WINDOW_S
    d = {"window_days": DECISION_WINDOW_S // 86400, "total": 0, "by_tier": {}, "by_route": {},
         "by_model": {}, "escalations": 0, "defaulted": 0, "failed_open": 0,
         "budget_exhausted": 0, "classifier_failures": {}, "recent": []}
    recent = []
    for fp in files:
        try:
            fh = open(fp, errors="replace")
        except OSError:
            continue
        with fh:
            for line in fh:
                if "agent.tier_router:" not in line:
                    continue
                t = _TS_RE.match(line)
                if not t:
                    continue
                try:
                    ts = datetime.strptime(t.group(1), "%Y-%m-%d %H:%M:%S").timestamp()
                except ValueError:
                    continue
                if ts < cutoff:
                    continue
                m = _DEC_RE.match(line.rstrip("\n"))
                if m:
                    _, tier, used, reason, model, prov = m.groups()
                    d["total"] += 1
                    d["by_tier"][used] = d["by_tier"].get(used, 0) + 1
                    key = f"{model}@{prov}"
                    d["by_model"][key] = d["by_model"].get(key, 0) + 1
                    if tier != used:
                        d["escalations"] += 1
                    if reason.startswith("classifier:"):
                        r = reason.split(":", 1)[1]
                        d["by_route"][r] = d["by_route"].get(r, 0) + 1
                    else:
                        d["defaulted"] += 1
                    recent.append({"ts": int(ts), "tier": tier, "used": used,
                                   "reason": reason[:40], "model": model[:60], "prov": prov[:30]})
                    continue
                body = line.split("tier_router: ", 2)[-1]
                if body.startswith("failed open"):
                    d["failed_open"] += 1
                elif body.startswith("classifier budget exhausted"):
                    d["budget_exhausted"] += 1
                else:
                    f = re.match(r"classifier (\S+) (?:failed|returned unparseable)", body)
                    if f:
                        k = f.group(1)[:60]
                        d["classifier_failures"][k] = d["classifier_failures"].get(k, 0) + 1
    recent.sort(key=lambda r: r["ts"])
    d["recent"] = recent[-RECENT_N:][::-1]
    return d


# ---- Profile ---------------------------------------------------------------------

def profile_payload(path, now=None):
    with open(path) as f:
        c = yaml.safe_load(f) or {}
    home = os.path.dirname(os.path.abspath(path))
    providers = _norm_providers(c.get("custom_providers"))

    m = c.get("model") or {}
    primary = entry(m.get("provider"), m.get("default"), m.get("base_url"), providers)
    primary["effort"] = m.get("reasoning_effort") or ""

    chain = _entries(c.get("fallback_providers"), providers)

    tasks = []
    for tk, tv in (c.get("auxiliary") or {}).items():
        if not isinstance(tv, dict):
            continue
        e = entry(tv.get("provider"), tv.get("model"), tv.get("base_url"), providers)
        e["task"] = tk
        e["doc"] = TASK_DOC.get(tk, "")
        e["fallbacks"] = len(tv.get("fallback_chain") or [])
        tasks.append(e)
    tasks.sort(key=lambda t: t["task"])

    dg = c.get("delegation") or {}
    delegation = None
    if dg.get("model") or dg.get("provider"):
        delegation = entry(dg.get("provider"), dg.get("model"), dg.get("base_url"), providers)
        delegation["fallbacks"] = len(dg.get("fallback_chain") or [])
        delegation["max_children"] = dg.get("max_concurrent_children")

    moa = c.get("moa") or {}
    preset = (moa.get("presets") or {}).get("default") or {}
    refs = _entries(preset.get("reference_models"), providers)
    agg = preset.get("aggregator") or {}
    moa_out = {
        "refs": refs,
        "agg": entry(agg.get("provider"), agg.get("model"), None, providers) if agg else None,
        "fanout": preset.get("fanout") or "",
    } if refs else None

    tr = tier_router(c, providers)

    # Every provider slot this profile can route to, for the auth table.
    used = {}
    hops = [primary, *chain, *tasks, *(refs or [])]
    if delegation:
        hops.append(delegation)
    if moa_out and moa_out["agg"]:
        hops.append(moa_out["agg"])
    if tr:
        hops += tr["classifier"]["pool"]
        for t in tr["tiers"]:
            hops += t["pool"] + t["fallback"]
    for h in hops:
        if h["provider"]:
            used.setdefault(h["provider"], h["prov"])

    comp = c.get("compression") or {}
    return {
        "primary": primary,
        "chain": chain,
        "tasks": tasks,
        "delegation": delegation,
        "moa": moa_out,
        "tier_router": tr,
        "auth": auth_for(home, used, providers),
        "decisions": decisions(home, now) if tr else None,
        "compression": {"threshold": comp.get("threshold"),
                        "enabled": bool(comp.get("enabled"))},
        "endpoints": {k: (v or {}).get("api", "") or (v or {}).get("base_url", "")
                      for k, v in providers.items()},
    }


def build():
    out = {"profiles": {}, "vocab": {
        "categories": list(CATEGORIES), "levels": list(LEVELS),
        "category_doc": CATEGORY_DOC, "level_doc": LEVEL_DOC},
        "collected_at": int(time.time())}
    for p in CFG.live_profiles():
        if os.path.exists(p.config):
            out["profiles"][p.name] = profile_payload(p.config)
    return stamp(out)


def main(dest=None):
    dest = dest or str(CFG.reports_dir / "router-data.json")
    data = build()
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    os.replace(tmp, dest)
    n = len(data["profiles"])
    tiers = sum(len((p["tier_router"] or {}).get("tiers") or []) for p in data["profiles"].values())
    print(f"{dest}  ({n} profiles, {tiers} router tiers)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
