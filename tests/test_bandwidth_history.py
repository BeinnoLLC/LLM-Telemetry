#!/usr/bin/env python3
"""P8-04 (#76): the persisted bandwidth series.

Acceptance, one check each:
- a dated series, one row per day/model/provider
- every row records the bytes_per_token it was computed with
- two runs over the same data give byte-identical output
- changing the constant does not alter already-written history
Plus: today stays open and keeps updating; a foreign-version ledger is set aside.
"""
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
os.environ.setdefault("LLM_TELEMETRY_CONFIG",
                      str(Path(__file__).resolve().parents[1] / "examples" / "sample-config.json"))

from llm_telemetry import bandwidth_history as bh  # noqa: E402

passed = failed = 0


def chk(ok, label, extra=""):
    global passed, failed
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{('  ' + extra) if extra else ''}")
    if ok:
        passed += 1
    else:
        failed += 1


def day_rows(scale=1):
    # Two task rows for the same day/model must collapse into one series row.
    return [
        {"date": "2026-09-20", "model": "m1", "provider": "anthropic", "task": "main", "calls": 10,
         "inp": 100, "cread": 1000, "outp": 10, "up_bytes": 5000 * scale, "down_bytes": 40 * scale,
         "lan_up_bytes": 0, "lan_down_bytes": 0},
        {"date": "2026-09-20", "model": "m1", "provider": "anthropic", "task": "title", "calls": 2,
         "inp": 10, "cread": 0, "outp": 5, "up_bytes": 50 * scale, "down_bytes": 20 * scale,
         "lan_up_bytes": 0, "lan_down_bytes": 0},
        {"date": "2026-09-26", "model": "q", "provider": "custom", "task": "main", "calls": 3,
         "inp": 7, "cread": 0, "outp": 3, "up_bytes": 0, "down_bytes": 0,
         "lan_up_bytes": 33 * scale, "lan_down_bytes": 14 * scale},
    ]


with tempfile.TemporaryDirectory() as tmp:
    d = Path(tmp)
    TODAY = "2026-09-26"
    by = bh.update(d, {"work": day_rows()}, today=TODAY)
    rows = by["work"]
    chk(len(rows) == 2, "one row per day/provider/model (tasks collapsed)", f"({len(rows)})")
    r0 = next(r for r in rows if r["date"] == "2026-09-20")
    chk(r0["up_bytes"] == 5050 and r0["down_bytes"] == 60, "bytes summed across tasks",
        f"({r0['up_bytes']}/{r0['down_bytes']})")
    chk(all("bytes_per_token" in r for r in rows), "every row records bytes_per_token")
    chk(r0["frozen"] is True, "a closed day is frozen")
    chk(next(r for r in rows if r["date"] == TODAY)["frozen"] is False, "today stays open")
    chk(rows[1]["lan_up_bytes"] == 33, "LAN bytes kept separate", f"({rows[1]['lan_up_bytes']})")

    ledger = d / bh.LEDGER_NAME
    first = ledger.read_bytes()
    bh.update(d, {"work": day_rows()}, today=TODAY)
    chk(ledger.read_bytes() == first, "re-running twice produces identical output")

    # Recalibration: the constant changes and the DB-derived bytes change with
    # it. Closed history must not move; today may.
    orig = bh.bandwidth.BYTES_PER_TOKEN
    try:
        bh.bandwidth.BYTES_PER_TOKEN = 9.99
        by2 = bh.update(d, {"work": day_rows(scale=3)}, today=TODAY)
    finally:
        bh.bandwidth.BYTES_PER_TOKEN = orig
    # merge() binds the default at import; pass the new constant explicitly to
    # mirror a real restart with a recalibrated module.
    rows_fresh = bh.rollup("work", day_rows(scale=3))
    merged = bh.merge(bh.load(ledger), rows_fresh, TODAY, bpt=9.99)
    old = next(r for r in merged if r["date"] == "2026-09-20")
    new = next(r for r in merged if r["date"] == TODAY)
    chk(old["up_bytes"] == 5050 and old["bytes_per_token"] == orig,
        "changing the constant does not alter written history",
        f"({old['up_bytes']} @ {old['bytes_per_token']})")
    chk(new["lan_up_bytes"] == 99 and new["bytes_per_token"] == 9.99,
        "the open day picks up the new constant", f"({new['lan_up_bytes']} @ {new['bytes_per_token']})")

    # Midnight passes: yesterday's open row freezes on the next run.
    bh.save(ledger, merged)
    rows3 = bh.update(d, {"work": day_rows(scale=3)}, today="2026-09-27")["work"]
    chk(next(r for r in rows3 if r["date"] == TODAY)["frozen"] is True,
        "yesterday freezes once the date rolls over")

    # A day the DB no longer reports (pruned) survives in the ledger.
    rows4 = bh.update(d, {"work": day_rows()[2:]}, today="2026-09-27")["work"]
    chk(any(r["date"] == "2026-09-20" for r in rows4), "history survives the source forgetting it")

    # A token column added later is backfilled into frozen rows; bytes are not.
    led = json.load(open(ledger))
    for r in led["rows"]:
        r.pop("cache_write_tokens", None)
        if r["date"] == "2026-09-20":
            r["up_bytes"] = 1234          # sentinel: must survive the backfill
    json.dump(led, open(ledger, "w"))
    rows6 = bh.update(d, {"work": [dict(x, cwrite=77) for x in day_rows()]}, today="2026-09-27")["work"]
    o = next(r for r in rows6 if r["date"] == "2026-09-20")
    chk(o.get("cache_write_tokens") == 154 and o["up_bytes"] == 1234,
        "new token column backfills a frozen row without touching its bytes",
        f"(cw={o.get('cache_write_tokens')} up={o['up_bytes']})")

    # A ledger in a different schema is set aside, not reinterpreted.
    json.dump({"schema_version": 999, "rows": [{"junk": 1}]}, open(ledger, "w"))
    rows5 = bh.update(d, {"work": day_rows()}, today=TODAY)["work"]
    chk(all("junk" not in r for r in rows5) and (d / f"{bh.LEDGER_NAME}.v999.bak").exists(),
        "foreign-version ledger is backed up and replaced")
    chk(json.load(open(ledger))["schema_version"] == bh.SCHEMA_VERSION, "ledger carries schema_version")

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
