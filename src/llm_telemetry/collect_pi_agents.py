"""Collect telemetry from PI agents and ingest into analytics store.

PI agents run under ~/.pi/agent-*/. Each has a sessions/ directory containing
JSONL files with structured session events. This module:
  - Discovers all PI agents dynamically (glob ~/.pi/agent-*/)
  - Reads and parses session JSONL files
  - Extracts usage metrics (tokens, cost, model, provider)
  - Detects orchestration signals (PI-to-PI triggers, Hermes→PI triggers)
  - Writes raw events to the analytics store
"""

from __future__ import annotations

import json
import logging
import re
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
class PISession:
    """Parsed PI agent session metadata."""
    agent_name: str  # e.g., "agent-pv", "agent-sp"
    session_id: str  # Unique session ID from the JSONL
    timestamp: str  # ISO 8601 timestamp
    cwd: str  # Working directory
    model: Optional[str] = None  # Model used (e.g., "scout", "sage")
    provider: Optional[str] = None  # Provider (e.g., "pv", "fireworks")
    thinking_level: Optional[str] = None  # Thinking level
    total_tokens: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    total_cost: float = 0.0
    raw_events: list[dict[str, Any]] = None  # type: ignore # All JSONL entries


def discover_pi_agents() -> list[str]:
    """Discover all PI agents in ~/.pi/.
    
    Returns:
        List of agent directory names (e.g., ["agent", "agent-pv", "agent-sp"]).
    """
    pi_home = Path.home() / ".pi"
    if not pi_home.exists():
        return []

    agents = []
    for agent_dir in pi_home.glob("agent*"):
        if agent_dir.is_dir():
            agents.append(agent_dir.name)
    return sorted(agents)


def parse_pi_session_jsonl(jsonl_path: Path) -> Optional[PISession]:
    """Parse a single PI session JSONL file.
    
    PI session files contain structured JSONL events:
      1. session: metadata (id, timestamp, cwd)
      2. model_change: selected model and provider
      3. thinking_level_change: thinking level
      4. message: user/assistant exchanges
      5. (future: tool calls, etc.)
    
    We extract usage metrics from message events that contain api/usage data.
    
    Args:
        jsonl_path: Path to the JSONL session file.
    
    Returns:
        PISession if parseable, or None if invalid/empty.
    """
    try:
        with open(jsonl_path, "r") as f:
            lines = f.readlines()
    except (OSError, ValueError):
        return None

    if not lines:
        return None

    session = None
    events = []

    try:
        for line in lines:
            line = line.strip()
            if not line:
                continue
            event = json.loads(line)
            events.append(event)

            # Extract session metadata
            if event.get("type") == "session":
                session = PISession(
                    agent_name=jsonl_path.parent.parent.name,  # agent-pv, etc.
                    session_id=event.get("id", ""),
                    timestamp=event.get("timestamp", ""),
                    cwd=event.get("cwd", ""),
                    raw_events=events,
                )
            elif event.get("type") == "model_change":
                if session:
                    session.provider = event.get("provider")
                    session.model = event.get("modelId")
            elif event.get("type") == "thinking_level_change":
                if session:
                    session.thinking_level = event.get("thinkingLevel")
            elif event.get("type") == "message" and session:
                # Extract usage metrics from assistant messages
                msg = event.get("message", {})
                if msg.get("role") == "assistant":
                    usage = event.get("usage", {})
                    if usage:
                        session.input_tokens += usage.get("input", 0)
                        session.output_tokens += usage.get("output", 0)
                        session.cache_read_tokens += usage.get("cacheRead", 0)
                        session.cache_write_tokens += usage.get("cacheWrite", 0)
                        session.total_tokens += usage.get("totalTokens", 0)
                        cost = usage.get("cost", {})
                        if isinstance(cost, dict):
                            session.total_cost += cost.get("total", 0.0)

    except (json.JSONDecodeError, KeyError, TypeError) as e:
        logger.warning(f"Failed to parse PI session {jsonl_path}: {e}")
        return None

    if session and session.session_id:
        return session
    return None


def ingest_pi_agents(store: AnalyticsStore | None = None) -> int:
    """Discover and ingest all PI agent sessions into the analytics store.
    
    Args:
        store: AnalyticsStore instance. If None, uses the global singleton.
    
    Returns:
        Total number of events written to the store.
    """
    if store is None:
        store = get_store()

    agents = discover_pi_agents()
    if not agents:
        logger.info("No PI agents found in ~/.pi/")
        return 0

    total_events = 0

    for agent_name in agents:
        agent_dir = Path.home() / ".pi" / agent_name
        sessions_dir = agent_dir / "sessions"

        if not sessions_dir.exists():
            continue

        # Iterate over all JSONL session files
        for jsonl_path in sessions_dir.rglob("*.jsonl"):
            session = parse_pi_session_jsonl(jsonl_path)
            if not session:
                continue

            # Write a raw event for this session
            event = RawEvent(
                source=EventSource.PI,
                profile_or_agent=agent_name,
                session_id=session.session_id,
                timestamp=_iso_to_unix(session.timestamp),
                event_type=EventType.SESSION_START,
                payload={
                    "cwd": session.cwd,
                    "model": session.model,
                    "provider": session.provider,
                    "thinking_level": session.thinking_level,
                    "tokens": {
                        "input": session.input_tokens,
                        "output": session.output_tokens,
                        "cache_read": session.cache_read_tokens,
                        "cache_write": session.cache_write_tokens,
                        "total": session.total_tokens,
                    },
                    "cost": {
                        "total": session.total_cost,
                    },
                    "jsonl_path": str(jsonl_path),
                },
            )
            row_id = store.write_event(event)
            if row_id > 0:
                total_events += 1
                logger.debug(f"Ingested PI session {agent_name}/{session.session_id}")

            # Detect PI-to-PI or Hermes-to-PI triggers in the message chain
            _detect_orchestration_signals(session, store)

    return total_events


def _detect_orchestration_signals(session: PISession, store: AnalyticsStore) -> None:
    """Analyze a PI session for orchestration signals.
    
    Look for:
    - Cross-agent function calls (e.g., subagent, dispatch_relay mentions)
    - Hermes integration references (Hermes-PI triggers)
    - PI-to-PI agent spawns
    
    Args:
        session: The parsed PI session.
        store: The analytics store to write edges to.
    """
    if not session.raw_events:
        return

    for event in session.raw_events:
        if event.get("type") != "message":
            continue

        msg = event.get("message", {})
        role = msg.get("role")
        content = msg.get("content")

        # Check assistant content for trigger patterns
        if role == "assistant" and isinstance(content, (list, str)):
            if isinstance(content, list):
                content_text = "\n".join(
                    item.get("text", "") or item.get("thinking", "")
                    for item in content
                    if isinstance(item, dict)
                )
            else:
                content_text = content

            # Pattern 1: subagent spawn
            if re.search(r"\bsubagent\b", content_text, re.IGNORECASE):
                _record_orchestration_edge(
                    session,
                    store,
                    triggered_target="pi:*",
                    signal_type="pi_subagent_spawn",
                    content_snippet=content_text[:200],
                )

            # Pattern 2: Hermes interaction (hermes://... or hermes trigger)
            if re.search(r"hermes|delegate_task|hermes://", content_text, re.IGNORECASE):
                _record_orchestration_edge(
                    session,
                    store,
                    triggered_target="hermes:*",
                    signal_type="pi_hermes_interaction",
                    content_snippet=content_text[:200],
                )

            # Pattern 3: dispatch_relay (explicit agent call)
            if re.search(r"dispatch_relay", content_text, re.IGNORECASE):
                _record_orchestration_edge(
                    session,
                    store,
                    triggered_target="pi:relay",
                    signal_type="pi_dispatch_relay",
                    content_snippet=content_text[:200],
                )


def _record_orchestration_edge(
    session: PISession,
    store: AnalyticsStore,
    triggered_target: str,
    signal_type: str,
    content_snippet: str = "",
) -> None:
    """Record a detected orchestration edge."""
    # Extract target agent name from triggered_target (e.g., "pi:agent-sp" -> "agent-sp")
    target_match = re.match(r"^(\w+):(.*)$", triggered_target)
    target_source = target_match.group(1) if target_match else "unknown"
    target_agent = target_match.group(2) if target_match and target_match.group(2) != "*" else None

    store.write_orchestration_edge(
        timestamp=_iso_to_unix(session.timestamp),
        trigger_source=EventSource.PI,
        trigger_profile_or_agent=session.agent_name,
        trigger_session_id=session.session_id,
        triggered_target=triggered_target,
        triggered_agent_or_profile=target_agent,
        signal_type=signal_type,
        payload={
            "model": session.model,
            "thinking_level": session.thinking_level,
            "content_snippet": content_snippet,
        },
    )


def _iso_to_unix(iso_str: str) -> float:
    """Convert ISO 8601 timestamp to Unix timestamp (seconds).
    
    Args:
        iso_str: ISO 8601 string (e.g., "2026-10-15T21:04:25.681Z").
    
    Returns:
        Unix timestamp as float.
    """
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return dt.timestamp()
    except (ValueError, AttributeError):
        # Fallback: use current time
        return datetime.now(timezone.utc).timestamp()
