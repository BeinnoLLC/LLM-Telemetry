# LLM Telemetry — v0.2 Plan: split the data plane from the presentation plane

This plan closes the gap identified in
[ADR 0001](../../adr/0001-language-and-runtime-split.md): the collectors are sound,
but the dashboard is a 1,789-line frontend application stored inside a Python
string literal, where no linter, type checker, or editor can see it. Every
recent hard-to-find bug came from that blind spot or from the unversioned
contract between the Python producer and the JavaScript consumer.

It assumes the v0.1 extraction is done: the package is importable, config is
autodiscovered, the leak gate passes, and 237 checks are green.

**This plan is deliberately not a rewrite.** The Python collectors stay. No
framework is adopted, no bundler is introduced, and the shipped artifact remains
static files plus stdlib Python.

**Update this file as work lands** — flip a box, then run the sync script.

## Overall progress

<!-- tracker:start -->
**0/12 tickets complete (0%)**

`░░░░░░░░░░░░░░░░░░░░` 0%

| Phase | Done | Total |
| --- | ---: | ---: |
| 1 · Contract | 0 | 3 |
| 2 · Presentation | 0 | 6 |
| 3 · Data plane | 0 | 3 |
<!-- tracker:end -->

## Where things stand (read this first)

Verified by reading the code on 2026-09-25, not by trusting earlier notes.

| Area | Reality check |
| --- | --- |
| **Collectors** | Healthy. `cli analytics` runs in 0.36s against a 2.2 GB SQLite DB, `cli live` in 0.13s. Stdlib only. No reason to touch them for performance. |
| **`build_dashboard.py`** | 2,527 lines, of which **2,490 (98%) are HTML/CSS/JS inside string literals** and 37 are Python. The largest single literal is 1,789 lines. |
| **Frontend tooling** | None. No ESLint, no CSS lint, no type checking. `display:inline` on a sized element, a negative `hsl()` hue, and a CSS specificity override all shipped undetected. |
| **Payload contract** | Implicit and unversioned. No `schema_version` in any of the four payloads. It has already broken twice (`d` vs `date`; `generated` epoch int vs ISO string). |
| **Tests** | 18 jsdom suites, 237 checks, green. They parse the *built* HTML, so they test the output, not the modules — a function cannot be tested in isolation. |
| **Python tests** | **Zero.** CI runs the leak gate and the jsdom suites only; collectors are exercised indirectly or not at all. |
| **Docs** | `docs/` existed but was empty until this plan. |

## 1. The contract between producer and consumer (0/3)

The seam where Python hands data to JavaScript is currently undefined. Both
payload bugs so far were contract bugs, and both presented as a blank or
zero-filled dashboard rather than an error — the worst failure mode, because it
looks like "no data" rather than "wrong data".

Target: a versioned, machine-checkable schema that *both* sides assert against,
so a mismatch fails loudly in CI instead of silently at render time.

- [ ] **P1-01 · Version every payload** — add `schema_version` to all four
      payloads and refuse to render on mismatch, with a visible error instead of
      an empty chart. The consumer currently cannot distinguish "collector wrote
      nothing" from "collector wrote a shape I don't understand". 🟢 ⏱ 2h ·
      Ticket [`P1-01`](./phase-01-contract/tickets/P1-01.md)
- [ ] **P1-02 · JSON Schema for the four payloads** — `analytics`, `live`,
      `ollama`, `router`. Validate on the Python side at write time and in the
      jsdom suites at read time, so producer and consumer are checked against
      one artifact rather than against each other's assumptions. 🟡 ⏱ 4h ·
      Ticket [`P1-02`](./phase-01-contract/tickets/P1-02.md)
- [ ] **P1-03 · Golden payload fixtures** — freeze a known-good payload and diff
      against it in CI. The sample generator *reshapes real data*, which is what
      makes it schema-accurate; that also means a collector change silently
      changes the fixture unless something pins it. 🟡 ⏱ 3h ·
      Ticket [`P1-03`](./phase-01-contract/tickets/P1-03.md)

## 2. Extract the presentation plane (0/6)

The main event. 2,490 lines move out of Python string literals into real files.

Order matters: CSS first (no execution semantics, lowest risk), then JS split by
concern, then the HTML shell, then linting, then the test migration. Each step
must leave the suite green — this is a move, not a redesign, and behaviour must
stay identical at every commit.

- [ ] **P2-01 · Extract CSS to `web/css/dashboard.css`** — 218 rules. Byte-identical
      output is the acceptance criterion; the rendered page must not change.
      🟢 ⏱ 3h · Ticket [`P2-01`](./phase-02-frontend/tickets/P2-01.md)
- [ ] **P2-02 · Extract JS to ES modules** — split by concern, not by size:
      `palette`, `charts`, `flow`, `drawer`, `live`, `router`. Plain ES modules,
      no bundler, so "clone and open the file" keeps working. 🔴 ⏱ 8h ·
      Ticket [`P2-02`](./phase-02-frontend/tickets/P2-02.md)
- [ ] **P2-03 · `dashboard.html` becomes a real file** — `build_dashboard.py`
      drops to: copy assets, inject payload, write output. It should end under
      150 lines of actual Python. 🟡 ⏱ 4h ·
      Ticket [`P2-03`](./phase-02-frontend/tickets/P2-03.md)
- [ ] **P2-04 · Same treatment for `build_costs.py`** — 43% embedded. Smaller and
      simpler than the dashboard, so it lands after the pattern is proven rather
      than in parallel with it. 🟢 ⏱ 2h ·
      Ticket [`P2-04`](./phase-02-frontend/tickets/P2-04.md)
- [ ] **P2-05 · ESLint + Stylelint in CI** — the payoff step. Configure rules that
      would have caught the actual bugs: no unused vars (the drag handler that
      never ran), valid colour functions (`hsl(-3 …)`), and no-descending-specificity
      (`cursor:pointer` beating `cursor:grab`). 🟡 ⏱ 3h ·
      Ticket [`P2-05`](./phase-02-frontend/tickets/P2-05.md)
- [ ] **P2-06 · Point the suites at modules, not built HTML** — tests can then
      import and call a function directly instead of loading a whole page and
      scraping the DOM. Keep a thin set of integration checks against the built
      artifact so the assembly step stays covered. 🔴 ⏱ 6h ·
      Ticket [`P2-06`](./phase-02-frontend/tickets/P2-06.md)

## 3. Harden the data plane (0/3)

Python stays, so it should be held to the same standard the frontend is about to
get. Today the collectors have no type checking and no direct tests.

- [ ] **P3-01 · Ruff + mypy on the package** — start non-strict and ratchet.
      `config.py` already had a `str`-vs-`Path` bug and a `to_dict`/`dump`
      mismatch that a type checker catches for free. 🟢 ⏱ 3h ·
      Ticket [`P3-01`](./phase-03-collectors/tickets/P3-01.md)
- [ ] **P3-02 · Python unit tests for the collectors** — CI has none. Build a
      small fixture SQLite DB and assert the shaping logic: cost maths, the
      `inflight()` queue count, local-host classification. That last one has real
      consequences — a misclassified host means self-hosted traffic is billed as
      API traffic. 🟡 ⏱ 5h ·
      Ticket [`P3-02`](./phase-03-collectors/tickets/P3-02.md)
- [ ] **P3-03 · Move SQL out of f-strings into named constants or `.sql` files** —
      the analytics module is 39% embedded SQL. Not an injection risk today
      (no user input reaches it), but it is unreadable and unreviewable in
      place. 🟢 ⏱ 2h ·
      Ticket [`P3-03`](./phase-03-collectors/tickets/P3-03.md)

## 4. Project distribution (0/11, 1 withdrawn)

Answer "where did my spend actually go?" per *project*, not per profile or model.
Full plan: [`phase-04-project-distribution/INDEX.md`](./phase-04-project-distribution/INDEX.md)

The premise ("projects are the session name") was measured against the live
`state.db` before design, and needed adjusting on three counts: there is **no**
session-name column (`display_name` is empty in all 282 rows), `title` is a
headline rather than a key (the cron job fragments into 25 timestamped
variants), and session-count coverage is only 16% — while *cost* coverage is
85%. Hence the phase is built cost-weighted; a session-count chart would be 84%
"unknown" and look broken.

- [ ] **P4-01 · Project key resolver, defined once** 🟡 ⏱ 3h ·
      [`P4-01`](./phase-04-project-distribution/tickets/P4-01.md)
- [ ] **P4-02 · `project` dimension in the analytics payload** 🟡 ⏱ 3h ·
      [`P4-02`](./phase-04-project-distribution/tickets/P4-02.md)
- [ ] **P4-03 · Subagent/cron sessions inherit the parent project** 🟢 ⏱ 2h ·
      [`P4-03`](./phase-04-project-distribution/tickets/P4-03.md)
- [ ] **P4-04 · Unattributed is a first-class bucket** 🟢 ⏱ 2h ·
      [`P4-04`](./phase-04-project-distribution/tickets/P4-04.md)
- [ ] **P4-05 · Projects view: project × model matrix** 🟡 ⏱ 5h ·
      [`P4-05`](./phase-04-project-distribution/tickets/P4-05.md)
- [ ] **P4-06 · Project × provider distribution** 🟡 ⏱ 3h ·
      [`P4-06`](./phase-04-project-distribution/tickets/P4-06.md)
- [ ] **P4-07 · Project drill-down panel** 🟡 ⏱ 4h ·
      [`P4-07`](./phase-04-project-distribution/tickets/P4-07.md)
- [ ] **P4-08 · Cost/calls/tokens weighting toggle** 🟢 ⏱ 2h ·
      [`P4-08`](./phase-04-project-distribution/tickets/P4-08.md)
- [ ] **P4-09 · Project as a global cross-filter** 🟡 ⏱ 3h ·
      [`P4-09`](./phase-04-project-distribution/tickets/P4-09.md)
- [ ] **P4-10 · Per-project trend over time** 🟡 ⏱ 3h ·
      [`P4-10`](./phase-04-project-distribution/tickets/P4-10.md)
- [ ] **P4-11 · Projects nav entry + homepage card** 🟢 ⏱ 1h ·
      [`P4-11`](./phase-04-project-distribution/tickets/P4-11.md)
- [ ] ~~**P4-12 · Per-project cost table in `costs.html`**~~ — **withdrawn**,
      see [`P4-12`](./phase-04-project-distribution/tickets/P4-12.md) and
      [#49](https://github.com/BeinnoLLC/LLM-Telemetry/issues/49). Filed on a
      misreading of `costs.html`, which is a price sheet, not a spend report.
      Replaced by [Phase 6](#6-price-sheet-05).

## 5. Profile autodiscovery (0/6)

Discovery already works; the bugs are in how config interacts with it.
Full plan: [`phase-05-profile-autodiscovery/INDEX.md`](./phase-05-profile-autodiscovery/INDEX.md)

Two reproduced defects. `"profiles": []` in `examples/sample-config.json` is
ignored and autodiscovery runs anyway — so **CI renders the sample dashboard
from the developer's real `~/.hermes`**, making the green build meaningless and
bypassing the leak gate. And naming one profile in config makes every other
on-disk profile invisible with no warning, so totals silently exclude it.

- [ ] **P5-01 · `"profiles": []` must mean none, not "discover"** 🟢 ⏱ 1h ·
      [`P5-01`](./phase-05-profile-autodiscovery/tickets/P5-01.md)
- [ ] **P5-02 · Merge configured with discovered, never replace** 🟡 ⏱ 3h ·
      [`P5-02`](./phase-05-profile-autodiscovery/tickets/P5-02.md)
- [ ] **P5-03 · `agent_home` from config + env var** 🟢 ⏱ 2h ·
      [`P5-03`](./phase-05-profile-autodiscovery/tickets/P5-03.md)
- [ ] **P5-04 · Report discovered/skipped/unreadable profiles** 🟢 ⏱ 2h ·
      [`P5-04`](./phase-05-profile-autodiscovery/tickets/P5-04.md)
- [ ] **P5-05 · Pick up a profile created after the config** 🟢 ⏱ 2h ·
      [`P5-05`](./phase-05-profile-autodiscovery/tickets/P5-05.md)
- [ ] **P5-06 · CI must not read the real `~/.hermes`** 🟡 ⏱ 3h ·
      [`P5-06`](./phase-05-profile-autodiscovery/tickets/P5-06.md)

## 6. Price sheet (0/5)

`costs.html` answers one question: **what does a token cost right now, on any
model.** It is a price sheet and debugging reference, not a spend report.
Full plan: [`phase-06-price-sheet/INDEX.md`](./phase-06-price-sheet/INDEX.md)

Measured: the catalogue holds **460 models**, the page renders **24** — only
those with recorded traffic — so it cannot answer "what would model X cost"
before you have already used X. Two further defects found while checking:
the page claims the catalogue is "cached 24h" when `pricing.py` sets
`TTL = 6 * 3600`, and a stale or unavailable catalogue is reported in small
grey text beside a table of numbers that may be days old.

**Standing constraint:** no filtering controls, and no project / profile / date
dimension on this page. Ctrl+F is the feature.

- [ ] **P6-01 · List the whole catalogue, not just used models** 🟡 ⏱ 4h ·
      [`P6-01`](./phase-06-price-sheet/tickets/P6-01.md)
- [ ] **P6-02 · Catalogue freshness is load-bearing; fix the 24h lie** 🟢 ⏱ 2h ·
      [`P6-02`](./phase-06-price-sheet/tickets/P6-02.md)
- [ ] **P6-03 · Make unpriced models impossible to miss** 🟢 ⏱ 2h ·
      [`P6-03`](./phase-06-price-sheet/tickets/P6-03.md)
- [ ] **P6-04 · Job calculator covers every model** 🟢 ⏱ 2h ·
      [`P6-04`](./phase-06-price-sheet/tickets/P6-04.md)
- [ ] **P6-05 · First tests for the price sheet** 🟡 ⏱ 3h ·
      [`P6-05`](./phase-06-price-sheet/tickets/P6-05.md)



## Decisions for the owner (not tasks)

These are product calls. An agent that silently picks one has decided something
nobody reviewed.

- [ ] **Is the fire icon still wanted?** Requested earlier: "if a model worker is
      REALLY under pressure, add a fire icon in its row". Deferred then because
      no defensible threshold existed. The Ollama panel now has real GPU / VRAM /
      queue telemetry, so a threshold is now *possible* — but "really under
      pressure" still needs a definition. Proposal: GPU ≥ 85% **and** queue ≥ 2
      sustained over three consecutive 5s probes, so a single spike does not
      light it up. **Needs approval on the numbers.**
- [x] **Should the repo name be fixed?** ~~It is `LLM-Telemtry` (missing an
      `e`)~~ **Done** — renamed to `LLM-Telemetry`; remote, `pyproject.toml`
      URLs and the README clone command updated. GitHub redirects the old name,
      so existing links keep working.
- [ ] **Does this stay a single-user tool?** The whole architecture above assumes
      one operator watching their own fleet from static files. Multi-user access
      would invalidate the "static files, no server" decision in ADR 0001 —
      worth saying now rather than discovering mid-refactor.

## Explicitly out of scope / deferred

- [x] **Rewriting the collectors in Node/TypeScript** — rejected in ADR 0001.
      They are fast, dependency-free, and not where the bugs are.
- [x] **Adopting a frontend framework (React/Vue/Svelte)** — the dashboard is
      charts and one force-directed graph. A framework adds a build step and a
      dependency tree to solve a problem this code does not have.
- [x] **Introducing a bundler** — plain ES modules need no build step and keep
      the clone-and-open property. Revisit only if module count becomes
      unmanageable.
- [x] **A dynamic server (FastAPI/Flask)** — collectors run on timers; nothing
      needs request-time database access. A server would add a process to
      supervise for no user-visible gain.
- [x] **Precomputing analytics into summary tables** — raised earlier as a speed
      idea. Measured: 0.36s against 2.2 GB. There is nothing to optimise, and a
      cache would add an invalidation bug class for free.

## Suggested order of attack

Ordered by dependency and by what removes risk soonest, not by section number.

1. **P1-01** (version the payloads) — cheap, and it turns the two failure modes
   that have already happened into loud errors. Do it before moving any code.
2. **P1-03** (golden fixtures) — gives the extraction a behavioural safety net
   *before* 2,490 lines move.
3. **P2-01** (CSS) — lowest-risk move, proves the asset pipeline.
4. **P2-03** (HTML shell) — small Python change, unblocks the JS split.
5. **P2-02** (JS modules) — the big one. Land it in reviewable commits, one
   concern per commit, suite green at each.
6. **P2-05** (linting) — only pays off once the code is in real files, so it
   comes after the move rather than before.
7. **P1-02** (JSON Schema) — the full contract, once both sides are stable.
8. **P2-06**, **P2-04**, then **P3-01**…**P3-03** — hardening, no longer on the
   critical path.
