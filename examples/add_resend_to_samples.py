#!/usr/bin/env python3
"""Add the per-session context re-send list (P9-03, #80) to the sample payload.

Derived from each profile's own recent_sessions, so fixture numbers stay
consistent: calls = the session's api_calls, prompt tokens = its token total
split by a fixed per-provider cache profile, and re-sent cost is priced
through the REAL pricing.price_row() -- never hand-written dollars.
Idempotent: re-running replaces the list.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from llm_telemetry import pricing  # noqa: E402

MIN_CALLS = 10   # matches collect_analytics.RESEND_MIN_CALLS


def add_resend(data, catalog=None):
    catalog = catalog if catalog is not None else {}
    for prof in data["profiles"].values():
        out = []
        for s in prof.get("recent_sessions") or []:
            calls = int(s.get("api_calls") or 0)
            if calls < MIN_CALLS:
                continue
            prompt = int(s.get("tokens") or 0)
            row = {"provider": s.get("prov"), "model": s["model"],
                   "base_url": s.get("base_url"), "input_tokens": 0, "output_tokens": 0}
            # Local runtimes do not cache; cloud agents re-read ~90% from cache.
            # Class comes from price_row itself, the one classifier.
            local = pricing.price_row(dict(row, cache_read=0), catalog)["cost_class"] == "local"
            share = 0.0 if local else 0.9
            cr = int(prompt * share)
            pr = pricing.price_row(dict(row, cache_read=cr), catalog)
            out.append({"id": s["id"], "title": s.get("title") or "", "model": s["model"],
                        "calls": calls, "ctx_per_call": round(prompt / calls),
                        "cread_pct": round(100.0 * share, 1),
                        "resend_usd": pr["market_value_usd"], "cost_class": pr["cost_class"],
                        "last": s.get("last_ts")})
        out.sort(key=lambda x: -x["resend_usd"])
        prof["resend"] = out[:60]
    return data


if __name__ == "__main__":
    p = ROOT / "examples" / "reports" / "analytics-data.json"
    d = json.loads(p.read_text())
    add_resend(d, pricing.fetch_catalog()[0])
    p.write_text(json.dumps(d, separators=(",", ":")))
    print({k: len(v["resend"]) for k, v in d["profiles"].items()})
