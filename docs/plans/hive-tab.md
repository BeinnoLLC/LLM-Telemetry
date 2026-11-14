# Plan: move Hive into LLM-Telemetry as a separate page

**Status:** plan only — no source code changes in this document's commit.
**Branch:** `docs/hive-tab-plan` off `main` (`bfab5b4`).
**Goal:** retire Donna's separate Hive app (now at `/home/hazemhagrass/workspace/beinno/hive/`,
aiohttp + WebSocket on :8790, systemd user unit `beinno-hive`) by moving every
feature into LLM-Telemetry as a separate `Hive` **page** in the left-nav
**Live** group (next to the Live view), served by the existing stdlib
`serve.py`. The standalone app keeps running until the page passes QA and the
user explicitly OKs its retirement.

**Ownership rule (important):** Hive stays a standalone project under
`~/workspace/beinno` UNTIL it is completely integrated into LLM-Telemetry; only
then does LLM-Telemetry become its home and the standalone one retires, with
Hazem's explicit OK. The old path `~/.hermes/profiles/beinno-donna/workspace/hive`
is now just a symlink to `/home/hazemhagrass/workspace/beinno/hive` (mentioned once).

**Canonical Hive source (read-only reference):** `/home/hazemhagrass/workspace/beinno/hive/`
(`index.html`, `server.py`). The beinno-hive systemd user unit now points at the
new path: `WorkingDirectory=/home/hazemhagrass/workspace/beinno/hive` (see
`~/.config/systemd/user/beinno-hive.service`, read-only).

Hive source is **read-only reference**. Snapshot note (refreshed): `index.html`
~57 KB (~1080 lines as of 2026-11-12 15:18), `server.py` ~13.9 KB (~332 lines);
faces are now polygon-only (see §1.1 F1/F2/F10/F20). `index.html` is actively
edited (several `.bak` files exist, incl. `index.html.bak-nocircle`); freeze a
reference copy at implementation start and diff against it during QA, since
Donna may keep changing the original. Line refs below are from this snapshot;
refs that could not be re-verified are marked `(approx)`.

---

## 0. Phases and Plane tickets (epic LLMTELEMET-267)

**Implementation note:** the Hive page is built in the **new Next.js app**
(migration epic **LLMTELEMET-280**, plan `docs/plans/node-nextjs-migration.md`
on branch `docs/node-migration-plan`); the Hive tickets H-1..H-7 below are that
plan's **T-7..T-14**. This document remains the feature and parity
specification (§1 inventory, §6 checklist).

| Phase | Plane ticket | Scope |
|---|---|---|
| (a) Nav regroup | **LLMTELEMET-277** | Left-nav regroup with redirects: a **Live** group holding the Live view (flow.js / Life view) and the new Hive **page**; merge duplicates, remove dead entries; old routes keep working via redirects |
| (b) Hive theme | **LLMTELEMET-278** | Hive style as semantic theme tokens **app-wide** (no per-component hard-coded colors): bg `#05060a`, fg `#f5f5f5`, mute `#8a8f9a`, card `#0f1118`, borders `#1d2130` / `#262a36`, Inter/system font stack, animated gradient title (`#6cf` `#f6c` `#7f9` `#fc6`), green live dot `#5f8` with glow, cards and buttons with 10px radius + 1px border, glow on the active/selected item (`#8af` / `#5f8`), tabular numbers. Keep WCAG AA contrast, honor reduced motion, keep text labels so meaning never relies on the face alone |
| (c) Hive page | **H-1..H-7 = LLMTELEMET-268..274** | The Hive page itself: collector/API, per-face model + spend, page shell + graph + faces, FX + anger, sound + voice, comms/events/replay (see §5) |
| (d) Parity checklist | **H-8 = LLMTELEMET-275** | PASS/FAIL per Hive feature with evidence, screenshots at 1920x1080 + mobile, gates green and a browser check with **no console errors** (§6) |
| (e) Retirement | **H-9 = LLMTELEMET-276** | Retire the standalone `beinno-hive` **only after** the done-gate (§3.0) **and** Hazem's explicit OK |

**Sound + voice (brief point 6 / H-6, LLMTELEMET-273):** on by default,
unlocked by the first click; tones plus a spoken line for every new real
message (including ones that arrive inside snapshots) and a narrator that
describes the real current state after about 75 s of silence. Do not cut over
until this passes on http://192.168.1.11:8790.

**Zoom (brief point 7):** the Hive page uses the shared wheel-zoom helper
(**LLMTELEMET-279**): wheel zoom to the cursor, drag to pan, double-click to
reset, `+` / `-` / Fit controls — and the zoom survives live updates and page
refresh.

**Full canvas + full roster (brief point 8):** the graph fills the stage (the
layout stretches to the stage aspect ratio and re-fits on resize) and shows the
full roster — every tool bot of each family (fleet bots with a profile) plus
every live pi/agent worker process (running and waiting-for-slot) as a
**satellite** of the brain/bot that launched it, with ticket, role and runtime;
counts in the top tabs. Reference: `~/workspace/beinno/hive` `server.py`
`_workers()` and `index.html` `satWorker()`. Scope: **LLMTELEMET-268**
(collector: roster/satellite data) and **LLMTELEMET-271** (layout: full-canvas
fit).

---

## 1. Feature inventory (every Hive feature, with line refs)

### 1.1 Graph, faces and moods (`index.html`)

| # | Feature | Where |
|---|---|---|
| F1 | Hex-node SVG stage (polygon-only faces: no inner disc/circle on faces; orbit and ping rings are hexagons) with fixed per-family layout and auto-zoom `fitView()` | `layout()` L387-394, `fitView()` L396-404, `render()` L406-456 (approx) |
| F2 | Center "Hazem / you" hub node with **hexagon orbit rings**, mood reacts to any running work (polygon-only faces: no inner disc) | L407-411 (approx) |
| F3 | Family hub per assistant, brains arranged on a ring, agents fanned out around their brain | L413-448 |
| F4 | Cartoon faces in hexes: `smile`, `talk`, `sleep`, `happy`, `angry`, `fire`, `dizzy`, `worry`, `wow` — eyes with pupils/shine, blink + look-around animation, brows, teeth, cheeks, zzz | `face()` L314-350, CSS L73-116 |
| F5 | Transient mood override (`setMood`, seconds-scale) layered over the status mood (`drawMood`) | L352-360 |
| F6 | `idle` / `hot` / `blocked` node states (hot = running or recently active; blocked = dashed red) | L424-448, CSS L48-52, 117-118 |
| F7 | **Anger levels 0-3**: base level from blocked counts (`blkLevel`: 1→1, ≤3→2, >3→3), heat bumps from real bad events decaying ~1 level/90 s; `data-anger` drives thicker/red strokes, rage shake at 3 | `heat/baseAnger/anger/bump` L481-486, CSS L70-72 |
| F8 | Anger escalation on a real rise: rate-limited rage sound, red screen flash, stage shake at level 3 | `escalate()` L488-490 |
| F9 | Node tooltips on hover (assistant/brain/agent detail: idle, sessions, counts, task list) | L368-369, `.tip` CSS L63-66 |
| F10 | Click on a node: particle burst, shockwave, **hexagon ping ring**, click sound (polygon-only, no circle) | L370 (approx) |
| F11 | Family color palette + per-family musical transposition (root/pixelvent/acasia/somethingpressing) | `COL`/`NOTE` L183-184 |
| F12 | View switcher: "All families" + one button per family (persisted `localStorage.hiveView`) | `views()` L470-476 |
| F13 | Edges: animated dashed "hot" edges when work is running; keyed in-place updates so animations never reset | `upEdge()` L380-385, CSS L49-51 |
| F14 | Ambient packet traffic flowing along every hot edge continuously | `traffic()` L458-462 |
| F15 | Header stats tabs: Assistants / Brains / Agents working / Running / Queued / Blocked / Done | `tabs()` L464-468 |
| F16 | Spinning hex brand logo; connection pill with beating dot and "live"/"reconnecting…" | L143-156, CSS L20-21, L22-26, `connect()` L690-701 |

### 1.2 Canvas background & FX

| # | Feature | Where |
|---|---|---|
| F17 | Starfield + drifting hex-grid background with mouse parallax | `drawBg()` L251-272 |
| F18 | Warp streaks (view switch, firing toggle, replay) | `warp` L250, 271 |
| F19 | Message packets with trails, big packets, and **laser bolts** (white core + colored glow) | `packet()` L276-280, `drawFx()` L291-312 |
| F20 | Bursts, confetti, shockwave rings, radial screen flash, arrival **hexagon** ping ring (polygon-only) | L281-290 (approx) |
| F21 | Shards (glass) and falling shell casings | `shards()/casings()` L579-582 |

### 1.3 Sound (Web Audio, fully synthesized — no audio files)

| # | Feature | Where |
|---|---|---|
| F22 | `tone()`/`noise()` synth primitives with master gain + compressor | L196-209 |
| F23 | SFX set: launch, arrive, newTask, done, blocked, running, whoosh, click | `SFX` L211-220 |
| F24 | Extended SFX: blast, casings, hit, shatter, charge, dizzy, grumble, boom, **rage (3 levels: huff/growl/roar with stomps)**, calm (anger relief) | `Object.assign(SFX…)` L561-578, `rage` L570-576 |
| F25 | Ambient hum toggle (low filtered drone with LFO) | `ambient()` L221-229 |
| F26 | Sound + ambient toggles, persisted (`localStorage.hiveSound`, `hiveAmb`) | L190, 235-236 |
| F27 | Sound + voice **on by default**, unlocked by the first click ("🔊 Click anywhere to turn on sound and voice" overlay; first gesture resumes AudioContext and greets) | `#unlock` L155, `unlock()` L237-239 |

### 1.4 Voice (browser speech synthesis)

| # | Feature | Where |
|---|---|---|
| F28 | Per-character voice: deterministic hashed voice/pitch/rate per profile; angrier = lower/faster/clipper ("!" at level 3); mood modulates | `say()` L547-558, `hash()` L546, `loadVoices()` L544-545 |
| F29 | **Voice names the project**: "On LLM Telemetry. …" before every spoken line | L601-609 (`${project(c) ? "On " + project(c) + ". " : ""}`) |
| F30 | Voice toggle; enabling speaks a greeting line | L651 |

### 1.5 Communications & events (real data only)

| # | Feature | Where |
|---|---|---|
| F31 | **Speech bubbles, max 2 on screen** (3rd evicts the oldest), wrapped text, via-line with project · from → to · channel · task, flip near edges, pop animation, 5.2 s lifetime | `bubble()` L531-542 (`while (box.children.length > 2)` L533), `wrap()` L528 |
| F32 | Message playback pipeline `playComm`: resolve sender/recipient to nodes, outcome classify (GOOD/BAD regexes), spoken line pick from `VOCAB` per kind | `playComm()` L594-614, `outcome()` L584-587, `line()` L589-592, `VOCAB` L495-507, GOOD/BAD L508-509 |
| F33 | **Firing mode** (default on): messages fly as laser bolts with charge → blast → casings → hit → 30% shatter glass; off = friendly big packet | `fireOn` L494, L611-612 vs L613, toggle L652 |
| F34 | Happy outcome: confetti, happy mood, done-fanfare, anger relief (`SFX.calm`), mood returns | L601 |
| F35 | Angry outcome: anger bump on target (+½ on sender), fire/angry mood scaled by level, red wave, flash, rage sound, boom at ≥3, stage shake | L602-603 |
| F36 | Dizzy outcome (crashed/timed out): dizzy mood, dizzy sound, gray shards | L604 |
| F37 | Neutral outcome: "wow" mood + hit/shards/shatter in firing mode, arrive sound otherwise | L605 |
| F38 | Conversations panel: colored from→to, project/via/kind tags, "waiting reply" pending chip, good/bad left border, 80-row window, per-family view filtering, "N in 12 h" counter | `commRow()` L618-627, `paintComms()` L629-632, `addComm()` L634-639, `inView()` L616-617 |
| F39 | Task-events feed panel (new/status diffs, per-family colors, empty state "Real ones will appear here") | `feed()` L669-674, HTML L176 |
| F40 | Task-event choreography `play()`: hop packets Hazem → assistant → brain → agent, then done confetti+flash / blocked anger+shake / new burst / running blip | `play()` L656-667 |
| F41 | **Replay** button: re-plays the last 8 conversations with stagger (labeled "replay · X ago ·"), or `flyThrough()` sweep when none | `#key` L683-684, `flyThrough()` L676-681 |
| F42 | Honest heartbeat strip: "checked Ns ago" + "last real message: X ago" (no fake activity) | setInterval L642-646 |
| F43 | Resolution rules: profile→node mapping via board/PMAP/family heuristics; `project()` names the ticket's project; `who()` display names | `resolve()` L511-517, `project()` L518-526, `who()` L525 |
| F44 | Persistence: `localStorage.hiveView/hiveSound/hiveAmb/hiveVoice/hiveFire` | L186, 190, 235-236, 494 |
| F45 | **Real data only, no simulation** — every event derives from a real snapshot diff or comm file; nothing is invented client-side | server `poller()` L284-302 + `diff()` L263-271 |

### 1.6 Server-side features (`server.py`) to port

| # | Feature | Where |
|---|---|---|
| S1 | Fleet discovery: `~/.hermes/fleet/*.yaml` → families, assistant, brains (board/project/display) | `load_families()` L39-63 |
| S2 | Kanban boards read **read-only via sqlite** (the `hermes kanban` CLI costs ~6 s CPU; sqlite ~1 ms), keep last-good on read error | `_read_board()` L65-79 |
| S3 | Bot Chat deliveries: `~/.hermes/profiles/*/runtime/bot_live_delivery/*.json` (author→profile, reply, pending when unsettled) | `_bot_chat()` L98-122 |
| S4 | Donna's brain lines: `~/.hermes/state/brain-lines/<assistant>/runs/*.query.txt` + `.log`, running detection via `<brain>.json` | `_brain_lines()` L124-155 |
| S5 | Kanban comments + task events (`completed/blocked/crashed/gave_up/timed_out/worker_lost/spawned/unblocked`) per board | `_board_comms()` L157-183, `EVENT_KINDS` L88-89 |
| S6 | Secret redaction (`SECRET` regex → `[redacted]`), whitespace clean + 280-char truncation | L87, `clean()` L92-96 |
| S7 | `collect()`: families → brains (idle, open sessions, per-status counts, agents with tasks) + merged comms (12 h window, last 400, snap keeps 120) | L223-260, `COMM_WINDOW` L85 |
| S8 | `diff()`: only real `new` (not-done) and `status` transitions become events | L263-271 |
| S9 | Poll loop every `HIVE_POLL=5 s`, first snapshot then deltas, survive errors | `poller()` L284-302 |
| S10 | Push to all clients + WebSocket heartbeat 20 s, snapshot on connect | `broadcast()` L275-282, `ws_handler()` L305-315 |
| S11 | `last_activity()` (mtime of state.db/sessions), `open_sessions()` | L199-220 |

---

## 2. Target architecture

```
hive page (web/js/hive.js)
   │  EventSource ──► GET /api/hive/stream  (SSE, preferred)
   │  fetch        ──► GET /api/hive?since=<seq>  (polling fallback)
   ▼
serve.py (stdlib ThreadingHTTPServer, HTTP/1.1 for /api/hive*)
   │  NoCacheHandler gains do_GET routes + one daemon collector thread
   ▼
hive.py (new, stdlib-only port of server.py collect/diff)
   reads: ~/.hermes/fleet/*.yaml, kanban/boards/*/kanban.db (sqlite ro),
          profiles/*/runtime/bot_live_delivery/*.json, state/brain-lines/**
   joins: reports/live-data.json, analytics-data.json, costs-data.json
          (LLM-Telemetry's own collectors — see §4)
```

### 2.1 Collector port (`src/llm_telemetry/hive.py`, stdlib only)

- Port `load_families`, `_read_board`, `board_tasks`, `_bot_chat`,
  `_brain_lines`, `_board_comms`, `_comms`, `last_activity`, `open_sessions`,
  `collect`, `diff`, `clean`/`SECRET` verbatim where possible. No `aiohttp`,
  no `asyncio`: plain functions + `threading.Thread(daemon=True)` collector
  loop (`HIVE_POLL`, default 5 s) started lazily on first request to
  `/api/hive*` (so `serve.py` keeps serving static files untouched in tests
  that never touch Hive).
- **YAML without PyYAML:** `server.py` imports `yaml`, but the port must be
  stdlib-only. The fleet specs are shallow mappings (family, orchestrators[]
  with name/assistant/display/board/project/family_title). Ship a small
  indentation-based YAML-subset reader (`hive_fleet.py`) covering exactly the
  fields read, and validate it against every real `~/.hermes/fleet/*.yaml` in
  QA. If `yaml` happens to be importable, prefer it and keep the subset reader
  as the fallback — one code path, two parsers, same output shape. A spec that
  fails to parse logs once and skips that family (same as today, S1).
- Shared state behind one `threading.Lock`: `state = {snapshot, tasks, seq,
  ring}` where `ring` is a bounded deque (500) of delta frames for SSE resume
  and `?since=`. `collect()` duration is measured; if it exceeds 1 s the loop
  backs off to 10 s (see Risk 2).
- Keep the "real data only" contract (F45): deltas come from `diff()` against
  the previous snapshot exactly as `server.py` L284-302 does.

### 2.2 Endpoints in `serve.py`

| Endpoint | Behaviour |
|---|---|
| `GET /api/hive` | Full snapshot JSON: `{"schema_version": 3, "type": "snapshot", "seq": N, "at": epoch, "families": [...], "comms": [...], "collect_s": 0.4}` |
| `GET /api/hive?since=<seq>` | `{"type": "delta", "from": <seq>, "to": M, "events": [frame…]}` replayed from the ring; if `since` is older than the ring start: `{"type": "reset", "snapshot": {...}}`. This is the **polling fallback** — identical semantics to SSE, no duplicated logic. |
| `GET /api/hive/stream` | **SSE** (`text/event-stream`, `Cache-Control: no-store`). On connect: `id: <seq>` + `event: snapshot` + current snapshot. Then `event: delta` frames, each with `id: <seq>`. `: heartbeat` comment every 15 s (also keeps proxies alive). Honours `Last-Event-ID` (or `?last=<seq>`) on reconnect: replay missed frames from the ring, or send a fresh snapshot on gap. |

**Delta frame format** (one JSON object per SSE `data:`, kept wire-compatible
with the old WebSocket protocol so the ported client code runs unchanged):

```json
{"seq": 1234, "at": 1795000000.5, "type": "event",
 "kind": "new" | "status", "id": "root:card-1", "family": "root",
 "brain": "llm-telemetry-brain", "board": "LLM Telemetry",
 "agent": "pi-worker", "status": "running", "from": "todo", "title": "…"}

{"seq": 1235, "at": 1795000001.0, "type": "comm",
 "id": "bc:ab12", "from": "hazem", "to": "beinno-donna", "kind": "ask",
 "via": "bot chat", "text": "…", "pending": true}
```

Snapshot frames carry the full `families` tree (S7) plus per-face `model`/`spend`
(§4).

### 2.3 SSE in ThreadingHTTPServer (the hard part)

- `ThreadingHTTPServer` spawns one daemon thread per connection — fine for a
  handful of viewers; cap concurrent streams at 8 (9th gets `503` with
  `Retry-After` and the UI falls back to polling automatically).
- The handler must set `protocol_version = "HTTP/1.1"` **only for the stream
  route** (or globally with correct `Content-Length` on everything else —
  prefer route-local: a small `HiveStreamHandler` subclass or explicit
  `self.protocol_version` on the response path) so the connection stays open
  without chunked encoding surprises; flush `wfile` after every frame.
- Catch `BrokenPipeError`/`ConnectionResetError` on write, drop the client,
  free the thread. Close idle streams after 10 min (client reconnects
  immediately and resumes from `Last-Event-ID`, so no loss).
- The existing `end_headers()` no-store override applies harmlessly to SSE.
- Heartbeat doubles as the liveness probe for the page's honest freshness strip
  (F42).

### 2.4 Front end

- New page `<div class="view" data-view="Hive" hidden>` in
  `web/dashboard.html`; register `'Hive'` in `router.js` `NAV_GROUPS` in the
  left-nav **Live** group together with the Live view (flow.js / Life view) and
  `NAV_ICONS`; register every export in `web/js/order.json` (the builder
  inlines modules in that order).
- New module `web/js/hive.js`: the ported scene code (~520 lines of
  `index.html` script). Reuse existing infrastructure where it exists instead
  of duplicating: `palette.js` `ago/esc`, `live.js` audio unlock
  (`ensureAudioCtx`/`armAudioUnlock`) instead of the `#unlock` overlay, and
  `views.js` `provOf`/`provLogoSvg` for provider marks. Keep Hive's own
  synth engine (F22-F26) — it is a self-contained Web Audio graph.
- The stage is full-canvas (brief point 8): it fills the page's stage area, the
  layout stretches to the stage aspect ratio and re-fits on resize
  (LLMTELEMET-271). Zoom uses the shared wheel-zoom helper (LLMTELEMET-279):
  wheel zoom to the cursor, drag to pan, double-click to reset, `+` / `-` / Fit,
  and it survives live updates and refresh. Side panel (conversations 62% /
  task events 38%) mirrors the current two-pane layout.
- CSS: add a namespaced block (`hive-*` prefixed classes) to
  `web/css/dashboard.css` or a dedicated `web/css/hive.css` inlined by
  `webassets.py`. All Hive globals (`#stage`, `#side`, …) get `hive-` prefixes
  so they cannot collide with existing views.

**AGENTS.md hard rule (provider icons never letters):** any provider/model
indicator rendered on the Hive page (face tooltips' live model, legend, comm
rows) must use `provLogoSvg()`/`provOf()` from `views.js` — a provider brand
SVG, never a letter glyph, never a `QT_GLYPH`-style table. The Hive faces
themselves are characters (not jar balls) and are unaffected, but any *ball*,
chip or legend mark that carries a provider must show the SVG logo. The guard
`tests/check_qt_ball_provider_icons.js` is never touched, skipped or loosened;
add a sibling guard `tests/check_hive_provider_icons.js` for the Hive page.

Clarification: the AGENTS.md "contrast disc behind provider logos" rule (jar
balls) applies to **provider logos**, not Hive faces. Hive faces are
polygon-only (no inner disc/circle) — these are separate concerns and must not
be conflated.

---

## 3. Migration plan

### 3.0 Done-gate: full integration = parity checklist

Retirement of the standalone (ticket H-9 / Plane LLMTELEMET-276) is allowed ONLY
when **every** parity-checklist item (§6) is ticked with evidence (screenshot /
recording / test name per item), all guards green, a 24 h side-by-side soak with
no regressions, AND Hazem's explicit OK. Referenced from §6 and the H-8/H-9 rows.

### 3.1 Runbook (steps 1-6 are safe and reversible; nothing is retired by them)

1. **Keep the standalone running.** `beinno-hive` (:8790, systemd user unit)
   stays untouched: no unit edits, no port change, nothing in its folder edited
   or deleted. The standalone folder is read only for QA.
2. **Deploy the page** with the normal LLM-Telemetry deploy (main checkout
   fast-forward, `pip install -e .`, restart `hermes-dash-http.service` on
   :8477). The Hive page is served from `/` (nav: Live > Hive) and reads
   `/api/hive` and `/api/hive/stream` from the same server.
3. **Verify the endpoints** against live data: `curl -s :8477/api/hive` returns
   a schema-stamped snapshot; `curl -N :8477/api/hive/stream` sends a snapshot
   first and a heartbeat within 20 s; `?since=<seq>` replays only missed frames.
4. **Side-by-side QA.** Open :8790 and the page next to each other on the same
   real data and tick every §6 row (F1-F45, S1-S11) PASS/FAIL with evidence
   (screenshot, recording for sound/voice/bolts, or test name). The real-data
   contract (F45) is checked by stopping kanban writes and observing zero
   phantom events.
5. **Guards green:** `npm run lint`, the `tests/check_hive_*.js` and
   `tests/unit_hive*.mjs` suites, `tests/check_qt_ball_provider_icons.js`,
   `tests/test_page_weight.py` (budget never raised), `pytest`.
6. **24 h soak.** Leave both surfaces running for 24 h and compare: same
   families, counts and conversations, no console errors, SSE reconnects clean.

### 3.2 GATE: ask Hazem

**Stop here.** Report the parity evidence (§6 table, soak result, guard output)
and ask Hazem for an explicit OK to retire `beinno-hive`. A general "keep
going" grant is not that OK. Until the OK is given, nothing below is run and
nothing is retired.

### 3.3 Retirement (only after Hazem's explicit OK; orchestrator-owned, ticket H-9)

7. `systemctl --user disable --now beinno-hive` (in the owner's profile
   context), then confirm :8790 is gone and the page is the only Hive surface.
8. Leave `index.html` / `server.py` in place as archive; do not delete them.
9. Rollback if anything regresses: `systemctl --user enable --now beinno-hive`.

---

## 4. Per-face live model and spend (requirement 3)

Every face (assistant, brain, agent) carries `model` + `spend` in the snapshot,
joined server-side in `hive.py` from LLM-Telemetry's own collectors/artifacts:

| Data | Artifact (collector) | Used for |
|---|---|---|
| Live model per profile | `reports/live-data.json` (`collect_live.py`: `profiles[].sessions[].model`, plus `pi_live` and `agent_live` rows from `collect_pi_live.py` / `collect_agent_worker_live.py`) | "face X is running `<model>` right now"; provider key via the same rules as `views.js provOf` (billing_base_url → billing_provider → name shape) |
| Spend per profile | `reports/analytics-data.json` (`collect_analytics.py`: profile `rows[].billed_usd` / `market_value_usd`, day grain) | "spend today / in window: $N" on the face tooltip and sub-label |
| Spend per model | `reports/costs-data.json` (`build_costs.py` + `pricing.py`: `models[].cost`, `profiles[]`) | model-level detail in the tooltip |
| Attribution / cost class | `cost_attribution.py` section of `analytics-data.json` (`cost_class`) | subscription-covered label: Claude Code / Codex agent-worker sessions show tokens + API-price equivalent labelled **"covered by subscription"**, excluded from Est. Cost (cost policy 2026-10-27) |
| Local models | `reports/ollama-data.json` (`probe_hosts.py`) | faces running local/Ollama models show `$0.00 local` rather than a bogus price |

Missing artifacts degrade gracefully: "spend n/a" — never a simulated number.
The join maps Hive profile/agent ids (e.g. `llm-telemetry-brain`, `pi-worker`)
to telemetry profile names via the fleet spec (`S1`) plus the same
`famOfProfile` heuristics used by `resolve()` (F43); unmapped ids show the
data-less face exactly as today.

---

## 5. Phases and tickets

Phases: **P1 Backend** (H-1…H-3) → **P2 Front end** (H-4…H-7) →
**P3 QA & migration** (H-8) → **P4 Retirement** (H-9, only after the done-gate).
Ticket filing goes to Plane via the orchestrator; each row below pairs the
plan-local id with its Plane id (epic **LLMTELEMET-267**; see §0).

| # | Title | Scope & files | Acceptance criteria | Tests | Deps | Effort |
|---|---|---|---|---|---|---|
| **H-1** (LLMTELEMET-268) | Port Hive collector to stdlib `hive.py` | New `src/llm_telemetry/hive.py`, `src/llm_telemetry/hive_fleet.py`; port S1-S8, S11; full-roster data (brief point 8): every tool bot of each family plus every live pi/agent worker running or waiting-for-slot as a satellite of the brain/bot that launched it, with ticket, role, runtime (ref `server.py _workers()`); YAML-subset parser; no aiohttp/asyncio/PyYAML required | `collect()` returns the same snapshot shape as `server.py` against fixture trees; `diff()` emits only real new/status frames; `clean()` redacts every `SECRET` pattern; board reads are sqlite read-only and keep last-good on error; collector thread survives per-source failures | `tests/test_hive_collector.py` (fixture fleet YAMLs, `kanban.db`, `bot_live_delivery/*.json`, `brain-lines/` runs, comments/events); redaction table tests; YAML-subset reader edge cases | — | 8 h |
| **H-2** (LLMTELEMET-269) | `/api/hive` + `/api/hive/stream` (SSE) in `serve.py` | `src/llm_telemetry/serve.py` (routes, `HiveStreamHandler`, collector-thread lazy start, seq ring), `src/llm_telemetry/hive.py` (ring/lock) | Snapshot endpoint returns schema-stamped payload; `?since=` replays exactly the missed frames or resets; SSE sends snapshot on connect, `id:` per frame, heartbeat ≤ 20 s, `Last-Event-ID` resume, stream cap 8 (10th → 503), broken client frees its thread; static-file serving and `/api/settings`/`/api/refresh` unchanged | `tests/test_hive_api.py` on `--port 0`: framing, heartbeat (interval override), resume-after-gap, disconnect cleanup, concurrency cap; existing `tests/test_serve*.py` stay green | H-1 | 10 h |
| **H-3** (LLMTELEMET-270) | Per-face live model + spend join | `src/llm_telemetry/hive.py` (join from `live-data.json`, `analytics-data.json`, `costs-data.json`, `cost_class`, `ollama-data.json`), `docs/data-sources.md` row | Every face in the snapshot carries `model` (live) + `spend {usd, window, cost_class}`; covered-by-subscription sessions labelled and excluded from Est. Cost; missing artifacts → `spend: null`, never invented; unmapped profile → data-less face | `tests/test_hive_spend.py`: fixture artifacts → expected join; stale/missing artifact paths; cost_class labelling; no-cache/atomic-read behaviour | H-1 | 6 h |
| **H-4** (LLMTELEMET-271) | Hive page shell: Live nav group, full-canvas stage, graph, faces, moods | `web/dashboard.html` (view div), `web/js/hive.js` (F1-F6, F9-F16 render core: `face/upNode/upEdge/layout/fitView/render/tabs/views`, tooltips, click FX hook), `web/js/router.js` (`NAV_GROUPS`, `NAV_ICONS`), `web/js/order.json`, `web/css/hive.css` | Page renders the live family graph from `/api/hive`; the graph fills the stage — layout stretches to the stage aspect ratio and re-fits on resize (brief point 8) — and the shared wheel-zoom helper (LLMTELEMET-279) is wired (wheel to cursor, drag pan, double-click reset, `+`/`-`/Fit, survives live updates and refresh); all 9 face moods render; idle/hot/blocked states; view switcher persists; tooltips show real counts; keyed in-place updates keep animations alive across snapshots; provider marks use `provLogoSvg` (no letters) | `tests/check_hive_view.js` (jsdom render smoke via `tests/lib/isolate.mjs`; stubs must name only real imports — known isolate pitfall); `tests/check_hive_provider_icons.js`; `tests/check_hive_polygon_faces.js` (no `<circle>` inside face/orbit/ping groups; all rings are hexagons); `check_js_order`/`check_js_modules` updated | H-2 | 12 h |
| **H-5** (LLMTELEMET-272) | FX layer + anger model | `web/js/hive.js` (F7-F8, F14, F17-F21: `drawBg/drawFx/packet/burst/confetti/wave/flash/shards/casings/traffic`, `heat/anger/bump/escalate`) | Starfield/hex background with parallax; packets, big packets and laser bolts; confetti/waves/flash/shards/casings/ping; anger 0-3 from blocked counts + decaying heat; escalation plays once (rate-limited), shake + flash at 3; ambient traffic on hot edges only | `tests/check_hive_fx.js`: `blkLevel`/`heatOf`/`anger` maths, decay, escalation rate-limit, max-2 bubbles invariant with FX on | H-4 | 10 h |
| **H-6** (LLMTELEMET-273) | Sound + voice | `web/js/hive.js` (F22-F30: synth primitives, full SFX incl. 3-level rage + calm, ambient hum, toggles + `localStorage`, `say()` with project naming), reuse `live.js` `armAudioUnlock`/`ensureAudioCtx` instead of `#unlock` | Sound + voice are **on by default** and unlocked by the first click (no autoplay attempt before the gesture); every SFX from the inventory reproducible; ambient toggle works; toggles persist; a spoken line plays for every new real message (including ones that arrive inside snapshots) and a narrator describes the real current state after ~75 s of silence; voice picks a stable per-profile voice, pitch/rate shift with anger/mood, level 3 appends "!"; every spoken line names the project when known; voice toggle greets; sound/voice parity confirmed against http://192.168.1.11:8790 before cutover | `tests/check_hive_sound.js`: SFX graph structure, unlock wiring (no autoplay attempt before gesture), voice hash stability, project-name prefix in `say()` inputs | H-4 | 8 h |
| **H-7** (LLMTELEMET-274) | Comms, events, replay, firing mode | `web/js/hive.js` (F31-F45: `bubble/playComm/commRow/paintComms/addComm/play/feed/flyThrough/replay/resolve/project/who/heartbeat strip`, firing-mode toggle) | Bubbles never exceed 2; every comm kind (ask/reply/comment/event, pending) renders and animates; happy/angry/dizzy/neutral outcomes drive the right mood+FX+sound; task diffs animate Hazem→assistant→brain→agent hops; conversations + feed panels match the standalone; replay re-plays last 8 (or fly-through); heartbeat strip honest; real-data-only (no phantom events when sources are quiet) | `tests/check_hive_comms.js`: outcome regexes, VOCAB picking, resolution/`project()` mapping, bubble cap, pending chip, replay stagger, `?since`-driven polling fallback path | H-4, H-5, H-6 | 10 h |
| **H-8** (LLMTELEMET-275) | Parity QA, guards, docs, migration runbook | QA pass vs frozen reference (`docs/plans/hive-ref/index.html`); `tests/test_page_weight.py` budget check; new `tests/check_hive_provider_icons.js` green; `tests/check_qt_ball_provider_icons.js` untouched and green; `docs/architecture.md` (components table, data-flow diagram: hive.py + /api/hive/stream), `docs/data-sources.md` (summary row + per-collector detail), `AGENTS.md` (Hive tab note alongside the icon rule), `docs/plans/hive-tab.md` §3 runbook | Every F1-F45/S1-S11 ticked PASS/FAIL with evidence on the page; screenshots at 1920x1080 + mobile; browser check with no console errors; full `tests/run-all.js` (Node 24, `timeout 1500`) per-suite FAIL-lines equal-or-better than a clean `git worktree add` of origin/main; `tests/test_page_weight.py` green (dashboard.html ≤ 960,000 B); side-by-side 24 h soak with no divergence; migration steps documented and rehearsed up to the "ask user" gate | Full suites: `npm ci --prefix tests` + `NODE_PATH=tests/node_modules node tests/run-all.js`; `.venv/bin/python tests/test_page_weight.py` and the Python suites; guard tests as above | H-7 | 8 h |
| **H-9** (LLMTELEMET-276) | Retire standalone `beinno-hive` | Runbook (orchestrator-owned): `systemctl --user disable --now beinno-hive` in Donna's profile context, confirm :8790 is gone and the Hive page is the only Hive surface, leave `index.html`/`server.py` in place as archive | Only after the done-gate (§3.0): every §6 row PASS with evidence **and** Hazem's explicit OK | — | H-8 | 1 h |

**Total effort: 72 h** (H-1 8 + H-2 10 + H-3 6 + H-4 12 + H-5 10 + H-6 8 +
H-7 10 + H-8 8; H-9 is an orchestrator-owned runbook step after the done-gate,
not counted). H-5/H-6/H-7 can run in parallel after H-4 if staffing allows
(then wall-clock ≈ 4-5 days); serial as listed ≈ 9 working days.

---

## 6. QA parity checklist (extract for H-8 / LLMTELEMET-275) — Done-gate (see §3.0)

Every item is marked **PASS** or **FAIL** with evidence (screenshot /
recording / test name per item). Screenshots at 1920x1080 and on mobile.
Browser check with no console errors. Any FAIL blocks the done-gate.

| Item | PASS/FAIL | Evidence |
|---|---|---|
| F1-F6: hex-node stage, hub, family hubs, 9 moods render | | |
| F7-F8: anger 0-3 strokes/shake, escalation rate-limited | | |
| F9: tooltips show real counts | | |
| F10: click burst + hexagon ping ring | | |
| F11-F12: family palette + view switcher persists | | |
| F13-F14: hot edges + ambient traffic | | |
| F15: stats tabs count correctly | | |
| F16: brand logo + connection pill | | |
| F17-F18: starfield/parallax + warp streaks | | |
| F19: packets, big packets, laser bolts | | |
| F20: bursts, confetti, shockwaves, flash, hexagon ping rings | | |
| F21: shards + casings | | |
| F22-F26: synth, SFX, ambient hum, toggles persist | | |
| F27: sound + voice on by default, unlocked by the first click | | |
| F28-F30: voice per-character, project naming, toggle greet; spoken line per new real message (incl. ones inside snapshots); narrator after ~75 s silence; sound/voice parity vs :8790 before cutover | | |
| F31: bubbles cap 2 | | |
| F32: playComm kinds + outcomes | | |
| F33: firing mode on/off | | |
| F34-F37: happy/angry/dizzy/neutral outcomes | | |
| F38-F39: conversations + task-events panels | | |
| F40: task-event choreography hops | | |
| F41: replay + fly-through | | |
| F42: honest heartbeat strip | | |
| F43-F44: resolution + persistence | | |
| F45: real-data-only (no phantom events) | | |
| S1-S11: server-side features ported | | |
| Zoom (LLMTELEMET-279): shared wheel-zoom helper — wheel to cursor, drag pan, double-click reset, `+`/`-`/Fit, survives live updates and refresh | | |
| Full canvas + full roster (brief point 8): graph fills the stage, layout stretches to the stage aspect ratio and re-fits on resize; every tool bot of each family and every live pi/agent worker (running or waiting-for-slot) shown as a satellite of the brain/bot that launched it, with ticket, role and runtime; counts in top tabs (ref `server.py _workers()`, `index.html satWorker()`) | | |
| Polygon-only faces (no <circle> in face/orbit/ping groups; hexagon rings) | | |
| Provider icons via provLogoSvg (no letters) | | |
| Spend/model tooltips match Cost page numbers | | |
| covered-by-subscription labelling | | |
| Secret redaction visible | | |
| 24 h side-by-side soak, no regressions | | |
| All guards green | | |
| Hazem explicit OK | | |

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| **SSE in `ThreadingHTTPServer`** — one thread per open stream; HTTP/1.0 default closes connections; proxies buffer; vanished clients leave broken writers | Route-local `HTTP/1.1` + explicit flush; heartbeat comment ≤ 20 s; `BrokenPipeError` handling frees the thread; stream cap 8 with 503 + automatic client fallback to `?since=` polling (identical delta logic, so fallback is lossless); 10-min idle recycle with `Last-Event-ID` resume |
| **`collect()` CPU** — globbing every profile's deliveries + 12 h comm window + SECRET regexing every 5 s; `hermes kanban` CLI was already too expensive (server.py L67 comment) | Keep sqlite read-only direct reads; mtime-based skip (`cut`) as today; single collector thread regardless of client count (snapshot cached in memory, clients served from cache); measure `collect_s` in every payload and back the loop off 5 s → 10 s when > 1 s; ring buffer keeps deltas cheap |
| **Sound autoplay policy** — browsers block AudioContext/speechSynthesis until a gesture; the standalone's `#unlock` overlay clashes with dashboard chrome | Reuse `live.js` `ensureAudioCtx`/`armAudioUnlock` (already proven by `check_completion_sound.js`); voice + sound stay muted until the first gesture, then the greeting fires; structural test asserts no `AudioContext` resume before `pointerdown`/`keydown` |
| **`dashboard.html` page-weight budget 960,000 B** (`tests/test_page_weight.py`) — Hive adds ~520 lines of JS + a CSS block + SVGs on top of a page already near budget | Namespace + trim the port (drop the standalone's dead CSS/HTML shell); target ≤ 45 KB for `hive.js` + 10 KB CSS; measure the built `examples/reports/dashboard.html` after every ticket; if the budget must rise it is a deliberate same-commit change to the test **and** the README (per the test's own docstring) and needs the user's nod |
| **New JS module wiring** — `order.json` export manifest, `webassets.py` inlining order, and `tests/lib/isolate.mjs` which throws when a stub names a binding the module does not import (past pitfall) | Register exports in `order.json` as part of H-4's acceptance criteria; write isolate stubs only for imports `hive.js` actually has; run `check_js_order`/`check_js_modules` early in H-4 |
| **Provider-icon hard rule** — a letter fallback anywhere on the Hive page violates AGENTS.md | All provider marks go through `provLogoSvg`/`provOf`; add `tests/check_hive_provider_icons.js`; never touch `tests/check_qt_ball_provider_icons.js`; where a logo is small, add the contrast disc / raise size — never letters |
| **Fleet YAML parsing without PyYAML** — a subset parser may choke on an exotic spec | Validate against all real `~/.hermes/fleet/*.yaml` in H-1 QA; prefer system `yaml` when importable; parse failure skips that family with a log line (same as today) |
| **Parity drift** — `index.html` changed twice on 2026-11-12 alone | Freeze the reference copy at implementation start; QA diffs against it; if Donna ships new Hive features mid-migration, add them as follow-up tickets, not scope creep in H-1…H-8 |
| **Time-windowed fixture rot** (past pitfall: hardcoded epochs aged out of 30-day windows) | All Hive test fixtures use `now − 1 h` relative timestamps, never fixed epochs |
| **Long job timeouts** (worker 60-min wall) | Tickets are sized ≤ 12 h of work but each has a runnable acceptance slice; commit per ticket so a killed worker resumes from real progress |

---

## 8. Test plan (summary)

1. **Python unit** (`tests/test_hive_collector.py`, `test_hive_spend.py`,
   `test_hive_api.py`): collector vs fixture trees; diff semantics (only real
   `new`/`status`); redaction table; YAML-subset reader; snapshot schema stamp
   (`schema.py stamp`, `SCHEMA_VERSION`); spend join + `cost_class` labelling;
   SSE framing/heartbeat/resume/cap/disconnect on `--port 0`;
   `?since=` equivalence with SSE. Run with the repo's `.venv/bin/python`.
2. **JS DOM/unit** (Node 24): `check_hive_view.js`, `check_hive_fx.js`,
   `check_hive_sound.js`, `check_hive_comms.js`, `check_hive_provider_icons.js`
   via `tests/lib/isolate.mjs`; bubble cap, anger maths, outcome regexes,
   project naming, voice hashing.
3. **Regression:** full `npm ci --prefix tests` +
   `NODE_PATH=tests/node_modules node tests/run-all.js` (`timeout 1500`);
   per-suite FAIL-line comparison (`comm -13`) against a fresh
   `git worktree add` of origin/main; `tests/test_page_weight.py` green;
   `tests/check_qt_ball_provider_icons.js` untouched and green.
4. **Manual QA / soak:** side-by-side :8790 vs `/#/Hive` for 24 h; sound,
   voice, bolts, replay exercised with recordings; real-data-only check
   (quiet sources → zero events); spend numbers reconciled against the Cost
   page; hidden-tab canvas check with the tab in front (hidden tabs pause rAF).
5. **Build check:** `.venv/bin/python -m llm_telemetry.build_dashboard
   <scratch.html>` after every ticket; byte-size tracked against budget.

---

## 9. Out of scope

- Editing or deleting anything in Donna's workspace (read-only forever here).
- Retiring `beinno-hive` before explicit user OK (§3 step 4-5).
- New Hive features not in the reference copy (track as separate tickets).
- Touching `tests/check_qt_ball_provider_icons.js`, the jar-ball icon pipeline,
  or any Life-view code.
