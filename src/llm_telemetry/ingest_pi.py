#!/usr/bin/env python3
"""Ingest PI agent sessions into the analytics store.

CLI entry point for LST-241: Dynamic PI agent discovery + PI session ingestion.

Usage:
    llm-telemetry ingest-pi          # Ingest all PI agents to default store
    llm-telemetry ingest-pi --db /path/to/db.sqlite3  # Custom store path
"""

import argparse
import json
import logging
import sys
from pathlib import Path

from .collect_pi_agents import ingest_pi_agents, discover_pi_agents
from .analytics_store import get_store


def main(argv=None):
    """Ingest PI agent sessions into the analytics store."""
    ap = argparse.ArgumentParser(
        prog="llm-telemetry ingest-pi",
        description="Ingest PI agent sessions into the analytics store.",
    )
    ap.add_argument(
        "--db",
        type=str,
        default="~/.local/share/llm-telemetry/analytics.db",
        help="Path to analytics SQLite database (default: ~/.local/share/llm-telemetry/analytics.db)",
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

    # Discover PI agents
    agents = discover_pi_agents()
    if not agents:
        logger.warning("No PI agents found in ~/.pi/")
        print(json.dumps({"agents": [], "total_events": 0, "total_edges": 0}))
        return 0

    logger.info(f"Discovered {len(agents)} PI agents: {', '.join(agents)}")

    # Ingest all sessions
    total_events = ingest_pi_agents(store)
    logger.info(f"Ingested {total_events} PI session events")

    # Get statistics if requested
    result = {
        "agents": agents,
        "total_events": total_events,
    }

    if args.stats:
        stats = store.get_statistics()
        result["statistics"] = stats
        logger.info(f"Store statistics: {json.dumps(stats, indent=2)}")

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
