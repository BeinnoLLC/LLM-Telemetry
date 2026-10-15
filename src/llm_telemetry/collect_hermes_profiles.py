"""Collect telemetry from Hermes profiles and ingest into analytics store.

Hermes stores session data in SQLite databases:
  - ~/.hermes/state.db (default profile sessions)
  - ~/.hermes/profiles/*/state.db (named profile sessions)

This module:
  - Discovers all profiles and their state.db files
  - Reads session records from the state.db schema
  - Extracts usage metrics (tokens, cost, model, profile)
  - Detects orchestration signals (subagent spawns, cross-profile calls, etc.)
  - Writes raw events to the analytics store
"""

from __future__ import annotations

import json
import logging
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from .analytics_store import (
    AnalyticsStore,
    EventSource,
    EventType,
    RawEvent,
    get_store,
)

logger = logging.getLogger(__name__)


@dataclass
class HermesSession:
    """Parsed Hermes session metadata from state.db."""
    profile_name: str  # e.g., "default", "research"
    session_id: str  # Session ID from Hermes
    timestamp: float  # Unix timestamp
    workspace_id: Optional[str] = None  # Workspace ID if recorded
    model: Optional[str] = None  # Model used
    provider: Optional[str] = None  # Provider (ollama, openai, etc.)
    total_tokens: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_cost: float = 0.0
    message_count: int = 0
    tool_calls: int = 0
    errors: int = 0


def discover_hermes_profiles() -> list[tuple[str, Path]]:
    """Discover all Hermes profiles with state.db.
    
    Returns:
        List of (profile_name, state_db_path) tuples.
    """
    hermes_home = Path.home() / ".hermes"
    profiles = []

    # Default profile
    default_db = hermes_home / "state.db"
    if default_db.exists():
        profiles.append(("default", default_db))

    # Named profiles
    profiles_dir = hermes_home / "profiles"
    if profiles_dir.exists():
        for profile_dir in profiles_dir.iterdir():
            if profile_dir.is_dir():
                state_db = profile_dir / "state.db"
                if state_db.exists():
                    profiles.append((profile_dir.name, state_db))

    return sorted(profiles)


def ingest_hermes_profiles(store: AnalyticsStore | None = None) -> int:
    """Discover and ingest all Hermes profile sessions into the analytics store.
    
    Args:
        store: AnalyticsStore instance. If None, uses the global singleton.
    
    Returns:
        Total number of events written to the store.
    """
    if store is None:
        store = get_store()

    profiles = discover_hermes_profiles()
    if not profiles:
        logger.info("No Hermes profiles found in ~/.hermes/")
        return 0

    total_events = 0

    for profile_name, state_db_path in profiles:
        events_this_profile = 0
        try:
            conn = sqlite3.connect(state_db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            # Query sessions table
            try:
                cursor.execute("""
                    SELECT * FROM sessions
                    ORDER BY started_at DESC
                    LIMIT 1000
                """)
                rows = cursor.fetchall()
            except sqlite3.OperationalError as e:
                logger.debug(f"No sessions table in {profile_name}: {e}")
                conn.close()
                continue

            for row in rows:
                row_dict = dict(row)
                session = _parse_hermes_session_row(profile_name, row_dict)
                if session:
                    event = RawEvent(
                        source=EventSource.HERMES,
                        profile_or_agent=profile_name,
                        session_id=session.session_id,
                        timestamp=session.timestamp,
                        event_type=EventType.SESSION_START,
                        payload={
                            "workspace_id": session.workspace_id,
                            "model": session.model,
                            "provider": session.provider,
                            "tokens": {
                                "input": session.input_tokens,
                                "output": session.output_tokens,
                                "total": session.total_tokens,
                            },
                            "cost": {
                                "total": session.total_cost,
                            },
                            "message_count": session.message_count,
                            "tool_calls": session.tool_calls,
                            "errors": session.errors,
                        },
                        workspace_id=session.workspace_id,
                    )
                    row_id = store.write_event(event)
                    if row_id > 0:
                        total_events += 1
                        events_this_profile += 1
                        logger.debug(f"Ingested Hermes session {profile_name}/{session.session_id}")

                    # Detect orchestration signals from this session
                    _detect_hermes_orchestration_signals(session, store, cursor)

            if events_this_profile > 0:
                logger.info(f"Ingested {events_this_profile} sessions from {profile_name} profile")

            conn.close()

        except (sqlite3.Error, OSError) as e:
            logger.warning(f"Failed to ingest from {profile_name}: {e}")
            continue

    return total_events


def _parse_hermes_session_row(profile_name: str, row: dict[str, Any]) -> Optional[HermesSession]:
    """Parse a single session row from Hermes state.db.
    
    Hermes sessions table has detailed schema with: id, started_at, model,
    message_count, tool_call_count, input/output/cache/reasoning tokens,
    actual_cost_usd, profile_name, etc.
    """
    try:
        session_id = row.get("id") or row.get("session_id") or ""
        if not session_id:
            return None

        # Parse timestamp - Hermes uses started_at
        timestamp = None
        if "started_at" in row and row["started_at"]:
            try:
                val = row["started_at"]
                if isinstance(val, (int, float)):
                    timestamp = float(val)
                else:
                    dt = datetime.fromisoformat(str(val).replace("Z", "+00:00"))
                    timestamp = dt.timestamp()
            except (ValueError, TypeError):
                timestamp = datetime.now(timezone.utc).timestamp()
        else:
            timestamp = datetime.now(timezone.utc).timestamp()

        session = HermesSession(
            profile_name=profile_name,
            session_id=session_id,
            timestamp=timestamp,
            workspace_id=row.get("chat_id"),  # Hermes uses chat_id for workspace-like grouping
            model=row.get("model"),
            provider=row.get("billing_provider") or "unknown",
        )

        # Extract token usage if available
        if "input_tokens" in row and row["input_tokens"]:
            session.input_tokens = int(row["input_tokens"])
        if "output_tokens" in row and row["output_tokens"]:
            session.output_tokens = int(row["output_tokens"])
        if "cache_read_tokens" in row and row["cache_read_tokens"]:
            session.total_tokens += int(row["cache_read_tokens"])
        if "cache_write_tokens" in row and row["cache_write_tokens"]:
            session.total_tokens += int(row["cache_write_tokens"])

        # Total = input + output + cache
        session.total_tokens = session.input_tokens + session.output_tokens

        # Extract cost
        if "actual_cost_usd" in row and row["actual_cost_usd"]:
            session.total_cost = float(row["actual_cost_usd"])

        # Extract message/tool counts
        if "message_count" in row and row["message_count"]:
            session.message_count = int(row["message_count"])
        if "tool_call_count" in row and row["tool_call_count"]:
            session.tool_calls = int(row["tool_call_count"])

        return session

    except (ValueError, TypeError, KeyError) as e:
        logger.debug(f"Failed to parse Hermes session row: {e}")
        return None


def _detect_hermes_orchestration_signals(
    session: HermesSession,
    store: AnalyticsStore,
    cursor: sqlite3.Cursor,
) -> None:
    """Analyze a Hermes session for orchestration signals.
    
    Look for:
    - Subagent spawns (delegate_task calls)
    - Cross-profile calls (profile switching)
    - Hermes→PI triggers
    
    Args:
        session: The parsed Hermes session.
        store: The analytics store to write edges to.
        cursor: Database cursor for querying related data.
    """
    # Try to query session_model_usage or other related tables for tool calls
    try:
        cursor.execute("""
            SELECT * FROM session_model_usage
            WHERE session_id = ?
            LIMIT 100
        """, (session.session_id,))
        tool_rows = cursor.fetchall()

        for tool_row in tool_rows:
            row_dict = dict(tool_row)
            tool_name = row_dict.get("tool_name") or row_dict.get("name") or ""

            # Detect subagent spawn (delegate_task)
            if "delegate" in tool_name.lower() or "subagent" in tool_name.lower():
                store.write_orchestration_edge(
                    timestamp=session.timestamp,
                    trigger_source=EventSource.HERMES,
                    trigger_profile_or_agent=session.profile_name,
                    trigger_session_id=session.session_id,
                    triggered_target="hermes:*",
                    signal_type="subagent_spawn",
                    payload={
                        "tool_name": tool_name,
                        "model": session.model,
                    },
                )

            # Detect cross-profile calls
            if "profile" in tool_name.lower() or "switch" in tool_name.lower():
                store.write_orchestration_edge(
                    timestamp=session.timestamp,
                    trigger_source=EventSource.HERMES,
                    trigger_profile_or_agent=session.profile_name,
                    trigger_session_id=session.session_id,
                    triggered_target="hermes:*",
                    signal_type="cross_profile_call",
                    payload={
                        "tool_name": tool_name,
                        "model": session.model,
                    },
                )

    except sqlite3.OperationalError:
        # Table doesn't exist in this version
        pass
