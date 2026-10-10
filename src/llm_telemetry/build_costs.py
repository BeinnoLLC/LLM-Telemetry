#!/usr/bin/env python3
"""Collect the per-million-token price payload the app's Prices view shows.

Answers one question: "how is a cost number on the dashboard produced?" Per
model: the exact input/output/cache rate applied, where that rate came from
(official vendor page, OpenRouter catalogue, or the local-electricity model),
and what the observed traffic cost at that rate. The rendering is the Prices
view inside dashboard.html (#113 consolidation: one app, no standalone pages).

Local models are NOT free — they burn electricity. That cost is shown as its
own figure (energy_usd), never folded into billed spend, and priced here from
measured throughput and the machine's draw at the configured tariff.
"""
import json
import os
import sys
import subprocess
import datetime
import collections
from pathlib import Path

from .config import get as _cfg

CFG = _cfg()
HERE = os.path.dirname(os.path.abspath(__file__))

from . import pricing as P  # noqa: E402 — deliberately after CFG/HERE; see module-level ordering note above

DATA = str(CFG.reports_dir / "analytics-data.json")

# ---------------------------------------------------------------- electricity
# The power model lives in energy.py (P7-01/02): one module, tariff and
# wattage read from config. This page only displays what it returns.
from . import energy as E  # noqa: E402 — deliberately after CFG/HERE constants

KWH_PRICE_USD, GPU_DRAW_W, HOST_OVERHEAD_W = E.tariff(CFG)
PREFILL_SPEEDUP = E.PREFILL_SPEEDUP
CACHE_SPEEDUP = E.CACHE_SPEEDUP


def local_rates(model):
    """-> ((input, output, cache) USD per 1M tokens, tokens/s)."""
    return E.local_rates(model, CFG)


def rate_source(model, catalog):
    """Where did this model's price come from? Drives the provenance column."""
    if P.is_local(model):
        return "local"
    # A published $0 tier is real traffic at a genuine $0 per token — OpenRouter
    # ":free" and OpenCode Zen's free SKUs alike — priced, not missing. Without
    # this it lands in "unpriced" and looks like a gap in the catalogue that
    # someone needs to go and fix.
    if P.is_free_tier(model):
        return "free-tier"
    if P.WEB_RATES.get(model) or P.WEB_RATES.get((model or "").split("/")[-1]):
        return "vendor"
    if P.rates_for(model, catalog):
        return "openrouter"
    return "unpriced"


def installed_local_models(ollama):
    """Model names installed on any probed local host (ollama-data.json)."""
    out = set()
    for h in (ollama or {}).get("hosts", []) or []:
        for c in h.get("catalog", []) or []:
            if c.get("name"):
                out.add(c["name"])
    return out


def _resolve_serving_provider(row):
    """Fallback serving-provider for rows with a blank billing slot."""
    url = (row.get("base_url") or "").lower()
    if "fireworks.ai" in url or "openrouter.ai" in url:
        return "fireworks" if "fireworks.ai" in url else "openrouter"
    if "opencode.ai" in url:
        return "opencode-go"
    if "api.anthropic.com" in url:
        return "anthropic"
    if "nousresearch.com" in url:
        return "nous"
    if "ollama.com" in url:
        return "ollama-cloud"
    model = (row.get("model") or "").strip().lower()
    if model.startswith("gpt-"):
        return "openai-codex"
    if model.startswith(("stepfun/", "step-")) or "hermes-" in model:
        return "nous"
    if "claude" in model:
        return "anthropic"
    if "glm" in model or "kimi" in model or "minimax" in model:
        return "opencode-go"
    return ""


def _infer_catalog_provider(model, catalog):
    """Serving-provider hint for catalogue rows with no recorded traffic.

    Thin wrapper over pricing.serving_provider_hint(); kept here so the
    sheet never imports the resolver directly and the resolution order
    stays in one place (pricing.py).
    """
    try:
        return P.serving_provider_hint(model, catalog)
    except Exception:  # a broken hint must never break the sheet build
        return ""


def observed_traffic(data):
    """Observed traffic per model across every profile."""
    seen = collections.defaultdict(lambda: {
        "calls": 0, "inp": 0, "outp": 0, "cache": 0, "cost": 0.0,
        "providers": set(), "profiles": set(), "local": False,
    })
    for pname, prof in (data or {}).get("profiles", {}).items():
        for r in prof.get("rows", []):
            e = seen[r.get("model") or ""]
            e["calls"] += r.get("calls", 0)
            e["inp"] += r.get("inp", 0)
            e["outp"] += r.get("outp", 0)
            e["cache"] += r.get("cread", 0)
            e["cost"] += r.get("market_value_usd") or 0.0
            # The collector stores the billing slot verbatim; an empty slot
            # (endpoint never set one) still served the traffic, so resolve it
            # the way price_row does — endpoint first, then the model shape —
            # instead of leaving the sheet's Served-by column blank.
            if r.get("provider"):
                e["providers"].add(r["provider"])
            elif not e["providers"]:
                fallback = _resolve_serving_provider(r)
                if fallback:
                    e["providers"].add(fallback)
            # The collector already classed the row by its endpoint (a LAN
            # host is local whatever the model is called), so the sheet
            # agrees with the dashboard instead of re-deriving from the name.
            if r.get("cost_class") == "local":
                e["local"] = True
            e["profiles"].add(pname)
    return seen


def assemble(data, catalog, installed=()):
    """Every model in the resolved price universe (P6-01, #59).

    Universe = OpenRouter catalogue + WEB_RATES vendor overrides + local
    models (installed on a probed host or seen in traffic) + any model with
    recorded traffic. Traffic columns annotate a row; `used` tells an unused
    model apart from one with zero calls. Pure: no I/O, so tests call it.
    """
    seen = observed_traffic(data)
    local_names = set(installed) | {m for m, a in seen.items() if a["local"]}
    universe = set(catalog) | set(P.WEB_RATES) | local_names | set(seen)
    # A traffic model that resolves to a catalogue id is ONE model, shown
    # under the name the agent used: drop the bare catalogue duplicate.
    for m in seen:
        if m in local_names:
            continue
        oid = P.ALIASES.get(m) or P._resolve_catalog_id(m, catalog)
        if oid and oid != m:
            universe.discard(oid)
    for w in P.WEB_RATES:
        oid = P.ALIASES.get(w)
        if oid and oid != w:
            universe.discard(oid)
    universe.discard("")

    models = []
    for model in universe:
        agg = seen.get(model)
        used = bool(agg and agg["calls"])
        local = model in local_names or P.is_local(model)
        source = "local" if local else rate_source(model, catalog)
        # Served only through Nous Portal: show what Nous charges (#131), not
        # the OpenRouter number. A model also served elsewhere keeps the
        # catalogue rate, because one row cannot carry two prices.
        nous_rt = None
        if not local and agg and agg["providers"] == {"nous"}:
            nous_rt = P.nous_rates_for(model, catalog)
            if nous_rt:
                source = "free-tier" if not any(nous_rt) else "nous"
        tps = energy = None
        if source == "local":
            (ri, ro, rc), tps = local_rates(model)
            if agg:
                energy = (agg["inp"] * ri + agg["outp"] * ro) / 1e6
        elif source == "free-tier":
            ri = ro = rc = 0.0
        else:
            rt = nous_rt if source == "nous" else P.rates_for(model, catalog)
            ri, ro, rc = (rt[0] * 1e6, rt[1] * 1e6, rt[2] * 1e6) if rt else (None, None, None)
            if rt is None:
                source = "unpriced"
        a = agg or {"calls": 0, "inp": 0, "outp": 0, "cache": 0, "cost": 0.0,
                    "providers": set(), "profiles": set()}
        # serving hint for the empty-traffic rows: a model installed on a
        # probed host IS served locally (observed, not inferred); a
        # local-by-name SKU that is not installed anywhere and never called
        # stays "—" (deploying it would be a guess); everything else falls
        # through to the catalogue shape. `inferred_by` records provenance
        # so the Prices view can show the hint as inferred, not observed.
        hint = ""
        if not agg:
            if installed and model in set(installed):
                hint = "local"
            elif not local:
                hint = _infer_catalog_provider(model, catalog) or ""
        models.append({
            "model": model, "short": model.split("/")[-1],
            # The catalogue id this row prices from, when it differs from
            # the name the agent used (Ctrl+F on either finds the row).
            "oid": ("" if local else (P.ALIASES.get(model) or P._resolve_catalog_id(model, catalog) or "")),
            "in_1m": ri, "out_1m": ro, "cache_1m": rc,
            "source": source, "tps": tps, "used": used,
            "calls": a["calls"], "inp": a["inp"], "outp": a["outp"],
            "cache": a["cache"], "cost": a["cost"], "energy": energy,
            "providers": sorted(a["providers"]),
            # A row with no recorded traffic has no provider slot to read —
            # that is why most of the sheet showed "—". The hint below fills
            # what is knowable from the model's name/aliases (never wrong by
            # construction: only families the resolver is sure of are used).
            "served_by": ", ".join(sorted(a["providers"])) or hint or "—",
            "inferred_by": hint,
            "profiles": sorted(a["profiles"]),
        })
    # Most expensive per output token first, unpriced last; name breaks ties
    # so the order is stable across builds.
    models.sort(key=lambda m: (m["out_1m"] is None, -(m["out_1m"] or 0), m["model"]))
    return models


def build():
    # The sample build (CI, fresh clone) renders from the committed payloads:
    # no collector run and no network. Same switch the dashboard uses.
    if not os.environ.get("LLM_TELEMETRY_NO_COLLECT"):
        subprocess.run([sys.executable, "-m", "llm_telemetry.collect_analytics", "-o", DATA], check=True)
    data = json.load(open(DATA))
    catalog, src = P.fetch_catalog()
    ollama = {}
    op = str(CFG.reports_dir / "ollama-data.json")
    if os.path.exists(op):
        try:
            ollama = json.load(open(op))
        except (OSError, ValueError):
            ollama = {}
    models = assemble(data, catalog, installed_local_models(ollama))

    d = {
        "models": models,
        "catalog_size": P.catalog_size(catalog),
        "catalog_source": src,
        "freshness": P.catalog_freshness(src),
        "generated": datetime.datetime.now().isoformat(timespec="seconds"),
        "kwh": KWH_PRICE_USD,
        "watts": GPU_DRAW_W + HOST_OVERHEAD_W,
        "gpu_w": GPU_DRAW_W,
        "host_w": HOST_OVERHEAD_W,
        "prefill": PREFILL_SPEEDUP,
        "cachex": CACHE_SPEEDUP,
    }
    # Propagate the sample marker so the leak guard (examples/check_no_leaks.py)
    # can tell the CI's committed sample payload apart from real-machine data.
    if data.get("sample"):
        d["sample"] = True
    return d



def costs_data_path():
    payload_path = os.environ.get("LLM_TELEMETRY_COSTS_DATA", "")
    if payload_path:
        return Path(payload_path)
    return CFG.reports_dir / "costs-data.json"


def write_costs_data(d):
    """Payload the dashboard's Prices view consumes (raw values, not strings)."""
    path = costs_data_path()
    os.makedirs(path.parent, exist_ok=True)
    with open(path, "w") as fh:
        json.dump(d, fh, default=str)
    return path


if __name__ == "__main__":
    d = build()
    data_path = write_costs_data(d)
    n_local = sum(1 for m in d["models"] if m["source"] == "local")
    n_un = sum(1 for m in d["models"] if m["source"] == "unpriced")
    print(f"{data_path}  ({len(d['models']):,} models, {n_local} local, "
          f"{n_un} unpriced) -> the app's Prices view")
