#!/usr/bin/env python3
"""P7-05 (#112): serve.py's SETTINGS whitelist gains live_poll_interval_s /
analytics_rebuild_interval_s. Exercises the real validate()/save()/current()
functions -- no reimplementation.
"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from llm_telemetry import serve

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{('  ' + str(extra)) if extra is not None else ''}")
    if ok:
        p += 1
    else:
        f += 1


# --- validate(): the two new keys are real whitelist entries with real ranges ---
clean, err = serve.validate({"live_poll_interval_s": 10, "analytics_rebuild_interval_s": 120})
chk(err is None and clean == {"live_poll_interval_s": 10.0, "analytics_rebuild_interval_s": 120.0},
    "both new interval keys validate as real numbers within range", (clean, err))

_, err = serve.validate({"live_poll_interval_s": 0.5})
chk(err is not None and "live_poll_interval_s" in err,
    "live_poll_interval_s below its floor (1s) is rejected, not silently clamped", err)

_, err = serve.validate({"live_poll_interval_s": 61})
chk(err is not None, "live_poll_interval_s above its ceiling (60s) is rejected")

_, err = serve.validate({"analytics_rebuild_interval_s": 5})
chk(err is not None, "analytics_rebuild_interval_s below its floor (10s) is rejected")

_, err = serve.validate({"analytics_rebuild_interval_s": 601})
chk(err is not None, "analytics_rebuild_interval_s above its ceiling (600s) is rejected")

_, err = serve.validate({"live_poll_interval_s": "5"})
chk(err is not None and "must be a number" in err,
    "a string value is rejected, never silently coerced (same rule the existing power-model keys use)")

# --- save()/current(): the real atomic-write + config round trip ---
with tempfile.TemporaryDirectory() as tmp:
    cfg_path = os.path.join(tmp, "config.json")
    with open(cfg_path, "w") as fh:
        json.dump({"electricity_rate_kwh": 0.05}, fh)

    saved_path = serve.save({"live_poll_interval_s": 15.0, "analytics_rebuild_interval_s": 90.0}, path=cfg_path)
    chk(saved_path == cfg_path, "save() returns the real path it wrote to")

    with open(cfg_path) as fh:
        raw = json.load(fh)
    chk(raw.get("live_poll_interval_s") == 15.0 and raw.get("analytics_rebuild_interval_s") == 90.0,
        "the new keys are actually persisted to the real config file")
    chk(raw.get("electricity_rate_kwh") == 0.05,
        "an unrelated existing key (electricity_rate_kwh) survives the merge untouched")

    values = serve.current(cfg_path)
    chk(values.get("live_poll_interval_s") == 15.0 and values.get("analytics_rebuild_interval_s") == 90.0,
        "current() reads the saved interval values back from disk, not a cache", values)

# --- current() with NO config file at all: real Config dataclass defaults ---
with tempfile.TemporaryDirectory() as tmp:
    missing_path = os.path.join(tmp, "does-not-exist.json")
    values = serve.current(missing_path)
    chk(values.get("live_poll_interval_s") == 5.0 and values.get("analytics_rebuild_interval_s") == 60.0,
        "with no config file, current() falls back to the real Config dataclass defaults (5s/60s)", values)

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
