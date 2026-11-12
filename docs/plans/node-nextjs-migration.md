# Plan: migrate LLM-Telemetry from Python to Next.js (App Router, TypeScript)

**Status:** plan only — no source changes in this document's commit.
**Branch:** `docs/node-migration-plan` off `origin/main` (`bfab5b4`).
**Brief:** Hazem's `llmt-hive-page-and-nav.md` §5 (read in full), especially the
required ORDER: (1) Next.js app shell + new nav + Hive theme tokens
(Plane LLMTELEMET-277/278), (2) the Hive page in Next.js (re-target
LLMTELEMET-268..276, epic 267), (3) port remaining pages and collectors/APIs one
at a time, each with a parity check vs the Python version.
**Scope:** LLM-Telemetry (`/home/hazemhagrass/workspace/beinno/LLM-Telemtry`) and
Hive (`/home/hazemhagrass/workspace/beinno/hive`, READ ONLY reference:
`server.py` 332 lines aiohttp+WebSocket :8790, `index.html` 718+ lines).

**Non-negotiables carried through the whole migration**

- The Python stack (systemd `hermes-dash-http.service` →
  `.venv/bin/llm-telemetry serve 8477`, `build_dashboard`, collectors on
  cron/timers) **stays live until full parity and Hazem's explicit cutover OK.**
- Data stores stay compatible: JSON artifacts (`reports_dir`, default
  `~/.local/share/llm-telemetry/reports`, config-driven — the
  `~/.hermes/reports/*.json` paths in ops notes are the same artifacts under the
  deployed config) with `schema_version` stamps validated against
  `src/llm_telemetry/schema/*.schema.json`, and the analytics SQLite
  (`analytics_store.py`: `raw_events`, `orchestration_edges`) — both stacks read
  the same files during overlap. No data loss, no schema break without a bump.
- **Jar balls show provider SVG icons via `provLogoSvg`/`provOf`, NEVER letters**
  (AGENTS.md hard rule). The guard `tests/check_qt_ball_provider_icons.js` is
  ported to the new test stack **un-loosened**; a sibling guard protects Hive
  provider marks.
- Real data only, no simulation, anywhere (Hive F45 and the whole dashboard).
- The standalone Hive (`beinno-hive`, :8790) keeps running until the Hive page
  passes the full parity checklist and Hazem OKs its retirement.
- Cutover happens only with Hazem's OK. Python stays as rollback for **14 days**
  after cutover (see §12).

Everything below was verified against the repo at `bfab5b4` unless marked
**(assumption)**.

---

## 1. Inventory — Python modules (47 files, 10,496 lines)

`src/llm_telemetry/`, line counts from `wc -l`. Difficulty: **L**ow /
**M**edium / **H**igh (port effort and risk, not importance). Roles:
**C**ollector (writes an artifact), **B**uilder (assembles an artifact),
**S**erver/CLI, **L**ib (pure logic), **D**ata store.

| Module | Lines | Role | Inputs → Outputs | Port difficulty |
|---|---|---|---|---|
| `collect_analytics.py` | 943 | C | each profile's `state.db` (ro sqlite), `logs/errors.log`, pricing catalogue → `analytics-data.json` (day+hour grain rows, sessions, health, delegations, outcomes, latency, tools, bandwidth, attribution, compaction, repo/branch, session index, alerts) | **H** — biggest module; every sub-section has its own tests |
| `pricing.py` | 727 | L/C | OpenRouter API + local/special model rules → `pricing-cache.json`; price lookups for everything | **H** — rate rules, cloud/local/special cases; live-rate tests |
| `collect_router.py` | 483 | C | router config + decision logs → `router-data.json` | M |
| `probe_hosts.py` | 472 | C | Ollama endpoints over HTTP → `ollama-data.json` | M |
| `collect_agent_worker_live.py` | 422 | C | `~/.claude`/`~/.codex` + per-login homes, JSONL transcripts → rows inside `live-data.json` (`agent_live`) | M |
| `analytics_store.py` | 422 | D | ingest API → analytics SQLite (`raw_events`, `orchestration_edges` + indexes) | **H** — must stay byte-compatible; shared by both stacks |
| `collect_live.py` | 410 | C | profile `state.db` (3 indexed queries), heartbeats, error tail, ollama cache, pi/agent-live sub-collectors → `live-data.json` (atomic write) | M |
| `detect_orchestration.py` | 403 | L | event rows → orchestration edge detection | M |
| `serve.py` | 384 | S | stdlib `ThreadingHTTPServer`; serves reports + `/api/refresh`, `/api/settings`; no-store headers | **H** — replaced wholesale by Next.js route handlers (§5) |
| `collect_quota.py` | 379 | C | provider quota APIs/cache → `quota-data.json`, `quota-history.json` | M |
| `doctor.py` | 361 | S | read-only preflight (config, DBs, artifacts, timers, hosts) → CLI report | L (CLI-only, port last) |
| `collect_pi_agents.py` | 323 | C | `~/.pi/agent-*/sessions/**.jsonl` → analytics store ingest rows | M |
| `collect_hermes_profiles.py` | 295 | C | Hermes profile state DBs → analytics store ingest rows | M |
| `build_costs.py` | 275 | B | pricing cache + usage rows → `costs-data.json` | M |
| `collect_pi_live.py` | 262 | C | `~/.pi/**.jsonl` (mtime ≤ 180 s = live) → rows inside `live-data.json` (`pi_live`) | L |
| `config.py` | 255 | L | env/config file discovery → resolved config (`reports_dir`, profiles, hosts) | L |
| `webassets.py` | 226 | B | web js/css + `order.json` → inlined `dashboard.html` | **H** conceptually — the inlining model dies with Next.js bundling; the *checks* it guards (order, module manifest) move to vitest |
| `collect_rankings.py` | 210 | C | OpenRouter rankings API → `rankings-data.json` | L |
| `alerts.py` | 202 | L | analytics rows → evaluated alert objects | L |
| `collect_logs.py` | 185 | C | profile error logs → `logs-data.json` | L |
| `delegations.py` | 180 | L | events → delegation trees/alerts | L |
| `schema_check.py` | 175 | L | artifact JSON vs `schema/*.schema.json` → validation report | L |
| `collect_session_timeline.py` | 169 | C | session transcripts → `sessions/<profile>/<id>.json` | M |
| `cost_attribution.py` | 151 | L | usage rows → `cost_class` attribution (subscription-covered policy) | M |
| `build_dashboard.py` | 138 | B | runs collectors, assembles `dashboard.html` via `webassets.py` | L in Next.js world (replaced by `next build`) |
| `bandwidth_history.py` | 132 | L | bytes/tokens history series | L |
| `context_compaction.py` | 127 | L | compaction metrics | L |
| `ingest_all.py` | 126 | S | orchestrates ingest → analytics store | L |
| `collect_context_compaction.py` | 124 | C | compaction events → analytics payload section | L |
| `failures.py` | 121 | L | failure classification | L |
| `bandwidth.py` | 120 | L | bytes-per-token math | L |
| `session_timeline.py` | 116 | L | timeline shaping | L |
| `tool_outcomes.py` | 107 | L | tool call outcomes | L |
| `collect_transcripts.py` | 106 | C | live session chats → `transcripts.json` | L |
| `collect_repo_branch.py` | 101 | C | repo/branch per session → analytics section | L |
| `projects.py` | 99 | L | project-of derivation | L |
| `stale.py` | 98 | L | stale-session policy | L |
| `collect_kanban.py` | 97 | C | kanban boards (sqlite ro) → kanban section | L |
| `collect_session_index.py` | 96 | C | session finder index → analytics section | L |
| `latency.py` | 94 | L | latency series | L |
| `ingest_pi.py` | 92 | S | PI ingest CLI | L |
| `cli.py` | 86 | S | argparse dispatch for all commands | L |
| `agents_alive.py` | 74 | L | alive detection | L |
| `energy.py` | 61 | L | energy cost math | L |
| `build_rankings.py` | 47 | B | rankings payload shaping | L |
| `schema.py` | 17 | L | `SCHEMA_VERSION` stamp helper | L |
| `__init__.py` | 3 | L | package marker | — |

Schemas: `schema/analytics.schema.json`, `live.schema.json`, `ollama.schema.json`,
`router.schema.json`. The Node collectors must produce artifacts that pass the
**same** schema files (the JSON Schemas stay as the contract; a Node port that
fails `schema_check` parity is a bug).

**How collectors are scheduled today (verified read-only):**

| Scheduler | Job |
|---|---|
| cron `* * * * *` | `~/.hermes/bin/refresh-dashboard.sh` — full build/collect cycle (repo has `scripts/refresh-dashboard.sh`; the cron copy runs the same collectors **(assumption: the ~/.hermes copy matches repo `scripts/`)**) |
| cron `0 * * * *` | `~/.hermes/bin/quota-refresh.sh` — router+quota hourly |
| cron `17 */6 * * *` | `~/.hermes/bin/pricing.py --force` — pricing catalogue |
| systemd `hermes-live-export.timer` (5 s) | `llm-telemetry live` → `live-data.json` |
| systemd `hermes-ollama-probe.timer` (5 s) | `llm-telemetry probe` → `ollama-data.json` |
| systemd `hermes-fleet-sync.timer` (hourly) | fleet bot regen (Hermes-side, out of scope) |
| systemd `hermes-dash-http.service` | `llm-telemetry serve 8477` (the Python server that stays live) |

## 2. Inventory — dashboard views (16 + Hive) and their JS (14 modules, 11,133 lines)

Views live as `data-view` divs in `web/dashboard.html`; routing is hash-based
(`router.js` `viewFromHash`/`pickView`, `NAV_GROUPS`, `VIEW_ALIASES`).
`views.js` is a monolith of per-view renderers.

| View (slug) | Primary JS | Reuse vs rewrite in Next.js |
|---|---|---|
| Home (live board; `#/live` aliases here) | `live.js` + `views.js` | **Rewrite as React components**; reuse pure formatting/predicates (`palette.js` `ago/esc`, title rules) as-is |
| Life (flow/jar view) | `flow.js` (1,105) + `arena.js` (351) | **Rewrite** canvas/DOM scene as a client component; keep `provLogoSvg`/`provOf` icon pipeline verbatim (hard rule); jar-ball guard ported |
| Flow | `flow.js` | same as Life (shared scene code) |
| Router | `routerview.js` (462) | Rewrite; table/charts helpers reused |
| Orchestration | `views.js` section | Rewrite; `detect_orchestration.py` output shape unchanged |
| Kanban | `views.js` section | Rewrite |
| Quota | `quotaview.js` (561) | Rewrite; gauge math reused |
| Usage | `views.js` | Rewrite |
| Sessions | `views.js` + `drawer.js` (840) | Rewrite; `drawer.js` becomes a shared detail-drawer component |
| Cost | `views.js` + `charts.js` (367) | Rewrite; `charts.js` canvas primitives reused as-is inside client components |
| Prices | `views.js` | Rewrite |
| Rankings | `views.js` | Rewrite |
| Health | `views.js` | Rewrite |
| Detail | `views.js` | Rewrite |
| Logs | `views.js` + `table.js` (185) | Rewrite; `table.js` reused |
| Settings | `router.js` settings section | Rewrite |
| **Hive** (new) | port of Hive `index.html` scene | New (see §6 + hive-tab plan); NOT in this repo's JS yet (in-flight `feat/live-nav-regroup` adds a placeholder — **assumption:** that branch is not yet pushed; `git ls-remote` at plan time showed no `feat/live-nav-regroup`) |

**Reuse-as-is candidates (plain functions, no DOM):** `palette.js` (492:
`ago/esc` and formatting), `charts.js` primitives, `table.js`, `state.js` (47),
`diffdom.js` (208 — superseded by React's own diffing, expect to drop),
`main.js` (186 — boot glue, dropped), `webassets.py` inlining (dropped).
Everything DOM-driven (`views.js` renderers, `router.js` nav/hash,
`drawer.js`, `quotaview.js`, `routerview.js`, `live.js` polling loop,
`flow.js`/`arena.js` scenes) is ported to React/TS, in most cases by wrapping
the existing pure helpers so logic (pricing math, filters, icon SVGs) does not
drift.

## 3. Inventory — tests (63 Python, 128 JS) and their port

| Suite | Count | Today | Ports to |
|---|---|---|---|
| Python unit (`tests/test_*.py`) | 63 | pytest (`.venv/bin/python -m pytest`) | **vitest** (node), one file per Python test, keeping fixture shapes; collector tests become vitest against the Node collectors with the **same fixtures** (relative `now − 1 h` timestamps, never fixed epochs — known past-rot pitfall) |
| JS DOM/guard (`tests/check_*.js`) | 127 + `run-all.js` | jsdom + `tests/lib/isolate.mjs` on Node 24 | **vitest + jsdom** — most keep their assertions verbatim; `isolate.mjs` stub discipline carries over (stubs must name only real imports) |
| Browser behaviours (canvas, audio unlock, hidden-tab rAF, visual) | subset of checks (e.g. `check_completion_sound.js`, canvas/arena checks) | jsdom approximations | **Playwright** (real Chromium) — this is where hidden-tab rAF/canvas truth lives (known pitfall: canvas stays 300×150 in background tabs) |
| `tests/check_qt_ball_provider_icons.js` | 1 | guard | **Ported 1:1, un-loosened** (AGENTS.md). Sibling `check_hive_provider_icons.js` added for Hive |
| `tests/test_page_weight.py` | 1 | dashboard.html ≤ 960,000 B | Replaced by a Next.js **route-weight/bundle budget** test (vitest + `next build` output sizes; initial budget proposed ≤ 1.2 MB total first-load JS+CSS for the shell — set precisely in T-2 and blessed by Hazem if it must move) |
| Schema/leak gates (`check_schema_version.js`, `test_schema.py`, `examples/check_no_leaks.py`) | 3 | mixed | vitest + a node port of the leak gate (samples carry nothing identifying) |

No test is dropped; anything unported must be explicitly listed in the ticket
that removes it (none expected).

## 4. Target architecture and repo layout

Same repo (`BeinnoLLC/LLM-Telemtry`), Node **24** (matches CI today; jsdom 30
requires ^22.22.2 / ^24.15 / ≥26), package manager **npm** (matches the repo's
existing root `package-lock.json` tooling; no pnpm/bun churn).

```
LLM-Telemtry/
  apps/web/                  # Next.js 15 App Router, TypeScript, strict
    app/
      layout.tsx             # shell: left nav (new groups), theme provider
      page.tsx               # Home (live board)
      (views)/…              # one route group per ported view
      api/
        refresh/route.ts     # POST trigger collect cycle (parity with /api/refresh)
        settings/route.ts
        hive/route.ts        # snapshot + ?since= polling fallback
        hive/stream/route.ts # SSE (Route Handler, runtime='nodejs')
        events/stream/route.ts  # dashboard live deltas (SSE)
    components/              # KPI cards, tables, drawer, charts wrappers
    lib/                     # ported pure logic (pricing, palette, icons, schema)
    styles/tokens.css        # Hive theme as SEMANTIC tokens (LLMTELEMET-278)
  packages/collectors/       # Node port of collectors + parity harness CLI
  src/llm_telemetry/         # PYTHON STAYS until cutover + 14 days
  tests/                     # existing suites during overlap; vitest/playwright move to apps/web/tests + packages/collectors/tests
  docs/plans/node-nextjs-migration.md   # this file
```

- **Dev port: 8480** (`next dev -p 8480`), prod preview `next start -p 8481`.
  Verified free at plan time; deliberately NOT 8477 (Python dashboard) and NOT
  8790 (standalone Hive).
- **Semantic theme tokens** (LLMTELEMET-278) in `styles/tokens.css` as CSS
  custom properties: `--bg #05060a`, `--fg #f5f5f5`, `--mute #8a8f9a`,
  `--card #0f1118`, `--border #1d2130`, `--border-strong #262a36`,
  `--accent #8af`, `--live #5f8` (green live dot with glow),
  `--title-grad (#6cf → #f6c → #7f9 → #fc6) animated, `--radius 10px`, Inter /
  system font, `font-variant-numeric: tabular-nums`. Components consume tokens
  only — no hard-coded colors per component. WCAG AA contrast preserved,
  `prefers-reduced-motion` honored (gradient/dot glow park to static), text
  labels always kept so meaning never relies on a face/icon alone.

### Live feeds

- **Dashboard live data:** SSE from Next.js Route Handlers
  (`app/api/events/stream/route.ts`, `runtime='nodejs'`, `export const dynamic
  ='force-dynamic'`), backed by the collectors' artifacts. Delta semantics
  mirror the Hive design (below): `id:` = seq, heartbeat comment ≤ 20 s,
  `Last-Event-ID` resume from an in-process bounded ring; `?since=` JSON
  endpoint as the polling fallback (identical logic, lossless).
- **Hive WebSocket replacement:** SSE in a Route Handler + `?since=` polling
  fallback, exactly the wire contract already specified in
  `docs/plans/hive-tab.md` §2.2–2.3 (snapshot on connect, delta frames
  `{seq, at, type: event|comm, …}` unchanged from `server.py`'s broadcast
  shape, so the ported client logic runs unmodified). One collector loop per
  process regardless of client count (the Node port of `server.py`'s
  `collect()`/`diff()` in `packages/collectors` — S1–S11 from the hive plan).
  If SSE-in-route-handler proves flaky under load, fallback is a tiny
  `node:http` server (`packages/collectors/server.ts`) speaking only
  `/api/hive*` + `/api/events*`; decision recorded in T-7 acceptance.
  Stream cap (8 concurrent, 9th → 503 + client auto-fallback to polling) and
  idle recycle carry over from the hive plan.

### Collectors as Node jobs

- `packages/collectors` exposes a CLI (`node packages/collectors/dist/cli.js
  <collect|live|probe|router|quota|analytics|costs|rankings|logs|transcripts|
  session-timeline|ingest…>`) mirroring `cli.py` subcommands one-to-one.
- **Scheduler: keep the OS schedulers** (systemd user timers + crontab) calling
  the Node CLI — same cadences as §1's table, just a different interpreter. No
  in-process cron daemon: the Python deployment already proved timers+cron, and
  both stacks can then run the *same schedule definition* during overlap
  (pointed at different output dirs for the Node side until cutover, then at
  the shared `reports_dir`). A `node-cron`-style in-app scheduler is rejected:
  it couples collection lifetime to the web process and breaks the 5 s timer
  model. **(assumption: systemd timers can call `node` from PATH in the user
  session; will pin the absolute node path in the unit, same as the current
  unit pins `.venv/bin/llm-telemetry`.)**
- Artifact writes stay **atomic (temp file + rename)** and keep the same keys
  and `schema_version`, so Python's `serve.py` can keep reading them and vice
  versa — this is the core overlap guarantee.

### SQLite

- **`better-sqlite3`** — synchronous API matches Python `sqlite3` semantics
  1:1, mature, supports `readonly: true` open mode (needed for the kanban
  `state.db`/boards reads and `analytics_store`). Alternative considered:
  Node 24's built-in `node:sqlite` (zero dep, still marked experimental in 24 —
  **(assumption: experimental status; re-verify before T-11)**); Prisma/Drizzle
  rejected (ORM mapping churn over an existing hand-built schema).
- `analytics_store.py` schema is created with `CREATE TABLE IF NOT EXISTS`, so
  the Node writer can share the file safely **only after cutover**; during
  overlap the Node ingest writes to a shadow copy
  (`analytics-node.db`) for parity diffing (§7), and takes over the real file
  at cutover.

## 5. Port order (Hazem's order, phase → ticket mapping)

**Phase 0 — foundation.** **Phase 1 — app shell + nav + theme (277/278).**
**Phase 2 — Hive page in Next.js (re-targeted 268..276).** **Phase 3 — page +
collector/API ports one at a time with parity checks.** **Phase 4 — cutover
preparation and runbook (Hazem OK required).**

## 6. Hive page in Next.js (re-targeted tickets)

Feature inventory and the PASS/FAIL parity checklist are **already written** in
`.worktrees/hive-plan/docs/plans/hive-tab.md` §1 (F1–F45, S1–S11) and §6 — the
Next.js Hive page uses that checklist verbatim as its acceptance gate. The
tickets LLMTELEMET-268..276 (epic 267) are re-targeted from "tab inside the
Python `dashboard.html`" to "route `/hive` in `apps/web`":

| Plane | Re-targeted scope |
|---|---|
| 268 (H-1) | Collector port → `packages/collectors/hive` (Node): S1–S8, S11, YAML fleet reader (or `yaml` dep — allowed on Node), redaction, sqlite ro board reads, `diff()` real-events-only |
| 269 (H-2) | `/api/hive` + `/api/hive/stream` SSE route handlers + `?since=` ring (wire-compatible frames) |
| 270 (H-3) | Per-face model + spend join from `live-data.json` / `analytics-data.json` / `costs-data.json` / `ollama-data.json` + `cost_class` subscription labelling |
| 271 (H-4) | Hive route shell: hex stage, faces (polygon-only, never circles), moods, states, view switcher, tooltips; provider marks via `provLogoSvg` |
| 272 (H-5) | FX layer + anger 0–3 model |
| 273 (H-6) | Sound + voice (audio unlock on first gesture, voice names the project) |
| 274 (H-7) | Comms/events/replay/firing mode, bubbles ≤ 2 |
| 275 (H-8) | Parity checklist PASS/FAIL vs frozen `index.html` reference + screenshots 1920×1080 & mobile, zero console errors, 24 h soak |
| 276 (H-9) | Retire `beinno-hive` — **only after 275 fully passes AND Hazem's OK**; runbook = hive-tab plan §3.0 |

## 7. Parity harness (same inputs, same numbers)

`packages/collectors/parity/` + `npm run parity -- <collector>`:

1. Freeze fixture input trees (fleet YAMLs, kanban sqlite, delivery JSONs,
   transcript JSONLs, a scrubbed `state.db`) under
   `packages/collectors/parity/fixtures/` — relative timestamps only.
2. Run the Python collector (`.venv/bin/python -m llm_telemetry.collect_*`)
   with `reports_dir` pointed at `parity/out/py/`; run the Node collector with
   the same inputs into `parity/out/node/`.
3. Normalize (drop `generated`/`at` timestamps, sort object keys) and **diff
   the JSON structurally**; the harness prints a field-level diff and exits
   non-zero on any value mismatch. Numbers (tokens, USD, counts) must match
   exactly — no tolerances except documented float formatting.
4. For live sources (Ollama probe, OpenRouter pricing) parity runs against
   recorded HTTP cassettes so both sides see identical responses.
5. Each ported page also gets a **UI parity check**: Python `serve.py` :8477 vs
   Next :8480 side by side, same fixture data, same numbers rendered (Playwright
   screenshots both, plus a DOM number extraction diff).

The harness runs in CI for every fixture set; live-cassette parity runs nightly
locally (not in CI — network flakiness must not gate merges).

## 8. CI changes (`.github/workflows/ci.yml`)

- Keep: Python job during overlap (`pip install -e .`, ruff, mypy, pytest) so
  the Python stack stays provably green as rollback.
- Add: Node 24 job — `npm ci` at root and `apps/web`, `next lint` + `tsc
  --noEmit`, vitest (jsdom), Playwright (chromium) for browser checks, collector
  parity harness on fixtures, bundle/route weight budget gate, leak gate port.
- The ESLint/stylelint web-source gate keeps running until the old `web/` tree
  is deleted at cutover.
- Post-cutover: Python job shrinks to `schema_check` + parity harness (the
  schemas and artifacts remain shared), then to removal after the rollback
  window.

## 9. Hard rules that carry over (re-stated for implementers)

1. Jar balls / any provider mark: `provLogoSvg`/`provOf` **SVG icons, never
   letters**. `check_qt_ball_provider_icons.js` ported un-loosened; add
   `check_hive_provider_icons.js`. If a logo looks small, add a contrast disc or
   raise size — never letters.
2. Real data only, no simulation (Hive F45 and every view). Missing artifact →
   "n/a", never an invented number.
3. Page-weight analog: the Next.js bundle budget gate (§3) replaces
   `test_page_weight.py`; moving the budget is a deliberate, user-blessed change.
4. WCAG AA contrast, `prefers-reduced-motion`, text labels beside color/face
   meaning (theme tokens §4).
5. Hive faces stay polygon-only (no inner circles/discs; hexagon rings).
6. Stubs/fixtures discipline: test stubs name only real imports; time-windowed
   fixtures use `now − 1 h`, never fixed epochs.
7. Stage files by name (`git add <path>`), never `git add -A`.
8. No production deploy without asking; local dev deploys = `:8480` (Next) and
   `:8477` (Python, untouched).

## 10. Phased ticket list

Effort in hours (dev+test+parity evidence). "Parity check" = the evidence
required before the ticket closes.

| # | Title | Scope | Acceptance | Parity check | Deps | Hours |
|---|---|---|---|---|---|---|
| T-0 | Migration scaffold: `apps/web` Next.js 15 TS strict, npm workspaces, Node 24, dev on :8480, CI node job, vitest+playwright wired | repo layout §4 | `next dev` serves shell on 8480; CI green; zero-touch to Python tree | Python suite still green unchanged | — | 8 |
| T-1 | Semantic theme tokens (LLMTELEMET-278) | `styles/tokens.css`, theme provider, reduced-motion, AA contrast audit | All colors via tokens; contrast report; gradient/dot respect `prefers-reduced-motion` | Visual A/B vs Hive reference styling | T-0 | 8 |
| T-2 | App shell + new nav (LLMTELEMET-277 re-target): Live group (Live view + Hive), Usage/Costs, Models/Providers, Tasks/Queue, System; legacy `#/…` hash routes redirect (port `VIEW_ALIASES` incl. `live → Home`) | `app/layout.tsx`, nav component, redirect map | Every legacy slug resolves (redirect test ported from `check_nav_groups.js`); every view appears exactly once | Nav structure matches `feat/live-nav-regroup` output (rebase on it when it lands) | T-0, T-1 | 10 |
| T-3 | Live feed core: SSE route handler + `?since=` ring + heartbeat/resume/cap, port of `diffdom`-free delta logic | `app/api/events/stream`, `lib/live-feed` | Snapshot-on-connect, `id:` seq, resume, 503 cap, polling fallback identical | Frame-level diff vs Python polling output on same artifacts | T-0 | 12 |
| T-4 | Collector platform: CLI skeleton, artifact writer (atomic, `schema_version`, schema_check), config port, scheduler units (systemd+crontab calling Node CLI) | `packages/collectors` | `node … cli.js live|analytics|…` writes schema-passing artifacts; timers run side by side | `schema_check` passes on Node artifacts | T-0 | 12 |
| T-5 | Parity harness v1 (fixtures, normalize+diff, cassettes) | `packages/collectors/parity` | Harness runs py+node on same fixtures, field-level diff, CI-gated | Self-testing: seeded mismatch detected | T-4 | 10 |
| T-6 | Port collector: live slice (`collect_live` + `collect_pi_live` + `collect_agent_worker_live`) | collectors | Node `live` output ≡ Python on fixtures | Parity harness green + UI numbers match :8477 | T-4, T-5 | 14 |
| T-7 | Hive collector port (Plane 268) | `packages/collectors/hive` | S1–S11 behaviours; real-events-only `diff()`; redaction | Snapshot diff vs `server.py` `collect()` on same fixture trees | T-4, T-5 | 12 |
| T-8 | Hive feed API (Plane 269): `/api/hive`, `/api/hive/stream` SSE (WS replacement), `?since=` | route handlers | Wire-compatible frames; resume; cap; heartbeat | Frame diff vs `server.py` WS captures | T-7, T-3 | 12 |
| T-9 | Hive face model+spend join (Plane 270) | collectors/hive + lib | model+spend per face; `cost_class` labelling; missing→n/a | Numbers match Cost view numbers | T-7, T-6 | 8 |
| T-10 | Hive page: shell/graph/faces/moods (Plane 271) | `app/hive`, components | F1–F6, F9–F16; polygon-only; provider SVG marks; guard test | Checklist items ticked + screenshots | T-2, T-8 | 14 |
| T-11 | Hive FX + anger (Plane 272) | hive components | F7–F8, F14, F17–F21 | Checklist + anger maths tests | T-10 | 12 |
| T-12 | Hive sound+voice (Plane 273) | hive components | F22–F30; unlock-on-gesture; project-named voice | Audio graph tests + recording evidence | T-10 | 10 |
| T-13 | Hive comms/replay/firing (Plane 274) | hive components | F31–F45; bubbles ≤ 2; real-data-only | Checklist + quiet-source zero-phantom check | T-11, T-12 | 12 |
| T-14 | Hive parity QA + docs (Plane 275) | QA, guards, docs | Every F/S item PASS with evidence; 24 h soak; zero console errors | §6 checklist of hive-tab plan fully ticked | T-13 | 10 |
| T-15 | Collector: analytics + subs (`collect_analytics` + alerts/delegations/outcomes/latency/tools/bandwidth/attribution/compaction/repo-branch/session-index/kanban) | collectors | Node `analytics-data.json` ≡ Python on fixtures | Parity harness green; KPI numbers match | T-5, T-6 | 24 |
| T-16 | Collector: router + quota + probe + logs + transcripts + timeline + rankings | collectors | Artifacts ≡ Python | Parity harness green | T-5 | 16 |
| T-17 | Collector: pricing + costs (`pricing.py`, `build_costs.py`) incl. live rates + cassette replay | collectors | `costs-data.json` ≡ Python incl. price tables | Price-sheet diff; unpriced-handling tests | T-5 | 16 |
| T-18 | Collector: ingest (`collect_hermes_profiles`, `collect_pi_agents`, `ingest_all`, `ingest_pi`, `analytics_store`) → `better-sqlite3` shadow DB | collectors | Shadow `analytics-node.db` rows ≡ Python DB | Row-level SQL diff | T-15 | 14 |
| T-19 | API surface: `/api/refresh`, `/api/settings`, sessions/timeline endpoints as route handlers (parity with `serve.py` do_GET) | route handlers | Same JSON as `serve.py` endpoints | Response diff harness | T-3, T-15 | 10 |
| T-20 | Page port: Home (live board) | `app/page.tsx` | KPIs, live table, queue, sounds work; roomy table per UI prefs | Number-by-number vs :8477 Home | T-2, T-3, T-6 | 14 |
| T-21 | Page port: Life/Flow (jar scene, provider icons) | components | Jar balls = provider SVGs (guard ported); one scroll container | Guard + visual A/B vs Python | T-20 | 16 |
| T-22 | Page port: Usage, Cost, Prices | routes | Charts/tables identical numbers | UI parity diff | T-15, T-17, T-20 | 16 |
| T-23 | Page port: Sessions + drawer, Logs | routes | Drawer behaviours, transcripts modal | UI parity diff | T-15, T-19 | 14 |
| T-24 | Page port: Router, Rankings, Quota, Health | routes | Numbers identical | UI parity diff | T-16, T-20 | 16 |
| T-25 | Page port: Orchestration, Kanban, Detail, Settings | routes | Identical | UI parity diff | T-15, T-19 | 14 |
| T-26 | Test-suite migration completion: all 63 py + 127 js suites accounted for (vitest/playwright), `run-all.js` successor green, leak gate ported | tests | Every old test mapped; guard tests green; none loosened | Old vs new suite failure-line comparison vs clean main worktree | T-20..T-25 | 16 |
| T-27 | Docs + CI finalization: architecture/data-sources/setup docs rewritten for Node, CI python job slimmed | docs, CI | Docs match reality | Reviewer sign-off | T-26 | 8 |
| T-28 | Cutover rehearsal + runbook (§12), rollback drill on :8481, Hazem decision package | ops | Rehearsed cutover + rollback; 24 h dual-run report | Full parity report (harness + UI) | T-27, T-14 | 12 |

(Plane IDs for T-0..T-28 to be created via beinno-plane by the orchestrator;
268..276 keep their IDs per §6. Ticket count: **29** including the 9 re-targeted
Hive tickets; if the Plane board treats 268..276 as already-filing, net-new
tickets = T-0..T-28 = 29.)

## 11. Effort estimate

- **Total dev effort: ~356 h** (sum of table), realistic range **320–420 h**
  (parity debugging and visual QA are the variance drivers; the Hive FX/voice
  and `collect_analytics` are the riskiest rows).
- **One serial worker** (60-min-run workers with resumes, effective ~5–6 h/day
  on this project given the fleet load): **~9–12 calendar weeks**.
- **2 parallel workers** (one on Phase 2 Hive, one on collectors/pages; shared
  T-0..T-5 first): **~6–8 calendar weeks**. Parallelism is capped at 2 because
  parity evidence and the theme/nav shell are serial bottlenecks and the host
  runs other projects' jobs.
- Hive-only slice (Phases 1–2, T-0..T-14): **~154 h** → ~4–5 weeks serial,
  ~3 weeks parallel.

## 12. Cutover + rollback runbook

**Preconditions (all required):** T-28 parity report complete — collector
parity harness green on all fixtures + cassettes, every ported page's UI number
diff clean, Hive §6 checklist fully ticked with evidence, 24 h dual-run soak
without divergence, all guards green, **Hazem's explicit OK**.

**Cutover (single change window):**

1. Freeze: stop merging feature PRs; record Python commit SHA and artifact set.
2. Point Node collectors at the shared `reports_dir` (they already write
   byte-compatible artifacts), run one full cycle, `schema_check` pass.
3. Switch the Node app to prod: `next build && next start -p 8481` behind the
   existing reverse-proxy/port publish **(assumption: current access is
   direct :8477; if a proxy exists it flips the upstream; otherwise swap the
   port clients use — decided with Hazem at the rehearsal)**.
4. Keep `hermes-dash-http.service` running (rollback), but stop the *duplicate*
   Python collectors only after the Node timers have produced one full valid
   cycle; cron entries are edited with the previous commands saved in the
   runbook for instant restore.
5. Verify: KPI spot-check (10 headline numbers vs pre-cutover screenshots),
   SSE live feed, Hive page, `schema_check`, error logs.

**Rollback (≤ 14 days after cutover):** restore the saved cron lines, ensure
`hermes-dash-http.service` is serving :8477 (it never stopped), point clients
back at :8477, restart Node timers disabled. Because artifacts are shared and
schema-compatible, no data migration is involved in either direction — rollback
loses nothing. After 14 days of clean operation: remove Python serve/collectors,
keep `schema/*.schema.json` + parity harness (they guard the shared contract),
delete `web/` and the Python test job per T-27 follow-up. Anything not proven
by the parity harness is NOT deleted.

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Numeric drift in ported collectors (floats, ordering, window edges) | Parity harness with exact-match diff and recorded cassettes; fixtures use relative timestamps; every collector ticket must close with a green harness run |
| SSE in Next.js route handlers under long-lived connections (buffering, cold starts) | Route handler `runtime='nodejs'` + explicit flush + heartbeat; fallback `node:http` mini-server already scoped (T-3/T-8 decision gate); stream cap + polling fallback identical by construction |
| `better-sqlite3` native build vs Node 24 / CI | Pin prebuilt binaries; CI installs with the same Node; `node:sqlite` spike recorded as fallback |
| Hive parity drift (`index.html` keeps changing) | Freeze reference copy at Phase 2 start (hive-tab plan §3.0 step 2); new Hive features = follow-up tickets, never scope creep |
| Bundle growth vs the page-weight rule | Budget gate in CI from T-0; charts/FX as lazy client chunks; measure every ticket |
| Autoplay/audio regressions (Hive sounds, completion sounds) | Playwright real-browser audio tests; unlock-on-first-gesture assertions carried from `check_completion_sound.js` |
| Worker 60-min wall limits killing long tickets | Tickets sliced ≤ 16 h with commit-able acceptance slices; RESUME-from-worktree discipline (known pitfall) |
| Both stacks writing the same artifacts during overlap | Node writes to shadow dirs until cutover; single-writer rule documented in each collector ticket |
| `feat/live-nav-regroup` / LLMTELEMET-277 landing mid-migration | T-2 rebases on it; the redirect map test is shared, no duplicated nav logic |
| Price catalogue live-rate flakiness (OpenRouter) | Cassette replay for parity; live-rate fetch stays in the 6 h scheduler exactly as today |

## 14. Unverified assumptions (explicit)

1. `~/.hermes/bin/refresh-dashboard.sh` and `quota-refresh.sh` match the repo's
   `scripts/` versions (cron copies live outside the repo; read-only).
2. `feat/live-nav-regroup` exists only locally in a worker worktree at plan
   time (not on origin); T-2 must sync with it when pushed.
3. Node 24's `node:sqlite` experimental status (only matters if `better-sqlite3`
   fails).
4. Direct port access model (:8477 without reverse proxy) for cutover step 3.
5. systemd user timers can exec `node` with an absolute path in this user's
   session (expected; verified in T-4).
6. Reports dir naming: ops memory says `~/.hermes/reports/`, code default is
   `~/.local/share/llm-telemetry/reports` — the deployed config decides; both
   stacks read `config.py`'s resolved `reports_dir` today and the Node config
   port must resolve identically (T-4 acceptance).
