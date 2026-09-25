# Phase 4 — Project Distribution (session attribution)

**Goal:** answer "where did my spend and my model usage actually go?" broken
down by *project*, not by profile or model alone.

**Status:** not started · 11 tickets (+1 withdrawn) · est ~31h

---

## Why

Today the dashboard can tell you *what* ran (models, providers, tools) and
*when*, but not *what for*. Two profiles and 15 models produce one flat pile.
The question the tool cannot currently answer is the one that matters for a
budget conversation: **which project burned the $736?**

## The premise, measured before it was designed

The request assumed "projects are the session name". That is *approximately*
true and the approximation is where all the difficulty lives. Measured on the
live `~/.hermes/state.db` (282 sessions, $736.81 estimated):

| candidate key    | non-null | distinct |
|------------------|----------|----------|
| `display_name`   | 0        | 0        |
| `git_repo_root`  | 0        | 0        |
| `git_branch`     | 0        | 0        |
| `title`          | 43       | 43       |
| `cwd`            | 106      | 4        |
| `profile_name`   | 282      | 1        |

Three things follow, and they shaped every ticket in this phase:

**1. There is no session "name" column.** `display_name` is empty in all 282
rows. The usable field is `title`, and it is present on 43. Any ticket written
against a `name` column would not compile.

**2. `title` is not a project key — it is a headline.** Real values:

    'ahwa-health-gate · Sep 25 12:04'     ← cron, 25 near-identical variants
    'Nowinv'                              ← a project
    'Explain understand-anything.com and its use in AI code understanding'
    'Ubuntu Diagnosis'                    ← a task, not a project

Grouping on raw `title` yields 43 groups for ~12 real projects, and the cron
job alone fragments into 25 singletons because the timestamp is *inside* the
title. A stem rule (split on ` · `) collapses those 25 to one.

**3. Session-count coverage looks fatal; cost coverage is fine.** After
stemming and falling back to `cwd` basename:

    attributed:  45 / 282 sessions  = 16%
    unattributed cost share:          15%

16% of sessions carry 85% of the money. The long tail of 237 unattributed
sessions is small, short, cheap work; the handful of named ones
(`Nowinv` $249.89, `Ahwa` $149.30, `Aixiom` $101.78) are the real projects.

**This is the central design decision of the phase:** the feature is built
**cost-weighted**, not session-count-weighted. A session-count bar chart would
be 84% "unknown" and would look broken. A cost bar chart is 85% attributed and
answers the actual question. See P4-08.

**4. Subagent and cron sessions are recoverable for free.** All 24 subagent
sessions have a `parent_session_id`, and all 24 parents have a title — so
inheritance lifts attribution from 45 to 69 sessions at zero guesswork cost
(P4-03). All 25 cron sessions have titles.

## Non-goals

- Inferring a project from prompt text or an LLM call. Guessed attribution in a
  cost report is worse than an honest "unattributed" bucket.
- Renaming or writing back to `sessions`. This phase reads; it does not mutate
  the agent's database.
- A project *manager* (create/merge/alias projects by hand). Possible later;
  see the open question.

## Tickets

| ID | Title | Est | Depends |
|----|-------|-----|---------|
| P4-01 | Project key resolver, defined once in Python | 3h | — |
| P4-02 | `project` dimension in the analytics payload | 3h | P4-01, P1-01 |
| P4-03 | Subagent + cron sessions inherit the parent project | 2h | P4-01 |
| P4-04 | Unattributed is a first-class bucket, never hidden | 2h | P4-02 |
| P4-05 | Projects view: project × model matrix | 5h | P4-02 |
| P4-06 | Project × provider distribution | 3h | P4-02 |
| P4-07 | Project drill-down panel | 4h | P4-05 |
| P4-08 | Cost / calls / tokens weighting toggle | 2h | P4-05 |
| P4-09 | Project as a global cross-filter | 3h | P4-05 |
| P4-10 | Per-project trend over time | 3h | P4-02 |
| P4-11 | Projects entry in the nav drawer + homepage card | 1h | #3, #4 |
| ~~P4-12~~ | ~~Per-project cost table in `costs.html`~~ — **withdrawn** | — | — |

**P4-12 was withdrawn** (#49). It was filed on a misreading of `costs.html`,
which is a price sheet and debugging reference, not a spend report: it answers
"what does a token cost right now", does not filter, and must not grow a
project dimension. Per-project spend lives here in Phase 4 only — two pages
computing the same total is two pages that can disagree. Price-sheet work moved
to [Phase 6](../phase-06-price-sheet/INDEX.md).

## Sequencing

P4-01 → P4-02 → P4-03 → P4-04 before any UI. The resolver and the payload are
the whole risk; the views are mechanical once the dimension exists.

P4-02 depends on **#23** (`schema_version`): adding a dimension to a payload
that carries no version is exactly the change that has already broken this
project twice with a silent empty render.

P4-11 depends on the nav shell (#3, #4) — do not add a seventh chip to the tab
row that #4 deletes.

## Open questions

- **Project aliasing.** `Workspace` and `workspace` are two groups today, and
  `Aixiom` vs the clinic repo may be the same project under two names. A
  user-editable alias map in config solves it, but it is state the tool has so
  far avoided. Deferred until the matrix exists and shows how bad the collisions
  actually are.
- **Is `cwd` worth keeping as a fallback?** It has 4 distinct values and 3 of
  them (`/opt`, `/tmp`, `/home`) are useless. Only `/home/hazemhagrass/workspace`
  is meaningful, and it maps to *many* projects. Currently specified as
  "basename, excluding a denylist" — may not be worth the complexity.
