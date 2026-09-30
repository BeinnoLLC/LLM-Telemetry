#!/usr/bin/env python3
"""Render analytics JSON into the dashboard page.

P2-03 (#37): the page shell is a real file - ``web/dashboard.html`` - with
six __PLACEHOLDER__ slots (__PRICE_TTL__, __DASHBOARD_CSS__, __DATA__,
__POWER__, __LOCAL_HOSTS__, __SCHEMA_VERSION__). This module only does
collect -> read assets -> inject -> write, so the HTML/CSS/JS all live in
files that editors and linters treat as what they are.
"""
import json
import os
import sys
import subprocess

from .config import get as _cfg

CFG = _cfg()
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = str(CFG.reports_dir / "analytics-data.json")
OUT  = sys.argv[1] if len(sys.argv) > 1 else str(CFG.reports_dir / "dashboard.html")
# P2-01 (#26): CSS lives in its own file (stylelint, editor completion,
# specificity tooling all work on a real .css that never worked on a Python
# string literal), inlined into <style> at build time so the page stays a
# single self-contained file you can open straight off disk.
CSS_PATH = os.path.join(HERE, "web", "css", "dashboard.css")
# P2-03 (#37) + P2-02 (#27): the page shell is a real .html file and the
# JavaScript is real ES modules under web/js/ — see webassets for why the
# modules are inlined back into one file instead of being loaded by the page.
SHELL_PATH = os.path.join(HERE, "web", "dashboard.html")

# LLM_TELEMETRY_NO_COLLECT renders from whatever JSON is already on disk.
# Required for the sample build: the collectors would otherwise overwrite the
# synthetic payload with real local telemetry (chat titles included) - which is
# exactly the data the public repo must never carry.
if os.environ.get("LLM_TELEMETRY_NO_COLLECT"):
    pass
else:
    subprocess.run([sys.executable, "-m", "llm_telemetry.collect_analytics", "-o", DATA], check=True)
    # Router config is small and changes only when you edit config.yaml, so it is
    # baked into the page rather than polled. Regenerated on every build, so the
    # help page cannot drift from the config the agent actually loads.
    subprocess.run([sys.executable, "-m", "llm_telemetry.collect_router",
                    str(CFG.reports_dir / "router-data.json")], check=True)
from .schema import SCHEMA_VERSION  # noqa: E402
from .webassets import inline_js, read_css, read_shell  # noqa: E402 - after module-level build-time subprocess calls


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


data = _load_versioned(DATA)
data["router"] = _load_versioned(CFG.reports_dir / "router-data.json")["profiles"]


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
         # P7-05 (#112): the interval VALUES IN EFFECT right now (config
         # override or default), separate from "tariff"/"defaults" (the
         # power-model Settings card's own SET_DEFAULTS derives from
         # "defaults" and requires every one of its keys present in a
         # /api/settings reply -- these live in their own key so they
         # never widen that card's own required-key set) -- the page reads
         # these to seed its own live setInterval calls without waiting
         # on a /api/settings round trip.
         "intervals": {"live_poll_interval_s": getattr(CFG, "live_poll_interval_s", _d.live_poll_interval_s),
                       "analytics_rebuild_interval_s": getattr(CFG, "analytics_rebuild_interval_s", _d.analytics_rebuild_interval_s)},
         "interval_defaults": {"live_poll_interval_s": _d.live_poll_interval_s,
                                "analytics_rebuild_interval_s": _d.analytics_rebuild_interval_s}}
_DASHBOARD_CSS = read_css()
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
