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
from llm_telemetry import collect_rankings as C
from llm_telemetry import build_rankings as B

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

chk(C.parse_tokens("1234567890") == 1234567890, "string total_tokens parsed to int")
chk(C.parse_tokens("18446744073709551615") == 2 ** 64 - 1, "64-bit string parsed exactly")
chk(C.parse_tokens(None) == 0 and C.parse_tokens("x") == 0, "junk tokens -> 0, not a crash")

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

mini = {"data": [
    {"date": "2026-10-04", "model_permaslug": "a/x", "total_tokens": "100"},
    {"date": "2026-10-05", "model_permaslug": "a/x", "total_tokens": "300"},
    {"date": "2026-10-05", "model_permaslug": "b/y", "total_tokens": "500"},
    {"date": "2026-10-05", "model_permaslug": "other", "total_tokens": "100"}]}
m = C.assemble(mini, "2026-10-04", "2026-10-05")
d = m["views"]["day"]
chk([t["model"] for t in d["top"]] == ["b/y", "a/x"] and d["total"] == 900, "day view = last date only", d["total"])
chk(m["views"]["week"]["top"][0]["model"] == "b/y" and m["views"]["week"]["total"] == 1000, "week sums both days")

calls = []
u = C.collect(today=TODAY, env={}, fetcher=lambda *a: calls.append(a) or (None, "x"))
chk(u["status"] == "unavailable" and "OPENROUTER_API_KEY" in u["reason"] and not calls,
    "no key -> unavailable, no request", u.get("reason"))
chk(u["rows"] == [] and u["views"] == {}, "unavailable carries no guessed data")

net = lambda *a: (None, "network error (URLError)")
n = C.collect(today=TODAY, env={C.KEY_ENV: FAKE}, fetcher=net)
chk(n["status"] == "unavailable" and "network" in n["reason"], "network error -> unavailable")
good = dict(got, fetched_at=0)
s = C.collect(today=TODAY, env={C.KEY_ENV: FAKE}, fetcher=net, previous=good)
chk(s["status"] == "ok" and s["last_error"]["reason"].startswith("network"), "failure keeps previous snapshot + reason")

seen = []
ok = C.collect(today=TODAY, env={C.KEY_ENV: FAKE}, fetcher=lambda *a: seen.append(a) or (mini, None))
chk(len(seen) == 1 and ok["status"] == "ok", "exactly one fetch per run")
chk(FAKE not in json.dumps(ok) and FAKE not in json.dumps(n) and FAKE not in json.dumps(s),
    "key never lands in the payload")

seen.clear()
fresh = dict(ok)
C.collect(today=TODAY, env={C.KEY_ENV: FAKE}, fetcher=lambda *a: seen.append(a) or (mini, None), previous=fresh)
chk(not seen, "fresh payload reused within TTL")

chk('stale_banner' in json.dumps(s) or s.get("status") == "ok", "stale-previous payload keeps status ok")
evil = C.assemble({"data": [{"date": "2026-10-05", "model_permaslug": '<img src=x onerror=alert(1)>"', "total_tokens": "5"}]},
                  "2026-10-05", "2026-10-05")
js = json.dumps(evil)
chk('<img src=x' in js and 'onerror' in js, "payload keeps the raw model name as DATA")
import html as _html
name = evil["views"]["day"]["top"][0]["model"]
chk(_html.escape(name) != name, "esc() would change it — escaping happens in renderRankings, covered by check_rankings_inapp.js")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
