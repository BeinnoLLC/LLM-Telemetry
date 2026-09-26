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
import json, os, sys, subprocess, datetime, collections

from .config import get as _cfg

CFG = _cfg()
HERE = os.path.dirname(os.path.abspath(__file__))

from . import pricing as P

DATA = str(CFG.reports_dir / "analytics-data.json")
OUT = sys.argv[1] if len(sys.argv) > 1 else str(CFG.reports_dir / "costs.html")

# ---------------------------------------------------------------- electricity
# The power model lives in energy.py (P7-01/02): one module, tariff and
# wattage read from config. This page only displays what it returns.
from . import energy as E

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
    # An OpenRouter ":free" tier is real traffic at a genuine $0 per token —
    # priced, not missing. Without this it lands in "unpriced" and looks like
    # a gap in the catalogue that someone needs to go and fix.
    if (model or "").endswith(P.FREE_TIER_SUFFIX):
        return "free-tier"
    if P.WEB_RATES.get(model) or P.WEB_RATES.get((model or "").split("/")[-1]):
        return "vendor"
    if P.rates_for(model, catalog):
        return "openrouter"
    return "unpriced"


def build():
    subprocess.run([sys.executable, "-m", "llm_telemetry.collect_analytics", "-o", DATA], check=True)
    data = json.load(open(DATA))
    catalog, src = P.fetch_catalog()

    # Aggregate observed traffic per model across every profile, so the sheet
    # covers exactly the models actually in use — not a catalogue dump.
    seen = collections.defaultdict(lambda: {
        "calls": 0, "inp": 0, "outp": 0, "cache": 0, "cost": 0.0,
        "providers": set(), "profiles": set(), "local": False,
    })
    for pname, prof in data.get("profiles", {}).items():
        for r in prof.get("rows", []):
            model = r.get("model") or ""
            e = seen[model]
            e["calls"] += r.get("calls", 0)
            e["inp"] += r.get("inp", 0)
            e["outp"] += r.get("outp", 0)
            e["cache"] += r.get("cread", 0)
            e["cost"] += r.get("market_value_usd") or 0.0
            if r.get("provider"):
                e["providers"].add(r["provider"])
            # The collector already classed the row by its endpoint (a LAN host
            # is local whatever the model is called), so the sheet agrees with
            # the dashboard instead of re-deriving it from the name alone.
            if r.get("cost_class") == "local":
                e["local"] = True
            e["profiles"].add(pname)

    models = []
    for model, agg in seen.items():
        source = "local" if agg["local"] else rate_source(model, catalog)
        tps = None
        if source == "local":
            (ri, ro, rc), tps = local_rates(model)
            # Electricity cost of the traffic actually observed.
            energy = (agg["inp"] * ri + agg["outp"] * ro) / 1e6
        elif source == "free-tier":
            ri = ro = rc = 0.0
            energy = None
        else:
            rt = P.rates_for(model, catalog)
            if rt:
                ri, ro, rc = rt[0] * 1e6, rt[1] * 1e6, rt[2] * 1e6
            else:
                ri = ro = rc = None
            energy = None
        models.append({
            "model": model,
            "short": model.split("/")[-1],
            "in_1m": ri, "out_1m": ro, "cache_1m": rc,
            "source": source,
            "tps": tps,
            "calls": agg["calls"],
            "inp": agg["inp"], "outp": agg["outp"], "cache": agg["cache"],
            "cost": agg["cost"],
            "energy": energy,
            "providers": sorted(agg["providers"]),
            "served_by": ", ".join(sorted(agg["providers"])) or "—",
            "profiles": sorted(agg["profiles"]),
        })

    # Priced models first (most expensive per output token), unpriced last —
    # an unpriced model is a gap to fix, so it should be visible, not buried.
    models.sort(key=lambda m: (m["out_1m"] is None, -(m["out_1m"] or 0)))

    return {
        "models": models,
        "catalog_size": len(catalog),
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


PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LLM Telemetry — Price Sheet</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%2322c55e'/%3E%3Ctext x='16' y='23' font-size='20' text-anchor='middle' fill='%23fff' font-family='sans-serif'%3E$%3C/text%3E%3C/svg%3E">
<style>
:root{--bg:#0b0f17;--card:#131822;--fg:#e6edf6;--muted:#8b98ab;--border:#232b39;
  --accent:#6366f1;--green:#22c55e;--amber:#f59e0b;--red:#ef4444;--violet:#a855f7;}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--fg);margin:0;
  font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased}
.wrap{width:100%;max-width:1500px;margin:0 auto;padding:clamp(16px,3vw,32px)}
h1{font-size:clamp(18px,2.4vw,24px);margin:0 0 4px;letter-spacing:-.02em}
.sub{color:var(--muted);font-size:12.5px;margin-bottom:22px}
.sub a{color:var(--accent)}
.card{background:var(--card);border:1px solid var(--border);border-radius:7px;
  padding:18px;margin-bottom:18px}
.lbl{font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);
  font-weight:600;margin-bottom:12px}
table{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px}
thead th{position:sticky;top:0;background:var(--card);z-index:2;
  font-size:9.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);
  font-weight:600;text-align:right;padding:0 10px 9px;white-space:nowrap;
  border-bottom:1px solid var(--border)}
thead th:first-child,thead th.l{text-align:left}
tbody td{padding:8px 10px;border-bottom:1px solid var(--border);text-align:right;
  font-variant-numeric:tabular-nums;white-space:nowrap}
tbody td:first-child,tbody td.l{text-align:left}
tbody tr:hover{background:rgba(99,102,241,.06)}
tbody tr:last-child td{border-bottom:none}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.warnbox{border:1px solid rgba(239,68,68,.45);background:rgba(239,68,68,.08);color:#fca5a5;
  border-radius:8px;padding:10px 12px;margin:12px 0;font-size:12.5px;line-height:1.55}
.warnbox b{color:#fecaca}
.okbox{border:1px solid rgba(34,197,94,.35);background:rgba(34,197,94,.07);color:#86efac;
  border-radius:8px;padding:8px 12px;margin:12px 0;font-size:12.5px}
.tag{display:inline-block;padding:1.5px 7px;border-radius:4px;font-size:9.5px;
  font-weight:650;letter-spacing:.03em;text-transform:uppercase}
.t-vendor{background:rgba(34,197,94,.15);color:#4ade80}
.t-openrouter{background:rgba(99,102,241,.15);color:#818cf8}
.t-local{background:rgba(245,158,11,.15);color:#fbbf24}
.t-free-tier{background:rgba(168,85,247,.15);color:#c084fc}
.t-unpriced{background:rgba(239,68,68,.15);color:#f87171}
.dot{display:inline-block;width:7px;height:7px;border-radius:2px;margin-right:7px;
  vertical-align:baseline}
.muted{color:var(--muted)}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(210px,100%),1fr));
  margin-bottom:18px}
.kpi{background:var(--card);border:1px solid var(--border);border-radius:7px;padding:14px 16px}
.kpi .v{font-size:clamp(19px,2.3vw,25px);font-weight:660;letter-spacing:-.02em;
  font-variant-numeric:tabular-nums;margin-top:3px}
.note{border-left:2px solid var(--accent);padding:2px 0 2px 14px;color:var(--muted);
  font-size:12px;line-height:1.7}
.note b{color:var(--fg);font-weight:600}
.calc{background:rgba(99,102,241,.06);border:1px solid var(--border);border-radius:6px;
  padding:14px 16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:11.5px;line-height:2;color:var(--muted);overflow-x:auto}
.calc b{color:var(--fg)}
.calc .r{color:var(--green);font-weight:600}
.back{display:inline-block;margin-bottom:16px;color:var(--accent);text-decoration:none;
  font-size:12.5px}
.back:hover{text-decoration:underline}
@media(max-width:700px){
  thead th,tbody td{padding-left:6px;padding-right:6px;font-size:11.5px}
  .hide-s{display:none}
}
/* Model name: the row's primary identifier, so it outweighs the numbers. */
.mname{font-size:14px;font-weight:600}
/* Provider badge — identical treatment to the dashboard's PROV badges. */
.pb{display:inline-block;padding:1.5px 7px;border-radius:4px;font-size:10px;
  font-weight:500;white-space:nowrap;margin-right:3px}
/* Calculator: fields wrap on narrow screens, result stays visually anchored. */
.calcbox{display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap}
.calcbox .f{display:flex;flex-direction:column;gap:4px}
.calcbox label{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.calcbox select,.calcbox input{background:var(--bg);color:var(--fg);border:1px solid var(--border);
  border-radius:4px;padding:6px 9px;font-size:12.5px;font-family:inherit;min-width:120px}
.calcbox select{min-width:190px}
.calcbox input{width:120px;text-align:right;font-variant-numeric:tabular-nums}
.calcbox select:focus,.calcbox input:focus{outline:none;border-color:var(--accent)}
.calcbox .out{margin-left:auto;text-align:right;min-width:150px}
.calcbox .big{font-size:26px;font-weight:650;letter-spacing:-.02em;
  font-variant-numeric:tabular-nums;line-height:1.15}
@media(max-width:640px){.calcbox .out{margin-left:0;text-align:left}}
</style></head><body><div class="wrap">
<a class="back" href="dashboard.html">&larr; Analytics dashboard</a>
<h1><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
  style="color:var(--accent);vertical-align:-3px;margin-right:8px">
 <path d="M3 17.5 8 11l4 3.5L21 5"/>
 <circle cx="8" cy="11" r="1.6" fill="currentColor" stroke="none"/>
 <circle cx="12" cy="14.5" r="1.6" fill="currentColor" stroke="none"/>
 <circle cx="21" cy="5" r="1.8" fill="currentColor" stroke="none"/>
 <path d="M3 21h18" opacity=".35"/>
</svg>Model price sheet</h1>
<div class="sub">Exactly how every cost number on the dashboard is produced &mdash;
  per-million-token rates, their source, and the observed spend at those rates.
  <br>Generated __GEN__ &middot; __FRESHLINE__</div>
__FRESHBOX__

__KPIS__
__UNPRICED__

<div class="card">
  <div class="lbl">Price a job</div>
  <div class="calcbox">
    <div class="f"><label for="cm">Model</label><select id="cm"></select></div>
    <div class="f"><label for="ci">Input tokens</label><input id="ci" type="text" value="100,000" inputmode="numeric"></div>
    <div class="f"><label for="co">Output tokens</label><input id="co" type="text" value="20,000" inputmode="numeric"></div>
    <div class="f"><label for="cr">Runs</label><input id="cr" type="text" value="1" inputmode="numeric"></div>
    <div class="out">
      <div class="lbl" style="margin:0">Cost</div>
      <div class="big" id="ctot">&mdash;</div>
      <div class="muted" id="cbrk" style="font-size:11px"></div>
    </div>
  </div>
  <div class="muted" style="font-size:11px;margin-top:10px">
    Rates come from the table below. Local models are priced by power draw, so their
    number is what the job costs to run, not what it bills.
  </div>
</div>

<div class="card">
  <div class="lbl">Rates per 1M tokens &mdash; every model with recorded traffic</div>
  <div style="overflow-x:auto">__TABLE__</div>
</div>

<div class="card">
  <div class="lbl">How a cost number is produced</div>
  <div class="calc">
cost = <b>(input_tokens &times; input_rate)</b> + <b>(output_tokens &times; output_rate)</b> + <b>(cache_read_tokens &times; cache_rate)</b>
<br>
<br><span class="muted"># rates are resolved in this order, first hit wins:</span>
<br>1. <b>local</b> &nbsp;&nbsp;&nbsp;&nbsp;&rarr; electricity model below (your tariff &times; the box's draw)
<br>2. <b>vendor</b> &nbsp;&nbsp;&nbsp;&rarr; official pricing page, hardcoded in <b>pricing.py WEB_RATES</b>
<br>3. <b>openrouter</b> &rarr; live OpenRouter catalogue, cached __TTL__, refreshed by cron
<br>4. <b>unpriced</b> &nbsp;&rarr; no rate found; contributes <b>$0</b> and is flagged red above
  </div>
</div>

<div class="card">
  <div class="lbl">Local models &mdash; how the rate is derived</div>
  <div class="calc">
<span class="muted"># your tariff and hardware</span>
<br>tariff                = <b>$__KWH__ / kWh</b>
<br>draw under load       = <b>__GPUW__ W</b> (GPU) + <b>__HOSTW__ W</b> (CPU, RAM, fans, PSU loss) = <b>__WATTS__ W</b>
<br>
<br><span class="muted"># cost of one second of inference</span>
<br>usd_per_second        = (__WATTS__ / 1000) &times; __KWH__ / 3600 = <b>$__USDSEC__</b>
<br>
<br><span class="muted"># generation: one forward pass per token, so throughput sets the price</span>
<br>output_per_1M_tokens  = usd_per_second &times; (1,000,000 / tokens_per_second)
<br>
<br><span class="muted"># prefill: the whole prompt is processed in one batched pass, ~__PREFILL__x cheaper</span>
<br>input_per_1M_tokens   = output_per_1M_tokens / __PREFILL__
<br>
<br><span class="muted"># cache read: no forward pass, but KV tensors still stream out of VRAM, ~__CACHEX__x cheaper</span>
<br>cache_per_1M_tokens   = output_per_1M_tokens / __CACHEX__
<br>
<br><span class="muted"># worked example, a 30B model at 30 tok/s</span>
<br>output = $__USDSEC__ &times; (1,000,000 / 30) = <span class="r">$__EX_OUT__ per 1M output tokens</span>
<br>input  = $__EX_OUT__ / __PREFILL__ &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;= <span class="r">$__EX_IN__ per 1M input tokens</span>
<br>cache  = $__EX_OUT__ / __CACHEX__ &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;= <span class="r">$__EX_CACHE__ per 1M cached tokens</span>
  </div>
  <div class="note" style="margin-top:14px">
    <b>Local cost is electricity, shown separately from billed spend.</b> No provider
    invoices a local run; the power is paid to your utility at the tariff above. The
    dashboard shows it as its own figure (marked <b>elec</b>) next to billed spend, so a
    local model never reads as $0 and electricity is never mistaken for an API bill.
    Tariff and wattage come from your config (<b>electricity_rate_kwh</b>,
    <b>gpu_draw_watts</b>, <b>host_overhead_watts</b>). Throughput per model size is measured on
    your own hardware; a cache read is priced at 1/__CACHEX__ of a generated token because it
    skips the forward pass but still streams the KV tensors out of VRAM with the GPU powered.
  </div>
</div>

<div class="card">
  <div class="lbl">Why dashboard spend and real spend differ</div>
  <div class="note">
    <b>Est. cost</b> on the dashboard is what the traffic <b>would</b> cost at public API
    rates. Most of it never becomes an invoice: Anthropic and OpenCode traffic runs inside a
    flat-rate subscription, so their numbers measure <b>value consumed</b>, not money spent.
    Fireworks is the only genuinely pay-per-token provider configured, and local models cost
    electricity only. Read the totals as "what this would have cost on demand pricing".
  </div>
</div>

<script>
// Calculator. Rates are baked in at build time — the sheet is static, so the
// arithmetic has to happen client-side.
const M = __CALCDATA__;
const $ = id => document.getElementById(id);
const sel = $('cm');
M.sort((a,b)=>a.n.localeCompare(b.n)).forEach((m,i)=>{
  const o = document.createElement('option');
  o.value = i; o.textContent = m.n + (m.s === 'local' ? '  (local)' : '');
  sel.appendChild(o);
});

// Accept "100,000", "100k", "1.5m" — nobody wants to count zeros.
function parseTokens(s){
  s = String(s).trim().toLowerCase().replace(/[, _]/g,'');
  const mult = s.endsWith('m') ? 1e6 : s.endsWith('k') ? 1e3 : 1;
  const n = parseFloat(mult === 1 ? s : s.slice(0,-1));
  return isFinite(n) && n >= 0 ? n * mult : 0;
}
const money = v => v >= 1 ? '$' + v.toFixed(2)
                 : v >= 0.01 ? '$' + v.toFixed(3)
                 : v > 0 ? '$' + v.toFixed(5)
                 : '$0.00';

function calc(){
  const m = M[sel.value]; if(!m) return;
  const i = parseTokens($('ci').value), o = parseTokens($('co').value);
  const runs = Math.max(1, Math.round(parseTokens($('cr').value) || 1));
  const cin = i / 1e6 * m.i, cout = o / 1e6 * m.o;
  const total = (cin + cout) * runs;
  $('ctot').textContent = money(total);
  $('ctot').style.color = m.s === 'local' ? '#fbbf24' : 'inherit';
  const per = runs > 1 ? ` &times; ${runs} runs` : '';
  $('cbrk').innerHTML =
    `in ${money(cin)} + out ${money(cout)}${per}` +
    (m.s === 'local' ? '<br>power cost, not billed' : '');
}
['cm','ci','co','cr'].forEach(id => {
  $(id).addEventListener('input', calc);
  $(id).addEventListener('change', calc);
});
calc();
</script>
</div></body></html>"""


def fmt_money_1m(v):
    if v is None:
        return '<span class="muted">&mdash;</span>'
    if v == 0:
        return '<span class="muted">$0</span>'
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
    return (f'<span class="pb" style="background:{bg};color:{fg}">'
            f'{icon} {name}</span>')


LABEL = {
    "vendor": "vendor page",
    "openrouter": "openrouter",
    "local": "local models",
    "free-tier": "free tier",
    "unpriced": "unpriced",
}


def freshness_html(f, catalog_size):
    """Catalogue freshness line (P6-02, #60). Stale and unavailable are warnings."""
    age = f" &middot; fetched {f['age']} ago" if f.get("age") else ""
    ttl = f"cache refreshes every {f['ttl']}"
    why = f" ({f['detail']})" if f.get("detail") else ""
    if f["state"] == "unavailable" and not catalog_size:
        return ('<div class="warnbox" id="catfresh" data-state="unavailable">'
                '<b>Catalogue prices are missing.</b> The OpenRouter catalogue could not be '
                f'fetched{why} and there is no cached copy, so every model that relies on it '
                'is unpriced below. Vendor rates and local electricity rates still apply. '
                'Check network access and rebuild.</div>')
    if f["state"] in ("stale", "unavailable"):
        return ('<div class="warnbox" id="catfresh" data-state="stale">'
                f'<b>Prices are stale</b>{age}. The latest fetch failed{why}, so an older '
                f'cached catalogue ({catalog_size:,} models) is in use; {ttl}.</div>')
    word = "fetched live" if f["state"] == "live" else "from cache"
    return (f'<span id="catfresh" data-state="{f["state"]}">OpenRouter catalogue: '
            f'{catalog_size:,} models, {word}{age}; {ttl}</span>')


def unpriced_html(models):
    """Unpriced models, split by whether they carry traffic (P6-03, #61)."""
    un = [m for m in models if m["source"] == "unpriced"]
    used = [m for m in un if m.get("calls")]
    idle = [m for m in un if not m.get("calls")]
    if not used:
        tail = (f' {len(idle)} unused model{"s" if len(idle) != 1 else ""} have no rate, '
                'which costs nothing.') if idle else ''
        return ('<div class="okbox" id="unpriced" data-used="0">'
                f'<b>Every model with traffic is priced.</b>{tail}</div>')
    calls = sum(m["calls"] for m in used)
    toks = sum(m.get("inp", 0) + m.get("outp", 0) for m in used)
    names = ", ".join(f'<span class="mono">{m["short"]}</span>' for m in used)
    idle_note = (f' Another {len(idle)} unpriced model{"s" if len(idle) != 1 else ""} '
                 'had no traffic, which is harmless.') if idle else ''
    return ('<div class="warnbox" id="unpriced" data-used="%d">' % len(used)
            + f'<b>{len(un)} model{"s" if len(un) != 1 else ""} unpriced, {len(used)} of them '
            f'with recorded traffic</b>: {names}.'
            + f' <b>Spend is understated:</b> {calls:,} calls and {toks:,} tokens are '
            'counted at $0 because no rate exists. How much is missing is unknown, so it '
            'is excluded rather than guessed.'
            + ' <b>Fix:</b> add the model to <span class="mono">WEB_RATES</span> '
            '(official vendor price) or map its name to an OpenRouter id in '
            '<span class="mono">ALIASES</span>, both in <span class="mono">pricing.py</span>.'
            + idle_note + '</div>')


def render(d):
    rows = []
    for m in d["models"]:
        src = m["source"]
        tps = f'{m["tps"]} tok/s' if m["tps"] else '<span class="muted">&mdash;</span>'
        # Output÷input multiple: the single most useful number for predicting a
        # bill, because output dominates cost on every metered provider.
        ratio = ('&mdash;' if not m["in_1m"] or not m["out_1m"]
                 else f'{m["out_1m"]/m["in_1m"]:.0f}&times;')
        badges = " ".join(prov_badge(p) for p in m["providers"]) or \
            '<span class="muted">&mdash;</span>'
        rows.append(
            f'<tr>'
            f'<td class="l"><span class="dot" style="background:{colour(m["model"])}"></span>'
            f'<span class="mono mname" style="color:{colour(m["model"])}">{m["short"]}</span></td>'
            f'<td class="l"><span class="tag t-{src}">{LABEL.get(src, src)}</span></td>'
            f'<td class="l hide-s">{badges}</td>'
            f'<td class="rate">{fmt_money_1m(m["in_1m"])}</td>'
            f'<td class="rate">{fmt_money_1m(m["out_1m"])}</td>'
            f'<td class="hide-s">{fmt_money_1m(m["cache_1m"])}</td>'
            f'<td class="hide-s muted">{ratio}</td>'
            f'<td class="hide-s muted">{tps}</td>'
            f'</tr>')

    table = (
        '<table><thead><tr>'
        '<th class="l">Model</th><th class="l">Rate source</th>'
        '<th class="l hide-s">Served by</th>'
        '<th>Input /1M</th><th>Output /1M</th><th class="hide-s">Cache /1M</th>'
        '<th class="hide-s">Out&divide;In</th><th class="hide-s">Throughput</th>'
        '</tr></thead><tbody>' + "".join(rows) + '</tbody></table>')

    priced = [m for m in d["models"] if m["out_1m"] is not None and m["source"] != "local"]
    local = [m for m in d["models"] if m["source"] == "local"]
    unpriced = [m for m in d["models"] if m["source"] == "unpriced"]
    metered = [m for m in priced if m["out_1m"]]
    dearest = max(priced, key=lambda m: m["out_1m"], default=None)
    cheapest = min(metered, key=lambda m: m["out_1m"], default=None)
    median = (sorted(m["out_1m"] for m in metered)[len(metered) // 2]
              if metered else None)

    f = d.get("freshness") or P.catalog_freshness(d.get("catalog_source"))
    fb = freshness_html(f, d["catalog_size"])
    # A plain state goes inline in the header; a warning gets its own box.
    fresh_line, fresh_box = (fb, "") if fb.startswith("<span") else (
        f'OpenRouter catalogue: {d["catalog_size"]:,} models', fb)

    # A reference sheet answers "what does a model cost", not "what did I spend".
    kpis = f'''<div class="grid">
  <div class="kpi"><div class="lbl" style="margin:0">Models on sheet</div>
    <div class="v">{len(d["models"])}</div>
    <div class="muted" style="font-size:11px;margin-top:2px">{len(unpriced)} unpriced</div></div>
  <div class="kpi"><div class="lbl" style="margin:0">Dearest output</div>
    <div class="v">{fmt_money_1m(dearest["out_1m"]) if dearest else "&mdash;"}</div>
    <div class="muted" style="font-size:11px;margin-top:2px">{dearest["short"] if dearest else ""}</div></div>
  <div class="kpi"><div class="lbl" style="margin:0">Cheapest metered output</div>
    <div class="v" style="color:#4ade80">{fmt_money_1m(cheapest["out_1m"]) if cheapest else "&mdash;"}</div>
    <div class="muted" style="font-size:11px;margin-top:2px">{cheapest["short"] if cheapest else ""}</div></div>
  <div class="kpi"><div class="lbl" style="margin:0">Median output rate</div>
    <div class="v">{fmt_money_1m(median)}</div>
    <div class="muted" style="font-size:11px;margin-top:2px">across {len(metered)} metered</div></div>
  <div class="kpi"><div class="lbl" style="margin:0">Local models</div>
    <div class="v" style="color:#fbbf24">{len(local)}</div>
    <div class="muted" style="font-size:11px;margin-top:2px">priced by power draw</div></div>
</div>'''

    watts = d["watts"]
    usd_sec = (watts / 1000.0) * d["kwh"] / 3600.0
    ex_out = usd_sec * (1e6 / 30)
    ex_in = ex_out / d["prefill"]
    ex_cache = ex_out / d["cachex"]

    # Live calculator: the point of knowing a rate is pricing a hypothetical
    # job, so let the sheet do that arithmetic instead of the reader.
    calc_models = [m for m in d["models"] if m["out_1m"] is not None]
    calc_json = json.dumps([
        {"n": m["short"], "i": m["in_1m"], "o": m["out_1m"], "s": m["source"]}
        for m in calc_models
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
