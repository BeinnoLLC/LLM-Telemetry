# Breakpoint QA checklist (#21)

Manual pass for a PR that touches `build_dashboard.py`'s HTML/CSS/JS, or
`build_costs.py`. Attach before/after screenshots at all five widths —
`tools/breakpoint_shots.py` generates them automatically (see below); this
checklist is what to actually LOOK FOR in each one, because a script can
confirm a view rendered without catching that it rendered badly.

## Widths × themes × views

| Width | Label | Why this one |
|---|---|---|
| 375px | Mobile | iPhone SE / smallest common phone viewport |
| 768px | Tablet | iPad portrait; nav drawer's collapse breakpoint lives near here |
| 1024px | Small laptop | iPad landscape / small laptop; charts start getting real room |
| 1440px | Desktop | Most common desktop width |
| 1920px | Wide | Full HD; layouts must not just stretch with acres of dead space |

Both themes (`dark` — the default, `light` — `data-theme="light"`).

Every nav view in `dashboard.html` (`#navdrawer` `.view[data-view]` in
source order): Home, Live, Flow, Settings, Logs, Health, Usage, Cost,
Detail. `costs.html` has no nav (`build_costs.py` is a single-view page) —
just the 5 widths × 2 themes for it.

## What to check per screenshot

- **No horizontal scroll.** The page must not need sideways scrolling at
  any width — a chart or table overflowing its card is the most common
  regression.
- **No clipped control.** Buttons, chips, and the range-picker bar must be
  fully visible and clickable, not cut off at a card edge or squeezed to
  zero width.
- **Nav reachable.** At 375px/768px the nav drawer collapses to a toggle
  (`#navtoggle`) — confirm the toggle itself is visible and tappable, not
  hidden behind other chrome.
- **Drawer behaves per breakpoint.** The live-tail drawer (`#drawer`,
  opened via the "Live tail" nav item) and the transcript modal (`#tmodal`,
  #79) both switch to a full-screen sheet below 640px (`100dvh` with a
  `100vh` fallback) — confirm they actually fill the viewport at 375px
  rather than floating as an undersized centered box.
- **Gauges legible.** Any radial/doughnut chart or gauge-style widget must
  keep its label text readable at 375px — check it isn't shrunk to
  illegible size or overlapping the ring.
- **Charts not squashed.** Chart.js canvases use `height:clamp(...)` — at
  the widest and narrowest ends of a clamp, confirm the chart still reads
  as the shape it's supposed to be (a bar chart at 1920px with 3 bars
  spread across the full width still looks like 3 bars, not a smear).
- **Theme contrast.** In light theme specifically, check that muted text,
  chart gridlines, and border colors (`--muted-foreground`, `--border`)
  still have real contrast against the light background — dark-theme
  colors ported without re-checking contrast is the most common
  light-theme regression.

## Generating the screenshots

```bash
pip install playwright        # dev-extra; NOT a runtime dependency
python3 -m llm_telemetry.build_dashboard examples/reports/dashboard.html
python3 -m llm_telemetry.build_costs examples/reports/costs.html
python3 tools/breakpoint_shots.py --out breakpoint-shots --file examples/reports/dashboard.html
python3 tools/breakpoint_shots.py --out breakpoint-shots --file examples/reports/costs.html
```

`tools/breakpoint_shots.py` uses the system's `google-chrome` binary
directly (`--chrome /path/to/chrome` to point at another one) — Playwright
itself is only needed for its automation API, its own bundled Chromium
download is never required. It also runs a render sanity check per
screenshot (the target view is actually the unhidden one, and the page has
non-trivial content) and exits non-zero if any view silently rendered
empty — a passing run means every screenshot is worth looking at, not that
the tool merely didn't crash.

## CI

`.github/workflows/ci.yml` runs the same script after every push/PR and
uploads the PNGs as a `breakpoint-shots` build artifact (`continue-on-error:
true` — a screenshot-tooling hiccup never blocks a merge; this step exists
to attach reviewable images, not to gate anything). Download the artifact
from the PR's checks tab to review layout changes without checking out the
branch locally.
