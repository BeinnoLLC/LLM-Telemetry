#!/usr/bin/env python3
"""OpenRouter pricing catalog -> per-model rates for Hermes usage rows.

Refreshed on the cache TTL (see TTL / ttl_label()). Classifies every billing provider so we never
invent a per-token cost for flat-fee or local traffic:

  metered      real pay-per-token spend  (fireworks, openrouter, deepseek direct)
  subscription flat monthly fee          (anthropic OAuth, opencode-go, openai-codex)
  free         local hardware            (custom/ollama)

For subscription+free rows we still compute a MARKET-EQUIVALENT value: what the
same tokens would have cost at public API rates. That answers "is the
subscription worth it" without ever pretending it is money spent.
"""
import datetime
import json
import os
import re
import time
import urllib.request
from typing import Any

from .config import get as _cfg
from .schema import stamp as _stamp


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
NOUS_URL = "https://inference-api.nousresearch.com/v1/models"
NOUS_CACHE = str(_cfg().reports_dir / "nous-pricing-cache.json")
NOUS_PREFIX = "nous:"

PROVIDER_CLASS = {
    "fireworks": "metered",
    "openrouter": "metered",
    "deepseek": "metered",
    "anthropic": "subscription",
    "opencode-go": "subscription",
    "openai-codex": "subscription",
    "copilot": "subscription",
    "nous": "subscription",
    "ollama-cloud": "metered",
    "custom": "local",
    "local": "local",
    "ollama": "local",
    "": "unknown",
}

LOCAL_HINTS = ("qwen3-coder", "gpt-oss", "qwen3:14b", "qwen3.8:latest",
               "deepseek-r1:14b", "nemotron", "qwen3:30b", "ministral",
               "ornith", "clef", "openjev")

METERED_MODEL_HINTS = (
    "accounts/fireworks/models/",
    "openrouter/",
)

# Cloud-served SKUs whose names contain a LOCAL_HINTS substring ("nemotron").
# Ollama Cloud serves these metered; they are priced from the live catalogue.
# A row sent to a LAN endpoint is still classed local by its URL in price_row().
CLOUD_ONLY_MODELS = frozenset({
    "nemotron-3-nano", "nemotron-3-super", "nemotron-3-ultra",
})

PRESET_MODELS = ("default",)

FREE_TIER_SUFFIX = ":free"

ZEN_FREE_MODELS = {
    "space-bunny-free",
    "longcat-2.5-preview-free",
    "mimo-v2.6-flash-free",
    "mimo-v2.5-free",
    "ling-3.0-flash-fin-free",
    "nemotron-3-ultra-free",
    "nemotron-3.5-lightning-free",
    "muse-spark-1.3-contributor-free",
    "jev-1.13-free",
    "big-pickle",
}


def is_free_tier(model):
    """True when this model's rate is a published $0, not merely unknown.

    Two conventions, both real traffic at zero cost per token: OpenRouter's
    ":free" suffix and OpenCode Zen's free SKUs (which may carry a "-free"
    suffix, a bare marketing name, or a dated "-preview-free" variant). The name
    alone cannot prove $0 — anything unrecognised must stay "unpriced" so the
    gap still surfaces — so only the explicit lists below qualify.
    """
    m = (model or "").strip().lower()
    if not m:
        return False
    if m.endswith(FREE_TIER_SUFFIX):
        return True
    if m in ZEN_FREE_MODELS:
        return True
    base = m.rsplit("/", 1)[-1]
    return base in ZEN_FREE_MODELS


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

# Rate precedence in rates_for(): local-by-name -> RATE_OVERRIDES -> live
# catalogue (OpenRouter) -> WEB_RATES. WEB_RATES is only the fallback for models
# the live catalogue does not list, so stale built-in numbers can no longer
# shadow a fresh catalogue price.
#
# RATE_OVERRIDES is the one place a built-in rate beats a live entry. Keep it
# small and say why each line is here:
#   * the live entry looks wrong (a data error on the catalogue side);
#   * the rate is provider-specific (Fireworks bills its own SKUs, which a
#     generic catalogue entry for the same weights does not describe).
RATE_OVERRIDES = {
    # live 0.07/1.40 -> input far below any GLM tier; official list is 1.40/4.40
    "glm-5.3":    (1.40, 4.40, 0.26),
    # live 0.169/20 -> output looks like a typo; official list is 3/15
    "kimi-k3":    (3.00, 15.00, 0.30),
    # Fireworks-billed SKUs: Fireworks' own price, not the generic model's
    "accounts/fireworks/models/deepseek-v4-flash-0731":       (0.22, 0.66, 0.007),
    "accounts/fireworks/models/deepseek-v4-flash-vision-exp": (0.22, 0.66, 0.007),
    "accounts/fireworks/models/deepseek-v4p1-flash":          (0.22, 0.66, 0.007),
    "accounts/fireworks/models/deepseek-v4-pro-0813":         (1.32, 3.96, 0.044),
    "accounts/fireworks/models/kimi-k3":                      (3.00, 15.00, 0.30),
}

# Fallback only (see precedence above): models with no live catalogue entry.
WEB_RATES = {
    "gpt-6-astra":     (10.00, 50.00, 1.00),
    "gpt-5.6-luna":    (0.20,  1.20,  0.02),
    "gpt-5.6-terra":   (2.00,  12.00, 0.20),
    "gpt-5.6-sol":     (4.00,  20.00, 0.40),
    "gpt-5.3-codex":   (1.75,  14.00, 0.175),
    "deepseek-v4.1-flash":    (0.22,  0.66,  0.007),
    "deepseek-v4-flash":      (0.22,  0.66,  0.007),
    "deepseek-v4-pro":        (0.66,  1.98,  0.022),
    "gemma4":                 (0.14,  0.40,  0.05),
    "glm-5.3-flash":          (0.15,  0.50,  0.03),
    "gpt-oss:120b":           (0.15,  0.60,  0.015),
    "gpt-oss:20b":            (0.07,  0.30,  0.035),
    "kimi-k2.7-code":         (0.95,  4.00,  0.19),
    "kimi-k2.6":              (0.95,  4.00,  0.16),
    "minimax-m3":             (0.60,  2.40,  0.12),
    "nemotron-3-nano":        (0.06,  0.24,  0.0),
    "nemotron-3-super":       (0.30,  2.40,  0.0),
    "nemotron-3-ultra":       (0.60,  2.40,  0.0),
    "qwen3.5:397b":           (0.60,  3.60,  0.0),
}

ALIASES = {
    "claude-opus-5": "anthropic/claude-opus-5",
    "claude-opus-4-7": "anthropic/claude-opus-4.7",
    "claude-sonnet-5": "anthropic/claude-sonnet-5",
    "claude-sonnet-4-5-20250929": "anthropic/claude-sonnet-4.5",
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
    # no Fireworks-specific rate is recorded for this SKU, so it is priced at the
    # generic z-ai/glm-5.3-flash catalogue rate (add a RATE_OVERRIDES line if
    # Fireworks' own price is ever pinned)
    "accounts/fireworks/models/glm-5p3-flash": "z-ai/glm-5.3-flash",
    "gpt-5.6-luna": "openai/gpt-5.6-luna",
    "gpt-5.3-codex": "openai/gpt-5.3-codex",
    "gpt-6-astra": "openai/gpt-6-astra",
    "qwen3.8-max": "qwen/qwen3.8-max-0902",
    "qwen3.8-max-prime": "qwen/qwen3.8-max-prime",
    "qwen3.8-flash": "qwen/qwen3.8-flash",
    "kimi-k2.7-code": "moonshotai/kimi-k2.7-code",
    "kimi-k2.6": "moonshotai/kimi-k2.6",
    "kimi-k2.5": "moonshotai/kimi-k2.5",
    "gpt-5.1-codex": "openai/gpt-5.1-codex",
    "minimax-m3": "minimax/minimax-m3",
    "qwen3.7-max": "qwen/qwen3.7-max",
    "qwen3.5:397b": "qwen/qwen3.5-397b-a17b",
    "nemotron-3-nano": "nvidia/nemotron-3-nano-30b-a3b",
    "nemotron-3-super": "nvidia/nemotron-3-super-120b-a12b",
    "nemotron-3-ultra": "nvidia/nemotron-3-ultra-550b-a55b",
    # Ollama-style cloud tags ("gpt-oss:20b-cloud"); the bare tag is local by name.
    "gpt-oss:20b": "openai/gpt-oss-20b",
    "gpt-oss:120b": "openai/gpt-oss-120b",
    # "gemma4" is deliberately NOT mapped: the catalogue lists gemma-4-26b-a4b-it
    # and gemma-4-31b-it, and the bare Ollama tag does not say which size ran.
}


def ttl_label(seconds=None):
    """Human form of the catalogue TTL ("<n>h" style), derived from TTL (P6-02).

    Pages that state how often prices refresh interpolate this, so the text
    cannot drift from the constant again.
    """
    s = TTL if seconds is None else seconds
    if s % 86400 == 0:
        return f"{s // 86400}d"
    if s % 3600 == 0:
        return f"{s // 3600}h"
    return f"{s // 60}m"


def age_label(seconds):
    """Compact age: "12m", "2h", "3d"."""
    if seconds is None:
        return ""
    s = max(0, int(seconds))
    if s < 3600:
        return f"{s // 60}m"
    if s < 86400:
        return f"{s // 3600}h"
    return f"{s // 86400}d"


def catalog_freshness(source, now=None):
    """How fresh the OpenRouter prices are (P6-02, #60).

    Returns {state, age_s, age, ttl, detail}. state is one of:
      live         fetched during this build
      cache        read from a cache younger than TTL
      stale        fetch failed and an older cache was used
      unavailable  fetch failed and there is no cache: no catalogue prices
    """
    now = time.time() if now is None else now
    age = None
    if os.path.exists(CACHE):
        try:
            cached = json.load(open(CACHE))
            fetched_at = cached.get("fetched_at")
            if fetched_at:
                ts = datetime.datetime.fromisoformat(fetched_at).timestamp()
            else:
                ts = float(cached.get("fetched") or os.path.getmtime(CACHE))
            age = now - ts
        except Exception:
            age = now - os.path.getmtime(CACHE)
    src = (source or "").strip()
    state = src.split(" ", 1)[0] or "unavailable"
    if state == "pinned":
        return {"state": "pinned", "age_s": None, "age": "", "ttl": ttl_label(), "detail": ""}
    if state not in ("live", "cache", "stale", "unavailable"):
        state = "cache"
    if state == "cache" and age is not None and age > TTL:
        state = "stale"
    detail = src[len(state):].strip(" ()") if src.startswith(state) else ""
    return {"state": state, "age_s": age, "age": age_label(age),
            "ttl": ttl_label(), "detail": detail}


def _iso_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _fetch_cached(url, cache, shape, force=False):
    """-> (models, source) for one remote catalogue, cached for TTL seconds,
    falling back to a stale cache when the network is down."""
    if not force and os.path.exists(cache):
        if time.time() - os.path.getmtime(cache) < TTL:
            try:
                return json.load(open(cache))["models"], "cache"
            except Exception:
                pass
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "hermes-analytics"})
        with urllib.request.urlopen(req, timeout=30) as r:
            models = shape(json.load(r))
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        json.dump(_stamp({"fetched": time.time(), "fetched_at": _iso_now(), "source": url,
                          "ttl_s": TTL, "status": "ok", "last_error": None, "models": models}),
                  open(cache, "w"))
        return models, "live"
    except Exception as e:
        if os.path.exists(cache):
            try:
                prior = json.load(open(cache))
                models = prior["models"]
                merged = dict(prior)
                merged.setdefault("ttl_s", TTL)
                merged["status"] = "stale"
                merged["last_error"] = f"{e.__class__.__name__}: {e}"
                merged["source"] = url
                os.makedirs(os.path.dirname(cache), exist_ok=True)
                json.dump(_stamp(merged), open(cache, "w"))
                return models, f"stale ({e.__class__.__name__})"
            except Exception:
                pass
        return {}, f"unavailable ({e.__class__.__name__})"


def _shape_nous(raw):
    """Nous /v1/models -> {"nous:<id>": pricing}, one key per id AND alias
    (rows record either "deepseek/deepseek-v4-pro-0813" or a dated alias)."""
    out = {}
    for m in raw.get("data", []):
        pr = m.get("pricing") or {}
        for mid in [m.get("id"), *(m.get("aliases") or [])]:
            if mid:
                out.setdefault(NOUS_PREFIX + mid, pr)
    return out


def fetch_nous_catalog(force=False):
    return _fetch_cached(NOUS_URL, NOUS_CACHE, _shape_nous, force)


def fetch_catalog(force=False):
    """Return {openrouter_id: pricing_dict} plus {"nous:<id>": pricing_dict},
    cached for TTL seconds.

    LLM_TELEMETRY_CATALOG pins a catalogue file (the committed sample one),
    read as-is: no network, no refresh, so a sample build is reproducible.
    The source label is the OpenRouter one; a Nous fetch failure only means
    Nous rows fall back to OpenRouter rates.
    """
    pinned = os.environ.get("LLM_TELEMETRY_CATALOG")
    if pinned:
        return json.load(open(pinned))["models"], "pinned"
    models, src = _fetch_openrouter(force)
    nous, _nsrc = fetch_nous_catalog(force)
    return {**models, **nous}, src


def _fetch_openrouter(force=False):
    if not force and os.path.exists(CACHE):
        try:
            cached = json.load(open(CACHE))
            if time.time() - float(cached.get("fetched") or os.path.getmtime(CACHE)) < TTL:
                return cached["models"], "cache"
        except Exception:
            pass
    try:
        req = urllib.request.Request(URL, headers={"User-Agent": "hermes-analytics"})
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = json.load(r)
        models = {m["id"]: m.get("pricing", {}) for m in raw.get("data", [])}
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        json.dump(_stamp({"fetched": time.time(), "fetched_at": _iso_now(), "source": URL,
                          "ttl_s": TTL, "status": "ok", "last_error": None, "models": models}),
                  open(CACHE, "w"))
        return models, "live"
    except Exception as e:
        if os.path.exists(CACHE):
            try:
                prior = json.load(open(CACHE))
                models = prior["models"]
                merged = dict(prior)
                merged.setdefault("ttl_s", TTL)
                merged["status"] = "stale"
                merged["last_error"] = f"{e.__class__.__name__}: {e}"
                merged["source"] = URL
                merged["fetched_at"] = merged.get("fetched_at") or _iso_now()
                os.makedirs(os.path.dirname(CACHE), exist_ok=True)
                json.dump(_stamp(merged), open(CACHE, "w"))
                return models, f"stale ({e.__class__.__name__})"
            except Exception:
                pass  # corrupt cache while offline: built-in rates take over
        return {}, f"unavailable ({e.__class__.__name__})"


_CAT_MEMO: dict[str, Any] = {}


def cached_catalog():
    """The catalogue from disk only (pinned file or the OpenRouter cache,
    stale or not), never the network: for the 5 s live poll, which must not
    block on a fetch. {} when there is none; built-in rates then apply."""
    path = os.environ.get("LLM_TELEMETRY_CATALOG") or CACHE
    try:
        mtime = os.path.getmtime(path)
        if _CAT_MEMO.get("k") != (path, mtime):
            _CAT_MEMO["k"], _CAT_MEMO["v"] = (path, mtime), json.load(open(path))["models"]
        return _CAT_MEMO["v"]
    except (OSError, ValueError, KeyError, TypeError):
        return {}


def is_local(model):
    """Local by NAME. A vendor-qualified id ("openai/gpt-oss-120b",
    "qwen/qwen3-coder") is a hosted catalogue model and never local here:
    the hints are substrings, and "gpt-oss"/"qwen3-coder"/"nemotron" also
    name cloud SKUs. Ollama tags have no vendor prefix. A row sent to a LAN
    host is still classed local by its endpoint in price_row()."""
    m = (model or "").lower()
    if "/" in m:
        return False
    if m.endswith(":cloud") or m.endswith("-cloud"):
        return False
    if m in CLOUD_ONLY_MODELS:
        return False
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
    base = re.sub(r"(:|-)cloud$", "", base)
    variant = None
    if ":" in base:
        base, variant = base.rsplit(":", 1)
    cands = [base]
    dotted = re.sub(r"-(\d+)-(\d+)$", r"-\1.\2", base)
    if dotted != base:
        cands.append(dotted)
    for cand in cands:
        for cid in catalog:
            if cid.startswith(NOUS_PREFIX) or ":" in cid.split("/")[-1]:
                continue
            if cid.split("/")[-1].lower() == cand:
                return cid
    return None


def catalog_size(catalog):
    """OpenRouter models in a catalogue, excluding the merged Nous entries."""
    return sum(1 for k in catalog if not k.startswith(NOUS_PREFIX))


def serving_provider_hint(model, catalog):
    """Which provider WOULD serve this model, from its name alone.

    Answers the sheet's Served-by column for rows with no recorded traffic
    (a model you have not called yet has no provider slot to read, which is
    why most rows showed "—"). Resolution order mirrors real attribution:
      1. nous:<model> in the catalogue / a nous vendor prefix  -> "nous"
      2. vendor-qualified id ("anthropic/x", "moonshotai/y")   -> that vendor
      3. an ALIAS resolving into the catalogue                 -> alias' vendor
      4. a fuzzy catalogue hit (_resolve_catalog_id)           -> its vendor
      5. WEB_RATES-covered names                               -> that vendor
      6. local-by-name (no vendor prefix, LOCAL_HINTS hit)     -> "local"
    Returns None ONLY when nothing is knowable — never a guess dressed up
    as a fact.
    """
    m = (model or "").strip()
    if not m:
        return None
    lm = m.lower()
    if lm.startswith(NOUS_PREFIX.rstrip(":") + ":") or (NOUS_PREFIX + m) in catalog:
        return "nous"
    if lm.startswith("accounts/fireworks/"):
        return "fireworks"
    if "/" in m:
        return m.split("/", 1)[0].lower()
    oid = ALIASES.get(m)
    if not oid:
        oid = m if m in catalog else _resolve_catalog_id(m, catalog)
    if oid and oid.lower().startswith("accounts/fireworks/"):
        return "fireworks"
    if oid and not oid.startswith(NOUS_PREFIX):
        return oid.split("/", 1)[0].lower()
    if lm in WEB_RATES or lm in RATE_OVERRIDES:
        if lm.endswith(":cloud") or lm.endswith("-cloud"):
            return "ollama-cloud"
        if lm.startswith("gpt-"):
            return "openai"
        if lm.startswith("kimi-"):
            return "moonshotai"
        if lm.startswith("minimax-"):
            return "minimax"
        if lm.startswith("deepseek-"):
            return "deepseek"
        if lm.startswith("glm-"):
            return "z-ai"
        if lm.startswith("qwen"):
            return "qwen"
        if lm.startswith("nemotron-"):
            return "nvidia"
        if lm.startswith("accounts/fireworks/"):
            return "fireworks"
        return "ollama-cloud"
    if is_local(m):
        return "local"
    return None


def _rate_triple(p):
    try:
        r = (float(p.get("prompt") or 0), float(p.get("completion") or 0),
             float(p.get("input_cache_read") or 0))
    except (TypeError, ValueError, AttributeError):
        return None
    return None if any(x < 0 for x in r) else r


def nous_rates_for(model, catalog, prompt_per_call=None):
    """-> Nous Portal's own (prompt, completion, cache_read) per token, or None.

    Exact id or alias only, with the vendor prefix tolerated both ways
    ("deepseek-v4.1-flash" vs "deepseek/deepseek-v4.1-flash" is NOT guessed:
    a wrong Nous match would be worse than the OpenRouter fallback). When the
    row's average prompt per call reaches an override's min_prompt_tokens, the
    long-context tier applies — rows are aggregates, so the average is the
    best available proxy for the per-call size Nous bills on.
    """
    p = catalog.get(NOUS_PREFIX + (model or ""))
    if not p:
        return None
    base = _rate_triple(p)
    if not base:
        return None
    if prompt_per_call:
        tiers = sorted((o for o in (p.get("overrides") or []) if isinstance(o, dict)),
                       key=lambda o: float(o.get("min_prompt_tokens") or 0))
        for o in tiers:
            if prompt_per_call >= float(o.get("min_prompt_tokens") or 0):
                merged = {"prompt": o.get("prompt", p.get("prompt")),
                          "completion": o.get("completion", p.get("completion")),
                          "input_cache_read": o.get("input_cache_read", p.get("input_cache_read"))}
                base = _rate_triple(merged) or base
    return base


def _builtin_rate(table, model):
    """Look a model up in a built-in rate table by id, basename, or cloud-stripped tag."""
    base = (model or "").split("/")[-1].lower()
    bare = re.sub(r"(:|-)cloud$", "", base)
    w = table.get(model) or table.get(base) or table.get(bare)
    if not w and ":" in bare:
        w = table.get(bare.rsplit(":", 1)[0])
    return w


def _live_rate(model, catalog):
    """-> (prompt, completion, cache_read) from the live catalogue, or None."""
    base = re.sub(r"(:|-)cloud$", "", (model or "").split("/")[-1].lower())
    oid = ALIASES.get(model) or ALIASES.get(base)
    if not oid:
        oid = model if model in catalog else _resolve_catalog_id(model, catalog)
    p = catalog.get(oid or "")
    if not p:
        return None
    try:
        r = (float(p.get("prompt") or 0),
             float(p.get("completion") or 0),
             float(p.get("input_cache_read") or 0))
    except (TypeError, ValueError):
        return None
    if any(x < 0 for x in r):
        return None
    if not any(r) and not is_free_tier(model):
        # all-zero on a non-free id is a promo/data error: fall through to the
        # built-in rate rather than pricing the model at $0
        return None
    return r


def rate_origin(model, catalog):
    """-> (origin, (prompt, completion, cache_read) per token) or (None, None).

    origin is "override" (RATE_OVERRIDES), "catalog" (live OpenRouter entry) or
    "builtin" (WEB_RATES fallback for a model the catalogue does not list).
    """
    if is_local(model):
        from . import energy as E
        (ri, ro, rc), _tps = E.local_rates(model)
        return "local", (ri / 1e6, ro / 1e6, rc / 1e6)
    w = _builtin_rate(RATE_OVERRIDES, model)
    if w:
        return "override", (w[0] / 1e6, w[1] / 1e6, w[2] / 1e6)
    r = _live_rate(model, catalog)
    if r:
        return "catalog", r
    w = _builtin_rate(WEB_RATES, model)
    if w:
        return "builtin", (w[0] / 1e6, w[1] / 1e6, w[2] / 1e6)
    return None, None


def rates_for(model, catalog):
    """-> (prompt, completion, cache_read) USD per token, or None.

    Order: local check -> RATE_OVERRIDES -> live catalogue -> WEB_RATES.
    The live catalogue wins over the built-in table; see RATE_OVERRIDES for
    the few deliberate exceptions.
    """
    return rate_origin(model, catalog)[1]


def is_dead_endpoint(base_url):
    """True for the discard-port test endpoints (127.0.0.1:9 / localhost:9).

    Rows and ids that only ever hit one of these are test scaffolding, not
    models anyone priced; pricing reports leave them out.
    """
    u = (base_url or "").lower()
    return bool(re.match(r"^(?:\w+://)?(?:127\.0\.0\.1|localhost|\[::1\]):9(?:[/?#]|$)", u))


def price_row(row, catalog):
    """Annotate one usage row with cost_class, real cost and market value."""
    prov = (row.get("provider") or "").strip()
    url = (row.get("base_url") or "").lower()
    if url:
        if "fireworks.ai" in url or "openrouter.ai" in url:
            prov = "fireworks" if "fireworks.ai" in url else "openrouter"
        elif "opencode.ai" in url:
            prov = "opencode-go"
        elif "api.anthropic.com" in url:
            prov = "anthropic"
        elif "nousresearch.com" in url:
            prov = "nous"
        elif "ollama.com" in url:
            prov = "ollama-cloud"
        elif any(h in url for h in _local_patterns()):
            prov = "local"
    cls = PROVIDER_CLASS.get(prov, "unknown")
    model = row.get("model")
    if (model or "").strip().lower() in PRESET_MODELS or prov == "moa":
        cls = "preset"
    elif is_free_tier(model):
        cls = "free"
    elif is_local(model):
        cls = "local"
    elif (model or "").lower().endswith((":cloud", "-cloud")):
        cls = "metered"
    elif metered_by_model(model):
        cls = "metered"
    elif cls == "unknown":
        cls = class_from_model(model) or "unknown"
    r = None
    rate_source = ""
    if prov == "nous" and cls not in ("local", "preset"):
        calls = row.get("calls") or 0
        prompt = (row.get("input_tokens") or 0) + (row.get("cache_read") or 0)
        ppc = (prompt / calls) if calls else None
        r = nous_rates_for(model, catalog, ppc)
        if r:
            rate_source = "nous"
    if r is None:
        r = None if is_free_tier(model) else rates_for(model, catalog)
        if r:
            rate_source = "local" if is_local(model) else "catalog"
    if cls == "local" and not is_local(model):
        from . import energy as E
        (ri, ro, rc), _tps = E.local_rates(model)
        r = (ri / 1e6, ro / 1e6, rc / 1e6)
        rate_source = "energy"
    value = 0.0
    if r:
        pin, pout, pcache = r
        cwrite_mult = 1.25 if row.get("cache_write") else 0.0
        value = (row.get("input_tokens", 0) * pin
                 + row.get("output_tokens", 0) * pout
                 + row.get("cache_read", 0) * pcache
                 + row.get("cache_write", 0) * cwrite_mult * pin)
    energy = value if cls == "local" else 0.0
    return {
        "cost_class": cls,
        "market_value_usd": round(value, 6),
        "billed_usd": round(value, 6) if cls == "metered" else 0.0,
        "energy_usd": round(energy, 6),
        "priced": bool(r) or cls == "free",
        "rate_source": rate_source,
    }


if __name__ == "__main__":
    import sys
    cat, src = fetch_catalog(force="--force" in sys.argv)
    print(f"catalog: {catalog_size(cat)} OpenRouter + {len(cat) - catalog_size(cat)} Nous ids ({src})")
    for m in ("claude-opus-5", "glm-5.3-flash", "qwen3-coder:30b",
              "accounts/fireworks/models/deepseek-v4p1-flash"):
        r = rates_for(m, cat)
        print(f"  {m:<46} {'local/none' if not r else f'in={r[0]*1e6:.2f} out={r[1]*1e6:.2f} /Mtok'}")
