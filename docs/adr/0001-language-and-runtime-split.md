# ADR 0001 — Language and runtime split

**Status:** proposed
**Date:** 2026-09-25

## Question

The tool grew from a personal script collection into a published repo. Before
adding features, is Python still the right choice — or should this become a
Node/TypeScript application?

## What the code actually looks like today

Measured, not estimated:

| Module | Lines | Embedded HTML/CSS/JS | Real Python |
| --- | ---: | ---: | ---: |
| `build_dashboard.py` | 2,527 | **2,490 (98%)** | 37 (1%) |
| `build_costs.py` | 557 | 241 (43%) | 316 |
| `collect_analytics.py` | 286 | 112 (39%, SQL) | 174 |
| `probe_hosts.py` | 383 | 56 (14%) | 327 |
| `pricing.py` | 266 | 21 (7%) | 245 |
| `collect_live.py` | 200 | 36 (18%) | 164 |
| `config.py` | 174 | 34 (19%) | 140 |

Total package: 4,774 lines.

The single largest string literal in `build_dashboard.py` is **1,789 lines** —
a complete frontend application (charts, force-directed graph, drawer, tab
router, colour system) living inside a Python string.

Performance, for the record: `cli analytics` completes in **0.36s** against a
2.2 GB SQLite database; `cli live` in 0.13s. Collection is not a bottleneck and
no rewrite can be justified on speed.

## The real problem is not the language, it is the seam

Every hard-to-find bug in recent memory came from the same place — code that no
tool could check, because to Python it was an opaque string:

- A progress-bar fill rendered **0.0 × 0.0** at every viewport. `<i>` defaults to
  `display:inline`, which ignores width and height. No linter saw it.
- A colour fan emitted `hsl(-3 …)` — a negative hue — from an unwrapped
  subtraction.
- `#flow .nd{cursor:pointer}` silently outranked `.nd{cursor:grab}` on
  specificity.
- A drag handler was requested, and only its CSS landed. The feature was
  *absent* for an entire session and nothing failed, because nothing could.
- The producer/consumer contract broke twice: a payload key `d` where the
  consumer read `date` (rendered 0 rows), and `generated` as an epoch int where
  the consumer called `.replace()` (wedged the loading screen).

Those last two are the important ones. They are not frontend bugs — they are
**contract** bugs between a Python producer and a JavaScript consumer that have
no agreed, checkable schema between them.

## Decision

**Keep Python for the data plane. Extract the presentation plane into real
files. Put a versioned contract on the seam between them.**

This is a refactor, not a rewrite. Nothing that works gets thrown away.

### Why Python stays for collection

- `sqlite3` is in the standard library. The equivalent in Node (`better-sqlite3`)
  is a native module needing a compiler on every deployment target.
- The collectors are the part that already works, is fast, and is covered by the
  leak gate. Rewriting them buys nothing a user can see.
- Deployment is a systemd timer on a box. Zero-dependency Python is the lightest
  thing that satisfies that; a Node service adds a runtime and a package tree.

### Why the frontend leaves the Python string

- It is 98% of that module. Calling it "a Python file" is a filing error.
- As `.js` and `.css` files it becomes visible to editors, linters, type
  checkers, diff review, and tests — every class of bug listed above becomes
  catchable before it ships.
- The test suite is **already Node/jsdom** (18 suites, 237 checks). Node is
  present in the dev workflow today; this stops pretending otherwise.

### Explicitly rejected

| Option | Why not |
| --- | --- |
| Full rewrite to TypeScript/Node | Discards working, fast, dependency-free collectors to solve a problem that lives entirely in the presentation layer. |
| Leave as-is | The bug pattern above is the cost, and it recurs. |
| Python + Jinja2 templates | Fixes HTML interpolation; leaves the 1,789-line JS blob exactly as unlinted as it is now. |
| Serve dynamically (FastAPI/Flask) | Adds a long-lived server process and loses "static files, any HTTP server, open the file". Collectors already run on timers; nothing needs a request-time database. |
| Bundler (Vite/webpack) for the frontend | Adds a build step and an npm tree to ship a dashboard. Plain ES modules need neither and keep "clone and open" true. |

### The shape this lands in

```
src/llm_telemetry/          # data plane — Python, stdlib only
  collect_*.py, probe_hosts.py, pricing.py, config.py
  schema/*.json             # the contract, versioned
web/                        # presentation plane — real files
  dashboard.html
  css/dashboard.css
  js/{palette,charts,flow,drawer,live,router}.js
```

`build_dashboard.py` shrinks to what it should have been: copy static assets,
inject the payload, write the output.

## Consequences

- Node becomes a declared **development** dependency (lint + test). It stays out
  of the runtime: the shipped artifact is still static files plus Python.
- One release carries a file move large enough to make `git log --follow`
  worth knowing about.
- The schema version is a real compatibility surface from now on: a payload
  change means a version bump and a consumer guard, not a silent key rename.
