#!/usr/bin/env python3
"""Generate the logs + transcripts parity fixture (T-16, LLMTELEMET-287).

Usage: make_logs_fixture.py OUT_DIR

Builds the analytics fixture (state.db with sessions + messages, errors.log,
config) and then adds what the Logs and Transcripts collectors read that the
analytics fixture does not cover: a live session with a long, mixed history
(tool_calls as JSON / invalid JSON / empty, an inactive row, unicode), and a
second titleless session so the session facet label falls back to the id.
"""
import importlib.util
import os
import sqlite3
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def _load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main(argv):
    if len(argv) != 1:
        sys.stderr.write("usage: make_logs_fixture.py OUT_DIR\n")
        return 2
    base = _load("make_analytics_fixture")
    if base.main(argv) != 0:
        return 1
    out = os.path.abspath(argv[0])
    now = int(time.time())
    db = os.path.join(out, "agent", "profiles", "alpha", "state.db")
    con = sqlite3.connect(db)
    for i in range(210):
        calls = None
        if i % 5 == 0:
            calls = '[{"id": "c%d", "function": {"name": "terminal", "arguments": "{}"}}]' % i
        elif i % 7 == 0:
            calls = "not json {"
        con.execute(
            "insert into messages (session_id, role, content, tool_name, tool_calls, timestamp, active)"
            " values (?,?,?,?,?,?,1)",
            ("s-live", "assistant" if i % 2 else "tool", "live msg %d é✓" % i,
             "terminal" if i % 2 == 0 else None, calls, now - 3000 + i))
    con.execute("insert into messages (session_id, role, content, timestamp, active) values (?,?,?,?,0)",
                ("s-live", "user", "inactive row", now - 100))
    con.execute("insert into messages (session_id, role, content, timestamp, active) values (?,?,?,?,1)",
                ("s-live", "user", "x" * 400, now - 90))
    con.execute("update sessions set title=NULL, display_name=NULL where id='s-cron'")
    con.commit()
    con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
