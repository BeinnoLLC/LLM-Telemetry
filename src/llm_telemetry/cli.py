"""Command line entry point: `llm-telemetry <command>`.

Subcommands map to the collector/renderer modules. Each is runnable on its own
(`python -m llm_telemetry.build_dashboard`), but the CLI is the documented
surface because it keeps the ordering constraints in one place: the dashboard
build shells out to the analytics collector, and the live feed depends on the
host probe having written its cache at least once.
"""
import argparse
import runpy
import sys


def _run(module, argv):
    """Run a module as __main__ with a synthetic argv.

    The collectors were written as standalone scripts that parse sys.argv, so
    invoking them this way preserves their existing interfaces rather than
    forcing a rewrite into importable main(argv) functions.
    """
    sys.argv = [module] + list(argv)
    runpy.run_module(f"llm_telemetry.{module}", run_name="__main__")


def main():
    ap = argparse.ArgumentParser(
        prog="llm-telemetry",
        description="Observability for local and hosted LLM fleets.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("dashboard", help="build dashboard.html (runs the collectors)")
    sub.add_parser("costs", help="build costs.html (per-1M rate reference)")
    sub.add_parser("live", help="write live-data.json (fast poll feed)")
    sub.add_parser("probe", help="probe inference hosts -> ollama-data.json")
    sub.add_parser("analytics", help="write analytics-data.json only")
    sub.add_parser("router", help="write router-data.json only")
    p_serve = sub.add_parser("serve", help="serve reports/ with no-store headers")
    p_serve.add_argument("port", nargs="?", default=None)
    sub.add_parser("config", help="print the resolved configuration and exit")

    args, rest = ap.parse_known_args()

    if args.cmd == "config":
        from .config import get
        import json as _json
        print(_json.dumps(get().to_dict(), indent=2))
        return

    mods = {
        "dashboard": "build_dashboard",
        "costs": "build_costs",
        "live": "collect_live",
        "probe": "probe_hosts",
        "analytics": "collect_analytics",
        "router": "collect_router",
        "serve": "serve",
    }
    argv = rest
    if args.cmd == "serve" and args.port:
        argv = [str(args.port)] + rest
    _run(mods[args.cmd], argv)


if __name__ == "__main__":
    main()
