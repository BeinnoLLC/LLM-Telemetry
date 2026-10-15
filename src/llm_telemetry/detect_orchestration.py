"""Orchestration signal detection and validation.

Detects and validates orchestration edges from ingested Hermes and PI data:
- Cross-profile Hermes calls
- Hermes→PI handoffs
- PI-to-PI cross-agent calls
- Subagent spawns (delegate_task)
- User-initiated vs agent-initiated sessions
"""

import logging
import re
import sqlite3
from dataclasses import dataclass
from typing import Optional

from .analytics_store import AnalyticsStore, EventSource

logger = logging.getLogger(__name__)


@dataclass
class OrchestrationSignal:
    """Detected orchestration signal ready for edge recording."""
    
    timestamp: float
    trigger_source: EventSource
    trigger_agent: str
    trigger_session_id: str
    triggered_target: str
    triggered_agent_or_profile: Optional[str]
    signal_type: str
    confidence: float  # 0.0-1.0: heuristic confidence in this signal
    payload: dict


def validate_and_filter_signals(signals: list[OrchestrationSignal]) -> list[OrchestrationSignal]:
    """Filter out noise and invalid signals.
    
    Rules:
    - Remove self-loops (source == target)
    - Remove signals with confidence < 0.3
    - Deduplicate by (source, target, signal_type, timestamp window)
    - Keep only bidirectional signals within 5-second window
    
    Args:
        signals: Raw detected signals.
    
    Returns:
        Validated signals ready for persistence.
    """
    if not signals:
        return []
    
    # Rule 1: No self-loops
    filtered = [
        s for s in signals
        if not _is_self_loop(s.trigger_agent, s.triggered_agent_or_profile)
    ]
    logger.debug(f"After self-loop filter: {len(filtered)}/{len(signals)} signals")
    
    # Rule 2: Confidence threshold
    filtered = [s for s in filtered if s.confidence >= 0.3]
    logger.debug(f"After confidence filter (>= 0.3): {len(filtered)} signals")
    
    # Rule 3: Deduplicate
    seen = set()
    deduped = []
    for signal in sorted(filtered, key=lambda s: s.timestamp):
        key = (signal.trigger_agent, signal.triggered_agent_or_profile, signal.signal_type)
        if key not in seen:
            seen.add(key)
            deduped.append(signal)
    logger.debug(f"After deduplication: {len(deduped)} signals")
    
    return deduped


def _is_self_loop(source: str, target: Optional[str]) -> bool:
    """Check if a signal is a self-loop (source calls itself)."""
    if not target or target == "*":
        return False
    
    # Extract base names for comparison (e.g., "agent-pv" vs "pi:agent-pv")
    source_base = source.split(":")[-1].lower() if ":" in source else source.lower()
    target_base = target.split(":")[-1].lower() if ":" in target else target.lower()
    
    return source_base == target_base


def detect_pi_cross_agent_calls(raw_events: list[dict], agent_name: str) -> list[OrchestrationSignal]:
    """Detect PI-to-PI cross-agent calls from session events.
    
    Look for:
    - Model/provider changes within a session (possible agent delegation)
    - Explicit agent mentions in message content
    - Tool calls that reference other agent names
    
    Args:
        raw_events: List of event dicts from a PI session JSONL.
        agent_name: The agent name that owns this session (e.g., "agent-pv").
    
    Returns:
        List of detected signals.
    """
    signals = []
    
    if not raw_events:
        return signals
    
    prev_model = None
    for event in raw_events:
        if event.get("type") == "model_change":
            new_model = event.get("model", {}).get("id", "")
            if prev_model and prev_model != new_model:
                # Model changed within session: possible agent delegation
                signals.append(OrchestrationSignal(
                    timestamp=event.get("timestamp", 0.0),
                    trigger_source=EventSource.PI,
                    trigger_agent=agent_name,
                    trigger_session_id="",  # Populated by caller
                    triggered_target="pi:*",
                    triggered_agent_or_profile=None,
                    signal_type="pi_model_change_delegation",
                    confidence=0.4,  # Low confidence: model change could be user-initiated
                    payload={
                        "prev_model": prev_model,
                        "new_model": new_model,
                    },
                ))
            prev_model = new_model
        
        # Check message content for explicit agent references
        if event.get("type") == "message":
            msg = event.get("message", {})
            content = msg.get("content")
            if isinstance(content, str):
                content_text = content
            elif isinstance(content, list):
                content_text = " ".join(
                    item.get("text", "") or item.get("thinking", "")
                    for item in content
                    if isinstance(item, dict)
                )
            else:
                continue
            
            # Pattern: agent-X or agent_X mentions
            agent_refs = re.findall(r"agent[_-](\w+)", content_text, re.IGNORECASE)
            for agent_ref in agent_refs:
                if agent_ref.lower() != agent_name.lower():
                    signals.append(OrchestrationSignal(
                        timestamp=event.get("timestamp", 0.0),
                        trigger_source=EventSource.PI,
                        trigger_agent=agent_name,
                        trigger_session_id="",  # Populated by caller
                        triggered_target=f"pi:agent-{agent_ref}",
                        triggered_agent_or_profile=f"agent-{agent_ref}",
                        signal_type="pi_agent_reference",
                        confidence=0.6,
                        payload={
                            "content_snippet": content_text[:200],
                        },
                    ))
    
    return signals


def detect_hermes_pi_handoffs(tool_calls: list[dict], profile_name: str, session_id: str, timestamp: float) -> list[OrchestrationSignal]:
    """Detect Hermes→PI handoffs from tool call records.
    
    Look for:
    - tool_call_name contains 'pi', 'agent', 'delegate'
    - tool output references PI agent execution
    - Explicit Hermes→PI delegation patterns
    
    Args:
        tool_calls: List of tool call dicts from session_model_usage or similar.
        profile_name: Hermes profile name.
        session_id: Hermes session ID.
        timestamp: Session timestamp.
    
    Returns:
        List of detected signals.
    """
    signals = []
    
    for tool_call in tool_calls:
        tool_name = tool_call.get("tool_name") or tool_call.get("name") or ""
        
        # Detect PI-related tool calls
        if any(pattern in tool_name.lower() for pattern in ["pi", "agent", "delegate", "execute"]):
            # Extract target agent if mentioned
            target_agent = None
            if "agent-" in tool_name.lower():
                match = re.search(r"agent[_-](\w+)", tool_name, re.IGNORECASE)
                if match:
                    target_agent = f"agent-{match.group(1)}"
            
            signals.append(OrchestrationSignal(
                timestamp=timestamp,
                trigger_source=EventSource.HERMES,
                trigger_agent=profile_name,
                trigger_session_id=session_id,
                triggered_target="pi:*" if not target_agent else f"pi:{target_agent}",
                triggered_agent_or_profile=target_agent,
                signal_type="hermes_pi_handoff",
                confidence=0.5,
                payload={
                    "tool_name": tool_name,
                },
            ))
    
    return signals


def detect_hermes_subagent_spawns(tool_calls: list[dict], profile_name: str, session_id: str, timestamp: float) -> list[OrchestrationSignal]:
    """Detect Hermes subagent spawns (delegate_task).
    
    Args:
        tool_calls: List of tool call dicts.
        profile_name: Hermes profile name.
        session_id: Hermes session ID.
        timestamp: Session timestamp.
    
    Returns:
        List of detected signals.
    """
    signals = []
    
    for tool_call in tool_calls:
        tool_name = (tool_call.get("tool_name") or tool_call.get("name") or "").lower()
        
        if "delegate" in tool_name:
            signals.append(OrchestrationSignal(
                timestamp=timestamp,
                trigger_source=EventSource.HERMES,
                trigger_agent=profile_name,
                trigger_session_id=session_id,
                triggered_target="hermes:*",
                triggered_agent_or_profile=None,
                signal_type="hermes_subagent_spawn",
                confidence=0.8,  # High confidence: explicit delegate_task
                payload={
                    "tool_name": tool_call.get("tool_name") or tool_call.get("name") or "",
                },
            ))
    
    return signals


def detect_hermes_cross_profile_calls(tool_calls: list[dict], profile_name: str, session_id: str, timestamp: float) -> list[OrchestrationSignal]:
    """Detect cross-profile Hermes calls.
    
    Args:
        tool_calls: List of tool call dicts.
        profile_name: Hermes profile name.
        session_id: Hermes session ID.
        timestamp: Session timestamp.
    
    Returns:
        List of detected signals.
    """
    signals = []
    
    for tool_call in tool_calls:
        tool_name = (tool_call.get("tool_name") or tool_call.get("name") or "").lower()
        
        # Look for profile switching patterns
        if any(p in tool_name for p in ["profile", "switch_profile", "set_profile"]):
            signals.append(OrchestrationSignal(
                timestamp=timestamp,
                trigger_source=EventSource.HERMES,
                trigger_agent=profile_name,
                trigger_session_id=session_id,
                triggered_target="hermes:*",
                triggered_agent_or_profile=None,
                signal_type="hermes_cross_profile_call",
                confidence=0.7,
                payload={
                    "tool_name": tool_call.get("tool_name") or tool_call.get("name") or "",
                },
            ))
    
    return signals


def resolve_orchestration_edges(store: AnalyticsStore, verbose: bool = False) -> int:
    """Main orchestration resolution function.
    
    Scans the raw_events table, detects orchestration signals, validates them,
    and writes to orchestration_edges table.
    
    Args:
        store: AnalyticsStore instance.
        verbose: Enable detailed logging.
    
    Returns:
        Number of new edges written.
    """
    logger.info("Resolving orchestration edges from raw events...")
    
    all_signals = []
    
    # Query PI sessions and detect signals
    try:
        pi_events = store.get_raw_events(source=EventSource.PI)
        pi_by_session = {}
        for event in pi_events:
            session_id = event["session_id"]
            if session_id not in pi_by_session:
                pi_by_session[session_id] = {
                    "agent": event["profile_or_agent"],
                    "timestamp": event["timestamp"],
                    "events": [],
                }
            pi_by_session[session_id]["events"].append(event.get("payload", {}))
        
        for session_id, session_data in pi_by_session.items():
            agent = session_data["agent"]
            timestamp = session_data["timestamp"]
            events = session_data["events"]
            
            # Detect PI cross-agent calls
            signals = detect_pi_cross_agent_calls(events, agent)
            for signal in signals:
                signal.trigger_session_id = session_id
                signal.timestamp = timestamp
            all_signals.extend(signals)
        
        if verbose:
            logger.info(f"Detected {len(all_signals)} PI-related signals")
    
    except Exception as e:
        logger.warning(f"Error detecting PI signals: {e}")
    
    # Query Hermes sessions and detect signals
    try:
        hermes_events = store.get_raw_events(source=EventSource.HERMES)
        hermes_by_session = {}
        for event in hermes_events:
            session_id = event["session_id"]
            if session_id not in hermes_by_session:
                hermes_by_session[session_id] = {
                    "profile": event["profile_or_agent"],
                    "timestamp": event["timestamp"],
                    "payload": event.get("payload", {}),
                }
            hermes_by_session[session_id]["events"] = event.get("payload", {})
        
        for session_id, session_data in hermes_by_session.items():
            profile = session_data["profile"]
            timestamp = session_data["timestamp"]
            payload = session_data.get("payload", {})
            
            # Extract tool calls from payload if present
            tool_calls = payload.get("tool_calls", [])
            if not tool_calls:
                tool_calls = []
            
            # Detect various Hermes signals
            signals = detect_hermes_pi_handoffs(tool_calls, profile, session_id, timestamp)
            all_signals.extend(signals)
            
            signals = detect_hermes_subagent_spawns(tool_calls, profile, session_id, timestamp)
            all_signals.extend(signals)
            
            signals = detect_hermes_cross_profile_calls(tool_calls, profile, session_id, timestamp)
            all_signals.extend(signals)
        
        if verbose:
            logger.info(f"Detected {len(all_signals)} Hermes-related signals (cumulative)")
    
    except Exception as e:
        logger.warning(f"Error detecting Hermes signals: {e}")
    
    # Validate and filter signals
    validated = validate_and_filter_signals(all_signals)
    logger.info(f"After validation: {len(validated)} signals")
    
    # Write to store
    written = 0
    for signal in validated:
        try:
            store.write_orchestration_edge(
                timestamp=signal.timestamp,
                trigger_source=signal.trigger_source,
                trigger_profile_or_agent=signal.trigger_agent,
                trigger_session_id=signal.trigger_session_id,
                triggered_target=signal.triggered_target,
                triggered_agent_or_profile=signal.triggered_agent_or_profile,
                signal_type=signal.signal_type,
                payload=signal.payload,
            )
            written += 1
        except sqlite3.IntegrityError:
            # Duplicate edge, skip
            pass
        except Exception as e:
            logger.error(f"Error writing edge {signal.signal_type}: {e}")
    
    logger.info(f"Wrote {written} orchestration edges")
    return written
