#!/usr/bin/env python3
"""rates_for() resolution order (P6-05, #63).

Order: local -> WEB_RATES -> alias -> exact catalogue id -> fuzzy match -> None.
Every cost number on both pages passes through this, so each step is pinned
with a synthetic catalogue: no network and no real agent data.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))
from llm_telemetry import pricing as P
from llm_telemetry import energy as E

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{('  ' + str(extra)) if extra is not None else ''}")
    if ok:
        p += 1
    else:
        f += 1


def per_m(r):
    return None if r is None else tuple(round(x * 1e6, 6) for x in r)


CAT = {
    "qwen/qwen3-coder": {"prompt": "0.000001", "completion": "0.000002"},
    "openai/gpt-6-astra": {"prompt": "0.000099", "completion": "0.000099"},
    "gpt-6-astra": {"prompt": "0.000099", "completion": "0.000099"},
    "anthropic/claude-opus-5": {"prompt": "0.000005", "completion": "0.000025",
                                "input_cache_read": "0.0000005"},
    "someone/claude-opus-5": {"prompt": "0.000777", "completion": "0.000777"},
    "openai/gpt-5:batch": {"prompt": "0.000000625", "completion": "0.000005"},
    "anthropic/claude-fable-7.2": {"prompt": "0.000003", "completion": "0.000015"},
    "anthropic/claude-fable-7.2:batch": {"prompt": "0.000001", "completion": "0.000001"},
    "openrouter/auto": {"prompt": "-1", "completion": "-1"},
}

(ri, ro, rc), _ = E.local_rates("qwen3-coder:30b")
chk(per_m(P.rates_for("qwen3-coder:30b", CAT)) == (round(ri, 6), round(ro, 6), round(rc, 6)),
    "1 local tag prices from electricity even when a cloud price exists")
chk(per_m(P.rates_for("qwen/qwen3-coder", CAT)) == (1.0, 2.0, 0.0),
    "  a vendor-qualified id is the cloud model, not local")

w = P.WEB_RATES["gpt-6-astra"]
chk(per_m(P.rates_for("gpt-6-astra", CAT)) == tuple(float(x) for x in w),
    "2 WEB_RATES beats the catalogue (and the alias) for the same SKU", per_m(P.rates_for("gpt-6-astra", CAT)))

chk(per_m(P.rates_for("claude-opus-5", CAT)) == (5.0, 25.0, 0.5),
    "3 ALIASES pins the id, beating a same-basename decoy")

chk(per_m(P.rates_for("openai/gpt-5:batch", CAT)) == (0.625, 5.0, 0.0),
    "4 an exact catalogue id (incl. :batch) prices from its own entry")

chk(per_m(P.rates_for("claude-fable-7-2", CAT)) == (3.0, 15.0, 0.0),
    "5 fuzzy match maps dashed to dotted and skips the :batch variant")

chk(P.rates_for("no-such-model", CAT) is None, "6 an unknown model has no rate (None, never 0)")
chk(P.rates_for("openrouter/auto", CAT) is None, "  a -1 router sentinel is None, never negative")
chk(P.rates_for("anything", {}) is None, "  an empty catalogue prices nothing but vendor/local")
chk(P.rates_for("gpt-6-astra", {}) is not None, "  vendor rates survive an unavailable catalogue")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
