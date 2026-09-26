"""Electricity cost of local inference (P7-01/02, #65 #66).

The single home of the power model. Local models are not free: they burn
electricity at the user's tariff. Every module that prices a local token
(pricing.price_row for the dashboard, build_costs for the price sheet) calls
local_rates() here, so there is no private copy of a tariff anywhere.

Tariff and wattage come from config (electricity_rate_kwh, gpu_draw_watts,
host_overhead_watts); defaults are 0.047 USD/kWh, 350 W GPU, 90 W host.
"""
from __future__ import annotations

from .config import get as _cfg

# Measured generation throughput per model size band, tokens/second, on the
# local inference box. Matched by substring on the model name, first hit wins,
# so larger bands are listed before the smaller ones they contain ("70b" before
# "0b" style collisions cannot happen because every band ends in "b").
LOCAL_TPS = [
    ("70b", 11), ("72b", 11), ("34b", 26), ("32b", 28), ("30b", 30),
    ("27b", 33), ("14b", 55), ("13b", 58), ("8b", 95), ("7b", 100),
    ("4b", 150), ("3b", 170), ("1.5b", 240), ("1b", 300),
]
LOCAL_TPS_DEFAULT = 40      # unknown size: assume a mid-range band

# Prompt processing is one batched forward pass, not one pass per token.
# Measured ratio of generation to prefill cost on this hardware.
PREFILL_SPEEDUP = 12

# A cache read skips the matmuls but still streams KV tensors out of VRAM with
# the GPU powered: ~60x cheaper than generating a token, not free.
CACHE_SPEEDUP = 60


def tariff(cfg=None):
    """(usd_per_kwh, gpu_watts, host_watts) exactly as configured."""
    c = cfg or _cfg()
    return (float(c.electricity_rate_kwh), float(c.gpu_draw_watts),
            float(c.host_overhead_watts))


def tps_for(model):
    m = (model or "").lower()
    for band, rate in LOCAL_TPS:
        if band in m:
            return rate
    return LOCAL_TPS_DEFAULT


def local_rates(model, cfg=None):
    """-> ((input, output, cache) USD per 1M tokens, tokens/s)."""
    kwh, gpu_w, host_w = tariff(cfg)
    tps = tps_for(model)
    usd_per_sec = ((gpu_w + host_w) / 1000.0) * kwh / 3600.0
    out_1m = usd_per_sec * (1e6 / tps)
    return (out_1m / PREFILL_SPEEDUP, out_1m, out_1m / CACHE_SPEEDUP), tps


def energy_usd(model, inp, outp, cache, cfg=None):
    """Electricity cost of one usage row's tokens, USD."""
    (ri, ro, rc), _ = local_rates(model, cfg)
    return (inp * ri + outp * ro + cache * rc) / 1e6
