#!/usr/bin/env python3
"""Render analytics JSON into the dashboard page.

P2-03 (
is real ES modules, so editors and linters treat them as what they are. This
module only collects -> reads assets -> injects -> writes. Seven __PLACEHOLDER__
slots get filled: __PRICE_TTL__, __DASHBOARD_CSS__ and __DASHBOARD_JS__ in the
shell; __DATA__, __POWER__, __LOCAL_HOSTS__ and __SCHEMA_VERSION__ in the JS.
"""
import json
import os
import sys
import subprocess
import time

from .config import get as _cfg
from .config import Config as _Config
from .schema import SCHEMA_VERSION
from .webassets import inline_js, read_css, read_shell, read_tokens
from . import energy as _E
from .pricing import ttl_label as _ttl_label

CFG = _cfg()
DATA = str(CFG.reports_dir / "analytics-data.json")
COSTS_DATA = str(CFG.reports_dir / "costs-data.json")
OUT  = sys.argv[1] if len(sys.argv) > 1 else str(CFG.reports_dir / "dashboard.html")

if os.environ.get("LLM_TELEMETRY_NO_COLLECT"):
    pass
else:
    subprocess.run([sys.executable, "-m", "llm_telemetry.collect_analytics", "-o", DATA], check=True)
    MAX_AGE_S = 65 * 60
    for _name in ("router", "quota"):
        _p = CFG.reports_dir / f"{_name}-data.json"
        if not _p.exists() or time.time() - _p.stat().st_mtime > MAX_AGE_S:
            subprocess.run([sys.executable, "-m", f"llm_telemetry.collect_{_name}", str(_p)], check=True)


def _load_versioned(path):
    """Load a payload and refuse a shape this build does not understand (#23).

    Failing the build is the loud version of the blank-dashboard bug: better a
    clear message here than a page that renders nothing.
    """
    d = json.load(open(path))
    got = d.get("schema_version")
    if got != SCHEMA_VERSION:
        sys.exit(f"{path}: schema_version {got!r}, expected {SCHEMA_VERSION} "
                 f"(stale payload - re-run the collector)")
    return d


def _load_versioned_opt(path):
    """Load an optional payload; absent means empty, stale still fails (#23).

    The quota payload is optional by design: it mirrors the Hermes quota plugin's
    cache, and that plugin is not installed everywhere. A machine with no plugin
    must still build a dashboard (the Quota tab renders its own empty state) —
    but a payload that IS there and speaks an older schema is a real error and
    must not be silently swallowed, so the version check stays mandatory here.
    """
    if not path.exists():
        return {}
    return _load_versioned(path)


data = _load_versioned(DATA)
_rd = _load_versioned(CFG.reports_dir / "router-data.json")
data["router"] = _rd["profiles"]
data["router_meta"] = {"vocab": _rd.get("vocab") or {}, "collected_at": _rd.get("collected_at")}
_qd = _load_versioned_opt(CFG.reports_dir / "quota-data.json")
data["quota"] = _qd.get("profiles") or {}
data["quota_meta"] = {"collected_at": _qd.get("collected_at"),
                      "attention_percent": _qd.get("attention_percent"),
                      "summary": _qd.get("summary") or {}}


def _shown_path(f):
    """A path fit to embed in a page: relative to the working directory when
    inside it (the sample build), else with the home directory as ~. An
    absolute home path must never reach the HTML."""
    if not f:
        return ""
    f = os.path.abspath(f)
    cwd = os.getcwd()
    if f.startswith(cwd + os.sep):
        return os.path.relpath(f, cwd)
    home = os.path.expanduser("~")
    return "~" + f[len(home):] if f.startswith(home + os.sep) else os.path.basename(f)


_kwh, _gw, _hw = _E.tariff(CFG)
_d = _Config()
POWER = {"tariff": {"electricity_rate_kwh": _kwh, "gpu_draw_watts": _gw, "host_overhead_watts": _hw},
         "defaults": {"electricity_rate_kwh": _d.electricity_rate_kwh,
                      "gpu_draw_watts": _d.gpu_draw_watts,
                      "host_overhead_watts": _d.host_overhead_watts},
         "tps": _E.LOCAL_TPS, "tps_default": _E.LOCAL_TPS_DEFAULT,
         "prefill": _E.PREFILL_SPEEDUP, "cachex": _E.CACHE_SPEEDUP,
         "config_file": _shown_path((CFG.resolution or {}).get("config_file", "")),
         "intervals": {"live_poll_interval_s": getattr(CFG, "live_poll_interval_s", _d.live_poll_interval_s),
                       "analytics_rebuild_interval_s": getattr(CFG, "analytics_rebuild_interval_s", _d.analytics_rebuild_interval_s)},
         "interval_defaults": {"live_poll_interval_s": _d.live_poll_interval_s,
                                "analytics_rebuild_interval_s": _d.analytics_rebuild_interval_s}}
_DASHBOARD_CSS = read_tokens() + read_css()
SHELL = read_shell()
try:
    _costs_payload = json.dumps(json.load(open(COSTS_DATA)), default=str)
except (OSError, ValueError):
    _costs_payload = "{}"
RANKINGS_DATA = str(CFG.reports_dir / "rankings-data.json")
try:
    _rankings_payload = json.dumps(json.load(open(RANKINGS_DATA)), default=str)
except (OSError, ValueError):
    _rankings_payload = "{}"
_JS_INLINE = inline_js()

html = (SHELL.replace("__PRICE_TTL__", _ttl_label())
             .replace("__DASHBOARD_CSS__", _DASHBOARD_CSS)
             .replace("__DASHBOARD_JS__", _JS_INLINE)
             .replace("__DATA__", json.dumps(data, default=str))
             .replace("__COSTS_DATA__", _costs_payload)
             .replace("__RANKINGS_DATA__", _rankings_payload)
             .replace("__POWER__", json.dumps(POWER))
             .replace("__LOCAL_HOSTS__", json.dumps(CFG.local_host_patterns))
             .replace("__SCHEMA_VERSION__", str(SCHEMA_VERSION)))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, "w").write(html)
print(f"{OUT}  ({len(html):,} bytes)")
