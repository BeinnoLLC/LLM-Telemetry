# Dashboard guide

How to read each page. Source for every statement is the front end in
`src/llm_telemetry/web/` (`dashboard.html`, `js/`) unless another file is named.

## Global controls

| Control | Behaviour |
|---|---|
| **Header stamp** | "generated … · auto-refresh every 1 min", aged by `stampFreshness` so a frozen page says so (`palette.js`). |
| **Refresh** (↻) | Re-fetches data in place. |
| **Theme** | Dark is the default; light is stored in `localStorage` key `hermes-dash-theme`. |
| **Sound** (speaker icon) | Completion tone, off by default. See [Sounds](#sounds). |
| **?** | Opens the router help overlay ("How your work gets routed"). |
| **Range bar** | Presets `1h`, `6h`, `12h` (real hour-grain data), `24h`, `7d`, `30d`, `All`, or From/To dates. Hour presets and date pickers are mutually exclusive. On phones the bar collapses to one chip. |
| **Filter bar** | Project, provider and model selects. They compose with the range and the profile chips (one more row-filter step), apply to Usage / Cost / Flow / Health, and show a "Filtering: …" chip when active. They ride in the URL hash. |
| **Fleet bar** | Kind filter (All / Hermes / PI / Claude / Codex) with live-session counts; narrows the Live tiles only. Profile chips show/hide Hermes profiles (at least one stays on). **Manage** or **F** opens a dialog for groups, per-profile colour and logo. |
| **Attention card** | Appears above every view when any alert rule tripped; hidden when none. |
| **Transferred card** | Total data moved over the selected range, both directions, estimated (bytes ÷ 4.68 bytes/token). Shown before the KPI row because the up:down ratio is the point — whole conversations are re-sent to receive one reply. |

## Home (the live board)

**Scorecards** (`renderLiveKpis`, `js/live.js`):

| Card | Meaning |
|---|---|
| Sessions in flight | Open sessions right now across Hermes, PI, Claude and Codex ("open right now"). |
| Agents alive | `alive/total` gateway backends with a recent heartbeat. Alive means a heartbeat within 120 s (`ALIVE_THRESHOLD_S = 2 × 60 s`, `agents_alive.py`). Shows "—" when no heartbeat rows exist (unknown, not "all heartbeating"). |
| Calls · tokens | Calls and tokens over the last 5 minutes, derived poll-to-poll from the live feed (shows "measuring…" until 5 minutes of samples exist), with a sparkline. |
| Active alerts | Number of tripped rules; red when any is critical; lists the two most severe plus "+N more"; "All clear" when none. Clicking opens Health. |

**Fleet tiles** — one tile per live session source; kind badges: Hermes (◉), PI
(⚙), Claude and Codex (brand marks).

**In progress now** — the live session table. Columns (`LV_COLS`):

| Column | Meaning |
|---|---|
| Kind | Hermes / PI / Claude / Codex. |
| Session | Title (two-line cell). |
| Model | Short model name plus provider badge. |
| State | `Running`, `Waiting` or `Idle`, with time since the session began. Hermes: idle when no activity for more than 120 s (`TILE_IDLE_S`). PI/Claude/Codex: idle when the phase is idle; waiting when the phase mentions wait, approval, blocked or input. |
| Tokens | Input + output tokens. |
| Cost | Estimated cost for the session. For Claude/Codex rows see [Cost policy](#cost-policy). |
| Last activity | Time since last event, current phase (a tool name, "thinking", "responding", "idle") and up to three tool chips. |
| Load | Context-window gauge (percent) and bandwidth. |

Headers are sortable (`lvSort`). Rows are roomy (about 48–56 px, two-line cells)
rather than dense.

**Other Home panels:** *Agents alive* (gateway backends and mid-turn leases),
*By category*, *Tool calls · last hour*, *Task queue*, *Calls & tokens · last 6h*,
*Local inference hosts*, *Explore* cards.

**Task queue** is a railway: **Depot** = requests waiting at an Ollama host,
**On the line** = live sessions coupled as a train (engine = most recently
active), **Yard** = recently finished sessions. Cars are keyed so a poll never
restarts motion; hover or focus a car for detail.

**Local inference hosts** — per physical host: GPU/CPU/VRAM load, queue depth,
capability pills, loaded-model residency, and a pressure indicator.

## Usage

KPI row (`#kpis`, `views.js`):

| KPI | Meaning |
|---|---|
| API calls | Recorded model calls in the selected range (with sparkline). |
| Tokens | Input + output tokens. |
| Cache hit rate | Cache-read share; ring turns warn below 60 %, bad below 30 %. |
| Sessions | Sessions in range. |
| Success rate | Successes ÷ (successes + failures) over this profile's models; ring warns below 95 %, bad below 80 %. |
| In progress | Live count; deliberately **not** date-filtered. |
| Est. cost | Sum of `market_value_usd` over the rows in range. For metered providers that is real spend; for subscription and local traffic it is the market-equivalent value. Local models' electricity is included and shown as "incl. $x". |

Panels: Provider distribution (calls), Calls by model, Token share, Daily
activity, Hourly distribution, Latency, Bandwidth (daily transfer, internet vs
LAN; context re-send by model = prompt tokens sent per fresh token), Concurrency
(peak parallel sessions), Cost by project, Repo & branch (repo derived from the
session's `cwd`).

An **unpriced banner** appears when a metered model has no catalogue rate,
because it would otherwise silently count as $0.

## Sessions

Project views: *Weight by* selector (what the matrix measures), *Project ×
model*, *Project × provider*, *Project trend*, and a drill-down per project
(keyboard: Enter/Space to open, Esc to close).

## Cost

Cost by category, Calls by task, Cost by model, Provider mix, Cost by provider,
Context re-sent per session, and **Cost attribution** (by source, root
session, cron job and tool, with a monthly projection derived from the
30-day window — labelled as a projection, `cost_attribution.py`).

## Prices

The per-1M-token input/output/cache rate applied to each model, where the rate
came from (vendor page, OpenRouter catalogue, or the local-electricity model),
what observed traffic cost at that rate, provider tabs, and a **what-if**
calculator that parses token counts and prices them. Header carries the
catalogue TTL (6 h). Local models are not free: electricity is a separate
figure (`energy_usd`) never folded into billed spend.

## Rankings

OpenRouter's public top models by token usage with a day / week / month chooser
and the attribution line. Says "unavailable" with the reason when the key is
missing or the request failed; a stale snapshot is marked stale.

## Health

| Panel | Meaning |
|---|---|
| Success rate by model | Successes vs failures, failure kinds broken out. |
| Recent failures | Parsed from `errors.log`, grouped and cleaned (`failures.py`). |
| Session lifecycle | Sessions ended in 30 days, **Orphan reaps** (agent died mid-turn), **Ended silently**, **Ended cleanly** %. |
| Session outcomes | Why sessions ended (reason breakdown, abnormal ones flagged). |
| Tool reliability | Measured tool success rate and call counts. |
| Delegated runs | Completion rate by model, why runs ended early, tool success inside runs, recent runs. |

## Detail

Activity heatmap, *Per-model detail* table (CSV export), *Sessions → Tree*
(parent/child orchestration tree with source badges), and *Context & compaction*
(context growth per session, compaction yield, reasoning share; sizes are
estimates from stored bytes).

## Flow

Provider → model → task force graph. Drag nodes; touch is supported. Controls in
the card header. Colours are the shared palette.

## Router

Per profile, folding cards with sub-pages: responsibility chart, routing matrix
(category × level → tier), background workers, provider auth table (type,
credential *source*, pool status — never a secret), and recent routing
decisions (7 days). Fold state and page choice persist in `localStorage`.

## Quota

KPI tiles: providers, `available/total`, *near limit*, *keys usable*. Per
profile and provider: usage windows with bars, account balances, account
state/expiry/origin, provider notes. Bar colour (`qvLevel`): bad at or above
the attention threshold (`attention_percent` from the payload), warn from 60 %
(or the threshold if lower), otherwise ok; muted when usage is unknown. Data is
the plugin cache, so a stale cache means stale bars.

## Logs and the Live tail drawer

- **Live tail drawer** — available on every view (press **L**, or the Live tail
  entry in the rail): a chronological feed of model failures from `errors.log`
  and tool events from live sessions, filterable by tab.
- **Logs view** — searchable full page. Facet counts are true totals over the
  window even though the event list is capped at 5000 newest rows; the page says
  how many are shown.

## Settings

- **Electricity & hardware** — electricity rate ($/kWh), GPU draw (W), host
  overhead (W); explains how a local token is priced; saved through
  `POST /api/settings` on the serve process (loopback only).
- **Refresh intervals** — live poll (1–60 s) and analytics rebuild (10–600 s),
  applied without reload.
- **Profile colours** and **Profile logos** (per-profile identity).

## Cost policy

1. **Metered** providers (fireworks, openrouter, deepseek, ollama-cloud): real
   spend; `billed_usd` = market value.
2. **Subscription** providers (anthropic OAuth, opencode-go, openai-codex,
   copilot, nous) and **local** hardware: a market-equivalent value is computed
   but `billed_usd` stays 0 (`pricing.py`).
3. **Local models** cost electricity (`energy_usd`) from throughput × the
   configured tariff; never presented as free, never presented as an invoice.
4. **Claude Code / Codex live sessions** (`agent_live`): tokens are counted and
   the API-price equivalent is shown **muted with a "sub" badge**, tooltip "API-price
   equivalent, covered by your Claude/ChatGPT subscription"
   (`coveredCost` in `live.js`). It is **not** added to any spend total, and
   the Est. cost KPI sums analytics rows only, which do not include
   `agent_live`. If a model has no rate, the cost is `null` and shown as "—",
   never $0.
5. A metered row with no catalogue rate raises the `unpriced_cloud_model`
   alert and the unpriced banner.

## Alerts

Evaluated server-side in `src/llm_telemetry/alerts.py` (`RULES`); the page only
renders them. Every rule carries a `why` string shown on hover, stating that
thresholds are opinions.

| Rule | Severity | View | Trips when |
|---|---|---|---|
| `unpriced_cloud_model` | warning | Cost | a metered model has no catalogue rate |
| `delegation_failure_rate` | critical | Health | delegation child failure rate above 25 % over the last 7 days |
| `orphan_reap` | critical | Usage | sessions reaped as orphaned in the last 24 h |
| `backend_stale` | warning | Live | a gateway backend stale or dead for more than 10 minutes |
| `long_running_session` | info | Live | a live session running over 3 hours |
| `tool_failure_high` | warning | Health | a tool above 20 % failure over at least 5 calls |
| `bandwidth_spike` | info | Usage | today's bandwidth at 3× the trailing mean |
| `compression_failure` | warning | Detail | a session in a compaction-failure cooldown |

## Sounds

Off by default; turning it on is the user gesture browsers require (Web Audio,
no audio files). Two quiet tones (gain 0.06, under 300 ms): a rising two-note
chime (880 Hz then ≈1174.66 Hz) for success, a single low note (220 Hz) for
failure. Completions within 2 s are debounced into one tone, escalating to the
failure tone if any failed. A baseline snapshot, a profile switch, and an
unfinished delegation never trigger a sound (`playTone`, `scheduleTone`,
`checkCompletions` in `live.js`).

## Keyboard shortcuts

| Key | Action |
|---|---|
| `/` | Open the Session finder (not while typing in an input) |
| ↑ / ↓, Enter, Esc | Navigate, open, close the Session finder |
| `F` | Open/close the fleet **Manage** dialog (ignored while typing, with another dialog open, or on key repeat) |
| `L` | Toggle the Live tail drawer (not while typing) |
| Esc | Close the open dialog, drawer, nav or help overlay |
| ← / → / Home / End | Move within the fleet bar kind filter and profile chips |
| ← / → / Enter in the session timeline | Move between spans / open (`drawer.js`) |
| Enter / Space | Open a project drill-down cell |

**Session finder** query syntax: free text plus `model:`, `source:`, `tool:`,
`end:`, `cost>N`, `dur>Nh` over the session index; message-body full-text is
explicitly not covered.
