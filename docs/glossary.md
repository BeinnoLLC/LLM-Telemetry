# Glossary

| Term | Meaning |
|---|---|
| **Agent home** | Directory holding agent profiles. `$LLM_TELEMETRY_AGENT_HOME`, else config `agent_home`, else `~/.hermes`. |
| **Alert / Attention card** | A rule from `alerts.py` that tripped; evaluated by the collector, only rendered by the page. |
| **Analytics store** | Durable SQLite store filled by `llm-telemetry ingest` (`analytics_store.py`). |
| **API-price equivalent** | What the same tokens would cost at public API rates. Shown for subscription traffic, never counted as spend. |
| **Billed vs market value** | `billed_usd` is real pay-per-token spend (metered only); `market_value_usd` is the API-rate value of the tokens, also computed for subscription and local rows. Est. cost sums the latter. |
| **Catalogue** | The pricing catalogue (OpenRouter, plus Nous) cached in `pricing-cache.json`, TTL 6 h. |
| **Collector** | A Python module that reads one source and writes one JSON payload (`collect_*.py`, `probe_hosts.py`). |
| **Compaction** | An agent summarising its context to shrink it; the Detail view tracks yield and failures. |
| **Cost class** | `metered`, `subscription`, `local`, `unknown` (`pricing.PROVIDER_CLASS`). |
| **Covered by subscription** | Label ("sub" badge) on Claude Code / Codex session costs: tokens counted, price shown, not added to Est. cost. |
| **Delegation** | A parent session spawning child runs (subagents); Health tracks completion rate. |
| **Depot / On the line / Yard** | The three sections of the Task queue railway: waiting at a host, live sessions, finished sessions. |
| **Fleet bar** | Header strip with the kind filter and profile chips. |
| **Hermes** | The agent platform whose profiles (`state.db`, `config.yaml`, logs) are the main data source. |
| **Kind** | Source type of a live session: Hermes, PI, Claude, Codex. |
| **Live feed** | `live-data.json`, the small payload the page polls every 5 s. |
| **Local host patterns** | Config list that marks hosts as LAN/local so their traffic and cost are treated as local. |
| **Orphan reap** | A session reaped because its agent died mid-turn (`startup_orphan_reap`, `ws_orphan_reap`). |
| **Payload** | A JSON file written by a collector, validated against `schema/<tag>.schema.json`. |
| **PI / pi-worker** | A coding-agent runner whose sessions are JSONL files under `~/.pi/agent-*/sessions/`. |
| **Physical host** | One machine, even when several URLs reach it; found by fingerprinting Ollama endpoints. |
| **Profile** | One agent identity: a name plus a home directory with `state.db`. |
| **Quota cache** | `quota_cache.json` maintained by the Hermes quota plugin; the only source for the Quota view. |
| **Reports dir** | Where payloads and `dashboard.html` are written (`reports_dir`, default `~/.local/share/llm-telemetry/reports`). |
| **Router** | The Hermes model router: tiers, routing matrix, fallbacks, auxiliary tasks. |
| **Schema version** | `SCHEMA_VERSION` (currently 3) stamped on every payload and baked into the page. |
| **Session finder** | `/` palette searching a per-session index (model, source, tool, cost, duration). |
| **Single-file artifact** | `dashboard.html` with CSS, JS and data inlined; opens from `file://`. |
| **Golden fixtures** | Frozen structural signatures of sample payloads in `tests/fixtures/golden/`, checked by `bless.js`. |
| **Page-weight budget** | Per-artifact byte ceiling in `tests/test_page_weight.py`; 960,000 B for `dashboard.html`. |
