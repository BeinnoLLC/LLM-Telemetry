#!/usr/bin/env python3
"""OpenRouter pricing catalog -> per-model rates for Hermes usage rows.

Refreshed every 6h (cache TTL 6h). Classifies every billing provider so we never
invent a per-token cost for flat-fee or local traffic:

  metered      real pay-per-token spend  (fireworks, openrouter, deepseek direct)
  subscription flat monthly fee          (anthropic OAuth, opencode-go, openai-codex)
  free         local hardware            (custom/ollama)

For subscription+free rows we still compute a MARKET-EQUIVALENT value: what the
same tokens would have cost at public API rates. That answers "is the
subscription worth it" without ever pretending it is money spent.
"""
import json, os, time, urllib.request

from .config import get as _cfg


def _local_patterns():
    """Config-driven so self-hosted URLs are recognised on any LAN.

    Lazy (not module-level) because pricing is imported during config loading
    in some paths; reading the config at import time would recurse.
    """
    try:
        return _cfg().local_host_patterns
    except Exception:
        return ["127.0.0.1", "localhost", "192.168.", "10.", "172."]

CACHE = str(_cfg().reports_dir / "pricing-cache.json")
URL = "https://openrouter.ai/api/v1/models"
TTL = 6 * 3600

# billing_provider -> class
PROVIDER_CLASS = {
    "fireworks": "metered",
    "openrouter": "metered",
    "deepseek": "metered",
    "anthropic": "subscription",
    "opencode-go": "subscription",
    "openai-codex": "subscription",
    "copilot": "subscription",
    "nous": "subscription",
    "custom": "free",
    "local": "free",
    "ollama": "free",
    "": "unknown",
}

# Models that live on local hardware: never price them, whatever the name says.
LOCAL_HINTS = ("qwen3-coder", "gpt-oss", "qwen3:14b", "qwen3.8:latest",
               "deepseek-r1:14b", "nemotron", "qwen3:30b", "ministral")

# Model-name patterns that are ALWAYS pay-per-token, whatever provider slot the
# row was recorded under. Needed because the provider field records the local
# config slot ("custom"), not the upstream vendor: Fireworks traffic routed
# through a custom-named slot was being classed "free" and billed at $0, which
# silently under-reports real metered spend. Model identity is authoritative
# here; the provider slot is not.
METERED_MODEL_HINTS = (
    "accounts/fireworks/models/",   # Fireworks serverless, pay per token
    "openrouter/",                  # OpenRouter passthrough
)

# Rows whose "model" is really a router/ensemble preset name, not a model. The
# per-member spend is already recorded as its own rows, so pricing the preset
# name again would double-count. Classify it explicitly instead of leaving it
# "unknown", which reads as "we failed to price this".
PRESET_MODELS = ("default",)

# ":free" is an OpenRouter tier suffix: real traffic, genuinely $0 per token.
FREE_TIER_SUFFIX = ":free"


# Known model -> billing class, used when the usage row carries no provider at
# all (older rows predate provider recording). Without this they land in
# "unknown", which makes a priced, well-understood model look untracked.
MODEL_CLASS_FALLBACK = {
    "claude-": "subscription",
    "glm-": "subscription",
    "deepseek-v4.1-flash": "subscription",
    "gpt-5": "subscription",
    "gpt-6": "subscription",
}


def class_from_model(model):
    """Billing class inferred from the model name, or None."""
    m = (model or "").lower()
    for prefix, cls in MODEL_CLASS_FALLBACK.items():
        if m.startswith(prefix):
            return cls
    return None


def metered_by_model(model):
    """True when the model name itself proves pay-per-token billing."""
    m = (model or "").lower()
    if any(h in m for h in LOCAL_HINTS):
        return False
    return any(h in m for h in METERED_MODEL_HINTS)

# Explicit model -> OpenRouter id. Substring guessing is too loose (a local
# "qwen3.8:latest" happily matches a cloud "qwen3.8-max"), so anything we care
# about is pinned here.
# Official vendor rates gathered from the web, USD per 1M tokens:
#   (input, output, cache_read)
# Used for models OpenRouter does not carry, and checked BEFORE the catalog.
# Sources: developers.openai.com/api/docs/pricing (gpt-6-astra, gpt-5.6-luna,
# gpt-5.3-codex), docs.fireworks.ai/serverless/pricing (DeepSeek SKUs).
WEB_RATES = {
    # OpenAI / Codex — absent from OpenRouter
    "gpt-6-astra":     (10.00, 50.00, 1.00),
    "gpt-5.6-luna":    (0.20,  1.20,  0.02),
    "gpt-5.6-terra":   (2.00,  12.00, 0.20),
    "gpt-5.6-sol":     (4.00,  20.00, 0.40),
    "gpt-5.3-codex":   (1.75,  14.00, 0.175),
    # Fireworks serverless SKUs
    "accounts/fireworks/models/deepseek-v4-flash-0731":      (0.22, 0.66, 0.007),
    "accounts/fireworks/models/deepseek-v4-flash-vision-exp": (0.22, 0.66, 0.007),
}

ALIASES = {
    "claude-opus-5": "anthropic/claude-opus-5",
    "claude-opus-4-7": "anthropic/claude-opus-4.7",
    "claude-sonnet-5": "anthropic/claude-sonnet-5",
    "claude-sonnet-4-5-20250929": "anthropic/claude-sonnet-4.5",
    # Hermes names Anthropic models with dashes and an optional date suffix;
    # OpenRouter uses dots and no date. Without these four the models fall
    # through to "unpriced" and silently contribute $0 to every total.
    "claude-opus-4-5-20251101": "anthropic/claude-opus-4.5",
    "claude-opus-4-5": "anthropic/claude-opus-4.5",
    "claude-opus-4-6": "anthropic/claude-opus-4.6",
    "claude-opus-4-8": "anthropic/claude-opus-4.8",
    "claude-opus-5-5": "anthropic/claude-opus-5.5",
    "claude-fable-5": "anthropic/claude-fable-5",
    "claude-fable-5-1": "anthropic/claude-fable-5.1",
    "claude-sonnet-4-6": "anthropic/claude-sonnet-4.6",
    "glm-5.3": "z-ai/glm-5.3",
    "glm-5.3-flash": "z-ai/glm-5.3-flash",
    "deepseek-v4.1-flash": "deepseek/deepseek-v4.1-flash",
    "accounts/fireworks/models/deepseek-v4p1-flash": "deepseek/deepseek-v4.1-flash",
    "accounts/fireworks/models/deepseek-v4-pro-0813": "deepseek/deepseek-v4-pro-0813",
    "accounts/fireworks/models/deepseek-v4-flash-0731": "deepseek/deepseek-v4-flash-0731",
    "accounts/fireworks/models/kimi-k3": "moonshotai/kimi-k3",
    "accounts/fireworks/models/glm-5p3-flash": "z-ai/glm-5.3-flash",
    "gpt-5.6-luna": "openai/gpt-5.6-luna",
    "gpt-5.3-codex": "openai/gpt-5.3-codex",
    "gpt-6-astra": "openai/gpt-6-astra",
}


def fetch_catalog(force=False):
    """Return {openrouter_id: pricing_dict}, cached for TTL seconds."""
    if not force and os.path.exists(CACHE):
        age = time.time() - os.path.getmtime(CACHE)
        if age < TTL:
            try:
                return json.load(open(CACHE))["models"], "cache"
            except Exception:
                pass
    try:
        req = urllib.request.Request(URL, headers={"User-Agent": "hermes-analytics"})
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = json.load(r)
        models = {m["id"]: m.get("pricing", {}) for m in raw.get("data", [])}
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        json.dump({"fetched": time.time(), "models": models}, open(CACHE, "w"))
        return models, "live"
    except Exception as e:
        # Network down: fall back to a stale cache rather than losing all pricing.
        if os.path.exists(CACHE):
            return json.load(open(CACHE))["models"], f"stale ({e.__class__.__name__})"
        return {}, f"unavailable ({e.__class__.__name__})"


def is_local(model):
    m = (model or "").lower()
    return any(h in m for h in LOCAL_HINTS)


def _resolve_catalog_id(model, catalog):
    """Find the OpenRouter id for a model name the ALIASES table does not pin.

    Hermes records Anthropic models with dashed versions ("claude-fable-5-1")
    while OpenRouter lists them dotted ("anthropic/claude-fable-5.1"). Before
    this, every new Anthropic release silently priced at $0.00 until someone
    hand-added an alias — opus-5-5 and fable-5-1 both shipped that way. Try
    the exact basename first, then the dashed->dotted form, and never match a
    ":batch"/":thinking" variant by accident.
    """
    base = (model or "").split("/")[-1].lower()
    if not base:
        return None
    cands = [base]
    # claude-fable-5-1 -> claude-fable-5.1; claude-opus-4-5-20251101 keeps
    # the date suffix as-is (that form is pinned in ALIASES anyway).
    import re
    dotted = re.sub(r"-(\d+)-(\d+)$", r"-\1.\2", base)
    if dotted != base:
        cands.append(dotted)
    for cand in cands:
        for cid in catalog:
            if ":" in cid.split("/")[-1]:
                continue
            if cid.split("/")[-1].lower() == cand:
                return cid
    return None


def rates_for(model, catalog):
    """-> (prompt, completion, cache_read) USD per token, or None.

    Order: local check -> web-sourced WEB_RATES -> OpenRouter catalog.
    WEB_RATES wins because it carries official vendor numbers for models
    OpenRouter does not list (Codex/Astra) or lists under a different SKU.
    """
    if is_local(model):
        return None
    w = WEB_RATES.get(model) or WEB_RATES.get((model or "").split("/")[-1])
    if w:
        return (w[0] / 1e6, w[1] / 1e6, w[2] / 1e6)
    oid = ALIASES.get(model)
    if not oid:
        oid = _resolve_catalog_id(model, catalog)
    p = catalog.get(oid or "")
    if not p:
        return None
    try:
        return (float(p.get("prompt") or 0),
                float(p.get("completion") or 0),
                float(p.get("input_cache_read") or 0))
    except (TypeError, ValueError):
        return None


def price_row(row, catalog):
    """Annotate one usage row with cost_class, real cost and market value."""
    prov = (row.get("provider") or "").strip()
    # The endpoint actually called outranks the config slot name: Fireworks
    # traffic recorded under a "custom" slot must not be classed as free local.
    url = (row.get("base_url") or "").lower()
    if url:
        if "fireworks.ai" in url or "openrouter.ai" in url:
            prov = "fireworks" if "fireworks.ai" in url else "openrouter"
        elif "opencode.ai" in url:
            prov = "opencode-go"
        elif "api.anthropic.com" in url:
            prov = "anthropic"
        elif any(h in url for h in _local_patterns()):
            prov = "local"
    cls = PROVIDER_CLASS.get(prov, "unknown")
    model = row.get("model")
    if (model or "").strip().lower() in PRESET_MODELS or prov == "moa":
        # Ensemble/router preset: members are billed on their own rows.
        cls = "preset"
    elif (model or "").lower().endswith(FREE_TIER_SUFFIX):
        cls = "free"
    elif is_local(model):
        cls = "free"
    elif metered_by_model(model):
        # The model name proves pay-per-token, so it outranks the provider slot
        # (Fireworks/OpenRouter traffic is often recorded under "custom").
        cls = "metered"
    elif cls == "unknown":
        # No provider recorded: recover the class from the model name rather
        # than reporting a well-known model as untracked.
        cls = class_from_model(model) or "unknown"
    r = rates_for(model, catalog)
    value = 0.0
    if r:
        pin, pout, pcache = r
        value = (row.get("input_tokens", 0) * pin
                 + row.get("output_tokens", 0) * pout
                 + row.get("cache_read", 0) * pcache)
    return {
        "cost_class": cls,
        "market_value_usd": round(value, 4),
        "billed_usd": round(value, 4) if cls == "metered" else 0.0,
        "priced": bool(r),
    }


if __name__ == "__main__":
    import sys
    cat, src = fetch_catalog(force="--force" in sys.argv)
    print(f"catalog: {len(cat)} models ({src})")
    for m in ("claude-opus-5", "glm-5.3-flash", "qwen3-coder:30b",
              "accounts/fireworks/models/deepseek-v4p1-flash"):
        r = rates_for(m, cat)
        print(f"  {m:<46} {'local/none' if not r else f'in={r[0]*1e6:.2f} out={r[1]*1e6:.2f} /Mtok'}")
