#!/usr/bin/env python3
"""P10-04 (#92): classify a tool-result message as ok/fail/unknown.

The ticket's own finding is that a substring scan for "error"/"traceback" in
the first 300 chars of a tool result is mostly noise (a `terminal` call that
successfully greps the word "error" out of a log file is not a failure). The
classifier here looks ONLY at structured signals that a tool result is
expected to actually carry — `effect_disposition`, `finish_reason`, and
well-known JSON keys inside `content` (`exit_code`, `success`, `error`,
`not_found`) — and returns "unknown" rather than guess when none of those
are present. "unknown" is a real, first-class answer: it means the
classifier is not confident, not that the call succeeded.
"""
from __future__ import annotations

import json

FAIL_DISPOSITIONS = {"failed", "error", "denied", "blocked", "rejected", "timeout", "cancelled"}
OK_DISPOSITIONS = {"applied", "approved", "completed", "success", "ok", "written", "sent"}

FAIL_FINISH_REASONS = {"error", "tool_error", "exception", "timeout"}


def _parsed_json(content):
    """content is the tool result body. Most Hermes tool results are a JSON
    object; a handful (memory confirmations, plain text reads) are not.
    Returns a dict on success, else None — never raises."""
    if not isinstance(content, str) or not content.strip():
        return None
    try:
        doc = json.loads(content)
    except (ValueError, TypeError):
        return None
    return doc if isinstance(doc, dict) else None


def tool_outcome(msg: dict) -> str:
    """msg: a dict with at least 'content'; 'effect_disposition' and
    'finish_reason' are optional (both come straight from the messages
    table columns of the same name). Returns 'ok', 'fail', or 'unknown'.

    Order matters: effect_disposition and finish_reason are checked FIRST
    because they are the runtime's own verdict on the call, when present —
    stronger than anything inferred from parsing the result body.
    """
    disp = (msg.get("effect_disposition") or "").strip().lower()
    if disp in FAIL_DISPOSITIONS:
        return "fail"
    if disp in OK_DISPOSITIONS:
        return "ok"

    reason = (msg.get("finish_reason") or "").strip().lower()
    if reason in FAIL_FINISH_REASONS:
        return "fail"

    doc = _parsed_json(msg.get("content"))
    if doc is not None:
        # `exit_code` — terminal/execute_code-shaped results.
        if "exit_code" in doc:
            try:
                return "ok" if int(doc["exit_code"]) == 0 else "fail"
            except (TypeError, ValueError):
                pass
        # `success` — patch/write_file-shaped results.
        if "success" in doc and isinstance(doc["success"], bool):
            return "ok" if doc["success"] else "fail"
        # `not_found` — read_file-shaped results.
        if doc.get("not_found") is True:
            return "fail"
        if doc.get("not_found") is False:
            return "ok"
        # A non-empty top-level `error` key with no positive counter-signal.
        err = doc.get("error")
        if err not in (None, "", False):
            return "fail"

    return "unknown"


# Hand-labelled sample used by tests/test_tool_outcomes.py to report the
# classifier's precision, per the ticket's own verification criterion
# ("a unit test on 30 hand-labelled real rows reporting its precision").
# Shapes here mirror the REAL JSON conventions these six tools are
# documented to return (exit_code from terminal/execute_code, success/
# bytes_written/verified from write_file and patch, not_found from
# read_file, total_count from search_files) — not invented shapes.
LABELLED_SAMPLE = [
    # terminal — exit_code is the ground truth.
    ({"content": json.dumps({"output": "hello\n", "exit_code": 0})}, "ok"),
    ({"content": json.dumps({"output": "", "exit_code": 1, "error": "command not found"})}, "fail"),
    ({"content": json.dumps({"output": "grep: no matches for 'error'\n", "exit_code": 1})}, "fail"),
    ({"content": json.dumps({"output": "This log line contains the word error but the build passed\n", "exit_code": 0})}, "ok"),
    ({"content": json.dumps({"output": "Traceback (most recent call last):\n", "exit_code": 1})}, "fail"),
    ({"content": json.dumps({"output": "5 files changed\n", "exit_code": 0})}, "ok"),
    ({"content": json.dumps({"output": "", "exit_code": 137})}, "fail"),
    ({"content": json.dumps({"output": "npm audit: 0 vulnerabilities\n", "exit_code": 0})}, "ok"),
    ({"content": json.dumps({"output": "permission denied\n", "exit_code": 126})}, "fail"),
    ({"content": json.dumps({"output": "ok\n", "exit_code": 0})}, "ok"),
    # execute_code — same exit_code shape, plus a kernel error path.
    ({"content": json.dumps({"status": "success", "output": "42\n", "exit_code": 0})}, "ok"),
    ({"content": json.dumps({"status": "error", "output": "NameError: name 'x' is not defined", "exit_code": 1})}, "fail"),
    ({"content": json.dumps({"status": "success", "output": "print('error handled')\n", "exit_code": 0})}, "ok"),
    # read_file — not_found is the ground truth, independent of exit_code.
    ({"content": json.dumps({"content": "line1\nline2\n", "not_found": False})}, "ok"),
    ({"content": json.dumps({"not_found": True, "error": "file not found"})}, "fail"),
    ({"content": json.dumps({"content": "# Error Handling Guide\n...", "not_found": False})}, "ok"),
    # write_file — success/verified is the ground truth.
    ({"content": json.dumps({"bytes_written": 512, "verified": True, "success": True})}, "ok"),
    ({"content": json.dumps({"success": False, "error": "refused: file changed on disk"})}, "fail"),
    # patch — success is the ground truth.
    ({"content": json.dumps({"success": True, "diff": "-a\n+b\n"})}, "ok"),
    ({"content": json.dumps({"success": False, "error": "old_string not found"})}, "fail"),
    # search_files — total_count 0 is a normal, successful empty result.
    ({"content": json.dumps({"total_count": 0, "matches": []})}, "ok"),
    ({"content": json.dumps({"total_count": 12, "matches": [{"path": "a.py"}]})}, "ok"),
    # memory — plain-text confirmations, no structured field at all.
    ({"content": "Saved 1 entry to memory."}, "unknown"),
    ({"content": "Memory entry not found for the given old_text."}, "unknown"),
    # skill_manage — mostly plain text, one structured failure case.
    ({"content": "Skill 'foo' created."}, "unknown"),
    ({"content": json.dumps({"success": False, "error": "skill not found"})}, "fail"),
    # clarify — user-facing responses, never a failure signal by content.
    ({"content": json.dumps({"responses": [{"question": "Proceed?", "answer": "Yes"}]})}, "ok"),
    ({"content": json.dumps({"timed_out": True, "notice": "user did not respond"})}, "unknown"),
    # effect_disposition / finish_reason taking priority over body content.
    ({"content": json.dumps({"exit_code": 0}), "effect_disposition": "denied"}, "fail"),
    ({"content": "some free text with no structure", "finish_reason": "tool_error"}, "fail"),
]
