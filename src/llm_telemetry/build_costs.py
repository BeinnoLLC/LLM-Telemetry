#!/usr/bin/env python3
"""Render a per-million-token price sheet for every model Hermes has used.

This page answers one question: "how is a cost number on the dashboard
produced?" It shows, per model, the exact input/output/cache rate applied,
where that rate came from (official vendor page, OpenRouter catalogue, or the
local-electricity model), and what the observed traffic cost at that rate.

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
import html as _html

from .config import get as _cfg
from .webassets import (frag, read_costs_css, read_costs_js, read_costs_shell,
                       read_tokens, script_json)

CFG = _cfg()
HERE = os.path.dirname(os.path.abspath(__file__))

from . import pricing as P  # noqa: E402 — deliberately after CFG/HERE; see module-level ordering note above

DATA = str(CFG.reports_dir / "analytics-data.json")
OUT = sys.argv[1] if len(sys.argv) > 1 else str(CFG.reports_dir / "costs.html")

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
            if r.get("provider"):
                e["providers"].add(r["provider"])
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
            "served_by": ", ".join(sorted(a["providers"])) or "—",
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

    return {
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


# P2-04 (#28): the page is a real file now (web/costs.html) with its styles in
# web/css/costs.css and its calculator in web/js/costs.js. The shared palette
# tokens come from web/css/tokens.css — the same file the dashboard inlines —
# so a colour change cannot land on one page and miss the other.
COSTS_CSS = read_tokens() + read_costs_css()
PAGE = (read_costs_shell()
        .replace("__COSTS_CSS__", COSTS_CSS)
        .replace("__COSTS_JS__", read_costs_js()))


def fmt_money_1m(v):
    if v is None:
        return frag("muted_dash")
    if v == 0:
        return frag("muted_zero")
    if v < 0.01:
        return f"${v:.4f}"
    if v < 1:
        return f"${v:.3f}"
    return f"${v:,.2f}"


def fmt_n(n):
    n = n or 0
    for u, d in (("B", 1e9), ("M", 1e6), ("K", 1e3)):
        if n >= d:
            return f"{n/d:.1f}{u}"
    return str(int(n))


# Model-family colour, matching the dashboard so a model reads the same on both
# pages. Kept in sync with FAMILY in build_dashboard.py.
FAMILIES = [
    (("claude", "opus", "sonnet", "haiku"), "hsl(17 66% 55%)"),
    (("glm", "kimi", "minimax"), "hsl(320 85% 60%)"),
    (("deepseek",), "hsl(262 80% 60%)"),
    (("qwen", "gpt-oss", "nemotron", "llama", "mistral", "phi", "gemma"), "hsl(196 88% 55%)"),
    (("gpt-", "astra", "luna", "codex", "sol", "terra"), "hsl(120 70% 45%)"),
]


def colour(model):
    m = (model or "").lower()
    for keys, c in FAMILIES:
        if any(k in m for k in keys):
            return c
    return "hsl(215 16% 55%)"


PROV = {
    "anthropic":    ("✳", "hsl(17 66% 55% / .16)",  "hsl(17 66% 55%)"),
    "opencode-go":  ("◈", "hsl(250 85% 62% / .16)", "hsl(250 85% 68%)"),
    "fireworks":    ("✦", "rgba(255,102,61,.16)",   "#ff663d"),
    "openai-codex": ("◉", "hsl(162 82% 38% / .16)", "hsl(162 82% 40%)"),
    "local":        ("▣", "hsl(213 90% 60% / .14)", "hsl(213 90% 62%)"),
    "moa":          ("⬡", "rgba(244,114,182,.16)",  "#f472b6"),
    "cloud":        ("☁", "hsl(205 80% 55% / .16)", "hsl(205 80% 58%)"),
    "nous":         ("◆", "rgba(234,179,8,.16)",    "#eab308"),
}


def prov_badge(name):
    """Same badge the dashboard renders, so the two pages read as one app."""
    key = (name or "").strip()
    # Ollama slots are recorded under several names; they are all local.
    if key.startswith("ollama") or key == "custom":
        key = "local"
    icon, bg, fg = PROV.get(key, ("○", "rgba(127,127,127,.14)", "var(--muted)"))
    return frag("prov_badge", bg=bg, fg=fg, icon=icon, name=name)


LABEL = {
    "vendor": "vendor page",
    "openrouter": "openrouter",
    "nous": "nous portal",
    "local": "local models",
    "free-tier": "free tier",
    "unpriced": "unpriced",
}


def freshness_html(f, catalog_size):
    """Catalogue freshness line (P6-02, #60). Stale and unavailable are warnings."""
    age = frag("fresh_age", age=f["age"]) if f.get("age") else ""
    ttl = f"cache refreshes every {f['ttl']}"
    why = f" ({f['detail']})" if f.get("detail") else ""
    size = f"{catalog_size:,}"
    if f["state"] == "unavailable" and not catalog_size:
        return frag("fresh_unavailable", why=why)
    if f["state"] in ("stale", "unavailable"):
        return frag("fresh_stale", age=age, why=why, size=size, ttl=ttl)
    if f["state"] == "pinned":
        return frag("fresh_pinned", size=size)
    word = "fetched live" if f["state"] == "live" else "from cache"
    return frag("fresh_plain", state=f["state"], size=size, word=word, age=age, ttl=ttl)


def freshness_is_warning(f, catalog_size):
    """Stale/unavailable get their own box; every other state sits in the header."""
    return f["state"] in ("stale", "unavailable")


def _plural(n):
    return "s" if n != 1 else ""


def unpriced_html(models):
    """Unpriced models, split by whether they carry traffic (P6-03, #61)."""
    un = [m for m in models if m["source"] == "unpriced"]
    used = [m for m in un if m.get("calls")]
    idle = [m for m in un if not m.get("calls")]
    if not used:
        tail = (f' {len(idle)} unused model{_plural(len(idle))} have no rate, '
                'which costs nothing.') if idle else ''
        return frag("unpriced_ok", tail=tail)
    calls = sum(m["calls"] for m in used)
    toks = sum(m.get("inp", 0) + m.get("outp", 0) for m in used)
    names = ", ".join(frag("mono", text=m["short"]) for m in used)
    idle_note = (f' Another {len(idle)} unpriced model{_plural(len(idle))} '
                 'had no traffic, which is harmless.') if idle else ''
    return frag("unpriced_warn", n_used=len(used), n_un=len(un), s=_plural(len(un)),
                names=names, calls=f"{calls:,}", toks=f"{toks:,}", idle_note=idle_note)


def row_html(m):
    """One price-sheet row. Shaping here, markup in web/costs-fragments.html."""
    src = m["source"]
    tps = frag("tps", tps=m["tps"]) if m["tps"] else frag("muted_dash")
    # Output÷input multiple: the single most useful number for predicting a
    # bill, because output dominates cost on every metered provider.
    ratio = (frag("mdash") if not m["in_1m"] or not m["out_1m"]
             else frag("ratio", n=f'{m["out_1m"]/m["in_1m"]:.0f}'))
    badges = " ".join(prov_badge(p) for p in m["providers"]) or frag("muted_dash")
    used = m.get("used", bool(m.get("calls")))
    oid = m.get("oid")
    return frag(
        "row",
        model_attr=_html.escape(m["model"], quote=True),
        oid_attr=_html.escape(oid or "", quote=True),
        src=src, used=1 if used else 0,
        unused_class="" if used else frag("unused_class"),
        colour=colour(m["model"]), model=_html.escape(m["model"]),
        priced_as=(frag("priced_as", oid=_html.escape(oid))
                   if oid and oid != m["model"] else ""),
        label=LABEL.get(src, src), badges=badges,
        in_1m=fmt_money_1m(m["in_1m"]), out_1m=fmt_money_1m(m["out_1m"]),
        cache_1m=fmt_money_1m(m["cache_1m"]), ratio=ratio, tps=tps,
        use_cell=fmt_n(m["calls"]) if used else frag("unused_cell"))


def render(d):
    table = frag("table", rows="".join(row_html(m) for m in d["models"]))

    priced = [m for m in d["models"] if m["out_1m"] is not None and m["source"] != "local"]
    local = [m for m in d["models"] if m["source"] == "local"]
    unpriced = [m for m in d["models"] if m["source"] == "unpriced"]
    metered = [m for m in priced if m["out_1m"]]
    n_used = sum(1 for m in d["models"] if m.get("used", bool(m.get("calls"))))
    dearest = max(priced, key=lambda m: m["out_1m"], default=None)
    cheapest = min(metered, key=lambda m: m["out_1m"], default=None)
    median = (sorted(m["out_1m"] for m in metered)[len(metered) // 2]
              if metered else None)

    f = d.get("freshness") or P.catalog_freshness(d.get("catalog_source"))
    fb = freshness_html(f, d["catalog_size"])
    # A plain state goes inline in the header; a warning gets its own box.
    fresh_line, fresh_box = (fb, "") if not freshness_is_warning(f, d["catalog_size"]) else (
        f'OpenRouter catalogue: {d["catalog_size"]:,} models', fb)

    # A reference sheet answers "what does a model cost", not "what did I spend".
    mdash = frag("mdash")
    kpis = frag(
        "kpis", n_models=len(d["models"]), n_used=n_used, n_unpriced=len(unpriced),
        dearest_rate=fmt_money_1m(dearest["out_1m"]) if dearest else mdash,
        dearest_name=dearest["short"] if dearest else "",
        cheapest_rate=fmt_money_1m(cheapest["out_1m"]) if cheapest else mdash,
        cheapest_name=cheapest["short"] if cheapest else "",
        median_rate=fmt_money_1m(median), n_metered=len(metered), n_local=len(local))

    watts = d["watts"]
    usd_sec = (watts / 1000.0) * d["kwh"] / 3600.0
    ex_out = usd_sec * (1e6 / 30)
    ex_in = ex_out / d["prefill"]
    ex_cache = ex_out / d["cachex"]

    # Live calculator: the point of knowing a rate is pricing a hypothetical
    # job, so let the sheet do that arithmetic instead of the reader.
    calc_json = script_json([
        {"n": m["model"], "i": m["in_1m"], "o": m["out_1m"], "s": m["source"],
         "u": 1 if m.get("used", bool(m.get("calls"))) else 0}
        for m in d["models"]
    ])

    html = (PAGE
            .replace("__GEN__", d["generated"].replace("T", " "))
            .replace("__CATSIZE__", f'{d["catalog_size"]:,}')
            .replace("__CATSRC__", d["catalog_source"])
            .replace("__FRESHLINE__", fresh_line)
            .replace("__FRESHBOX__", fresh_box)
            .replace("__TTL__", P.ttl_label())
            .replace("__UNPRICED__", unpriced_html(d["models"]))
            .replace("__KPIS__", kpis)
            .replace("__TABLE__", table)
            .replace("__CALCDATA__", calc_json)
            .replace("__KWH__", f'{d["kwh"]:.3f}')
            .replace("__GPUW__", f'{d["gpu_w"]:g}')
            .replace("__HOSTW__", f'{d["host_w"]:g}')
            .replace("__WATTS__", f'{watts:g}')
            .replace("__USDSEC__", f"{usd_sec:.9f}")
            .replace("__PREFILL__", str(d["prefill"]))
            .replace("__CACHEX__", str(d["cachex"]))
            .replace("__EX_CACHE__", f"{ex_cache:.4f}")
            .replace("__EX_OUT__", f"{ex_out:.4f}")
            .replace("__EX_IN__", f"{ex_in:.4f}"))
    return html


if __name__ == "__main__":
    d = build()
    html = render(d)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, "w").write(html)
    n_local = sum(1 for m in d["models"] if m["source"] == "local")
    n_un = sum(1 for m in d["models"] if m["source"] == "unpriced")
    print(f"{OUT}  ({len(html):,} bytes)  "
          f"{len(d['models'])} models, {n_local} local, {n_un} unpriced")
