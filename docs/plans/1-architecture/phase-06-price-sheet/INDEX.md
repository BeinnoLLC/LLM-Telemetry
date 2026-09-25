# Phase 6 — Price Sheet

**Goal:** `costs.html` answers "what does a token cost, right now, on any model"
— for every model, not only the ones already used.

**Status:** not started · 0/5 tickets

## What this page is

A **price sheet and debugging reference**. Its own subtitle states the job:

> Exactly how every cost number on the dashboard is produced — per-million-token
> rates, their source, and the observed spend at those rates.

It explains the four-tier rate resolution (`local` → `vendor` → `openrouter` →
`unpriced`), derives local rates from measured power draw, and offers a job
calculator.

## What this page is not

It is **not** a spend report and it does **not** filter. Per-project, per-profile
and per-date-range spend belong on the dashboard (Phase 4). A withdrawn ticket
(#49) proposed a per-project cost table here; that was a misreading. Two places
computing the same total is two places that can disagree.

Design rule for this phase: **no filtering controls on this page.**

## Why the phase exists

Measured against the live catalogue:

```
OpenRouter catalogue:            460 models   (436 priced, 24 zero-price)
listed on the price sheet:        24 models
vendor overrides (WEB_RATES):      7
model aliases (ALIASES):          21
```

The page filters to models with recorded traffic, so **95% of known prices are
hidden**. It cannot price a model you have not run — which is precisely the
adoption decision a price sheet exists to support.

Two further defects found while measuring:

- The page claims the catalogue is "cached 24h". The real TTL is **6 hours**
  (`pricing.py: TTL = 6 * 3600`). The page misdocuments itself, on the page
  whose entire purpose is documenting where numbers come from.
- `fetch_catalog()` can return `live`, `cache`, `stale (...)` or
  `unavailable (...)`, but staleness carries no age and no visual weight. A
  sheet served from a cache that has not refreshed in a week looks identical to
  a fresh one.

And the reason all of it survived: **`costs.html` is never built in CI and never
asserted.** The 237 green checks cover `dashboard.html` only.

## Tickets

- [ ] **P6-01 · List the whole catalogue, not just models with traffic**
      🟡 ⏱ 3h · [`P6-01`](./tickets/P6-01.md)
- [ ] **P6-02 · Show catalogue freshness and fix the wrong 24h claim**
      🟢 ⏱ 2h · [`P6-02`](./tickets/P6-02.md)
- [ ] **P6-03 · Make unpriced models impossible to miss**
      🟢 ⏱ 2h · [`P6-03`](./tickets/P6-03.md)
- [ ] **P6-04 · Job calculator covers every model, local vs metered made clear**
      🟢 ⏱ 2h · [`P6-04`](./tickets/P6-04.md)
- [ ] **P6-05 · Test the price sheet: it currently has zero coverage**
      🟡 ⏱ 3h · [`P6-05`](./tickets/P6-05.md)

Total: ⏱ 12h

## Order

P6-01 first — it changes what the table *is*, and P6-03 / P6-04 both operate on
the fuller list. P6-02 is independent and can land any time; it is the smallest
fix with the most direct bearing on "are these prices current".

P6-05 last by dependency, but note the risk: four behaviour changes landing on a
page with zero tests. If only one ticket ships this cycle, P6-05 is the one that
makes the others safe.

## Dependency note

Independent of Phase 4. P6-01 touches the same `build()` aggregation loop that
P4-02 adds a `project` dimension to, so the two will conflict textually if run
in parallel — land one, then rebase the other.

`build_costs.py` also duplicates the dashboard's `:root` theme block (line
~171). Any styling added here must be added twice until #28 shares the tokens.
