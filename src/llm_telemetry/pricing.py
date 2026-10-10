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
import json
import os
import re
import time
import urllib.request

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
# Nous Portal publishes its OWN price list (#131): public, OpenRouter-shaped,
# and not always equal to OpenRouter's (deepseek-v4-pro-0813 is 5x cheaper on
# Nous). Merged into the catalogue under NOUS_PREFIX so Nous traffic prices at
# what Nous charges while every other row keeps the OpenRouter rate.
NOUS_URL = "https://inference-api.nousresearch.com/v1/models"
NOUS_CACHE = str(_cfg().reports_dir / "nous-pricing-cache.json")
NOUS_PREFIX = "nous:"

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
    # Ollama Cloud (https://ollama.com/v1) is consumption-billed: plan credits
    # drawn per request, not a flat monthly fee. Real rows exist with the
    # provider slot "ollama-cloud" (issue #118).
    "ollama-cloud": "metered",
    # Local inference is "local", never "free": it costs electricity (P7-01).
    "custom": "local",
    "local": "local",
    "ollama": "local",
    "": "unknown",
}

# Models that live on local hardware: never price them, whatever the name says.
LOCAL_HINTS = ("qwen3-coder", "gpt-oss", "qwen3:14b", "qwen3.8:latest",
               "deepseek-r1:14b", "nemotron", "qwen3:30b", "ministral",
               # 2026-10-10 fleet additions (ollama list): ornith/ornith-1.5 are
               # 9B qwen3.5-family chat models; clef/clef-flash (27B/9B, vision)
               # and openjev serve SystemOne decision traffic (/v1/systemone),
               # never cloud chat — any usage row carrying them is local hardware.
               "ornith", "clef", "openjev")

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

# OpenCode Zen ships free SKUs under its OWN naming convention, not OpenRouter's
# ":free" suffix — "space-bunny-free", "longcat-2.5-preview-free", or a bare
# "big-pickle". They were falling through to the catalogue, which does not list
# them, so 153 calls of real traffic priced at $0 and landed in "unpriced":
# genuine $0, reported as a data gap (issue #135). Declared here as an explicit
# $0 price so they read as a priced free tier, exactly like ":free" does.
# Source: opencode.ai/docs/zen pricing table (Input/Output/Cached Read = Free).
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
    # Zen free SKUs also appear with a vendor prefix ("openrouter/…", "zen/…")
    # or an ":online" tag; match on the basename only after an exact-list miss,
    # and never on a substring so "space-bunny-free-experimental" stays unpriced.
    base = m.rsplit("/", 1)[-1]
    return base in ZEN_FREE_MODELS


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
# gpt-5.3-codex), docs.fireworks.ai/serverless/pricing (DeepSeek SKUs),
# ollama.com/pricing (Ollama Cloud SKUs, standard non-peak rates).
WEB_RATES = {
    # OpenAI / Codex — absent from OpenRouter
    "gpt-6-astra":     (10.00, 50.00, 1.00),
    "gpt-5.6-luna":    (0.20,  1.20,  0.02),
    "gpt-5.6-terra":   (2.00,  12.00, 0.20),
    "gpt-5.6-sol":     (4.00,  20.00, 0.40),
    "gpt-5.3-codex":   (1.75,  14.00, 0.175),
    # Fireworks serverless SKUs — billed-by-fireworks rates from each model's
    # own fireworks page (cheaper than the OpenRouter proxy for the same
    # weights; issue #131). DeepSeek V4.1 Flash's docs-table row
    # $0.30/$0.006/$1.20 is DeepSeek/DeepInfra's first-party rate, NOT
    # Fireworks' ($0.22/$0.007/$0.66 on the model page, Oct 2026).
    "accounts/fireworks/models/deepseek-v4-flash-0731":       (0.22, 0.66, 0.007),
    "accounts/fireworks/models/deepseek-v4-flash-vision-exp": (0.22, 0.66, 0.007),
    "accounts/fireworks/models/deepseek-v4p1-flash":          (0.22, 0.66, 0.007),
    "accounts/fireworks/models/deepseek-v4-pro-0813":         (1.32, 3.96, 0.044),
    # Ollama Cloud (issue #118) — models OpenRouter does not list at all.
    # Keyed by the tagged name so ":cloud" rows price; _resolve_catalog_id and
    # rates_for both try the bare basename too, so either spelling works.
    "deepseek-v4.1-flash":    (0.22,  0.66,  0.007),
    "deepseek-v4-flash":      (0.22,  0.66,  0.007),
    "deepseek-v4-pro":        (0.66,  1.98,  0.022),
    "gemma4":                 (0.14,  0.40,  0.05),
    "glm-5.3":                (1.40,  4.40,  0.26),
    "glm-5.3-flash":          (0.15,  0.50,  0.03),
    "gpt-oss:120b":           (0.15,  0.60,  0.015),
    "gpt-oss:20b":            (0.07,  0.30,  0.035),
    "kimi-k3":                (3.00, 15.00,  0.30),
    "kimi-k2.7-code":         (0.95,  4.00,  0.19),
    "kimi-k2.6":              (0.95,  4.00,  0.16),
    "minimax-m3":             (0.60,  2.40,  0.12),
    "nemotron-3-nano":        (0.06,  0.24,  0.0),
    "nemotron-3-super":       (0.015, 0.60,  0.015),
    "nemotron-3-ultra":       (0.10,  3.00,  0.10),
    "qwen3.5:397b":           (0.60,  3.60,  0.0),
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
    # Hermes/portal names without the vendor prefix (issue #117: 21 real calls
    # at $0 because no alias existed). Each maps to the OpenRouter SKU the
    # provider actually serves.
    "qwen3.8-max": "qwen/qwen3.8-max-0902",
    "qwen3.8-max-prime": "qwen/qwen3.8-max-prime",
    "qwen3.8-flash": "qwen/qwen3.8-flash",
    "kimi-k2.7-code": "moonshotai/kimi-k2.7-code",
    "kimi-k2.6": "moonshotai/kimi-k2.6",
    "kimi-k2.5": "moonshotai/kimi-k2.5",
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
            age = now - float(json.load(open(CACHE)).get("fetched") or os.path.getmtime(CACHE))
        except Exception:
            age = now - os.path.getmtime(CACHE)
    src = (source or "").strip()
    state = src.split(" ", 1)[0] or "unavailable"
    if state == "pinned":
        # A fixed catalogue file (the committed sample): never refreshed, so
        # age and TTL do not apply.
        return {"state": "pinned", "age_s": None, "age": "", "ttl": ttl_label(), "detail": ""}
    if state not in ("live", "cache", "stale", "unavailable"):
        state = "cache"
    # An old cache is stale even when no fetch was attempted.
    if state == "cache" and age is not None and age > TTL:
        state = "stale"
    detail = src[len(state):].strip(" ()") if src.startswith(state) else ""
    return {"state": state, "age_s": age, "age": age_label(age),
            "ttl": ttl_label(), "detail": detail}


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
        json.dump({"fetched": time.time(), "models": models}, open(cache, "w"))
        return models, "live"
    except Exception as e:
        if os.path.exists(cache):
            try:
                return json.load(open(cache))["models"], f"stale ({e.__class__.__name__})"
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
    """Local by NAME. A vendor-qualified id ("openai/gpt-oss-120b",
    "qwen/qwen3-coder") is a hosted catalogue model and never local here:
    the hints are substrings, and "gpt-oss"/"qwen3-coder"/"nemotron" also
    name cloud SKUs. Ollama tags have no vendor prefix. A row sent to a LAN
    host is still classed local by its endpoint in price_row()."""
    m = (model or "").lower()
    if "/" in m:
        return False
    # An explicit cloud marker means hosted, whatever the name says: Ollama
    # Cloud tags are "kimi-k3:cloud", "qwen3-coder:480b-cloud", etc., and the
    # bare name inside the tag would otherwise match LOCAL_HINTS (issue #118).
    if m.endswith(":cloud") or m.endswith("-cloud"):
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
    # An Ollama Cloud tag ("kimi-k3:cloud", "qwen3-coder:480b-cloud") names a
    # hosted SKU the catalogue carries without the marker: strip it before
    # matching, or every :cloud request lands "unpriced" (issue #118).
    base = re.sub(r"(:|-)cloud$", "", base)
    # Batch/thinking variants bill at the base SKU (OpenRouter lists :batch as
    # its own id only where it exists; most carry no entry at all, so a
    # ":batch" request would otherwise land unpriced).
    variant = None
    if ":" in base:
        base, variant = base.rsplit(":", 1)
    cands = [base]
    # claude-fable-5-1 -> claude-fable-5.1; claude-opus-4-5-20251101 keeps
    # the date suffix as-is (that form is pinned in ALIASES anyway).
    dotted = re.sub(r"-(\d+)-(\d+)$", r"-\1.\2", base)
    if dotted != base:
        cands.append(dotted)
    for cand in cands:
        for cid in catalog:
            # Nous entries (#131) are looked up explicitly for Nous rows only;
            # a fuzzy match must never hand a non-Nous row a Nous rate.
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
        # vendor-qualified id where the FIRST segment is an account root, not
        # the vendor ("accounts/fireworks/models/x" would split to
        # "accounts"). The vendor is the second segment.
        return "fireworks"
    if "/" in m:
        return m.split("/", 1)[0].lower()
    # bare name: try the alias table, then the fuzzy match, then WEB_RATES,
    # then local-by-name — the same order rates_for() prices in
    oid = ALIASES.get(m)
    if not oid:
        oid = m if m in catalog else _resolve_catalog_id(m, catalog)
    if oid and oid.lower().startswith("accounts/fireworks/"):
        return "fireworks"
    if oid and not oid.startswith(NOUS_PREFIX):
        return oid.split("/", 1)[0].lower()
    if lm in WEB_RATES:
        # vendor of record per SKU block; Ollama Cloud SKUs are hosted
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


def rates_for(model, catalog):
    """-> (prompt, completion, cache_read) USD per token, or None.

    Order: local check -> web-sourced WEB_RATES -> OpenRouter catalog.
    WEB_RATES wins because it carries official vendor numbers for models
    OpenRouter does not list (Codex/Astra) or lists under a different SKU.
    """
    if is_local(model):
        # Local inference is priced from the electricity model (P7-01): a
        # local "qwen3" must never pick up a cloud qwen's catalogue price.
        from . import energy as E
        (ri, ro, rc), _tps = E.local_rates(model)
        return (ri / 1e6, ro / 1e6, rc / 1e6)
    # WEB_RATES is keyed on the bare model name, so try the raw name, the
    # vendor-stripped basename, and finally the cloud-marker-stripped form —
    # a ":cloud" request for "gpt-oss:120b-cloud" must find "gpt-oss:120b".
    base = (model or "").split("/")[-1].lower()
    bare = re.sub(r"(:|-)cloud$", "", base)
    w = (WEB_RATES.get(model) or WEB_RATES.get(base)
         or WEB_RATES.get(bare))
    # A ":batch"/":thinking" variant bills at its base SKU when the variant
    # itself has no published rate (see _resolve_catalog_id).
    if not w and ":" in bare:
        w = WEB_RATES.get(bare.rsplit(":", 1)[0])
    if w:
        return (w[0] / 1e6, w[1] / 1e6, w[2] / 1e6)
    oid = ALIASES.get(model)
    if not oid:
        # An exact catalogue id is its own price ("openai/gpt-5:batch" is a
        # real SKU); only a fuzzy name match must avoid the ":" variants.
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
    # OpenRouter marks router pseudo-models ("openrouter/auto") with -1: a
    # sentinel for "depends on the model it routes to", not a price. Taking it
    # literally would price a call at minus a dollar per token.
    if any(x < 0 for x in r):
        return None
    return r


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
        elif "nousresearch.com" in url:
            prov = "nous"
        elif "ollama.com" in url:
            # Ollama Cloud is hosted and metered, never a LAN host: it must be
            # matched BEFORE the local patterns (issue #118).
            prov = "ollama-cloud"
        elif any(h in url for h in _local_patterns()):
            prov = "local"
    cls = PROVIDER_CLASS.get(prov, "unknown")
    model = row.get("model")
    if (model or "").strip().lower() in PRESET_MODELS or prov == "moa":
        # Ensemble/router preset: members are billed on their own rows.
        cls = "preset"
    elif is_free_tier(model):
        # A published $0 tier: OpenRouter ":free" and OpenCode Zen's free SKUs
        # are genuinely free, a different thing from local inference (rates_for
        # is skipped below so the row can never inherit a metered SKU's price
        # through the base-name match).
        cls = "free"
    elif is_local(model):
        cls = "local"
    elif (model or "").lower().endswith((":cloud", "-cloud")):
        # An explicit cloud marker on the model name outranks the provider
        # slot the row was recorded under: a ":cloud" request routed through
        # a "custom" slot is hosted metered traffic, never the electricity
        # model (issue #118).
        cls = "metered"
    elif metered_by_model(model):
        # The model name proves pay-per-token, so it outranks the provider slot
        # (Fireworks/OpenRouter traffic is often recorded under "custom").
        cls = "metered"
    elif cls == "unknown":
        # No provider recorded: recover the class from the model name rather
        # than reporting a well-known model as untracked.
        cls = class_from_model(model) or "unknown"
    r = None
    rate_source = ""
    if prov == "nous" and cls not in ("local", "preset"):
        # What Nous actually charges (#131), before any OpenRouter guess. Its
        # catalogue lists its own ":free" SKUs at 0, so it also wins over the
        # free-tier shortcut for Nous traffic.
        calls = row.get("calls") or 0
        prompt = (row.get("input_tokens") or 0) + (row.get("cache_read") or 0)
        ppc = (prompt / calls) if calls else None
        r = nous_rates_for(model, catalog, ppc)
        if r:
            rate_source = "nous"
    if r is None:
        r = None if is_free_tier(model) else rates_for(model, catalog)
        if r:
            rate_source = "catalog"
    if cls == "local" and not is_local(model):
        # Classed local by its endpoint (a LAN host) but not by name: still
        # electricity, never a catalogue price and never $0 (P7-01).
        from . import energy as E
        (ri, ro, rc), _tps = E.local_rates(model)
        r = (ri / 1e6, ro / 1e6, rc / 1e6)
        rate_source = "energy"
    value = 0.0
    if r:
        pin, pout, pcache = r
        # Cache WRITES cost money too on Anthropic-shaped traffic (the only
        # family that reports cache_creation tokens): 1.25x the input rate.
        # Omitted, every prompt that built a cache was silently free here
        # while the provider's invoice included it.
        cwrite_mult = 1.25 if row.get("cache_write") else 0.0
        value = (row.get("input_tokens", 0) * pin
                 + row.get("output_tokens", 0) * pout
                 + row.get("cache_read", 0) * pcache
                 + row.get("cache_write", 0) * cwrite_mult * pin)
    energy = value if cls == "local" else 0.0
    return {
        "cost_class": cls,
        "market_value_usd": round(value, 6),
        # Billed = money that leaves an account. Electricity is paid to the
        # utility, not per call, so it is carried in energy_usd and never
        # silently folded into billed spend.
        "billed_usd": round(value, 6) if cls == "metered" else 0.0,
        "energy_usd": round(energy, 6),
        # A published $0 tier is PRICED: the rate is known, it just happens to
        # be zero. Reporting it as "unpriced" made real traffic look like a
        # catalogue gap and told the user their est. cost was understated when
        # it was exact (#135).
        "priced": bool(r) or cls == "free",
        # Which price list the rate came from: "nous" (Nous Portal's own,
        # #131), "catalog" (OpenRouter / web rates), or "" when unpriced.
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
