#!/usr/bin/env python3
"""Delegation outcomes must come from the CHILD entries, not the parent state.

The bug this guards: a delegation row can read state='completed' while a child
inside it failed. Computing rates from the parent column turns a 27%-failure
reality into a clean run — which is exactly the blindness #90 exists to fix.
"""
import json, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from llm_telemetry import delegations  # noqa: E402

FAILED = 0


def chk(cond, label, extra=""):
    global FAILED
    print(("  OK   " if cond else "  FAIL ") + label + (f"  ({extra})" if extra else ""))
    if not cond:
        FAILED += 1


def child(status="completed", model="m1", dur=10.0, cost=0.5,
          failure_reason=None, exit_reason=None, tools=None, tokens=None):
    return {
        "status": status, "model": model, "duration_seconds": dur,
        "cost_usd": cost, "failure_reason": failure_reason,
        "exit_reason": exit_reason or ("completed" if status == "completed" else "error"),
        "tokens": tokens if tokens is not None else {"input": 100, "output": 10},
        "tool_trace": tools or [],
    }


def row(did, state, kids, goal="do a thing", at=1000.0):
    return (did, state, at, at + 60,
            json.dumps({"results": kids}),
            json.dumps({"goal": goal}))


# --- the headline trap: parent says completed, child failed ---------------
p = delegations.summarize([
    row("d1", "completed", [child(), child(status="failed", model="m2",
                                  failure_reason="rate_limit", dur=1200)]),
])
chk(p["children"] == 2, "counts children, not delegations", p["children"])
chk(p["failed"] == 1, "a failed child inside a 'completed' delegation is counted",
    f"failed={p['failed']}")
chk(p["rate"] == 50.0, "rate is per child", p["rate"])
chk(p["reasons"].get("rate_limit") == 1, "failure_reason bucketed", p["reasons"])
chk(p["wasted_hours"] == round(1200 / 3600, 2),
    "wasted hours counts only non-completed children", p["wasted_hours"])

# --- per-model rates, the number that drives the routing decision ---------
p = delegations.summarize([
    row("d2", "completed", [child(model="good") for _ in range(4)]),
    row("d3", "error", [child(model="bad", status="failed",
                              failure_reason="timeout") for _ in range(3)]
                       + [child(model="bad")]),
])
by = {m["model"]: m for m in p["by_model"]}
chk(by["good"]["rate"] == 100.0, "clean model reports 100%", by["good"]["rate"])
chk(by["bad"]["rate"] == 25.0, "failing model reports its real rate", by["bad"]["rate"])
chk(p["by_model"][0]["model"] == "bad", "sorted by volume, worst offender first")

# --- tool_trace is MEASURED and must not be confused with the heuristic ---
p = delegations.summarize([
    row("d4", "completed", [child(tools=[
        {"tool": "terminal", "status": "ok"},
        {"tool": "terminal", "status": "error"},
        {"tool": "patch", "status": "ok"},
    ])]),
])
tl = {t["tool"]: t for t in p["tools"]}
chk(tl["terminal"]["calls"] == 2 and tl["terminal"]["fail"] == 1,
    "per-tool measured failures", tl["terminal"])
chk(tl["terminal"]["rate"] == 50.0, "tool success rate", tl["terminal"]["rate"])
chk(p["tools_measured"] is True, "payload flags these as measured, not inferred")

# --- robustness: the shapes that actually appear in the wild --------------
chk(delegations.summarize([]) is None, "no delegations -> None (panel hides)")
chk(delegations.summarize([row("d5", "completed", [])]) is None,
    "delegation with no children -> None")
p = delegations.summarize([row("d6", "error", [child(tokens=12345)])])
chk(p["by_model"][0]["tokens"] == 12345, "bare-int tokens tolerated (old rows)")
p = delegations.summarize([("d7", "error", 1.0, None, "not json", None)])
chk(p is None, "malformed result_json does not crash the build")
p = delegations.summarize([("d8", "error", 1.0, None, None, None)])
chk(p is None, "null result_json does not crash the build")

p = delegations.summarize([row("d9", "completed",
                               [child(status="interrupted", failure_reason=None,
                                      exit_reason="interrupted")])])
chk(p["reasons"].get("interrupted") == 1,
    "null failure_reason falls back to exit_reason", p["reasons"])

# --- cost + goal carried for the recent list ------------------------------
p = delegations.summarize([row("dA", "completed", [child(cost=2.5)], goal="G" * 300)])
chk(p["cost_usd"] == 2.5, "cost summed", p["cost_usd"])
chk(len(p["recent"][0]["goal"]) <= 160, "goal truncated for the payload")
chk(p["recent"][0]["id"] == "dA", "recent carries the delegation id")

print()
print(("ALL PASS" if not FAILED else "FAILED") + f"  ({FAILED} failed)")
sys.exit(1 if FAILED else 0)
