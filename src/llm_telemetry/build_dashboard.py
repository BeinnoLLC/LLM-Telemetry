#!/usr/bin/env python3
"""Render analytics JSON into the dashboard page.

P2-03 (#37): the page shell is a real file (``web/dashboard.html``) and the JS
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

CFG = _cfg()
DATA = str(CFG.reports_dir / "analytics-data.json")
OUT  = sys.argv[1] if len(sys.argv) > 1 else str(CFG.reports_dir / "dashboard.html")
# P2-01 (#26) / P2-03 (#37) / P2-02 (#27): CSS, the page shell, and the JS are
# real files under web/ (a lint or an editor sees a .css/.html/.js, not a
# Python string literal), inlined back at build time so the page stays a single
# self-contained file you can open straight off disk. webassets owns the paths.

# LLM_TELEMETRY_NO_COLLECT renders from whatever JSON is already on disk.
# Required for the sample build: the collectors would otherwise overwrite the
# synthetic payload with real local telemetry (chat titles included) - which is
# exactly the data the public repo must never carry.
if os.environ.get("LLM_TELEMETRY_NO_COLLECT"):
    pass
else:
    subprocess.run([sys.executable, "-m", "llm_telemetry.collect_analytics", "-o", DATA], check=True)
    # Router (#130) and quota (#115) data each have their own hourly job — the
    # router collector walks every profile's agent log, and the quota collector
    # also rewrites a 30-day history ledger, so neither belongs in a build that
    # runs every minute. This build only re-collects as a safety net when the
    # file is missing or older than MAX_AGE_S, so a deployment with no timer (a
    # plain container running the build loop) still refreshes hourly. The module
    # name is the payload name minus "-data"; both collectors take the output
    # path as their only argument.
    MAX_AGE_S = 65 * 60
    for _name in ("router", "quota"):
        _p = CFG.reports_dir / f"{_name}-data.json"
        if not _p.exists() or time.time() - _p.stat().st_mtime > MAX_AGE_S:
            subprocess.run([sys.executable, "-m", f"llm_telemetry.collect_{_name}", str(_p)], check=True)
from .schema import SCHEMA_VERSION  # noqa: E402
from .webassets import inline_js, read_css, read_shell, read_tokens  # noqa: E402


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
# Router tab (#130): the shared category/level vocabulary and when the hourly
# job last ran, so the tab can say how fresh its picture is.
data["router_meta"] = {"vocab": _rd.get("vocab") or {}, "collected_at": _rd.get("collected_at")}
# Quota tab (#115): provider headroom per profile, plus when the hourly job last
# refreshed the picture. The payload is already credential-free (see
# collect_quota's whitelist), so it passes through as-is.
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


from . import energy as _E  # noqa: E402 - after the payload load above
from .pricing import ttl_label as _ttl_label  # noqa: E402
from .config import Config as _Config  # noqa: E402

_kwh, _gw, _hw = _E.tariff(CFG)
# Defaults come from the Config dataclass itself, so the page's "Defaults"
# button can never disagree with what an unconfigured install uses.
_d = _Config()
POWER = {"tariff": {"electricity_rate_kwh": _kwh, "gpu_draw_watts": _gw, "host_overhead_watts": _hw},
         "defaults": {"electricity_rate_kwh": _d.electricity_rate_kwh,
                      "gpu_draw_watts": _d.gpu_draw_watts,
                      "host_overhead_watts": _d.host_overhead_watts},
         "tps": _E.LOCAL_TPS, "tps_default": _E.LOCAL_TPS_DEFAULT,
         "prefill": _E.PREFILL_SPEEDUP, "cachex": _E.CACHE_SPEEDUP,
         "config_file": _shown_path((CFG.resolution or {}).get("config_file", "")),
         # P7-05 (#112): the interval VALUES IN EFFECT right now (config override
         # or default), kept out of "tariff"/"defaults" because the power-model
         # Settings card's SET_DEFAULTS requires every key of "defaults" present in
         # a /api/settings reply. The page reads these to seed its own live
         # setInterval calls without waiting on a round trip.
         "intervals": {"live_poll_interval_s": getattr(CFG, "live_poll_interval_s", _d.live_poll_interval_s),
                       "analytics_rebuild_interval_s": getattr(CFG, "analytics_rebuild_interval_s", _d.analytics_rebuild_interval_s)},
         "interval_defaults": {"live_poll_interval_s": _d.live_poll_interval_s,
                                "analytics_rebuild_interval_s": _d.analytics_rebuild_interval_s}}
# P2-04 (#28): the palette tokens live in ONE file (web/css/tokens.css) that both
# pages inline ahead of their own styles, so a colour change cannot land on the
# dashboard and miss the price sheet.
_DASHBOARD_CSS = read_tokens() + read_css()
SHELL = read_shell()
_JS_INLINE = inline_js()

html = (SHELL.replace("__PRICE_TTL__", _ttl_label())
             .replace("__DASHBOARD_CSS__", _DASHBOARD_CSS)
             .replace("__DASHBOARD_JS__", _JS_INLINE)
             .replace("__DATA__", json.dumps(data, default=str))
             .replace("__POWER__", json.dumps(POWER))
             .replace("__LOCAL_HOSTS__", json.dumps(CFG.local_host_patterns))
             .replace("__SCHEMA_VERSION__", str(SCHEMA_VERSION)))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, "w").write(html)
print(f"{OUT}  ({len(html):,} bytes)")
