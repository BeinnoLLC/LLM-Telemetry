#!/usr/bin/env python3
"""Generate the session-timeline parity fixture (T-16, LLMTELEMET-287).

Usage: make_timeline_fixture.py OUT_DIR

Builds the analytics fixture, then adds assistant turns the timeline's model
lane needs: s-live gets assistant rows around its two usage rows (qwen last
seen now-120s, llama3 now-90s) so the per-message `last_seen <= ts` model
lookup resolves to different models, one assistant row before any usage
(model None, skipped), plus a tool row with a JSON failure payload.
"""
import importlib.util
import os
import sqlite3
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def main(argv):
    if len(argv) != 1:
        sys.stderr.write("usage: make_timeline_fixture.py OUT_DIR\n")
        return 2
    spec = importlib.util.spec_from_file_location("make_analytics_fixture", os.path.join(HERE, "make_analytics_fixture.py"))
    base = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(base)
    if base.main(argv) != 0:
        return 1
    out = os.path.abspath(argv[0])
    now = int(time.time())
    for prof in ("alpha", "beta-bot"):
        con = sqlite3.connect(os.path.join(out, "agent", "profiles", prof, "state.db"))
        rows = [
            ("s-live", "assistant", "early, no usage yet", None, None, None, now - 3500),
            ("s-live", "assistant", "first", None, None, None, now - 100),
            ("s-live", "assistant", "second", None, None, None, now - 95),
            ("s-live", "tool", '{"exit_code": 2}', "terminal", None, None, now - 85),
            ("s-live", "assistant", "third", None, None, None, now - 80),
            ("s-live", "user", "go", None, None, None, now - 70),
            ("s-root", "assistant", "fixed it", None, None, None, now - 4 * 3600 - 30),
            ("s-root", "tool", "plain text", "patch", "applied", None, now - 4 * 3600 - 20),
        ]
        for sid, role, content, tool, disp, fin, ts in rows:
            con.execute("insert into messages (session_id, role, content, tool_name, effect_disposition,"
                        " finish_reason, timestamp) values (?,?,?,?,?,?,?)", (sid, role, content, tool, disp, fin, ts))
        con.commit()
        con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
