"""Persisted daily bandwidth series (P8-04, #76).

Every bandwidth figure is derived: ``tokens x BYTES_PER_TOKEN``. Recomputing
history on each build means a recalibration of that constant silently restates
every past day, so "tracking over time" would really be "re-estimating the past
with today's assumptions". This module freezes each closed day instead.

Ledger: ``<reports_dir>/bandwidth-history.json``::

    {"schema_version": 1,
     "rows": [{"profile", "date", "provider", "model",
               "up_bytes", "down_bytes", "lan_up_bytes", "lan_down_bytes",
               "input_tokens", "cache_read_tokens", "cache_write_tokens",
               "output_tokens", "calls", "bytes_per_token", "frozen"}]}

Rules:
- A day before today is CLOSED. The first time a closed day is seen it is
  written with the constant in force at that moment and marked frozen; after
  that it is never recomputed, whatever the constant becomes.
- Today is OPEN: recomputed on every run (frozen=False), so the current day
  keeps growing until midnight, then freezes on the first run after.
- Output is sorted and written with stable separators, so two runs over the same
  DB produce byte-identical files.

The token columns are kept so a deliberate, audited restatement is still
possible later (tokens x a new constant) without guessing what went in.
"""

from __future__ import annotations

import datetime
import json
import os
from pathlib import Path

from . import bandwidth
from .schema import SCHEMA_VERSION

LEDGER_NAME = "bandwidth-history.json"
KEY = ("profile", "date", "provider", "model")
TOKEN_KEYS = ("input_tokens", "cache_read_tokens", "cache_write_tokens", "output_tokens", "calls")


def _key(r):
    return tuple(r.get(k) or "" for k in KEY)


def rollup(profile: str, rows: list[dict]) -> list[dict]:
    """Day rows (date, model, provider, task...) -> one row per day/provider/model.

    Rows arrive already carrying up/down/lan byte estimates (split per
    endpoint by collect_analytics), so this only sums; it never re-applies the
    constant, which keeps the tables and the series from disagreeing.
    """
    agg: dict[tuple, dict] = {}
    for r in rows:
        k = (profile, r.get("date") or "", r.get("provider") or "", r.get("model") or "")
        o = agg.get(k)
        if o is None:
            o = agg[k] = {"profile": k[0], "date": k[1], "provider": k[2], "model": k[3],
                          "up_bytes": 0, "down_bytes": 0, "lan_up_bytes": 0, "lan_down_bytes": 0,
                          "input_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0,
                          "output_tokens": 0,
                          "calls": 0}
        o["up_bytes"] += int(r.get("up_bytes") or 0)
        o["down_bytes"] += int(r.get("down_bytes") or 0)
        o["lan_up_bytes"] += int(r.get("lan_up_bytes") or 0)
        o["lan_down_bytes"] += int(r.get("lan_down_bytes") or 0)
        o["input_tokens"] += int(r.get("inp") or 0)
        o["cache_read_tokens"] += int(r.get("cread") or 0)
        o["cache_write_tokens"] += int(r.get("cwrite") or 0)
        o["output_tokens"] += int(r.get("outp") or 0)
        o["calls"] += int(r.get("calls") or 0)
    return [agg[k] for k in sorted(agg)]


def load(path: Path) -> list[dict]:
    try:
        with open(path) as f:
            d = json.load(f)
    except (OSError, ValueError):
        return []
    if d.get("schema_version") != SCHEMA_VERSION:
        # A ledger in a shape this code does not understand is not silently
        # reinterpreted; it is set aside and a fresh one started.
        try:
            os.replace(path, f"{path}.v{d.get('schema_version')}.bak")
        except OSError:
            pass
        return []
    return d.get("rows") or []


def merge(existing: list[dict], fresh: list[dict], today: str,
          bpt: float = bandwidth.BYTES_PER_TOKEN) -> list[dict]:
    """Frozen history wins; open days and never-seen days take the fresh value."""
    out = {_key(r): r for r in existing}
    for r in fresh:
        k = _key(r)
        old = out.get(k)
        if old is not None and old.get("frozen"):
            # History is not restated: bytes and the constant stay as written.
            # Token counts do not depend on the constant, so a token column
            # added in a later version may be backfilled into a frozen row.
            for tk in TOKEN_KEYS:
                if tk not in old and tk in r:
                    old[tk] = r[tk]
            continue
        row = dict(r, bytes_per_token=bpt, frozen=r["date"] < today)
        out[k] = row
    # An open row from an earlier run that the DB no longer reports for today
    # is left alone rather than deleted: the ledger only ever grows.
    for k, r in out.items():
        if not r.get("frozen") and r.get("date", "") < today:
            r["frozen"] = True
    return [out[k] for k in sorted(out)]


def save(path: Path, rows: list[dict]) -> None:
    tmp = f"{path}.tmp"
    with open(tmp, "w") as f:
        json.dump({"schema_version": SCHEMA_VERSION, "rows": rows}, f,
                  separators=(",", ":"), sort_keys=True)
    os.replace(tmp, path)          # atomic: a crash mid-write never truncates history


def update(reports_dir: Path, per_profile_rows: dict[str, list[dict]],
           today: str | None = None) -> dict[str, list[dict]]:
    """Merge today's rollup into the ledger and return rows grouped by profile."""
    today = today or datetime.date.today().isoformat()
    path = Path(reports_dir) / LEDGER_NAME
    fresh = [row for name, rows in per_profile_rows.items() for row in rollup(name, rows)]
    rows = merge(load(path), fresh, today)
    save(path, rows)
    by: dict[str, list[dict]] = {}
    for r in rows:
        by.setdefault(r["profile"], []).append(
            {k: v for k, v in r.items() if k != "profile"})
    return by
