# Phase 5 — Profile Autodiscovery

**Goal:** the tool finds every agent profile on the box by itself, and the
config file narrows or extends that set instead of silently replacing it.

**Status:** not started · 6 tickets · est ~13h

---

## Current behaviour, measured

`config.py` already has `autodiscover_profiles()` and it works — it finds both
profiles on this machine:

    profiles: [('default', '/home/hazemhagrass/.hermes', True),
               ('pixelvent', '/home/hazemhagrass/.hermes/profiles/pixelvent', True)]

So "read profiles automatically" is half-built. The defects are in how
discovery interacts with configuration, and both are reproducible:

**Bug 1 — an explicit empty list is overridden by discovery.**
`examples/sample-config.json` declares `"profiles": []`. Verified:

    sample-config declares profiles: []
    but load() returned: ['default', 'pixelvent']

The falsy-check treats "the user asked for none" as "the user said nothing".
The consequence is worse than cosmetic: **CI renders the sample dashboard from
the developer's real `~/.hermes`**, so a green build proves nothing about the
committed fixtures, and a leak gate that scans `examples/` cannot see it.
That makes this a privacy bug, not just a config bug — P5-06.

**Bug 2 — naming one profile hides the rest.** With a config naming a single
profile, on a box that has two:

    load() returned: ['Main']
    -> pixelvent is INVISIBLE: True

There is no warning. A new profile created after the config was written stays
invisible forever, and the dashboard's totals silently exclude it — the same
"plausible but empty" failure mode as the payload bugs in Phase 1.

**Bug 3 — `agent_home` is hardcoded at the call site.** The parameter exists
(`autodiscover_profiles(agent_home="~/.hermes")`) but nothing threads config or
an env var into it, so a non-default agent home cannot be discovered at all.

## Design

Discovery is the default and configuration is a *modifier*:

- No `profiles` key → discover everything. (works today)
- `"profiles": []` → discover nothing. Explicit empty means empty.
- `"profiles": [...]` → the named ones, **plus** discovered ones, with config
  entries winning on name collision. Discovered-but-unconfigured profiles are
  included and reported, not dropped.
- `"exclude": [...]` → the escape hatch for a profile you genuinely don't want.

The rule: **the tool never silently omits data that exists on disk.** If a
profile is skipped, the page says so.

## Tickets

| ID | Title | Est | Depends |
|----|-------|-----|---------|
| P5-01 | `"profiles": []` must mean none, not "discover" | 1h | — |
| P5-02 | Merge configured with discovered instead of replacing | 3h | P5-01 |
| P5-03 | `agent_home` from config + `LLM_TELEMETRY_AGENT_HOME` | 2h | — |
| P5-04 | Report discovered / skipped / unreadable profiles in the UI | 2h | P5-02 |
| P5-05 | Pick up a profile created after the config was written | 2h | P5-02 |
| P5-06 | CI must not read the developer's real `~/.hermes` | 3h | P5-01 |

## Sequencing

P5-01 first and alone — it is a one-line semantic fix that P5-06 needs, and
P5-06 closes a live privacy hole in CI. Both should land before the Phase 2
extraction work starts touching the build path.

## Open question

**Should a profile be discoverable across users?** Discovery looks under one
`agent_home`. A shared box with two operators has two homes and the tool can
only see one. Out of scope until #36 ("does this stay a single-user tool?")
is answered — it is the same decision.
