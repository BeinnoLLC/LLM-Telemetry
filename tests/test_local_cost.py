#!/usr/bin/env python3
"""Cost path for local models (P7-01 #65, P7-02 #66, P7-05 #69).

Each check names the behaviour it guards; the negative controls in the ticket
comments show each one fails when that behaviour is broken.
"""
import dataclasses
import json
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from llm_telemetry import config as C  # noqa: E402
from llm_telemetry import energy as E  # noqa: E402
from llm_telemetry import pricing as P  # noqa: E402

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    if ok:
        p += 1
        print(f"  OK   {label}" + (f"  {extra}" if extra is not None else ""))
    else:
        f += 1
        print(f"  FAIL {label}" + (f"  {extra}" if extra is not None else ""))


base = C.Config()                      # the shipped defaults


def cfg(**kw):
    return dataclasses.replace(base, **kw)


# --- defaults (P7-02) --------------------------------------------------------
chk((base.electricity_rate_kwh, base.gpu_draw_watts, base.host_overhead_watts)
    == (0.047, 350, 90), "defaults: 0.047 USD/kWh, 350 W GPU, 90 W host",
    (base.electricity_rate_kwh, base.gpu_draw_watts, base.host_overhead_watts))
chk(not hasattr(base, "currency"), "dead `currency` setting is gone")

# --- the ticket's worked example (P7-05) --------------------------------------
(ri, ro, rc), tps = E.local_rates("qwen3-coder:30b", base)
chk(tps == 30, "qwen3-coder:30b runs at the 30b band, 30 tok/s", tps)
chk(round(ri, 4) == 0.0160 and round(ro, 4) == 0.1915,
    "qwen3-coder:30b at 0.047 USD/kWh, 440 W -> $0.0160 in / $0.1915 out per 1M",
    (round(ri, 4), round(ro, 4)))
chk(rc > 0 and abs(rc - ro / E.CACHE_SPEEDUP) < 1e-12, "cache reads cost power too, 1/60 of output", rc)

# --- price_row on a local row (the original "$0 for every local row" bug) ----
row = {"provider": "custom", "base_url": "http://192.168.1.12:11434/v1",
       "model": "qwen3-coder:30b", "input_tokens": 1_000_000,
       "output_tokens": 1_000_000, "cache_read": 0}
pr = P.price_row(row, {})
chk(pr["cost_class"] == "local", "local row is class 'local', never 'free'", pr["cost_class"])
chk(pr["energy_usd"] > 0, "price_row returns non-zero energy cost for a local row", pr["energy_usd"])
chk(abs(pr["energy_usd"] - (ri + ro)) < 1e-6, "energy equals tokens x electricity rates",
    (pr["energy_usd"], round(ri + ro, 6)))
chk(pr["market_value_usd"] == pr["energy_usd"], "market value of a local row is its energy cost")
chk(pr["billed_usd"] == 0.0, "no provider bills a local run: billed stays 0")
chk(pr["priced"] is True, "a local row counts as priced, not a coverage gap")

# --- :free tiers are a different thing -----------------------------------------
fr = P.price_row({"provider": "openrouter", "model": "stepfun/step-3.7-flash:free",
                  "input_tokens": 5000, "output_tokens": 5000, "cache_read": 0}, {})
chk(fr["cost_class"] == "free", "':free' tier stays class 'free'", fr["cost_class"])
chk(fr["market_value_usd"] == 0 and fr["energy_usd"] == 0, "':free' tier prices at $0")
chk(fr["cost_class"] != pr["cost_class"], "':free' and local are distinguishable")

# --- a local model is never priced from the catalogue ----------------------------
cat = {"qwen/qwen3-coder": {"prompt": "0.001", "completion": "0.002", "input_cache_read": "0"}}
chk(P.rates_for("qwen3-coder:30b", cat) == (ri / 1e6, ro / 1e6, rc / 1e6),
    "local model uses the electricity rate even when a cloud price exists")

# --- the tariff is config, not a constant (P7-02) --------------------------------
(ri2, ro2, _), _ = E.local_rates("qwen3-coder:30b", cfg(electricity_rate_kwh=0.094))
chk(abs(ro2 - 2 * ro) < 1e-12, "doubling electricity_rate_kwh doubles the cost", (ro, ro2))
(_, ro3, _), _ = E.local_rates("qwen3-coder:30b", cfg(gpu_draw_watts=790))
chk(abs(ro3 - 2 * ro) < 1e-12, "raising gpu_draw_watts 350 -> 790 doubles the cost (440 -> 880 W)", ro3)
(_, ro4, _), _ = E.local_rates("qwen3-coder:30b", cfg(host_overhead_watts=530))
chk(abs(ro4 - 2 * ro) < 1e-12, "raising host_overhead_watts 90 -> 530 doubles the cost", ro4)

# the config file really is read (not just the dataclass default)
with tempfile.TemporaryDirectory() as t:
    path = os.path.join(t, "c.json")
    json.dump({"profiles": [], "electricity_rate_kwh": 0.2, "gpu_draw_watts": 100,
               "host_overhead_watts": 20}, open(path, "w"))
    loaded = C.load(path)
    chk((loaded.electricity_rate_kwh, loaded.gpu_draw_watts, loaded.host_overhead_watts)
        == (0.2, 100, 20), "config file values reach the power model", E.tariff(loaded))

# --- size bands and fallback -----------------------------------------------------
_, t_unknown = E.local_rates("mystery-model:latest", base)
chk(t_unknown == E.LOCAL_TPS_DEFAULT, "unknown size falls back to LOCAL_TPS_DEFAULT", t_unknown)
(_, o70, _), _ = E.local_rates("llama3:70b", base)
(_, o7, _), _ = E.local_rates("mistral:7b", base)
chk(o70 > o7, "a 70B model costs more per token than a 7B one", (round(o70, 4), round(o7, 4)))

# --- one home for the power model ---------------------------------------------------
src = os.path.join(os.path.dirname(__file__), "..", "src", "llm_telemetry")
offenders = []
for fn in os.listdir(src):
    if fn.endswith(".py") and fn != "energy.py" and fn != "config.py":
        text = open(os.path.join(src, fn)).read()
        # A literal definition, not a re-export (``X = E.X`` is fine).
        for pat in (r"0\.047", r"\b(KWH_PRICE_USD|GPU_DRAW_W|HOST_OVERHEAD_W)\s*=\s*[\d.]+",
                    r"LOCAL_TPS\s*=\s*\[", r"(PREFILL|CACHE)_SPEEDUP\s*=\s*\d"):
            for m in re.finditer(pat, text):
                offenders.append(f"{fn}: {m.group(0)}")
chk(not offenders, "no module keeps a private copy of the tariff or power model", offenders)

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
