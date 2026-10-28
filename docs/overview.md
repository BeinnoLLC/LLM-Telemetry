# Overview and feature list

## What it does

LLM Telemetry collects telemetry from a mixed agent fleet and renders it as one
static page (`dashboard.html`) that refreshes itself. It covers four jobs:

1. **Live view** — what is running now, on which host, at what cost so far.
2. **Spend** — calls, tokens, cache hits and estimated cost by model, provider,
   task, project and repo. Local models are costed from electricity, hosted ones
   from catalogue rates, subscription tools as an API-price equivalent that is
   *not* added to spend.
3. **Health** — success rate by model, tool reliability, session outcomes,
   delegated runs, recent failures, and an Attention (alerts) card.
4. **Routing and quota** — how each profile routes work between models, how
   each provider authenticates, and how much quota headroom is left.

Every model, provider and tool keeps one stable colour across every chart
(`src/llm_telemetry/web/js/palette.js`).

## Navigation

The left rail groups the 13 views (`NAV_GROUPS` in
`src/llm_telemetry/web/js/router.js`). `#/live` is an alias for Home.

| Group | Views |
|---|---|
| Overview | Home, Flow, Router, Quota |
| Analysis | Usage, Sessions, Cost, Prices, Rankings, Health |
| System | Detail, Logs, Settings |

Pinned under the rail: **Prices** (link) and **Live tail** (opens the log
drawer). Each view has a hash URL such as `#/Usage`; project, provider and model
filters ride in the hash so a filtered view can be shared.

## Page-by-page

| View | What it shows |
|---|---|
| **Home** | The live board. Four scorecards (Sessions in flight, Agents alive, Calls · tokens over the last 5 min, Active alerts); the **Task queue** railway (Depot → On the line → Yard) directly under the scorecards at every width; fleet tiles; the **In progress now** session table (state and current tool/phase live in its rows; every row carries an owner badge, a source tag and a short session id); an **Agents alive** panel; **Calls & tokens · last 6h**; **Local inference hosts**; an **Explore** strip of cards linking to other views. |
| **Flow** | Force-directed provider → model → task graph; draggable; shows the chats each node served. |
| **Router** | Per profile: primary model, fallback chain, auxiliary tasks, delegation, tier router and routing matrix, background workers, provider auth table, and the last 7 days of routing decisions. |
| **Quota** | Per profile and provider: usage windows, account balances, notes, from the Hermes quota plugin cache. |
| **Usage** | Provider distribution, calls by model, token share, daily activity, hourly distribution, latency, bandwidth, concurrency, cost by project, repo and branch. |
| **Sessions** | Project cross-views: weight selector, Project × model, Project × provider, Project trend, with a drill-down. |
| **Cost** | Cost by category, calls by task, cost by model, provider mix, cost by provider, context re-sent per session, cost attribution (by source, root session, cron job and tool). |
| **Prices** | Per-1M-token rates in use, where each rate came from, and a what-if calculator. |
| **Rankings** | OpenRouter's public top models by token usage, day / week / month. |
| **Health** | Success rate by model, recent failures, session lifecycle, session outcomes, tool reliability, delegated runs. |
| **Detail** | Activity heatmap, per-model detail table, Sessions → Tree, Context & compaction. |
| **Logs** | The searchable log page (events plus facets over the whole window). |
| **Settings** | Power model (electricity rate, GPU and host draw), refresh intervals, profile colours, profile logos. |

Global chrome (all views): the **fleet bar** (kind filter All / Hermes / PI /
Claude / Codex and profile chips), a date **Range** bar (1h / 6h / 12h / 24h /
7d / 30d / All presets, or From/To dates), project / provider / model filters,
refresh, theme toggle, the **Sound on / Sound off** toggle (on by default), a help (`?`) button, the
**Session finder**, per-session **timeline** and **transcript** modals, and the
**Live tail** drawer.

See [dashboard-guide.md](dashboard-guide.md) for what each KPI and column means.

## Screenshots

The repo currently contains **no screenshot image files**: `shots/` holds only
`projfilter_overflow.py`, and the root README references `docs/screenshot.png`,
which does not exist in the tree (**to confirm**: whether the image lives
elsewhere). To produce images, render the committed sample and capture it:

```bash
python3 tools/breakpoint_shots.py --out breakpoint-shots --file examples/reports/dashboard.html --chrome "$(which google-chrome-stable)"
```

This script is documented in [breakpoint-qa.md](breakpoint-qa.md) and needs the
dev extra (`pip install -e ".[dev]"`, Playwright). It captures five widths
(375, 768, 1024, 1440, 1920 px) in both themes.

## Supported agent sources

| Kind | Where its data comes from |
|---|---|
| Hermes | `state.db` SQLite files under each profile home (default `~/.hermes`) |
| PI | JSONL sessions under `~/.pi/agent-*/sessions/` |
| Claude Code | JSONL transcripts under `~/.claude/projects/` |
| Codex | JSONL rollouts under `~/.codex/sessions/` |
| Ollama | HTTP API of each configured endpoint |

Details in [data-sources.md](data-sources.md).
