#!/usr/bin/env python3
"""OpenRouter public model rankings -> reports/rankings-data.json (#113).

Source: GET https://openrouter.ai/api/v1/datasets/rankings-daily
(``start_date``/``end_date``/``period``, Bearer OPENROUTER_API_KEY). Each day
holds the top 50 public models by token usage plus one reserved ``other`` row
(pinned last, omitted on days with an empty long tail). ``total_tokens`` is a
STRING (64-bit safe) and is parsed to int here.

Window choice (explicit, per the spec): ONE request per run for a fixed window
of the last ``WINDOW_DAYS`` days at ``period=day``, clamped to the dataset
floor. The day series is kept verbatim under ``rows`` and the day / week /
month views are re-aggregated from it (``views``), so the page's chooser never
needs a second fetch and the three views always share one ``as_of``.

Failure is never guessed into data: no key, a network error or a non-200
records ``status: "unavailable"`` with the reason. A previous good payload is
kept (its source date still tells the truth about its age) with the failure
attached as ``last_error``; with no previous payload the page renders an
explicit "no data" state. Only the variable NAME of the key is ever reported.
"""
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.request

from .config import get as _cfg

URL = "https://openrouter.ai/api/v1/datasets/rankings-daily"
KEY_ENV = "OPENROUTER_API_KEY"
FLOOR = datetime.date(2025, 1, 1)
WINDOW_DAYS = 30
OTHER = "other"
TOP_N = 10
# view name -> days of the window it covers (ending at the source end date).
VIEWS = {"day": 1, "week": 7, "month": 30}
# The build cycle runs every minute but the dataset is daily: a good payload
# younger than this is reused instead of re-fetched (override via env).
MIN_REFETCH_S = int(os.environ.get("LLM_TELEMETRY_RANKINGS_TTL", "3600"))
ATTRIBUTION = "Rankings data by OpenRouter, CC BY 4.0"
ATTRIBUTION_URL = "https://openrouter.ai/docs"


def parse_tokens(v):
    """total_tokens arrives as a string; anything unparseable counts as 0."""
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return 0


def window(today=None):
    """(start, end) dates of the fixed fetch window, clamped to the floor."""
    end = (today or datetime.date.today()) - datetime.timedelta(days=1)
    start = max(FLOOR, end - datetime.timedelta(days=WINDOW_DAYS - 1))
    return start, end


def _sum_by_model(rows, dates):
    out = {}
    for r in rows:
        if r.get("date") in dates:
            m = r.get("model_permaslug") or ""
            out[m] = out.get(m, 0) + parse_tokens(r.get("total_tokens"))
    return out


def aggregate(rows, days):
    """Rank models over the last ``days`` dates present in ``rows``.

    Trend method (also stated in the page legend): the trend span is the last
    max(2, days) dates of the series (day view: latest day vs the day before);
    trend % = (tokens in the last floor(span/2) dates - tokens in the first
    floor(span/2) dates) / first half * 100. ``None`` when the first half is zero (new model,
    or not enough history) -- never a made-up 0 %.

    The ``other`` row is everything outside the top N, INCLUDING the source's
    reserved ``other`` aggregate, so top-N + other == total exactly.
    """
    all_dates = sorted({r.get("date") for r in rows if r.get("date")})
    if not all_dates:
        return {"days": 0, "start": None, "end": None, "total": 0, "top": [], "other": None}
    dates = all_dates[-days:]
    span = all_dates[-max(2, days):]
    half = len(span) // 2
    first = _sum_by_model(rows, set(span[:half])) if half else {}
    # Equal halves: on an odd span the middle date is in neither half.
    second = _sum_by_model(rows, set(span[-half:])) if half else {}

    sums = _sum_by_model(rows, set(dates))
    total = sum(sums.values())
    named = sorted(((m, t) for m, t in sums.items() if m != OTHER),
                   key=lambda kv: (-kv[1], kv[0]))

    def trend(m):
        a, b = first.get(m, 0), second.get(m, 0)
        return None if not a else round((b - a) / a * 100, 1)

    top = []
    for i, (m, t) in enumerate(named[:TOP_N], 1):
        top.append({"rank": i, "model": m, "tokens": t,
                    "share": round(t / total * 100, 2) if total else 0.0,
                    "trend": trend(m)})
    rest = total - sum(x["tokens"] for x in top)
    other = {"model": OTHER, "tokens": rest,
             "share": round(rest / total * 100, 2) if total else 0.0,
             "models": max(0, len(named) - TOP_N), "source_other": sums.get(OTHER, 0)}
    return {"days": len(dates), "start": dates[0], "end": dates[-1],
            "total": total, "top": top, "other": other}


def assemble(resp, start, end):
    """The payload for a successful response (raw rows kept unmodified)."""
    rows = resp.get("data") or []
    meta = resp.get("meta") or {}
    return {
        "status": "ok",
        "source": URL,
        "window": {"start": str(start), "end": str(end), "period": "day"},
        "meta": meta,
        "as_of": meta.get("as_of"),
        "rows": rows,
        "views": {name: aggregate(rows, n) for name, n in VIEWS.items()},
        "attribution": {"text": ATTRIBUTION, "url": ATTRIBUTION_URL},
        "fetched_at": int(time.time()),
    }


def unavailable(reason, start=None, end=None):
    return {"status": "unavailable", "reason": reason, "source": URL,
            "window": {"start": str(start) if start else None,
                       "end": str(end) if end else None, "period": "day"},
            "rows": [], "views": {},
            "attribution": {"text": ATTRIBUTION, "url": ATTRIBUTION_URL}}


def fetch(start, end, key, timeout=30):
    """(payload dict or None, reason). The reason never contains the key."""
    url = f"{URL}?start_date={start}&end_date={end}&period=day"
    req = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + key, "Accept": "application/json",
        "User-Agent": "llm-telemetry"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code} from OpenRouter rankings API"
    except (urllib.error.URLError, OSError) as e:
        return None, f"network error ({type(e).__name__})"
    except ValueError:
        return None, "response was not valid JSON"


def collect(today=None, env=None, fetcher=fetch, previous=None):
    env = os.environ if env is None else env
    start, end = window(today)
    if (previous and previous.get("status") == "ok" and not previous.get("sample")
            and not previous.get("last_error")
            and time.time() - int(previous.get("fetched_at") or 0) < MIN_REFETCH_S):
        return previous
    key = (env.get(KEY_ENV) or "").strip()
    if not key:
        reason = f"{KEY_ENV} is not set"
    else:
        resp, reason = fetcher(start, end, key)
        if resp is not None:
            if isinstance(resp, dict) and isinstance(resp.get("data"), list):
                return assemble(resp, start, end)
            reason = "response had no data list"
    if previous and previous.get("status") == "ok":
        kept = dict(previous)
        kept["last_error"] = {"reason": reason,
                              "at": datetime.datetime.now().isoformat(timespec="seconds")}
        return kept
    return unavailable(reason, start, end)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    out = argv[0] if argv else str(_cfg().reports_dir / "rankings-data.json")
    previous = None
    if os.path.exists(out):
        try:
            with open(out, encoding="utf-8") as fh:
                previous = json.load(fh)
        except (OSError, ValueError):
            previous = None
    payload = collect(previous=previous)
    tmp = out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1)
    os.replace(tmp, out)
    note = payload.get("reason") or (payload.get("last_error") or {}).get("reason")
    print(f"rankings: {payload['status']}" + (f" ({note})" if note else "") + f" -> {out}")


if __name__ == "__main__":
    main()
