#!/usr/bin/env python3
"""Parse Hermes errors.log into per-model reliability stats.

Why a log parser: the database records only successful usage
(`session_model_usage` rows are written when a call returns), so a failed call
is invisible there. Failures live in ~/.hermes/logs/errors.log, where the agent
writes structured `provider=… model=…` markers next to the HTTP status.

Output feeds the dashboard's success-rate matrix, keyed (profile, model).
"""
from __future__ import annotations

import os
import re
import time

from .config import get as _cfg

CFG = _cfg()

# Each profile has its own log tree; the default profile logs at the root.
LOGS = {p.name: p.errors_log for p in CFG.live_profiles()}

# `provider=x model=y` appears on the structured failure lines.
KV = re.compile(r"provider=([\w.:-]+)\s+model=([^\s|]+)")
# Fall back to a bare `model=` when the provider is absent.
MODEL_ONLY = re.compile(r"model=([^\s|]+)")
TS = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})")

# Classify the failure. Order matters: check specific causes before generic
# ones, because a rate-limit line also contains the word "error".
KINDS = [
    ("rate_limit", ("429", "rate limit", "usage limit", "out of capacity", "quota")),
    ("overloaded", ("overloaded", "503", "502", "capacity")),
    ("timeout", ("timed out", "timeout")),
    ("auth", ("401", "403", "unauthorized", "forbidden", "expired", "invalid api key")),
    ("server_error", ("500", "internal server")),
    ("unavailable", ("unavailable", "not supported", "no fallback")),
]


def classify(line: str) -> str | None:
    low = line.lower()
    for kind, needles in KINDS:
        if any(n in low for n in needles):
            return kind
    return None


def parse(path: str, since_days: int = 7) -> tuple[dict, list]:
    """Return ({(model): {kind: n, 'total': n, 'last': ts, 'last_msg': str}}, events[])."""
    stats: dict[str, dict] = {}
    events: list[dict] = []
    if not os.path.exists(path):
        return stats, events

    cutoff = time.time() - since_days * 86400
    try:
        with open(path, errors="replace") as fh:
            lines = fh.readlines()[-60000:]   # bound the work on a large log
    except OSError:
        return stats, events

    for line in lines:
        kind = classify(line)
        if not kind:
            continue
        # only count real API failures, not lint/lsp noise
        if "API call failed" not in line and "auxiliary" not in line.lower() \
           and "unhealthy" not in line.lower():
            continue

        m = KV.search(line)
        if m:
            model = m.group(2)
        else:
            m2 = MODEL_ONLY.search(line)
            model = m2.group(1) if m2 else None
        if not model:
            continue

        ts_m = TS.match(line)
        ts = ts_m.group(1) if ts_m else ""
        if ts:
            try:
                if time.mktime(time.strptime(ts, "%Y-%m-%d %H:%M:%S")) < cutoff:
                    continue
            except ValueError:
                pass

        s = stats.setdefault(model, {"total": 0, "last": "", "last_msg": "", "last_kind": ""})
        s[kind] = s.get(kind, 0) + 1
        s["total"] += 1

        # Trim the message down to the part that identifies the failure.
        msg = line.strip()
        for marker in ("HTTP ", "Error code: ", "error_type="):
            i = msg.find(marker)
            if i != -1:
                msg = msg[i:]
                break
        msg = msg[:150]

        # Keep EVERY failure event, not just the newest per model: the Health
        # panel shows individual incidents, so one-row-per-model would collapse
        # a burst of twenty rate-limits into a single line and hide the burst.
        events.append({"model": model, "when": ts, "kind": kind, "msg": msg})

        if ts >= s["last"]:
            s["last"] = ts
            s["last_kind"] = kind
            s["last_msg"] = msg

    events.sort(key=lambda r: r["when"], reverse=True)
    return stats, events[:60]


def for_profile(name: str, since_days: int = 7):
    return parse(LOGS.get(name, ""), since_days)


if __name__ == "__main__":
    for prof in LOGS:
        st, rec = for_profile(prof)
        print(f"== {prof}: {len(st)} models with failures")
        for model, s in sorted(st.items(), key=lambda kv: -kv[1]["total"])[:8]:
            kinds = ", ".join(f"{k}={v}" for k, v in s.items()
                              if k not in ("total", "last", "last_msg", "last_kind"))
            print(f"   {model:34} total={s['total']:4}  {kinds}")
        for r in rec[:3]:
            print(f"     last: {r['when']} [{r['kind']}] {r['msg'][:90]}")
