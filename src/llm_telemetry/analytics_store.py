"""Independent durable SQLite analytics store for LLM telemetry.

Persists raw events from Hermes and PI agents in a standalone database
outside ~/.hermes/state.db, so data survives user clearing Hermes state.
Supports:
  - Raw event ingestion (source, profile, agent, session, timestamp, type, payload)
  - Orchestration signal storage (agent triggers, cross-profile calls, handoffs)
  - Flexible schema for future signal types
  - Archival writes on every collection run
"""

from __future__ import annotations

import json
import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from enum import Enum


class EventSource(Enum):
    """Origin of the event: Hermes profile, PI agent, or external."""
    HERMES = "hermes"
    PI = "pi"
    EXTERNAL = "external"


class EventType(Enum):
    """Type of event being recorded."""
    SESSION_START = "session_start"
    SESSION_END = "session_end"
    TOOL_CALL = "tool_call"
    SUBAGENT_SPAWN = "subagent_spawn"  # delegate_task call
    CROSS_PROFILE_CALL = "cross_profile_call"  # Hermes calling another profile
    HERMES_PI_TRIGGER = "hermes_pi_trigger"  # Hermes triggering PI
    PI_PI_TRIGGER = "pi_pi_trigger"  # PI agent triggering another PI agent
    MODEL_SELECTION = "model_selection"  # Router model choice
    ERROR = "error"
    HEARTBEAT = "heartbeat"


@dataclass
class RawEvent:
    """A single raw event from any agent source."""
    source: EventSource  # hermes, pi, external
    profile_or_agent: str  # Hermes profile name or PI agent name
    session_id: str  # Session or request ID
    timestamp: float  # Unix timestamp (seconds)
    event_type: EventType  # Type of event
    payload: dict[str, Any]  # Flexible JSON payload (cost, tokens, trigger target, etc.)
    workspace_id: Optional[str] = None  # For Hermes profiles, the workspace ID if known


class AnalyticsStore:
    """Standalone SQLite database for raw telemetry and orchestration signals.
    
    Thread-safe writes via a connection pool. Stores all events durably and
    exposes orchestration relationships for visualization.
    """

    def __init__(self, db_path: str | Path = "~/.local/share/llm-telemetry/analytics.db"):
        """Initialize the analytics store at the given path.
        
        Args:
            db_path: Path to the SQLite database. Expands ~ and env vars.
                     Created with parent dirs if needed.
        """
        self.db_path = Path(db_path).expanduser().resolve()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._lock = threading.Lock()
        self._init_schema()

    def _get_conn(self) -> sqlite3.Connection:
        """Get a thread-local database connection."""
        if not hasattr(self._local, 'conn') or self._local.conn is None:
            conn = sqlite3.connect(str(self.db_path))
            conn.row_factory = sqlite3.Row
            self._local.conn = conn
        return self._local.conn

    def _init_schema(self) -> None:
        """Create tables if they don't exist."""
        conn = self._get_conn()
        cursor = conn.cursor()

        # Raw events table: comprehensive event log
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS raw_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source TEXT NOT NULL,
                profile_or_agent TEXT NOT NULL,
                session_id TEXT NOT NULL,
                timestamp REAL NOT NULL,
                event_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                workspace_id TEXT,
                created_at REAL NOT NULL,
                UNIQUE (source, profile_or_agent, session_id, timestamp, event_type)
            )
        """)

        # Orchestration edges: detected agent-triggers-agent relationships
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS orchestration_edges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp REAL NOT NULL,
                trigger_source TEXT NOT NULL,
                trigger_profile_or_agent TEXT NOT NULL,
                trigger_session_id TEXT NOT NULL,
                triggered_target TEXT NOT NULL,
                triggered_agent_or_profile TEXT,
                signal_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at REAL NOT NULL,
                UNIQUE (trigger_source, trigger_profile_or_agent, trigger_session_id,
                        triggered_target, triggered_agent_or_profile, timestamp)
            )
        """)

        # Indices for fast queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_raw_events_source_profile
            ON raw_events (source, profile_or_agent)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_raw_events_session_timestamp
            ON raw_events (session_id, timestamp)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_raw_events_event_type
            ON raw_events (event_type)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_orchestration_edges_timestamp
            ON orchestration_edges (timestamp)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_orchestration_edges_trigger
            ON orchestration_edges (trigger_source, trigger_profile_or_agent)
        """)

        conn.commit()

    def write_event(self, event: RawEvent) -> int:
        """Write a raw event to the store. Returns the row ID.
        
        Raises:
            sqlite3.IntegrityError if the event is a duplicate (same source,
                profile, session, timestamp, event_type).
        """
        conn = self._get_conn()
        cursor = conn.cursor()
        now = datetime.now().timestamp()

        try:
            cursor.execute("""
                INSERT INTO raw_events
                (source, profile_or_agent, session_id, timestamp, event_type, payload, workspace_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                event.source.value,
                event.profile_or_agent,
                event.session_id,
                event.timestamp,
                event.event_type.value,
                json.dumps(event.payload),
                event.workspace_id,
                now,
            ))
            conn.commit()
            last_id = cursor.lastrowid
            return last_id if last_id is not None else -1
        except sqlite3.IntegrityError:
            # Duplicate event; silently skip
            return -1

    def write_orchestration_edge(
        self,
        timestamp: float,
        trigger_source: EventSource,
        trigger_profile_or_agent: str,
        trigger_session_id: str,
        triggered_target: str,  # e.g., "pi:agent-pv" or "hermes:research"
        triggered_agent_or_profile: Optional[str] = None,
        signal_type: str = "unknown",
        payload: Optional[dict[str, Any]] = None,
    ) -> int:
        """Record a detected orchestration signal (agent triggering another agent).
        
        Args:
            timestamp: Unix timestamp of the trigger event.
            trigger_source: EventSource of the triggering agent.
            trigger_profile_or_agent: Name of the agent doing the triggering.
            trigger_session_id: Session ID of the trigger event.
            triggered_target: Full target identifier (e.g., "pi:agent-pv", "hermes:research").
            triggered_agent_or_profile: Parsed target name (e.g., "agent-pv", "research").
            signal_type: Type of signal (e.g., "delegate_task", "cross_profile_call", "hermes_pi_trigger").
            payload: Optional extra data (cost, token count, etc.).
        
        Returns:
            The row ID of the inserted edge, or -1 if it's a duplicate.
        """
        conn = self._get_conn()
        cursor = conn.cursor()
        now = datetime.now().timestamp()
        payload_json = json.dumps(payload or {})

        try:
            cursor.execute("""
                INSERT INTO orchestration_edges
                (timestamp, trigger_source, trigger_profile_or_agent, trigger_session_id,
                 triggered_target, triggered_agent_or_profile, signal_type, payload, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                timestamp,
                trigger_source.value,
                trigger_profile_or_agent,
                trigger_session_id,
                triggered_target,
                triggered_agent_or_profile,
                signal_type,
                payload_json,
                now,
            ))
            conn.commit()
            return cursor.lastrowid if cursor.lastrowid is not None else -1
        except sqlite3.IntegrityError:
            return -1

    def get_raw_events(
        self,
        source: Optional[EventSource] = None,
        profile_or_agent: Optional[str] = None,
        event_type: Optional[EventType] = None,
        session_id: Optional[str] = None,
        since_timestamp: Optional[float] = None,
        limit: int = 1000,
    ) -> list[dict[str, Any]]:
        """Query raw events with optional filters.
        
        Args:
            source: Filter by event source.
            profile_or_agent: Filter by profile or agent name.
            event_type: Filter by event type.
            session_id: Filter by session ID.
            since_timestamp: Filter to events at or after this timestamp.
            limit: Max rows to return.
        
        Returns:
            List of event dicts.
        """
        conn = self._get_conn()
        cursor = conn.cursor()

        query = "SELECT * FROM raw_events WHERE 1=1"
        params: list[Any] = []

        if source:
            query += " AND source = ?"
            params.append(source.value)
        if profile_or_agent:
            query += " AND profile_or_agent = ?"
            params.append(profile_or_agent)
        if event_type:
            query += " AND event_type = ?"
            params.append(event_type.value)
        if session_id:
            query += " AND session_id = ?"
            params.append(session_id)
        if since_timestamp is not None:
            query += " AND timestamp >= ?"
            params.append(since_timestamp)

        query += " ORDER BY timestamp DESC LIMIT ?"
        params.append(limit)

        cursor.execute(query, params)
        rows = cursor.fetchall()
        return [
            {
                'id': row['id'],
                'source': row['source'],
                'profile_or_agent': row['profile_or_agent'],
                'session_id': row['session_id'],
                'timestamp': row['timestamp'],
                'event_type': row['event_type'],
                'payload': json.loads(row['payload']),
                'workspace_id': row['workspace_id'],
                'created_at': row['created_at'],
            }
            for row in rows
        ]

    def get_orchestration_edges(
        self,
        trigger_source: Optional[EventSource] = None,
        trigger_profile_or_agent: Optional[str] = None,
        signal_type: Optional[str] = None,
        since_timestamp: Optional[float] = None,
        limit: int = 1000,
    ) -> list[dict[str, Any]]:
        """Query orchestration edges (detected agent-triggers-agent relationships).
        
        Args:
            trigger_source: Filter by source of triggering agent.
            trigger_profile_or_agent: Filter by name of triggering agent.
            signal_type: Filter by signal type (e.g., "delegate_task").
            since_timestamp: Filter to edges at or after this timestamp.
            limit: Max rows to return.
        
        Returns:
            List of edge dicts.
        """
        conn = self._get_conn()
        cursor = conn.cursor()

        query = "SELECT * FROM orchestration_edges WHERE 1=1"
        params: list[Any] = []

        if trigger_source:
            query += " AND trigger_source = ?"
            params.append(trigger_source.value)
        if trigger_profile_or_agent:
            query += " AND trigger_profile_or_agent = ?"
            params.append(trigger_profile_or_agent)
        if signal_type:
            query += " AND signal_type = ?"
            params.append(signal_type)
        if since_timestamp is not None:
            query += " AND timestamp >= ?"
            params.append(since_timestamp)

        query += " ORDER BY timestamp DESC LIMIT ?"
        params.append(limit)

        cursor.execute(query, params)
        rows = cursor.fetchall()
        return [
            {
                'id': row['id'],
                'timestamp': row['timestamp'],
                'trigger_source': row['trigger_source'],
                'trigger_profile_or_agent': row['trigger_profile_or_agent'],
                'trigger_session_id': row['trigger_session_id'],
                'triggered_target': row['triggered_target'],
                'triggered_agent_or_profile': row['triggered_agent_or_profile'],
                'signal_type': row['signal_type'],
                'payload': json.loads(row['payload']),
                'created_at': row['created_at'],
            }
            for row in rows
        ]

    def get_statistics(self) -> dict[str, Any]:
        """Return aggregate statistics about stored data."""
        conn = self._get_conn()
        cursor = conn.cursor()

        # Event counts by source
        cursor.execute("""
            SELECT source, COUNT(*) as count
            FROM raw_events
            GROUP BY source
        """)
        events_by_source = {row['source']: row['count'] for row in cursor.fetchall()}

        # Event counts by type
        cursor.execute("""
            SELECT event_type, COUNT(*) as count
            FROM raw_events
            GROUP BY event_type
        """)
        events_by_type = {row['event_type']: row['count'] for row in cursor.fetchall()}

        # Orchestration edges by signal type
        cursor.execute("""
            SELECT signal_type, COUNT(*) as count
            FROM orchestration_edges
            GROUP BY signal_type
        """)
        orchestration_by_type = {row['signal_type']: row['count'] for row in cursor.fetchall()}

        # Total counts
        cursor.execute("SELECT COUNT(*) as count FROM raw_events")
        total_events = cursor.fetchone()['count']

        cursor.execute("SELECT COUNT(*) as count FROM orchestration_edges")
        total_edges = cursor.fetchone()['count']

        return {
            'total_events': total_events,
            'events_by_source': events_by_source,
            'events_by_type': events_by_type,
            'total_orchestration_edges': total_edges,
            'orchestration_by_type': orchestration_by_type,
            'db_path': str(self.db_path),
        }

    def close(self) -> None:
        """Close the database connection."""
        if hasattr(self._local, 'conn') and self._local.conn:
            self._local.conn.close()
            self._local.conn = None


# Global singleton store instance
_store: Optional[AnalyticsStore] = None
_store_lock = threading.Lock()


def get_store(db_path: str | Path = "~/.local/share/llm-telemetry/analytics.db") -> AnalyticsStore:
    """Get or create the global analytics store singleton."""
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = AnalyticsStore(db_path)
    return _store
