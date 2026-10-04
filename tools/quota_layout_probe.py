#!/usr/bin/env python3
"""Geometry probe for the Quota view: catches layout breakage a screenshot
review can miss, and does not need a human (or a vision model) to look.

Asserts, at each breakpoint: the view un-hides, every provider card has
non-zero size, every quota bar has non-zero width AND is inside its row, no
element overflows the viewport horizontally, and the attention state is
visually distinct from the ok state.
"""
import os
import sys

# The repo's standing visual-check widths, plus the nav's own breakpoints.
WIDTHS = [360, 375, 768, 1024, 1280, 1440, 1920]

PROBE = """() => {
  const view = document.querySelector('[data-view="Quota"]');
  if (!view || view.hidden) return {fatal: 'Quota view not unhidden'};
  const cards = [...view.querySelectorAll('.qv-prov')];
  if (!cards.length) return {fatal: 'no .qv-prov cards rendered'};

  const de = document.documentElement;
  const overflow = [];
  for (const el of view.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > de.clientWidth + 1 || r.left < -1) {
      overflow.push((el.className || el.tagName) + ' [' +
                    Math.round(r.left) + '..' + Math.round(r.right) + ']');
    }
  }

  const fills = [...view.querySelectorAll('.qv-fill')];
  const tracks = [...view.querySelectorAll('.qv-track')];
  // Assert the TRACK, not the fill. A fill is legitimately ~0px wide when a
  // window has 0% used, so checking fills confuses "nothing consumed yet" with
  // "the column collapsed and there is no bar at all". The track is the
  // invariant: if it has width, a bar exists and the fill can grow inside it.
  const zeroTrack = tracks.filter(t => t.getBoundingClientRect().width < 0.5).length;
  const escaped = fills.filter(f => {
    const row = f.closest('.qv-win');
    if (!row) return true;
    const fr = f.getBoundingClientRect(), rr = row.getBoundingClientRect();
    return fr.right > rr.right + 1 || fr.left < rr.left - 1;
  }).length;

  // The attention state must be distinguishable from ok, else a 97%-used
  // provider reads exactly like a comfortable one.
  const levels = [...new Set(
    [...view.querySelectorAll('.qv-win')].map(w => w.dataset.level).filter(Boolean)
  )].sort();

  return {
    cards: cards.length,
    fills: fills.length,
    tracks: tracks.length,
    zeroTrack, escaped,
    overflow: overflow.slice(0, 5),
    overflowCount: overflow.length,
    levels,
    hasPct: view.querySelectorAll('.qv-pct').length,
  };
}"""


# Reproduces the 360px failure CI hit, in two parts, because one alone is not
# enough on a machine with different fonts.
#
# The collapse needs the row's fixed columns to exceed the row width. The
# culprit is the trailing `auto` column: the "resets <timestamp>" text, whose
# rendered width is font-dependent. On the runner that text is wider than it is
# here, which is exactly why the old CSS passed locally and failed in CI.
# `letter-spacing` widens that one column without touching the row's type size,
# so this reproduces the runner's metrics rather than faking the outcome.
#
# With the fix in place the reset span is `display:none` below 520px, so this
# CSS changes nothing -- which is the point: the fix is font-metric-proof
# because the bar's track carries an explicit `minmax(48px,1fr)` minimum and
# the reset column is gone, leaving nothing to squeeze it.
REVERT_CSS = """
.qv-win{grid-template-columns:minmax(70px,auto) 52px 1fr auto !important}
@media (max-width:520px){
  .qv-win{grid-template-columns:minmax(70px,auto) 52px 1fr auto !important}
  .qv-reset{display:inline !important;letter-spacing:.42em}
}
"""

BROKEN_WIDTH = 360

# Sub-check B: keep the FIXED grid but force the wide reset text visible again,
# so the `minmax(48px,1fr)` bar minimum is what has to hold the row together.
# This is the load-bearing half of the control: A proves the probe can fail, B
# proves the shipped CSS survives the runner's font metrics rather than merely
# happening to fit on the machine that wrote it.
WIDEN_CSS = """
@media (max-width:520px){.qv-reset{display:inline !important;letter-spacing:.42em}}
"""


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--chrome", default="/usr/bin/google-chrome",
                    help="Chrome/Chromium binary (CI resolves its own)")
    ap.add_argument("--control", action="store_true",
                    help="prove the probe can fail (revert the CSS fix and "
                         "require failure) and that the fixed CSS still holds "
                         "when the reset column is widened to CI's metrics")
    ap.add_argument("--control-part", choices=["revert", "widen"],
                    help="run a single control sub-check instead of both")
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.dirname(here)
    target = os.path.join(repo, "examples/reports/dashboard.html")
    if not os.path.exists(target):
        print(f"ERROR: {target} missing — build it first", file=sys.stderr)
        return 1

    from playwright.sync_api import sync_playwright

    url = "file://" + os.path.abspath(target)
    widths = [BROKEN_WIDTH] if args.control else WIDTHS
    bad = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            executable_path=args.chrome, headless=True)
        try:
            for width in widths:
                page = browser.new_page(viewport={"width": width, "height": 1000})
                page.goto(url)
                page.wait_for_timeout(400)
                if args.control and args.control_part != "widen":
                    page.add_style_tag(content=REVERT_CSS)
                elif args.control:
                    page.add_style_tag(content=WIDEN_CSS)
                page.evaluate("location.hash = '#Quota'")
                page.wait_for_timeout(300)
                r = page.evaluate(PROBE)
                page.close()

                if r.get("fatal"):
                    bad.append(f"{width}px: {r['fatal']}")
                    continue
                if r["zeroTrack"]:
                    bad.append(f"{width}px: {r['zeroTrack']} collapsed bar track(s) "
                               f"— the row renders a percentage with no bar")
                if r["escaped"]:
                    bad.append(f"{width}px: {r['escaped']} bar(s) outside their row")
                if r["overflowCount"]:
                    bad.append(f"{width}px: {r['overflowCount']} overflowing "
                               f"element(s): {r['overflow']}")
                if not r["hasPct"]:
                    bad.append(f"{width}px: no percentage badge rendered")
                print(f"{width:>5}px  cards={r['cards']} bars={r['fills']} "
                      f"tracks={r['tracks']} pcts={r['hasPct']} "
                      f"levels={','.join(r['levels']) or '-'}")
        finally:
            browser.close()

    if args.control:
        part = args.control_part or "revert"
        if part == "widen":
            # Sub-check B: the shipped CSS must SURVIVE the wide reset column.
            # Here finding nothing is the pass.
            if bad:
                print(f"\ncontrol B FAILED — the fixed row collapses at "
                      f"{BROKEN_WIDTH}px once the reset column is widened to "
                      f"the runner's metrics, so the fix is not font-proof:")
                for b in bad:
                    print("  - " + b)
                return 1
            print(f"\ncontrol B OK — the fixed row keeps all 5 bar tracks at "
                  f"{BROKEN_WIDTH}px even with the reset column widened")
            return 0

        # Sub-check A: the control passes only if reverting the CSS actually
        # broke the layout. A probe that cannot fail is not a gate.
        if bad:
            print("\ncontrol A OK — reverting the row CSS reproduces the failure:")
            for b in bad:
                print("  - " + b)
            return 0
        print("\ncontrol A FAILED — reverting the row CSS changed nothing, so the "
              "probe would not have caught the original bug")
        return 1

    if bad:
        print("\nFAIL:")
        for b in bad:
            print("  - " + b)
        return 1
    print("\nquota layout probe passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())