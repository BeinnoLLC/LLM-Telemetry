#!/usr/bin/env python3
"""Add the persisted bandwidth series (P8-04, #76) to the sample payload.

Built from the sample's own (already sanitised) day rows with the real rollup
code, so the fixture has exactly the shape the collector writes. The last date
in the sample is treated as "today" (open); every earlier day is frozen, which
is what a ledger that has been running for a while looks like.
"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
os.environ.setdefault("LLM_TELEMETRY_CONFIG", str(ROOT / "examples" / "sample-config.json"))

from llm_telemetry import bandwidth_history as bh  # noqa: E402

path = ROOT / "examples" / "reports" / "analytics-data.json"
data = json.loads(path.read_text())
dates = sorted({r["date"] for p in data["profiles"].values() for r in p.get("rows", []) if r.get("date")})
today = dates[-1] if dates else "1970-01-01"
fresh = [row for n, p in data["profiles"].items() for row in bh.rollup(n, p.get("rows", []))]
rows = bh.merge([], fresh, today)
for n, p in data["profiles"].items():
    p["bandwidth_daily"] = [{k: v for k, v in r.items() if k != "profile"} for r in rows if r["profile"] == n]
path.write_text(json.dumps(data))
print(f"{path}: bandwidth_daily added ({len(rows)} rows, open day {today})")
