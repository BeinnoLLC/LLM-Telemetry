#!/usr/bin/env python3
"""Generate the deterministic ingest parity fixture (T-18, LLMTELEMET-289).

Usage: make_ingest_fixture.py OUT_DIR

Writes a synthetic HOME containing a .pi agent tree and a .hermes tree (a
default state.db plus two named profiles). The sessions cover normal rows,
rows the parsers skip, duplicate raw-event identities and orchestration
signals. Every value is a fixed literal: no clock, no network, no real user
paths, no real host addresses.
"""
import json
import os
import sqlite3
import sys

SESSION_COLUMNS = [
    "id", "session_id", "started_at", "chat_id", "model", "billing_provider",
    "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens",
    "actual_cost_usd", "message_count", "tool_call_count", "errors", "workspace_id",
]
USAGE_COLUMNS = ["session_id", "tool_name", "name", "model"]


def write_jsonl(path, events):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        for event in events:
            fh.write(json.dumps(event, sort_keys=True) + "\n")


def write_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def write_state_db(path, sessions, usage):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    con = sqlite3.connect(path)
    try:
        con.execute(
            "CREATE TABLE sessions (%s)" % ", ".join(SESSION_COLUMNS)
        )
        con.execute(
            "CREATE TABLE session_model_usage (%s)" % ", ".join(USAGE_COLUMNS)
        )
        for row in sessions:
            values = [row.get(col) for col in SESSION_COLUMNS]
            con.execute(
                "INSERT INTO sessions (%s) VALUES (%s)"
                % (", ".join(SESSION_COLUMNS), ", ".join("?" for _ in SESSION_COLUMNS)),
                values,
            )
        for row in usage:
            values = [row.get(col) for col in USAGE_COLUMNS]
            con.execute(
                "INSERT INTO session_model_usage (%s) VALUES (%s)"
                % (", ".join(USAGE_COLUMNS), ", ".join("?" for _ in USAGE_COLUMNS)),
                values,
            )
        con.commit()
    finally:
        con.close()


def main(argv):
    if len(argv) != 1:
        sys.stderr.write("usage: make_ingest_fixture.py OUT_DIR\n")
        return 2
    out = os.path.abspath(argv[0])
    home = os.path.join(out, "home")
    pi = os.path.join(home, ".pi")
    hermes = os.path.join(home, ".hermes")

    # PI: two agents with real sessions plus files the parser must skip.
    write_jsonl(os.path.join(pi, "agent-alpha", "sessions", "pi-1.jsonl"), [
        {"type": "session", "id": "pi-1", "timestamp": "2026-11-20T09:30:00Z", "cwd": "/work/parity/pi-alpha"},
        {"type": "model_change", "provider": "provider-pi", "modelId": "model-pi"},
        {"type": "thinking_level_change", "thinkingLevel": "medium"},
        {"type": "message", "message": {"role": "assistant", "content": "Use a subagent and hermes handoff."},
         "usage": {"input": 20, "output": 5, "totalTokens": 25, "cost": {"total": 0.25}}},
    ])
    write_jsonl(os.path.join(pi, "agent-beta", "sessions", "pi-2.jsonl"), [
        {"type": "session", "id": "pi-2", "timestamp": "2026-11-20T09:35:00Z", "cwd": "/work/parity/pi-beta"},
        {"type": "message", "message": {"role": "assistant", "content": "Ordinary work, no orchestration signal."},
         "usage": {"input": 8, "output": 2, "totalTokens": 10, "cost": {"total": 0.05}}},
    ])
    write_text(os.path.join(pi, "agent-alpha", "sessions", "broken.jsonl"), "not json\n")
    write_text(os.path.join(pi, "agent-beta", "sessions", "empty.jsonl"), "")
    os.makedirs(os.path.join(pi, "agent-empty", "sessions"), exist_ok=True)

    # Hermes default profile: normal rows, a duplicate identity, skipped rows
    # and all the orchestration-signal shapes the Node port must reproduce.
    write_state_db(
        os.path.join(hermes, "state.db"),
        [
            {
                "id": "ing-def-1", "started_at": "2026-11-20T10:00:00.123456Z",
                "chat_id": "chat-default", "model": "model-a", "billing_provider": "provider-a",
                "input_tokens": 12, "output_tokens": "3", "cache_read_tokens": 2,
                "cache_write_tokens": 1, "actual_cost_usd": "0.125",
                "message_count": "4", "tool_call_count": 2, "errors": 0,
                "workspace_id": "ws-default",
            },
            {
                "id": "ing-def-2", "started_at": 1795168100.5, "chat_id": None,
                "model": "model-b", "billing_provider": "provider-b",
                "input_tokens": 7.9, "output_tokens": 2, "cache_read_tokens": 1,
                "cache_write_tokens": 0, "actual_cost_usd": 0.25,
                "message_count": 3, "tool_call_count": 1,
            },
            # Same identity as ing-def-2: the raw event is a duplicate, but
            # its NULL-target edges are still written in both runtimes.
            {
                "id": "ing-def-2", "started_at": 1795168100.5, "chat_id": "chat-duplicate",
                "model": "model-b", "billing_provider": "provider-b",
                "input_tokens": 7.9, "output_tokens": 2, "actual_cost_usd": 0.25,
            },
            # Skipped by the parser: no id.
            {"id": "", "session_id": "", "started_at": 1795168101},
            # Skipped by the parser: int("oops") fails.
            {"id": "ing-bad", "started_at": 1795168102, "input_tokens": "oops"},
        ],
        [
            {"session_id": "ing-def-1", "tool_name": "delegate_task", "name": None, "model": None},
            {"session_id": "ing-def-1", "tool_name": "switch_profile", "name": None, "model": "model-a"},
            {"session_id": "ing-def-2", "tool_name": None, "name": "subagent.dispatch", "model": None},
            {"session_id": "ing-def-2", "tool_name": "delegate_to_profile", "name": None, "model": None},
        ],
    )

    # Two named profiles; unicode is avoided so the sidecar stays ASCII.
    write_state_db(
        os.path.join(hermes, "profiles", "alpha", "state.db"),
        [{
            "id": "ing-alpha-1", "started_at": 1795168200, "chat_id": "chat-alpha",
            "model": "model-alpha", "billing_provider": "provider-alpha",
            "input_tokens": 30, "output_tokens": 8, "cache_read_tokens": 4,
            "cache_write_tokens": 0, "actual_cost_usd": "0.5",
            "message_count": 6, "tool_call_count": 2,
        }],
        [{"session_id": "ing-alpha-1", "tool_name": "delegate_and_switch_profile", "name": None, "model": None}],
    )
    write_state_db(
        os.path.join(hermes, "profiles", "beta", "state.db"),
        [{
            "id": "ing-beta-1", "started_at": "2026-11-20T10:10:00Z", "chat_id": "chat-beta",
            "model": "model-beta", "billing_provider": "provider-beta",
            "input_tokens": 5, "output_tokens": 1, "cache_read_tokens": 0,
            "cache_write_tokens": 0, "actual_cost_usd": 0.0,
            "message_count": 2, "tool_call_count": 0,
        }],
        [],
    )

    sys.stdout.write(home + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
