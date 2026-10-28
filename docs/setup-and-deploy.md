# Setup and deploy

## Requirements

- Python 3.10 or newer (`pyproject.toml`: `requires-python = ">=3.10"`; CI uses 3.12).
- PyYAML (the only runtime dependency). Everything else is the standard library.
- Optional: `nvidia-smi` for GPU telemetry, `jq` for Ollama capability probing.
- Node 24 and Chrome are needed only for development and QA, never at runtime.

## Install

```bash
git clone git@github.com:BeinnoLLC/LLM-Telemetry.git
cd LLM-Telemetry
pip install -e .          # installs the `llm-telemetry` command
```

Then:

```bash
llm-telemetry config      # show the resolved configuration
llm-telemetry doctor      # read-only preflight (exits 1 on any `fail`)
llm-telemetry dashboard   # collect + render dashboard.html
llm-telemetry serve       # http://localhost:8477/dashboard.html
```

## Configuration

### Config file

Resolved in this order (`src/llm_telemetry/config.py`): `$LLM_TELEMETRY_CONFIG`,
`$XDG_CONFIG_HOME/llm-telemetry/config.json`,
`~/.config/llm-telemetry/config.json`, then built-in defaults plus autodiscovery.
Unknown keys are ignored with a warning on stderr.

| Key | Default | Meaning |
|---|---|---|
| `profiles` | autodiscovered | List of `{name, home}`; see profile rules below |
| `exclude` | `[]` | Profile names to drop; the only way to omit a discovered profile |
| `agent_home` | `~/.hermes` | Where profiles are discovered |
| `inference_endpoints` | `[]` | Ollama base URLs to probe |
| `endpoint_aliases` | `{}` | Display names for endpoints |
| `local_host_patterns` | private ranges, `.local`, `.lan`, … | Hosts treated as local/LAN (not internet traffic, not metered) |
| `reports_dir` | `~/.local/share/llm-telemetry/reports` | Where payloads and `dashboard.html` are written (created if missing) |
| `port` / `bind` | `8477` / `0.0.0.0` | Server defaults |
| `electricity_rate_kwh` | `0.047` | $/kWh for local cost |
| `gpu_draw_watts` / `host_overhead_watts` | `350` / `90` | Power model |
| `live_poll_interval_s` | `5.0` | Live poll cadence (Settings page edits it) |
| `analytics_rebuild_interval_s` | `60.0` | Full data refresh cadence |

Profile rules: no `profiles` key = every discovered profile; `"profiles": []` =
none; a non-empty list = those profiles **plus** every other discovered one
(config wins on a name collision). A profile is a directory containing
`state.db`; the default profile is the agent home itself, named ones are under
`profiles/*`.

### Environment variables

| Variable | Effect | Defined in |
|---|---|---|
| `LLM_TELEMETRY_CONFIG` | Path to the config file | `config.py` |
| `LLM_TELEMETRY_AGENT_HOME` | Agent home; beats config `agent_home` | `config.py` |
| `LLM_TELEMETRY_NO_COLLECT` | Any value: build/render from JSON already on disk, run no collectors | `build_dashboard.py`, `build_costs.py`, `build_rankings.py` |
| `LLM_TELEMETRY_CATALOG` | Pin the pricing catalogue to a file (no network; used for samples) | `pricing.py` |
| `LLM_TELEMETRY_COSTS_DATA` | Override the path of `costs-data.json` | `build_costs.py` |
| `LLM_TELEMETRY_PI_HOME` | Root for live PI agents (default `~/.pi`); the `ingest-pi` collector (`collect_pi_agents.py`) uses `~/.pi` unconditionally | `collect_pi_live.py` |
| `LLM_TELEMETRY_CLAUDE_HOME` | Claude Code home (default `~/.claude`) | `collect_agent_worker_live.py` |
| `LLM_TELEMETRY_CODEX_HOME` | Codex home (default `~/.codex`) | `collect_agent_worker_live.py` |
| `LLM_TELEMETRY_RANKINGS_TTL` | Seconds between rankings fetches (default 3600) | `collect_rankings.py` |
| `OPENROUTER_API_KEY` | Needed for the Rankings view; absent = "unavailable" | `collect_rankings.py` |
| `XDG_CONFIG_HOME` | Alternative config location | `config.py` |

`scripts/refresh-dashboard.sh` additionally reads `HERMES_HOME` and
`LLM_TELEMETRY_REPO` (a cron alternative to systemd) and unsets
`LLM_TELEMETRY_CONFIG` / `LLM_TELEMETRY_NO_COLLECT` so it always does real
collection.

## CLI

`llm-telemetry <command>` (`src/llm_telemetry/cli.py`):

| Command | Does |
|---|---|
| `config` | Print resolved configuration |
| `doctor` | Read-only preflight: config, agent DBs, artifact ages vs timer cadence, installed timers, schema, hosts. `--json`, `--offline`. Exit 1 on any `fail`. Warns at 1.5× a cadence, fails at 3× |
| `dashboard` | Collect analytics (and router/quota if stale) + render `dashboard.html` |
| `analytics` | Write `analytics-data.json` |
| `live` | Write `live-data.json` |
| `logs` | Write `logs-data.json` |
| `transcripts` | Write `transcripts.json` |
| `session-timeline` | Write `sessions/<profile>/<id>.json` |
| `probe` | Probe inference hosts → `ollama-data.json` |
| `costs` | Refresh `costs-data.json` (Prices view) |
| `rankings` | Fetch OpenRouter rankings → `rankings-data.json` |
| `router` | Write `router-data.json` |
| `quota` | Write `quota-data.json` and history |
| `ingest`, `ingest-pi` | Ingest sessions into the analytics store (`--db`, `--pi-only`, `--hermes-only`) |
| `serve` | Static server, no-store headers; `--port N` (`0` = free port), `--bind ADDR`, `--dir PATH`, `--open` |

## Serving

`serve.py` sends `Cache-Control: no-store` on every response so a rebuild is
never hidden by a browser cache. It also exposes `GET /api/settings` and
`POST /api/settings`: loopback clients only, requires a custom header (forces a
CORS preflight the server never approves), whitelists numeric power/interval
keys, writes atomically. The server binds `0.0.0.0` by default so the LAN can
view the dashboard but only the host can change its config.

## systemd (user units)

Shipped in `systemd/`:

| Unit | Schedule | Runs |
|---|---|---|
| `llm-telemetry-build.timer` / `.service` | boot +1 min, then every 1 min | `dashboard`, `quota`, `live`, `logs`, `costs`, `rankings`, `transcripts`, `session-timeline` |
| `llm-telemetry-probe.timer` / `.service` | boot +20 s, then every 5 s | `probe` |
| `llm-telemetry-router.timer` / `.service` | boot +2 min, hourly | `router` |
| `llm-telemetry-quota.timer` / `.service` | boot +3 min, hourly | `quota` |
| `llm-telemetry-rankings.timer` / `.service` | boot +2 min, every 1 h | `rankings` |
| `llm-telemetry-serve.service` | always on (`Restart=on-failure`) | `serve` |

```bash
cp systemd/*.service systemd/*.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now llm-telemetry-build.timer llm-telemetry-probe.timer \
  llm-telemetry-router.timer llm-telemetry-quota.timer llm-telemetry-rankings.timer \
  llm-telemetry-serve
```

Units expect the command at `%h/.local/bin/llm-telemetry`. Without systemd, use
cron: `scripts/refresh-dashboard.sh` every minute (it runs the same collectors
from a repo venv and keeps a log under `$HERMES_HOME/reports/refresh.log`), and
`llm-telemetry router quota` hourly.

### Reference deployment: `hermes-dash-http.service` on port 8477

On the maintainer's machine the dashboard is served by a user unit named
`hermes-dash-http.service` on **port 8477**. That unit file is **not in this
repo** (**to confirm** its contents on the host). The repo's own
`llm-telemetry-serve.service` also targets 8477, and an older
`serve-reports.service` used to clash on that port; it is disabled. Never run
two servers on 8477. Check `systemctl --user status hermes-dash-http.service`
before starting any other server, and use `llm-telemetry serve --port 0` for
experiments.

## Deploy after a merge to main

Project rule: after every merge to `main`, deploy locally. The detailed
procedure is kept in the team's `llm-telemetry-repo` skill (not in this repo,
**to confirm**); the steps are:

1. In the main checkout, fast-forward to `origin/main` (`git fetch origin`,
   `git merge --ff-only origin/main`).
2. `pip install -e .` in the environment the units use.
3. Restart the serving unit: `systemctl --user restart hermes-dash-http.service`.
4. Verify: `llm-telemetry doctor`, load `http://localhost:8477/dashboard.html`,
   and check the header "generated" stamp is fresh.

Because collectors are timers that call the installed code, the next minute's
build already uses the new version; only the server needs the restart.

## Samples without touching real data

```bash
LLM_TELEMETRY_NO_COLLECT=1 \
LLM_TELEMETRY_CONFIG=examples/sample-config.json \
LLM_TELEMETRY_AGENT_HOME=examples/agent-home \
LLM_TELEMETRY_CATALOG=examples/reports/sample-catalog.json \
python3 -m llm_telemetry.build_dashboard examples/reports/dashboard.html
```

`reports/` is gitignored because real telemetry contains chat titles and spend;
`examples/reports/` holds synthetic equivalents.
