#!/usr/bin/env python3
"""P10-04 (#92): classifier precision on the 30-row hand-labelled sample.

Precision here is measured over confident predictions only (ok/fail),
excluding 'unknown' from the denominator — an 'unknown' verdict is a
deliberate abstention, not a wrong guess, and folding it into the
precision calculation would penalize the classifier for being honest
about text-only tool results (memory, skill_manage, clarify) that carry
no structured success/failure signal at all.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))
from llm_telemetry.tool_outcomes import tool_outcome, LABELLED_SAMPLE  # noqa: E402

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{('  ' + str(extra)) if extra is not None else ''}")
    if ok:
        p += 1
    else:
        f += 1


chk(len(LABELLED_SAMPLE) >= 30, f"the labelled sample has at least 30 rows (has {len(LABELLED_SAMPLE)})")

confident = 0
correct = 0
unknown_count = 0
mismatches = []
for msg, label in LABELLED_SAMPLE:
    got = tool_outcome(msg)
    if got == "unknown":
        unknown_count += 1
        continue
    confident += 1
    if got == label:
        correct += 1
    else:
        mismatches.append((msg, label, got))

precision = correct / confident if confident else 0.0
chk(precision >= 0.9,
    f"classifier precision on confident (ok/fail) predictions is >= 0.9 (got {precision:.3f}, "
    f"{correct}/{confident} correct, {unknown_count} abstained)")
chk(not mismatches, f"every confident prediction matches its hand label (mismatches: {mismatches})")

# The classifier must actually abstain on unstructured text — a precision
# number computed over zero abstentions would just mean the substring-guess
# problem was reintroduced under a different name.
chk(unknown_count >= 3,
    f"the classifier abstains (returns 'unknown') on at least some unstructured rows (got {unknown_count})")

# Targeted unit checks (independent of the sample, one per rule) so a
# regression in ANY single rule is pinpointed rather than only visible as a
# precision-number wobble.
chk(tool_outcome({"content": '{"exit_code": 0}'}) == "ok", "bare exit_code=0 is ok")
chk(tool_outcome({"content": '{"exit_code": 1}'}) == "fail", "bare exit_code=1 is fail")
chk(tool_outcome({"content": '{"success": true}'}) == "ok", "bare success=true is ok")
chk(tool_outcome({"content": '{"success": false}'}) == "fail", "bare success=false is fail")
chk(tool_outcome({"content": '{"not_found": true}'}) == "fail", "bare not_found=true is fail")
chk(tool_outcome({"content": '{"not_found": false}'}) == "ok", "not_found=false with no other signal is NOT fail (must not default to fail)")
chk(tool_outcome({"content": "plain prose with no structure"}) == "unknown",
    "unstructured plain text is 'unknown', never guessed at")
chk(tool_outcome({"content": '{"exit_code": 0}', "effect_disposition": "denied"}) == "fail",
    "effect_disposition overrides a contradicting exit_code")
chk(tool_outcome({"content": "no structure", "finish_reason": "tool_error"}) == "fail",
    "finish_reason=tool_error is fail even with no parseable content")
chk(tool_outcome({"content": "This is an error message that succeeded anyway", "effect_disposition": "ok"}) == "ok",
    "the word 'error' appearing in prose does NOT override a real ok signal (the ticket's own noise case)")
chk(tool_outcome({}) == "unknown", "an empty message dict is 'unknown', not a crash")
chk(tool_outcome({"content": None}) == "unknown", "content=None is 'unknown', not a crash")
chk(tool_outcome({"content": "{not valid json"}) == "unknown", "malformed JSON content is 'unknown', not a crash")

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
