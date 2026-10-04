#!/bin/bash
# Rebuild the LLM Telemetry dashboard. Run from cron every minute.
#
# Runs the INSTALLED REPO (~/workspace/beinno/LLM-Telemtry), not the old
# ~/.hermes/bin copies. Those copies froze on 2026-09-25 while the repo kept
# moving, so the served page silently lacked bandwidth, Home, nav, routing and
# the aggregated-transfer card even though all of it was committed and pushed.
# One codebase from now on: `git pull` in the repo is the whole deploy.
set -euo pipefail
# No absolute paths: HOME-relative, with both locations overridable by env so
# this works for any user, any checkout. LLM_TELEMETRY_REPO is the one thing
# that cannot be derived — set it in the crontab if the repo moves.
H="${HERMES_HOME:-$HOME/.hermes}"
REPO="${LLM_TELEMETRY_REPO:-$HOME/workspace/beinno/LLM-Telemtry}"
if [ ! -x "$REPO/.venv/bin/llm-telemetry" ]; then
  echo "refresh-dashboard: no llm-telemetry venv at $REPO — set LLM_TELEMETRY_REPO" >&2
  exit 1
fi
PY="$REPO/.venv/bin/python"
CLI="$REPO/.venv/bin/llm-telemetry"
LOG="$H/reports/refresh.log"
mkdir -p "$H/reports"
unset LLM_TELEMETRY_CONFIG LLM_TELEMETRY_NO_COLLECT   # personal config, real collection
{
  echo "=== $(date '+%F %T') === $(cd "$REPO" && git rev-parse --short HEAD)"
  # Guard: every cloud model Hermes has recorded must resolve to a price. A
  # model at $0.00 looks free, and a plausible-looking wrong number is worse
  # than a stale page. Build anyway on failure so the page never goes dark,
  # but say so loudly in the log.
  if "$PY" "$REPO/tests/test_pricing_coverage.py" > /dev/null 2>&1; then
    echo "pricing guard: PASS"
  else
    echo "pricing guard: FAIL — a model is unpriced, see below"
    "$PY" "$REPO/tests/test_pricing_coverage.py" 2>&1 | grep -v '^  OK' | tail -20
  fi
  # `dashboard` runs the analytics + router collectors itself and writes
  # dashboard.html; `live` and `costs` are separate outputs off the same data.
  # `logs` writes logs-data.json for the Logs view, fetched on demand (~1.3 MB
  # per profile, so it deliberately stays out of the HTML).
  "$CLI" dashboard
  "$CLI" live
  "$CLI" logs
  "$CLI" costs
  # The transcript modal (transcripts.json) and the session timeline
  # (sessions/<profile>/<id>.json) are fetched ON DEMAND by the page, so a
  # missing file is not an error the build can catch -- the modal just says
  # "not exported" for every session. Both are sub-second, so they belong to
  # the same per-minute cycle as the pages that link to them.
  "$CLI" transcripts
  "$CLI" session-timeline
} >> "$LOG" 2>&1
# keep the log from growing forever
tail -n 200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"