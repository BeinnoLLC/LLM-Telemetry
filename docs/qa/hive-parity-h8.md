# Hive parity QA (LLMTELEMET-275, H-8 part B)

Branch `feat/lst-275-hive-parity-qa`. Frozen reference: the standalone Hive (`/home/hazemhagrass/workspace/beinno/hive`, read only; nothing copied).
Checklist source: `docs/plans/hive-tab.md` §1 (F1-F45), §1.6 (S1-S11), §6.

Method: (a) the jsdom suites named below, (b) headless Chromium (playwright) against the worktree build served on a scratch port with the live `/api/hive` feed, 1920x1080 and 390x844, page brought to front so rAF runs, (c) code reads (`file:line` in `src/llm_telemetry/web/js/hive.js` = `hive.js`, `src/llm_telemetry/hive.py` = `hive.py`).
Screenshots are kept out of the repo, in `/home/hazemhagrass/.hermes/profiles/llm-telemetry-brain/cache/scratch/h8-shots/`:
`hive-desktop-1920x1080.png`, `hive-stage-desktop-1920x1080.png`, `hive-after-interact-desktop-1920x1080.png`, `hive-tooltip-1920x1080.png`, `hive-mobile-390x844.png`, `hive-stage-mobile-390x844.png`, `hive-after-interact-mobile-390x844.png`.

Browser console on both viewports (load, 4 s idle, Replay click, firing toggle x2, hover and click on a node): **0 errors, 0 warnings**.

## Defects found and fixed in this branch

1. **Firing delay lost a real event** — `hvC.ft` was one timer id, cleared before each schedule. It is now a `Set` (add on schedule, delete on fire, `hvStop` clears all). Tests: `check_hive_comms.js` "two firing comms hold two pending delay timers", "both firing comms produced a bolt packet", "hvStop cancels both pending firing delays".
2. **Hive page threw `HV_VIA_MAX is not defined` in the browser** (found by this QA; every comm bubble would have failed). `order.json` lists the top-level blocks the bundler ships; `HV_VIA_MAX` and `hvFamId` were declared in `hive.js` but missing from it, so `build_dashboard` silently dropped them. The jsdom suites import `hive.js` directly and could not see it. Both added to `order.json`.
3. **`hvCol` memoised** — it is called per node, per edge and per packet on every snapshot render, so each call did a `getComputedStyle`. It now caches per family and drops the cache when `data-theme` changes (also self-clears across theme toggles; verified with the theme attribute removed → token resolves again).
4. **S2 last-good** — `hive.collect` turned an unreadable board (`read_board` → `None`) into `[]`, so a sqlite hiccup removed the board's tasks and the next tick replayed every task as a `new` event (phantom activity, breaks F45). It now keeps the last good read per (home, board). Test: `test_unreadable_board_keeps_last_good_read`.

## F1-F45 (front end)

| Item | Verdict | Evidence |
|---|---|---|
| F1 hex-node stage, auto-fit | PASS | `check_hive_view.js` "graph renders egg, 2 assistants, 1 bot, 1 brain, 1 agent"; `unit_hive_fx.mjs` layout at 1920x900 / 2560x1300 / 1280x720 (zero overlaps, all inside stage); screenshot `hive-desktop-1920x1080.png` |
| F2 Hazem hub, orbit rings | PASS | "Hazem sits at the exact centre"; `check_hive_polygon_faces.js` "orbit ring is a polygon"; screenshot (egg with crown at centre) |
| F3 family hubs, brains/agents fanned | PASS | `unit_hive_fx.mjs` "assistants radial, distinct bearings", "every brain and tool bot is on the graph"; screenshot |
| F4 nine moods | PASS | `check_hive_view.js` "all nine moods draw on a live node"; `unit_hive_fx.mjs` "face <mood>: markup without circle/ellipse" x9 |
| F5 transient mood over status mood | PASS | `hvSetMood` `hive.js:~505`; `check_hive_comms.js` happy/angry/dizzy/neutral outcome tests set and reset moods |
| F6 idle / hot / blocked | PASS | `check_hive_view.js` "blocked brain draws the angry face"; `hive.css:22` hot node; `hvDrawNode` classes `hot idle blocked nodata` |
| F7 anger 0-3: strokes, heat decay, shake | FAIL (partial) | Levels and decay PASS: `hvLvOf` `hive.js:557`, bump decay `hive.js:390`, `unit_hive_fx.mjs` anger maths (a = .7p + .3 blocked share, monotonic, bounded). **Stage shake at level 3 is never triggered**: `.hv-shake` exists in `hive.css:64` but `hive.js` never adds it (only `hv-flash`, `hv-flash-ok`). Follow-up F-A |
| F8 escalation: rate-limited sound, flash, shake at 3 | FAIL (partial) | Rate-limited rage on a rise: `hvSoundDiff` `hive.js:648-665` plays only when level rises; `check_hive_sound.js` "per-event cooldown drops an immediate repeat". Red flash on angry comm/blocked event `hive.js:798,852` PASS. Shake at 3 missing (same as F7) |
| F9 tooltips with real counts | PASS | Playwright hover on a brain node: tip text "Ahwa brain ahwa-brain · board ahwa 39 done · 0 running · 3 queued · 11 blocked"; screenshot `hive-tooltip-1920x1080.png`; `check_hive_view.js` "brain label carries the real counts" |
| F10 click: burst, shockwave, hexagon ping | FAIL | `hvHooks.onClick` is left empty (`hive.js:23,361`, "this ticket leaves empty"); Playwright click on a node adds 0 elements to `#hive-pk` and plays no click cue. Follow-up F-B |
| F11 family palette | PASS | `check_hive_tokens.js` "all 20 --hv-* colour tokens resolve"; `hive.css` `--hv-fam-*`; `check_hive_comms.js` "no hex colour literals"; per-family musical transposition via `hvT` (`check_hive_sound.js` per-profile voice) |
| F12 view switcher persists | PASS | `check_hive_view.js` "choosing a family persists and filters", `hive.js:493,541` (`hiveView`) |
| F13 hot edges, keyed updates | PASS | `hive.css:18` dashed animated hot edge; `check_hive_view.js` "a second snapshot updates nodes in place (same element)" |
| F14 ambient traffic on hot edges | FAIL | No `traffic` function in `hive.js`; packets exist only per comm/event. Follow-up F-C |
| F15 stats tabs | PASS | `check_hive_view.js` "seven stat tabs"; `unit_hive_fx.mjs` "tab counts come from real counts"; screenshot (4 / 22 / 1 / 6 / 5 / 41 / 512) |
| F16 brand logo + connection pill | PASS (pill) / N-A (logo) | Pill "live" / "reconnecting…" `hvPill` `hive.js:~499`, screenshot shows `LIVE`; the spinning hex brand logo is the dashboard shell's own brand, not duplicated in the page by design |
| F17 starfield / hex-grid parallax | FAIL | No background layer in `hive.js` or `hive.css` (no canvas, no stars, no pointer parallax). Follow-up F-D |
| F18 warp streaks | FAIL | Same: no streak effect on view switch / firing toggle / replay. Follow-up F-D |
| F19 packets, big packets, laser bolts | PASS | `hvPacket` `hive.js:~760` (`bolt` laser polygon vs hexagon packet); `check_hive_comms.js` "both firing comms produced a bolt packet", "firing mode: sender charges before the blast" |
| F20 bursts, confetti, waves, flash | PASS | `hvPuff` `hive.js:767` (confetti polygons / expanding hexagon wave), `hvKick('hv-flash')`; "done confetti carry the conf class and a family colour"; `check_hive_polygon_faces.js` (no circles) |
| F21 shards and casings | FAIL | CSS classes `.hv-p.shard` / `.hv-p.cas` exist (`hive.css:62`) but no JS spawns them; only the `casings`/`shatter` sounds exist. Follow-up F-E |
| F22 synth primitives + master chain | PASS | `check_hive_sound.js` "first gesture resumes the shared context and builds the master chain" |
| F23 base SFX set | PASS | "SFX inventory complete (F23/F24 + calm + kettle)" and one test per cue |
| F24 extended SFX, 3-level rage, calm | PASS | "3-level rage escalates (level 3 adds stomps)", blast/casings/hit/shatter/charge/dizzy/grumble/boom/calm cases |
| F25 ambient hum | PASS | "ambient hum toggle present", "ambient hum starts at noon", "hum stops when quiet hours begin" |
| F26 toggles persist | PASS | "toggles + volume persist in localStorage"; keys `hiveSound`, `hiveAmb`, `hiveVoice` (`hive.js:690`) |
| F27 on by default, unlocked by first gesture | PASS | "no sound and no AudioContext before the first gesture", "sound and voice default to on", "unlock disarms the gesture listeners" |
| F28 per-character voice | PASS | "voice hash is stable per profile", "anger lowers pitch and raises rate", "level 3 ends with '!'", "no voice list yet: silent" |
| F29 voice names the project | PASS | "line names the project", "no project, no prefix" |
| F30 voice toggle; line per new real message; narrator after ~75 s | FAIL (partial) | Toggle and a spoken line for comms that arrive inside snapshots PASS ("voice toggle off silences speech", "a comm that arrives inside a later snapshot is logged and played"). **No 75 s narrator**: `check_hive_sound.js` asserts "sound init starts no timer (no timed narrator)" — a deliberate no-fake-activity choice that contradicts the H-6 acceptance text. Needs a decision; follow-up F-F. Voice greeting on enable not asserted |
| F31 bubbles, max 2 | PASS | "never more than 2 bubbles; the 3rd evicts the oldest", "bubbles live 5.2 s", clamp inside stage, via cut to 48 chars |
| F32 playComm pipeline | PASS | outcome regexes, VOCAB picking, resolve tests in `check_hive_comms.js` (first 12 tests) |
| F33 firing mode on/off, persisted | PASS | "firing mode reads localStorage.hiveFire", "the toggle flips, persists and updates aria-pressed", "enabling firing mode plays the charge cue"; 30 % shatter visual is the F21 gap |
| F34 happy outcome | PASS | "happy outcome: happy mood + done fanfare"; calm on anger relief `hive.js:797` |
| F35 angry outcome | PASS | "angry outcome: angry/fire mood + rage sound"; boom at level >= 3 `hive.js:798` (stage shake part of F7 gap) |
| F36 dizzy outcome | PASS | "dizzy outcome: dizzy mood + dizzy sound" (gray shards = F21 gap) |
| F37 neutral outcome | PASS | "neutral outcome (firing off): wow mood + arrive sound" (shards in firing mode = F21 gap) |
| F38 conversations panel | PASS | "ask/reply/comment/event/pending all render a row", "waiting reply chip", "good/bad left border", "80-row window", "per-family view filtering", "N in 12 h counter" |
| F39 task-events feed | PASS | "feed panel: per-family row, diff arrow, empty state removed" |
| F40 task-event choreography | PASS | "task diff hops Hazem → assistant → brain → agent", "an assistant-owned worker collapses to Hazem → assistant", `hive.js:851-852` |
| F41 replay + fly-through | FAIL (partial) | Replay of last 8, staggered 1.5 s: PASS ("replay re-plays the last 8 conversations 1.5 s apart", "a new replay cancels the previous one"). With no history it only reports "nothing to replay"; the `flyThrough()` sweep is not ported. Follow-up F-G |
| F42 honest heartbeat | PASS | "heartbeat: no messages and no snapshot says so", "snapshot age + newest real message age"; screenshot "CHECKED 22S AGO · LAST REAL MESSAGE: 2M AGO" |
| F43 resolution rules | PASS | "profiles resolve to assistant / brain / bot nodes", "an agent resolves through its board", "family heuristics, then Hazem, then null", "project() names the board/brain", "who() display names" |
| F44 persistence | PASS | `hiveView`, `hiveSound`, `hiveAmb`, `hiveVoice`, `hiveFire` all read/written (`hive.js:493,541,690,889`) with tests above |
| F45 real data only | PASS | "first snapshot: baseline only, nothing animates", "a quiet snapshot invents no events", `check_hive_comms.js` "H-7 code has no raw colours and no timer-driven comms", S2 last-good fix above removes the one phantom-event path found |

## S1-S11 (collector, now `hive.py` + `serve.py`)

| Item | Verdict | Evidence |
|---|---|---|
| S1 fleet discovery | PASS | `test_hive_collector.py::test_parse_fleet_spec`, `test_load_families_roster`, `test_load_families_no_fleet` |
| S2 boards read-only via sqlite, last-good on error | PASS (after fix) | `_ro` uses `mode=ro` (`hive.py:199`); `test_snapshot_shape_and_json`; last-good added with `test_unreadable_board_keeps_last_good_read` (was FAIL before this branch) |
| S3 Bot Chat deliveries | PASS | `test_bot_chat_delivery` |
| S4 brain-lines runs | PASS (code) | `_brain_lines` `hive.py:252`; exercised only by the `test_collect_real_scan_smoke` / snapshot path, **no dedicated fixture test** — test gap, not a behaviour failure |
| S5 comments + task events | PASS | `test_comms_window_and_redaction` (comment + event kinds), `EVENT_KINDS` `hive.py:41` |
| S6 secret redaction | PASS | same test asserts `token=abcd1234` → `[redacted]`. Note: `SECRET` and `clean()` are defined twice in `hive.py` (lines ~40/219 and ~504/517; the later pair wins). Harmless today, dedupe is a follow-up |
| S7 collect(): families, brains, 12 h comms | PASS | `test_snapshot_shape_and_json`, `test_comms_window_and_redaction` (window), `test_unattributed_workers` |
| S8 diff(): only real new/status | PASS | `test_first_tick_emits_no_events_and_comms_are_deduped`; ad-hoc check: `diff_tasks` emits `status` for todo→running and `new` for a todo card, nothing for a brand-new done card |
| S9 poll loop, survives errors | PASS | `HiveFeed._run`/`tick` keep the last snapshot on exception (`hive.py:~1150`); `test_hive_api.py` env fixtures |
| S10 push + heartbeat + snapshot on connect | PASS | `test_stream_framing_snapshot_then_delta`, `test_stream_heartbeat`, `test_last_event_id_resume`, `test_stream_cap_then_503_and_slot_freed_on_disconnect`, `test_abrupt_disconnect_does_not_crash_server` |
| S11 last_activity / open_sessions | PASS | `test_open_sessions_and_last_activity` |

## Sounds S1-S11 of the brief (sound list)

The task refers to S1-S11 sound items. The plan has no separate sound table; the sound inventory is F22-F30 plus the kettle/pressure cues of H-4/H-6. All of them are covered by `check_hive_sound.js` (70 checks, listed above): every cue builds oscillators/noise, nothing sounds before the first gesture, quiet hours and reduced motion mute the right cues, the pressure kettle plays once per band, `a_aah.mp3` and audio files are absent ("no a_aah.mp3, audio files or reference material"). **Not verifiable headless**: audible parity against the frozen reference (needs a human listening session; N-A here).

## Remaining §6 rows

| Row | Verdict | Evidence |
|---|---|---|
| Zoom (LLMTELEMET-279) | PASS | `attachZoom` wired `hive.js:473`; screenshot shows `−` `+` `Fit`; wheel/drag covered by the shared zoom tests, `check_hive_view.js` re-render keeps buttons |
| Full canvas + full roster | PASS | `unit_hive_fx.mjs` "workers present, incl. pool", "pool strip stays on stage", layout at three viewports; screenshot shows every bot of each family |
| Polygon-only faces | PASS | `check_hive_polygon_faces.js` 4/4, "no circles on the stage" |
| Provider icons via provLogoSvg | PASS | `check_hive_provider_icons.js` 5/5; `check_qt_ball_provider_icons.js` 13/13 untouched |
| Spend/model tooltips, subscription labelling | PASS (backend) | `test_hive_spend.py` (join, subscription excluded from Est. Cost, null never invented); tooltip shows model/spend lines only when data exists |
| Secret redaction visible | PASS | S6 |
| 24 h side-by-side soak | NOT RUN | needs a day of wall clock plus a human; open |
| All guards green / Hazem OK | see report | guard results are in the task report; Hazem's OK is not mine to give |

## Counts

F1-F45 (45 items): **36 PASS**, **9 FAIL** — 5 outright (F10, F14, F17, F18, F21) and 4 partial (F7, F8, F30, F41), **0 N-A** (F16 is PASS for the pill, the logo half is N-A by design). S1-S11 (11 items): 11 PASS (S2 only after the fix in this branch, S4 with a test gap). Sound inventory (F22-F30 + kettle): covered by 70 passing checks, audible parity not verifiable headless.

The done-gate in `docs/plans/hive-tab.md` §3.0 says any FAIL blocks it, so the 9 FAILs above block retirement (H-9) until fixed or explicitly waived by Hazem.

## Follow-ups (not fixed here)

- F-A/F8: apply `.hv-shake` on the stage when anger reaches level 3 (small, CSS exists).
- F-B/F10: wire `hvHooks.onClick` to a burst + hexagon ping + click cue.
- F-C/F14: ambient packet traffic along hot edges.
- F-D/F17-F18: starfield / hex-grid parallax layer and warp streaks. Needs page-weight room: the dashboard is within about 2 KB of its 960,000-byte budget, which must not be raised, so this needs trimming elsewhere first.
- F-E/F21: shard and casing particles (CSS already present).
- F-F/F30: decide whether the 75 s narrator is wanted; the sound test currently forbids timers.
- F-G/F41: `flyThrough()` for an empty history.
- `hive.py`: remove the duplicated `SECRET` / `clean()`.
- Mobile 390x844: the stage sits below the toolbar and stats rows; consider moving the stage up (screenshot `hive-mobile-390x844.png`). The "Standalone Hive" link renders in the browser default link colour.
