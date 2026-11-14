# Scheduler templates (T-4, LST-283)

The OS schedulers stay the schedulers: systemd user timers + crontab calling
the Node CLI with the same cadences as the Python stack
(docs/plans/node-nextjs-migration.md §4 "Collectors as Node jobs" and §1's
schedule table). No in-process cron daemon — timers+cron already proved the
deployment model, and both stacks can run the same schedule definition side by
side during the overlap.

## Contents

| File | Mirrors | Cadence |
|---|---|---|
| `systemd/llm-telemetry-node-live.{service,timer}` | `systemd/llm-telemetry-live-export` | 5 s (`live` → live-data.json) |
| `systemd/llm-telemetry-node-probe.{service,timer}` | `systemd/llm-telemetry-probe` | 5 s (`probe` → ollama-data.json) |
| `crontab.example` | `scripts/refresh-dashboard.sh` cron + README "Continuous updates" | 1 min full cycle; hourly router+quota; 6-hourly pricing |

## NOT installed by this ticket

These are FILES ONLY. Nothing here has been copied to
`~/.config/systemd/user/`, no unit has been enabled/started, and no crontab
entry exists. Installation happens at dual-run/cutover time (plan §12 step 4)
with the user's explicit OK, and `hermes-dash-http.service` (:8477) is never
touched by any of it.

## Before first use

1. `command -v node` → pin that absolute path in `ExecStart`/`NODE` (plan §4
   pins the interpreter like the Python units pin `.venv/bin/llm-telemetry`).
2. Adjust the checkout path (`%h/workspace/beinno/LLM-Telemtry` here).
3. Keep `LLM_TELEMETRY_NODE_REPORTS_DIR` pointed at a Node-only dir — the
   writer refuses the Python reports dir outright (single-writer rule, §13).
4. Expect exit 1 "not yet ported" from every collector command except `demo`
   and `config` until T-6/T-15..T-18 land. That loud failure is deliberate:
   a stub must never look like a successful empty collection.
