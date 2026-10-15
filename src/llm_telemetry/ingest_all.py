#!/usr/bin/env python3
"""Ingest all telemetry (PI + Hermes) into the analytics store.

CLI entry point for LST-240 + LST-241: Complete data ingestion pipeline.

Usage:
    llm-telemetry ingest          # Ingest both PI and Hermes to default store
    llm-telemetry ingest --db /path/to/db.sqlite3  # Custom store path
    llm-telemetry ingest --pi-only              # Only ingest PI agents
    llm-telemetry ingest --hermes-only          # Only ingest Hermes profiles
"""

import argparse
import json
import logging
import sys
from pathlib import Path

from .collect_pi_agents import ingest_pi_agents, discover_pi_agents
from .collect_hermes_profiles import ingest_hermes_profiles, discover_hermes_profiles
from .analytics_store import get_store


def main(argv=None):
    """Ingest all telemetry into the analytics store."""
    ap = argparse.ArgumentParser(
        prog="llm-telemetry ingest",
        description="Ingest PI and Hermes telemetry into the analytics store.",
    )
    ap.add_argument(
        "--db",
        type=str,
        default="~/.local/share/llm-telemetry/analytics.db",
        help="Path to analytics SQLite database (default: ~/.local/share/llm-telemetry/analytics.db)",
    )
    ap.add_argument(
        "--pi-only",
        action="store_true",
        help="Only ingest PI agents",
    )
    ap.add_argument(
        "--hermes-only",
        action="store_true",
        help="Only ingest Hermes profiles",
    )
    ap.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Enable verbose logging",
    )
    ap.add_argument(
        "--stats",
        "-s",
        action="store_true",
        help="Print statistics after ingestion",
    )

    args = ap.parse_args(argv)

    # Setup logging
    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger = logging.getLogger(__name__)

    # Expand database path
    db_path = Path(args.db).expanduser()

    # Get or create store
    store = get_store(db_path)
    logger.info(f"Using analytics store: {db_path}")

    pi_agents = []
    hermes_profiles = []
    total_events = 0

    # Ingest PI agents
    if not args.hermes_only:
        pi_agents = discover_pi_agents()
        if pi_agents:
            logger.info(f"Discovered {len(pi_agents)} PI agents: {', '.join(pi_agents)}")
            pi_events = ingest_pi_agents(store)
            total_events += pi_events
            logger.info(f"Ingested {pi_events} PI session events")
        else:
            logger.warning("No PI agents found in ~/.pi/")

    # Ingest Hermes profiles
    if not args.pi_only:
        hermes_profiles = discover_hermes_profiles()
        if hermes_profiles:
            logger.info(f"Discovered {len(hermes_profiles)} Hermes profiles")
            hermes_events = ingest_hermes_profiles(store)
            total_events += hermes_events
            logger.info(f"Ingested {hermes_events} Hermes session events")
        else:
            logger.warning("No Hermes profiles found in ~/.hermes/")

    # Build result
    result = {
        "pi_agents": pi_agents,
        "hermes_profiles": [name for name, _ in hermes_profiles],
        "total_events": total_events,
    }

    # Get statistics if requested
    if args.stats:
        stats = store.get_statistics()
        result["statistics"] = stats
        logger.info(f"Store statistics: {json.dumps(stats, indent=2)}")

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
