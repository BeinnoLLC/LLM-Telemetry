#!/usr/bin/env python3
"""Collect OpenRouter rankings into reports/rankings-data.json (#113).

The dashboard's Rankings view consumes this payload: build_dashboard inlines
it into the single app page and renderRankings() paints it client-side.
build_rankings no longer renders a standalone rankings.html — everything
lives under the main app. Model names come from a third party; the view
escapes them on the render path (see tests/check_rankings_inapp.js).

Usage: python3 -m llm_telemetry.build_rankings [out.json]
Unless LLM_TELEMETRY_NO_COLLECT is set, the collector runs first.
"""
import json
import os
import sys

from .config import get as _cfg
from .collect_rankings import main as collect_main


def build(out=None, data_path=None):
    reports = str(_cfg().reports_dir)
    out = out or os.path.join(reports, "rankings-data.json")
    data_path = data_path or out
    if not os.environ.get("LLM_TELEMETRY_NO_COLLECT"):
        collect_main([data_path])
    try:
        with open(data_path, encoding="utf-8") as fh:
            data = json.load(fh)
        # Normalise through disk so the payload is exactly what the app inlines.
        tmp = out + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, default=str)
        os.replace(tmp, out)
    except (OSError, ValueError):
        data = {"status": "unavailable",
                "reason": "rankings-data.json is missing or unreadable"}
    print(f"rankings data ({data.get('status')}) -> {out}")
    return out


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    build(argv[0] if argv else None, argv[1] if len(argv) > 1 else None)


if __name__ == "__main__":
    main()