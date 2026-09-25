# Phase 7 — Local Cost & Settings

**Goal:** local models stop reporting `$0`. Their electricity cost is computed
from the user's tariff, and the tariff lives in a settings page instead of in
Python literals.

**Status:** not started · 5 tickets · est ~14h

---

## The bug

Local models are reported at **exactly $0**. Measured on the live data — 8 local
models, 55.5M input / 1.17M output tokens:

| model | in | out | tok/s | electricity |
|---|---:|---:|---:|---:|
| qwen3-coder:30b | 43,408,906 | 489,030 | 30 | $0.7863 |
| qwen3.8:latest | 2,882,873 | 609,895 | 40 | $0.1221 |
| gpt-oss:20b | 6,141,741 | 31,071 | 40 | $0.0780 |
| qwen3-coder:30b (2nd profile) | 2,197,017 | 21,688 | 30 | $0.0392 |
| deepseek-r1:14b | 859,970 | 20,675 | 55 | $0.0096 |
| gpt-oss:20b (2nd profile) | 14,150 | 751 | 40 | $0.0003 |
| qwen3:14b (×2) | 1,310 | 82 | 55 | $0.0000 |

**Electricity cost: $1.0355. Reported: $0.00.**

## Why it happens

`build_costs.py` has a complete, working power model — `KWH_PRICE_USD`,
`GPU_DRAW_W`, `HOST_OVERHEAD_W`, `LOCAL_TPS`, `PREFILL_SPEEDUP`,
`CACHE_SPEEDUP`, and `local_rates()`. Verified working: qwen3-coder:30b prices
at $0.0160/Mtok in, $0.1915/Mtok out, from
`(350 + 90) W / 1000 × $0.047 / 3600 = $0.0000057` per second of inference.

`pricing.py` never calls any of it. `rates_for()` returns `None` for local
models by design, so `price_row()` leaves `market_value_usd = 0.0` on every
local row. The model exists in one module; the cost path lives in another; they
were never connected.

The dollar figure is small. Two things make it worth fixing:

1. **The class is called `"free"`.** `build_costs.py`'s own docstring says
   *"Local models are NOT free in reality — they burn electricity"*, and the
   price sheet footnote says *"never counted as spend"*. The code contradicts
   its own documentation, and a reader believes the label.
2. **It scales.** 43M tokens through one model is already the largest single
   consumer by volume. As local usage grows, a $0 line item grows with it.

## Dead config found while checking

`Config.electricity_rate_kwh = 0.047` is read **nowhere**:

```
$ grep -rn "electricity_rate_kwh" src/ tests/ examples/
src/llm_telemetry/config.py:86:    electricity_rate_kwh: float = 0.047
```

The README documents it as a knob (it appears in `PKG-INFO`), but
`build_costs.py` hardcodes its own `KWH_PRICE_USD = 0.047`. A user who sets it
sees no change. `Config.currency` is dead the same way.

## Tickets

| id | title | est | depends |
|---|---|---|---|
| P7-01 | Price local models from the electricity tariff | 4h | — |
| P7-02 | Tariff comes from config, not hardcoded constants | 2h | P7-01 |
| P7-03 | Settings page: tariff + hardware, with the reasoning | 4h | P7-02 |
| P7-04 | Stop calling local models "free" in the UI | 2h | P7-01 |
| P7-05 | Tests for the electricity cost model | 2h | P7-01, P7-02 |

## Sequencing

P7-01 first — it is the actual defect. P7-04 can land immediately after and is
the ticket that fixes the *wrong belief*, which matters more than the dollars.
P7-02 then moves the constants into config, and P7-03 gives them a UI. P7-05
guards the regression.

P7-03 is blocked on a design decision: ADR 0001 says static files, no server, so
there is nothing to POST settings to. Either the serve process gains a write
path or the page emits YAML to paste. That decision also depends on #36
(single-user or not) — a settings page that writes to disk assumes one operator.

## Defaults (unchanged by this phase)

| setting | value |
|---|---|
| electricity rate | 0.047 USD/kWh |
| GPU draw under load | 350 W |
| host overhead | 90 W |
| derived | $0.0000057 per second of inference |

## Related

- #32 — Python tests for collectors; P7-05 should share its harness.
- #59–#63 — Phase 6 price sheet; P7-04 edits the same footnote as #60.
