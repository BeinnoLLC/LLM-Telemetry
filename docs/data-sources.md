# Data sources and collectors

All collectors live in `src/llm_telemetry/`, write JSON into the **reports
directory** (config `reports_dir`, default `~/.local/share/llm-telemetry/reports`)
and stamp `schema_version` (see [architecture.md](architecture.md)). The CLI
command for each is in [setup-and-deploy.md](setup-and-deploy.md).

## Summary

| Source | Collector module | CLI command | Output file | Cadence (shipped systemd) |
|---|---|---|---|---|
| Hermes `state.db` (usage, sessions, health, delegations) | `collect_analytics.py` | `analytics` (also run by `dashboard`) | `analytics-data.json` | 60 s |
| Hermes live slice + PI + Claude/Codex + Ollama cache | `collect_live.py` | `live` | `live-data.json` | 60 s file rewrite; page polls every 5 s |
| PI live sessions | `collect_pi_live.py` | (called by `live`) | inside `live-data.json` (`pi_live`) | with `live` |
| Claude Code / Codex live sessions | `collect_agent_worker_live.py` | (called by `live`) | inside `live-data.json` (`agent_live`) | with `live` |
| Ollama endpoints | `probe_hosts.py` | `probe` | `ollama-data.json` | 5 s timer |
| Router config + decisions | `collect_router.py` | `router` | `router-data.json` | hourly timer; build re-collects if older than 65 min |
| Provider quota cache | `collect_quota.py` | `quota` | `quota-data.json`, `quota-history.json` | hourly timer and every build |
| Pricing catalogue | `pricing.py` + `build_costs.py` | `costs` | `costs-data.json`, `pricing-cache.json` | build cycle; catalogue TTL 6 h |
| OpenRouter rankings | `collect_rankings.py` + `build_rankings.py` | `rankings` | `rankings-data.json` | hourly timer; reuse if younger than 1 h |
| Logs page | `collect_logs.py` | `logs` | `logs-data.json` | 60 s |
| Transcript modal | `collect_transcripts.py` | `transcripts` | `transcripts.json` | 60 s |
| Session timeline | `collect_session_timeline.py` | `session-timeline` | `sessions/<profile>/<id>.json` | 60 s |
| Hermes + PI into durable store | `collect_hermes_profiles.py`, `collect_pi_agents.py` via `ingest_all.py`, `ingest_pi.py` | `ingest`, `ingest-pi` | analytics store SQLite (`analytics_store.py`) | manual / not in the shipped timers |

Other modules `collect_context_compaction.py`, `collect_repo_branch.py` and
`collect_session_index.py` are called by `collect_analytics.py` and add the
context & compaction, repo/branch and session-finder sections to the analytics
payload. The repo has 15 `collect_*.py` modules in total.

## Per-collector detail

### Analytics — `collect_analytics.py`
- **Input:** each profile's `state.db` (read-only), `logs/errors.log`, and the
  pricing catalogue. Profiles come from config/autodiscovery (`config.py`).
- **Output (`analytics-data.json`):** top-level keys `generated`, `profiles`,
  `resolution`, `pricing_models`, `pricing_source`, `schema_version`. Each profile
  carries day-grain `rows` (calls, input/output/cache tokens, cost fields
  `billed_usd`, `market_value_usd`, `energy_usd`, `cost_class`, bytes up/down),
  `hours`, `sessions`, `health`, plus delegations, outcomes, latency, tool
  reliability, bandwidth, attribution, context & compaction, repo/branch,
  session index, and evaluated `alerts`.
- **Time windows:** rows are at **day** granularity so the page filters any
  from/to range client-side. A separate **hour**-grain series covers the last
  `HOUR_WINDOW_S = 259200` s (72 h) for the 1h/6h/12h presets. Delegation alert
  rate is over 7 days; "Sessions ended" is 30 days.

### Live — `collect_live.py`
- **Input:** three cheap indexed queries per profile (open sessions, recent tool
  calls, recent models), `gateway_heartbeats`, `session_turn_leases`, the last
  60 error lines (`tail_errors`, 2 h window), the cached `ollama-data.json`, and
  the PI and Claude/Codex live collectors.
- **Output (`live-data.json`):** `generated`, `bytes_per_token`, `profiles`
  (live sessions, models, tools, recent ended/delegations, heartbeats),
  `errors`, `ollama`, `pi_live`, `agent_live`. Written atomically (temp file +
  rename).
- **Why separate:** the full analytics export prices every usage row; the live
  slice is small enough to poll aggressively.

### PI live — `collect_pi_live.py`
- **Input:** `~/.pi/agent-*/sessions/<cwd-slug>/<timestamp>_<id>.jsonl`
  (`$LLM_TELEMETRY_PI_HOME` overrides the root).
- **Rule:** a session is live when its file mtime is within `STALE_WINDOW_S = 180`
  s. Output per session: id, cwd-derived title, model/provider, idle time, a short
  phase, tokens, and recent tools (`TOOLS_WINDOW_S = 900`, `TOOLS_LIMIT = 12`).

### Claude Code / Codex live — `collect_agent_worker_live.py`
- **Input:** `$LLM_TELEMETRY_CLAUDE_HOME` (default `~/.claude`)
  `/projects/<slug>/<uuid>.jsonl` and `$LLM_TELEMETRY_CODEX_HOME` (default
  `~/.codex`) `/sessions/Y/M/D/rollout-*.jsonl`.
- **Agent-worker logins:** also scans every per-login home
  `~/.hermes/agent-logins/<login>/claude` and `…/<login>/codex` (override the
  root list with `$LLM_TELEMETRY_AGENT_LOGINS`, path-separated; empty disables).
  Sessions started by an agent-worker never touch `~/.claude` / `~/.codex`. Each
  row carries `login` (the `<login>` directory name, empty for the default
  home), shown as the row's owner badge.
- **Rule:** live when the file mtime is within `STALE_WINDOW_S = 180` s. One row
  per engine + session id (most recently written file wins).
- **Output:** engine, login, session id, a cwd-basename title, model (only when the transcript names one), last-event
  time, token counts, coarse phase, and `cost_usd` with `cost_class:
  "subscription"` — the API-price equivalent from the pricing table, `null` when
  a model has no rate (so it never reads as a real $0).
- **Privacy:** prompts, replies and tool arguments are never copied; only the
  basename of the working directory is used for the title.

### Ollama probe — `probe_hosts.py`
- **Input:** each URL in config `inference_endpoints` (`/api/*`); `jq` is used to
  read capabilities because `/api/show` can embed raw newlines in JSON.
- **Output (`ollama-data.json`):** `endpoints`, `hosts`, `physical`, `ts`.
  Endpoints that resolve to the same machine are fingerprinted (model list +
  loaded-model expiry) and grouped into one *physical* host so VRAM is not
  double-counted. `nvidia-smi` is used when present.
- **Cadence:** every 5 s so the page can show GPU residency and queue depth;
  consumers read `age` to detect a dead probe.

### Router — `collect_router.py`
- **Input:** each profile's `config.yaml`, `auth.json` (whitelisted descriptive
  fields only) and the agent log.
- **Output (`router-data.json`):** `collected_at`, `vocab`, per-profile primary
  model, fallbacks, auxiliary tasks, delegation, MoA preset, tier router and
  routing matrix, provider auth type/source/pool status, and recent routing
  decisions.
- **Window:** decisions over the last 7 days (`DECISION_WINDOW_S`); `RECENT_N = 15`.

### Quota — `collect_quota.py`
- **Input:** `<profile home>/quota_cache.json`, kept fresh by the Hermes quota
  plugin. This repo never holds a provider credential.
- **Output (`quota-data.json`):** `collected_at`, `attention_percent`, `summary`,
  per-profile providers with usage windows, balances and accounts, plus
  `quota-history.json` (`HISTORY_DAYS = 30`). Only whitelisted fields are copied;
  credential-shaped substrings in free text become `[REDACTED]`.
- **Optional:** if the plugin is not installed the Quota view renders an empty
  state; the build still succeeds.

### Pricing — `pricing.py`, `build_costs.py`
- **Input:** OpenRouter model catalogue (`https://openrouter.ai/api/v1/models`),
  Nous catalogue, cached in `pricing-cache.json` with `TTL = 6 h`.
  `LLM_TELEMETRY_CATALOG` pins a catalogue file (used for reproducible samples).
- **Classification (`PROVIDER_CLASS`):** `metered` (fireworks, openrouter,
  deepseek, ollama-cloud), `subscription` (anthropic, opencode-go, openai-codex,
  copilot, nous), `local` (custom, local, ollama), `unknown`. A market-equivalent
  value is computed for subscription and local traffic but never counted as billed
  spend (`billed_usd` is non-zero only for `metered`).
- **Local electricity:** `energy.py` converts throughput to watt-seconds using
  the configured tariff (`electricity_rate_kwh`, `gpu_draw_watts`,
  `host_overhead_watts`) and per-model tokens-per-second estimates by parameter
  size (`LOCAL_TPS`).
- **Output (`costs-data.json`):** per-model rates, their source, catalogue size
  and freshness, and the power model inputs.

### Rankings — `collect_rankings.py`
- **Input:** `GET https://openrouter.ai/api/v1/datasets/rankings-daily`, Bearer
  `OPENROUTER_API_KEY` (only the variable *name* is ever reported).
- **Window:** one request per run for the last `WINDOW_DAYS = 30` days; day,
  week and month views are re-aggregated from it; `TOP_N = 10` named models are kept, the rest are summarised as an aggregate.
  Re-fetch limited by `LLM_TELEMETRY_RANKINGS_TTL` (default 3600 s).
- **Failure:** no key or request failure writes `status: "unavailable"` with the
  reason; a previous good snapshot is kept and marked stale.
- **Attribution:** "Rankings data by OpenRouter, CC BY 4.0", shown in the view.

### Logs, transcripts, session timeline
- `collect_logs.py`: merges `messages` (agent actions) and `errors.log`
  failures (via `failures.parse`, 7 days). Events are capped at the newest
  `DEFAULT_CAP = 5000`, but facet counts (tool, role, session, kind) are computed
  over the full window; the payload records `events_total` vs `events_shown`.
  Kept out of the HTML because it is large.
- `collect_transcripts.py`: last `WINDOW = 200` messages per currently live
  session.
- `collect_session_timeline.py`: one file per session, newest
  `MAX_SESSIONS = 100`; the page says "not exported" for older ones.

### Durable store — `ingest`, `ingest-pi`
`collect_hermes_profiles.py` and `collect_pi_agents.py` discover profiles and
PI agents (`~/.pi/agent-*/`), extract usage and orchestration signals
(subagent spawns, PI-to-PI and Hermes→PI triggers) and write events into the
analytics store (`analytics_store.py`). `ingest` accepts `--db`, `--pi-only`,
`--hermes-only`. These are not part of the shipped timers; how they are
scheduled on a given host is **to confirm**.

## Token and byte estimates

`messages.token_count` is NULL in the real Hermes DB, so context size and
bandwidth are estimated from stored message bytes using
`BYTES_PER_TOKEN = 4.68` (`bandwidth.py`). The Transferred card and bandwidth
panels are labelled "estimated" for that reason.
