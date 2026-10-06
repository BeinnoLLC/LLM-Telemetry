#!/usr/bin/env python3
"""Render reports/rankings.html from rankings-data.json (#113).

Mirrors build_costs.py: a standalone page assembled from palette tokens +
web/css/rankings.css + the web/rankings.html shell, with every row rendered
server-side for each window (day / week / month) so the chooser is a pure
show/hide and the page needs no fetch. Model names come from a third party:
every one is HTML-escaped here before it reaches a fragment.

Usage: python3 -m llm_telemetry.build_rankings [out.html] [data.json]
Unless LLM_TELEMETRY_NO_COLLECT is set, the collector runs first.
"""
import html as _html
import json
import os
import sys

from .config import get as _cfg
from .build_costs import colour
from .collect_rankings import VIEWS, ATTRIBUTION, ATTRIBUTION_URL
from .collect_rankings import main as collect_main
from .webassets import (rankings_frag, read_rankings_css, read_rankings_js,
                        read_rankings_shell, read_tokens)

VIEW_LABELS = {"day": "Day", "week": "Week", "month": "Month"}


def esc(s):
    return _html.escape(str(s), quote=True)


def fmt_tokens(n):
    n = int(n or 0)
    for div, unit in ((1e12, "T"), (1e9, "B"), (1e6, "M"), (1e3, "K")):
        if n >= div:
            return f"{n / div:.2f}{unit}"
    return str(n)


def fmt_trend(t):
    if t is None:
        return rankings_frag("trend_none")
    cls = "up" if t > 0 else "down" if t < 0 else "flat"
    arrow = "▲" if t > 0 else "▼" if t < 0 else "■"
    return rankings_frag("trend", cls=cls, arrow=arrow, pct=esc(f"{t:+.1f}%"))


def render_view(name, view, active):
    rows = []
    for r in view.get("top", []):
        model = r.get("model", "")
        vendor, _, short = model.partition("/")
        rows.append(rankings_frag(
            "row", rank=int(r.get("rank", 0)), model=esc(model),
            short=esc(short or model), vendor=esc(vendor if short else ""),
            colour=esc(colour(model)), tokens=esc(fmt_tokens(r.get("tokens"))),
            raw=int(r.get("tokens") or 0), share=esc(f"{r.get('share', 0):.2f}"),
            bar=esc(f"{min(100.0, float(r.get('share') or 0)):.2f}"),
            trend=fmt_trend(r.get("trend"))))
    o = view.get("other")
    if o and o.get("tokens"):
        rows.append(rankings_frag(
            "other_row", models=int(o.get("models", 0)),
            tokens=esc(fmt_tokens(o["tokens"])), raw=int(o["tokens"]),
            share=esc(f"{o.get('share', 0):.2f}")))
    span = (f"{view.get('start')} → {view.get('end')}"
            if view.get("start") != view.get("end") else str(view.get("end")))
    return rankings_frag(
        "view", name=esc(name), hidden="" if active else " hidden",
        span=esc(span), days=int(view.get("days", 0)),
        total=esc(fmt_tokens(view.get("total"))), rows="".join(rows))


def render_body(data):
    status = data.get("status")
    views = data.get("views") or {}
    if status != "ok" or not any(v.get("top") for v in views.values()):
        reason = data.get("reason") or "no rankings rows in the source window"
        return rankings_frag("unavailable", reason=esc(reason))
    buttons = "".join(
        rankings_frag("view_btn", name=esc(n), label=esc(VIEW_LABELS[n]),
                      pressed="true" if n == "week" else "false")
        for n in VIEWS if n in views)
    panes = "".join(render_view(n, views[n], n == "week") for n in VIEWS if n in views)
    stale = ""
    if data.get("last_error"):
        stale = rankings_frag("stale", reason=esc(data["last_error"].get("reason", "")),
                              at=esc(data["last_error"].get("at", "")))
    return stale + rankings_frag("chooser", buttons=buttons) + panes


def render(data):
    meta = data.get("meta") or {}
    asof = data.get("as_of") or meta.get("as_of") or "—"
    win = data.get("window") or {}
    sample = " · sample data" if data.get("sample") else ""
    page = read_rankings_shell()
    for k, v in (("__RANKINGS_CSS__", read_tokens() + "\n" + read_rankings_css()),
                 ("__STATUS__", esc(data.get("status", "unavailable"))),
                 ("__ASOF__", esc(asof)),
                 ("__WINDOW__", esc(f"{win.get('start') or '?'} → {win.get('end') or '?'}")),
                 ("__SAMPLE__", esc(sample)),
                 ("__ATTR_TEXT__", esc(ATTRIBUTION)),
                 ("__ATTR_URL__", esc(ATTRIBUTION_URL)),
                 ("__BODY__", render_body(data)),
                 ("__RANKINGS_JS__", read_rankings_js())):
        page = page.replace(k, v)
    return page


def build(out=None, data_path=None):
    reports = str(_cfg().reports_dir)
    out = out or os.path.join(reports, "rankings.html")
    data_path = data_path or os.path.join(os.path.dirname(out) or reports, "rankings-data.json")
    if not os.environ.get("LLM_TELEMETRY_NO_COLLECT"):
        collect_main([data_path])
    try:
        with open(data_path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        data = {"status": "unavailable", "reason": "rankings-data.json is missing or unreadable"}
    page = render(data)
    tmp = out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(page)
    os.replace(tmp, out)
    print(f"rankings page ({data.get('status')}) -> {out}")
    return out


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    build(argv[0] if argv else None, argv[1] if len(argv) > 1 else None)


if __name__ == "__main__":
    main()
