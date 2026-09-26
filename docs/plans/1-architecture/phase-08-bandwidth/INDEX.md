# Phase 8 — Bandwidth

**Goal:** estimate upload/download for every session and model, render it in the
tables, and keep tracking it over time.

**Status:** in progress · 5/6 tickets · est ~20h

---

## What the data says

No byte counters exist in the schema (only `hosted_rooms.event_bytes`, unrelated
to LLM traffic). `messages.token_count` is NULL in all 425,427 rows, so
per-message calibration is impossible. A session-level join works:

    269 sessions · 560,471,345 stored body bytes · 121,273,494 in+out tokens
    -> ~4.6 bytes per token (4.68 on the run recorded below)

That sits near the ~4 chars/token rule of thumb, which is why the method is
trustworthy rather than a guess.

### The finding that shapes the phase

| | tokens | share |
|---|---:|---:|
| input (fresh) | 104,410,872 | 2.4% |
| cache_read | 4,311,531,663 | **97.6%** |
| output | 16,862,622 | — |

Context is re-sent **42x per unique stored byte**. Bandwidth here is almost
entirely re-sent conversation history — not new prompts, and not replies.

### Estimate

| | raw | if request gzip is on |
|---|---:|---:|
| Internet upload | 18.74 GB | 5.13 GB |
| Internet download | 0.07 GB | 0.02 GB |
| LAN (local models) | 0.27 GB | — |

Over 31,782 API calls. Upload:download is **278:1**, inverted versus normal web
traffic, because a whole conversation is shipped to receive a paragraph.

## Resolved: prefix vs handle-based caching

This was the one assumption that could move the estimate by 40x. Live data
settles it:

    anthropic    cache_read=3,886,077,710  cache_write=243,023,794  calls=26,512
                 -> 146,578 cache_read tokens PER CALL
    opencode-go  87,682 per call, cache_write=0
    custom       13,268 per call, cache_write=0

`cache_write > 0` means the client sent a prefix and asked the server to store
it. 146k read tokens per call is a whole conversation re-sent, not an id. No
provider shows the handle-based signature (high reads, zero writes, tiny
per-call figure). **Every caching provider re-sends context**, so cache_read
tokens genuinely cross the wire and belong in the upload figure.

## Open: request-body gzip (P8-06)

Anthropic returns `Vary: Accept-Encoding`, but that governs *responses* — the
0.07 GB half, not the 18.74 GB half. Whether the client gzips *request* bodies
cannot be verified from this box: the Hermes client source is not installed here.
Default httpx/requests do **not** gzip request bodies, so raw is the likelier
figure and is the default. Measured on real content, gzip -6 gives 3.65x.

This decides whether four views show a number that is 3.65x too high, so it is
worth settling early.

## Reproducing these numbers

    .venv/bin/python examples/recalibrate_bytes_per_token.py ~/.hermes/state.db

The constant drifts slightly as the DB grows (4.62 → 4.68 within one working
session), which is why P8-04 stores the constant alongside each dated row
instead of recomputing history.

## Tickets

| id | title | est | depends |
|---|---|---|---|
| P8-01 | Byte estimator, calibrated, assumptions named | 4h | — |
| P8-02 | Bandwidth columns in the model and provider tables | 4h | P8-01 |
| P8-03 | Live view: per-session bandwidth, updating as work happens | 4h | P8-01 |
| P8-04 | Persist bandwidth per day so it can be tracked | 3h | P8-01, #23 |
| P8-05 | Bandwidth trend and a context re-send panel | 3h | P8-04 |
| P8-06 | Settle request-body gzip, correct the figures | 2h | P8-01 |

## Sequencing

**P8-01 and P8-06 first.** The estimator and the gzip question are both cheap,
and together they decide what number every other ticket renders. Building four
views on an unsettled basis means correcting four views later.

Then **P8-02** (the tables, which is what was actually asked for), then
**P8-03** (live tracking), then **P8-04 → P8-05** for history and the trend.

**P8-04 depends on #23** (payload versioning). Adding a payload dimension
without a version field repeats the exact failure class ADR 0001 documents.

## Constraint

Every rendered figure is an **estimate** and must say so in the header, not in a
footnote. A number that looks measured but is derived is the failure mode this
phase has to avoid — the same shape as the "plausible but empty dashboard" bugs
in ADR 0001.

LAN bytes are tracked separately and never summed into the internet total. Local
traffic does not touch the metered link.
