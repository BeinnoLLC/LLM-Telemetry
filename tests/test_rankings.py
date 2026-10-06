#!/usr/bin/env python3
"""OpenRouter rankings (#113): token parsing, aggregation, failure states.

Fixture-driven with an injected fetcher: no network, no real key. The fake
key below is a placeholder string and is asserted never to reach the output.
"""
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
os.environ.setdefault("LLM_TELEMETRY_CONFIG",
                      os.path.join(os.path.dirname(__file__), "..", "examples", "sample-config.json"))
from llm_telemetry import collect_rankings as C  # noqa: E402
from llm_telemetry import build_rankings as B  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), "..", "examples", "reports", "rankings-data.json")
FAKE = "placeholder-not-a-key"
TODAY = datetime.date(2026, 10, 6)

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    if ok:
        p += 1
    else:
        f += 1
    print(f"  {'OK  ' if ok else 'FAIL'} {label}" + (f"  ({extra})" if extra is not None else ""))


with open(FIXTURE, encoding="utf-8") as fh:
    sample = json.load(fh)

# total_tokens is a string on the wire, 64-bit values included.
chk(C.parse_tokens("1234567890") == 1234567890, "string total_tokens parsed to int")
chk(C.parse_tokens("18446744073709551615") == 2 ** 64 - 1, "64-bit string parsed exactly")
chk(C.parse_tokens(None) == 0 and C.parse_tokens("x") == 0, "junk tokens -> 0, not a crash")

# Re-assemble the committed fixture's raw rows: views must be reproducible.
resp = {"data": [{"date": r["date"], "model_permaslug": r["model_permaslug"],
                  "total_tokens": str(r["total_tokens"])} for r in sample["rows"]],
        "meta": sample["meta"]}
start, end = sample["window"]["start"], sample["window"]["end"]
got = C.assemble(resp, start, end)
chk(got["status"] == "ok", "assemble -> ok")
for name in ("day", "week", "month"):
    chk(got["views"][name]["top"] == sample["views"][name]["top"], f"{name}: top matches fixture")
week = got["views"]["week"]
toks = [t["tokens"] for t in week["top"]]
chk(len(toks) == C.TOP_N and toks == sorted(toks, reverse=True), "top-N sorted by tokens desc")
chk(all(t["model"] != C.OTHER for t in week["top"]), "reserved 'other' row never ranked")
chk(week["other"]["tokens"] + sum(toks) == week["total"], "top + other == window total")
chk(abs(sum(t["share"] for t in week["top"]) + week["other"]["share"] - 100) < 0.1, "shares sum to 100%")

# Tiny hand-checked case: two days, one model each plus other.
mini = {"data": [
    {"date": "2026-10-04", "model_permaslug": "a/x", "total_tokens": "100"},
    {"date": "2026-10-05", "model_permaslug": "a/x", "total_tokens": "300"},
    {"date": "2026-10-05", "model_permaslug": "b/y", "total_tokens": "500"},
    {"date": "2026-10-05", "model_permaslug": "other", "total_tokens": "100"}]}
m = C.assemble(mini, "2026-10-04", "2026-10-05")
d = m["views"]["day"]
chk([t["model"] for t in d["top"]] == ["b/y", "a/x"] and d["total"] == 900, "day view = last date only", d["total"])
chk(m["views"]["week"]["top"][0]["model"] == "b/y" and m["views"]["week"]["total"] == 1000, "week sums both days")

# No key -> explicit unavailable with the reason; fetcher never called.
calls = []
u = C.collect(today=TODAY, env={}, fetcher=lambda *a: calls.append(a) or (None, "x"))
chk(u["status"] == "unavailable" and "OPENROUTER_API_KEY" in u["reason"] and not calls,
    "no key -> unavailable, no request", u.get("reason"))
chk(u["rows"] == [] and u["views"] == {}, "unavailable carries no guessed data")

# Network failure -> unavailable (no previous) / stale previous kept.
net = lambda *a: (None, "network error (URLError)")  # noqa: E731
n = C.collect(today=TODAY, env={C.KEY_ENV: FAKE}, fetcher=net)
chk(n["status"] == "unavailable" and "network" in n["reason"], "network error -> unavailable")
good = dict(got, fetched_at=0)
s = C.collect(today=TODAY, env={C.KEY_ENV: FAKE}, fetcher=net, previous=good)
chk(s["status"] == "ok" and s["last_error"]["reason"].startswith("network"), "failure keeps previous snapshot + reason")

# One request per run, with the key only in the header argument.
seen = []
ok = C.collect(today=TODAY, env={C.KEY_ENV: FAKE}, fetcher=lambda *a: seen.append(a) or (mini, None))
chk(len(seen) == 1 and ok["status"] == "ok", "exactly one fetch per run")
chk(FAKE not in json.dumps(ok) and FAKE not in json.dumps(n) and FAKE not in json.dumps(s),
    "key never lands in the payload")

# Fresh good payload is reused (per-minute cycle must not hammer the API).
seen.clear()
fresh = dict(ok)
C.collect(today=TODAY, env={C.KEY_ENV: FAKE}, fetcher=lambda *a: seen.append(a) or (mini, None), previous=fresh)
chk(not seen, "fresh payload reused within TTL")

# Rendering: unavailable empty state, stale banner, escaping of model names.
hu = B.render(u)
chk('data-status="unavailable"' in hu and "OPENROUTER_API_KEY" in hu and "rk-row" not in hu,
    "unavailable page renders empty state")
chk("Rankings data by OpenRouter, CC BY 4.0" in hu and 'rel="noopener"' in hu, "attribution on unavailable page")
hs = B.render(s)
chk("previous snapshot" in hs, "stale banner shown")
evil = {"data": [{"date": "2026-10-05", "model_permaslug": '<img src=x onerror=alert(1)>"', "total_tokens": "5"}]}
he = B.render(C.assemble(evil, "2026-10-05", "2026-10-05"))
chk("<img src=x" not in he and "&lt;img" in he, "model names are escaped")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
