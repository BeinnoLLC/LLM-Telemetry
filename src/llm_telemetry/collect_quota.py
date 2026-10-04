#!/usr/bin/env python3
"""Export each profile's provider quota headroom for the dashboard's Quota tab.

The dashboard must never hold a provider credential, so it cannot call provider
APIs itself. Instead this collector reads the cache the Hermes quota plugin
already maintains (``<profile home>/quota_cache.json``, kept fresh by the
plugin's own hourly job) and copies out a strict **whitelist** of descriptive
fields.

Deliberately dropped:

* every key not named in ``_PROVIDER_FIELDS`` / ``_WINDOW_FIELDS`` /
  ``_BALANCE_FIELDS`` -- a new key in the plugin's schema shows up here only
  when someone adds it on purpose, so a credential-shaped field cannot leak in
  by accident.
* any credential-shaped substring inside the free-text ``details`` lines,
  which are scrubbed to ``[REDACTED]`` before the payload is written.
* the credential stores themselves (``auth.json``, ``.env``, ``config.yaml``):
  this module never opens them.

The payload is per profile, because each profile keeps its own cache:

    {profiles: {<name>: {providers: {<id>: {...}}, cache_fetched_at, note}},
     collected_at, schema_version}

Run hourly by systemd/llm-telemetry-quota.timer; the every-minute dashboard
build re-collects only when quota-data.json is missing or stale.
"""
import json
import os
import re
import sys
import time

from .config import get as _cfg
from .schema import stamp

CFG = _cfg()

# The plugin writes this file next to the rest of a profile's state.
CACHE_NAME = "quota_cache.json"
DATA_NAME = "quota-data.json"
HISTORY_NAME = "quota-history.json"

# How much history the ledger keeps. Hourly collection => ~24 samples/day, so
# 30 days is well under the cap for a normal install.
HISTORY_DAYS = 30
HISTORY_MAX_SAMPLES = 900

# Whitelist. Named explicitly so an unexpected plugin key is dropped rather
# than copied.
_PROVIDER_FIELDS = (
    "label", "plan", "unavailable_reason", "api_calls_available",
    "windows", "account_balances", "details",
)
_WINDOW_FIELDS = ("label", "reset_at", "used_percent")
_BALANCE_FIELDS = ("currency", "total_balance", "granted_balance", "topped_up_balance")

# A window at or above this reads as "about to run out" in the UI.
ATTENTION_PERCENT = 90.0

# Credential shapes worth scrubbing even out of descriptive text. The
# whitelist is the real guarantee; this is belt-and-braces for free text a
# provider chose to echo back at us.
_SECRET_PATTERNS = [re.compile(p) for p in (
    r"sk-[A-Za-z0-9_\-]{8,}",
    r"gh[pousr]_[A-Za-z0-9]{16,}",
    r"(?i)\bbearer\s+[A-Za-z0-9._\-]{8,}",
    r"(?i)\b(api[_\-]?key|access[_\-]?token|refresh[_\-]?token|secret|password)\b\s*[:=]\s*\S+",
    r"[A-Za-z0-9_\-]{40,}",
)]
_SECRET_REPLACEMENT = "[REDACTED]"


def scrub(text):
    """Replace credential-shaped substrings with ``[REDACTED]``; cap length."""
    if not isinstance(text, str):
        return None
    out = text
    for pat in _SECRET_PATTERNS:
        out = pat.sub(_SECRET_REPLACEMENT, out)
    return out[:400]


def _text(value):
    """A scrubbed string, or None when there is nothing to show."""
    if value is None:
        return None
    out = scrub(str(value))
    return out or None


def _percent(value):
    """Coerce to a float percentage, or None. Booleans are not numbers here."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if num != num:  # NaN
        return None
    return round(num, 2)


def _numstr(value):
    """Decimal strings must survive verbatim; anything else is coerced."""
    if value is None:
        return None
    if isinstance(value, str):
        return scrub(value)
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return repr(value)
    return None


def window(raw):
    """Whitelist one quota window, or None when it carries no usable label."""
    if not isinstance(raw, dict):
        return None
    label = _text(raw.get("label"))
    if not label:
        return None
    return {
        "label": label,
        "reset_at": _text(raw.get("reset_at")),
        "used_percent": _percent(raw.get("used_percent")),
    }


def balance(raw):
    """Whitelist one account balance entry."""
    if not isinstance(raw, dict):
        return None
    out = {k: _numstr(raw.get(k)) for k in _BALANCE_FIELDS}
    if not (out["currency"] or out["total_balance"]):
        return None
    return out


def provider(pid, raw):
    """Whitelist one provider record into the payload shape the view expects."""
    raw = raw if isinstance(raw, dict) else {}
    windows = [w for w in (window(x) for x in (raw.get("windows") or [])) if w]
    balances = [b for b in (balance(x) for x in (raw.get("account_balances") or [])) if b]
    details = [d for d in (_text(x) for x in (raw.get("details") or [])) if d]

    calls = raw.get("api_calls_available")
    if not isinstance(calls, bool):
        calls = None

    used = [w["used_percent"] for w in windows if w["used_percent"] is not None]
    worst = max(used) if used else None

    return {
        "id": pid,
        "label": _text(raw.get("label")) or pid,
        "plan": _text(raw.get("plan")),
        "unavailable_reason": _text(raw.get("unavailable_reason")),
        "api_calls_available": calls,
        "windows": windows,
        "balances": balances,
        "details": details,
        "max_used_percent": worst,
        "attention": bool(worst is not None and worst >= ATTENTION_PERCENT),
    }


def read_cache(home):
    """Load a profile's quota cache, or None when absent/unreadable/foreign.

    A parse error is reported as missing rather than fatal: the tab should say
    "no quota data", not take the whole dashboard down.
    """
    path = os.path.join(home, CACHE_NAME)
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    return data


def profile_payload(home):
    """Whitened quota view of one profile's cache."""
    raw = read_cache(home)
    if raw is None:
        return {"providers": {}, "cache_fetched_at": None, "note": "no-quota-cache"}

    providers = raw.get("providers")
    providers = providers if isinstance(providers, dict) else {}
    out = {pid: provider(pid, rec) for pid, rec in sorted(providers.items())}
    return {
        "providers": out,
        "cache_fetched_at": _text(raw.get("fetched_at")),
        "note": None if out else "no-providers",
    }


def summarise(profiles):
    """Counts the view and the build both want, computed once."""
    total = avail = attention = 0
    for pdata in profiles.values():
        for prov in pdata["providers"].values():
            total += 1
            if prov["unavailable_reason"] is None:
                avail += 1
            if prov["attention"]:
                attention += 1
    return {"providers": total, "available": avail, "attention": attention}


def build():
    """Pure: assemble the payload without touching the reports directory."""
    profiles = {}
    for p in CFG.live_profiles():
        profiles[p.name] = profile_payload(p.home)
    out = {
        "profiles": profiles,
        "collected_at": int(time.time()),
        "attention_percent": ATTENTION_PERCENT,
    }
    out["summary"] = summarise(profiles)
    return stamp(out)


def history_sample(now, data):
    """One compact ledger row: per profile/provider, each window's fill level."""
    providers = {}
    for pname, pdata in data["profiles"].items():
        entry = {}
        for pid, prov in pdata["providers"].items():
            entry[pid] = {
                "plan": prov["plan"],
                "unavailable_reason": prov["unavailable_reason"],
                "windows": {w["label"]: w["used_percent"] for w in prov["windows"]},
            }
        if entry:
            providers[pname] = entry
    if not providers:
        return None
    return {"t": now, "providers": providers}


def append_history(path, sample, now):
    """Append one sample to the ledger, pruning by age and count.

    Append-only in spirit: existing samples are kept in order; only the tail is
    trimmed so the file cannot grow without bound. The read-modify-write is
    safe here because a single systemd timer owns the file.
    """
    samples = []
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as fh:
                prev = json.load(fh)
            if isinstance(prev, dict) and isinstance(prev.get("samples"), list):
                samples = [s for s in prev["samples"] if isinstance(s, dict)]
        except (OSError, ValueError):
            samples = []
    if sample:
        samples.append(sample)
    cutoff = now - HISTORY_DAYS * 86400
    samples = [s for s in samples if isinstance(s.get("t"), (int, float)) and s["t"] >= cutoff]
    samples = samples[-HISTORY_MAX_SAMPLES:]
    payload = stamp({"samples": samples, "days": HISTORY_DAYS})
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    os.replace(tmp, path)
    return len(samples)


def _write(dest, data):
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    tmp = dest + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"))
    os.replace(tmp, dest)


def main(dest=None, history=None):
    dest = dest or str(CFG.reports_dir / DATA_NAME)
    history = history or str(CFG.reports_dir / HISTORY_NAME)
    now = int(time.time())
    data = build()
    _write(dest, data)
    kept = append_history(history, history_sample(now, data), now)
    n = len(data["profiles"])
    s = data["summary"]
    print(f"{dest}  ({n} profiles, {s['providers']} providers, "
          f"{s['available']} available, {s['attention']} near limit; "
          f"history: {kept} samples)")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    main(args[0] if args else None, args[1] if len(args) > 1 else None)
