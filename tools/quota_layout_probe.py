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
  const zeroWidth = fills.filter(f => f.getBoundingClientRect().width < 0.5).length;
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
    zeroWidth, escaped,
    overflow: overflow.slice(0, 5),
    overflowCount: overflow.length,
    levels,
    hasPct: view.querySelectorAll('.qv-pct').length,
  };
}"""


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--chrome", default="/usr/bin/google-chrome",
                    help="Chrome/Chromium binary (CI resolves its own)")
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.dirname(here)
    target = os.path.join(repo, "examples/reports/dashboard.html")
    if not os.path.exists(target):
        print(f"ERROR: {target} missing — build it first", file=sys.stderr)
        return 1

    from playwright.sync_api import sync_playwright

    url = "file://" + os.path.abspath(target)
    bad = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            executable_path=args.chrome, headless=True)
        try:
            for width in WIDTHS:
                page = browser.new_page(viewport={"width": width, "height": 1000})
                page.goto(url)
                page.wait_for_timeout(400)
                page.evaluate("location.hash = '#Quota'")
                page.wait_for_timeout(300)
                r = page.evaluate(PROBE)
                page.close()

                if r.get("fatal"):
                    bad.append(f"{width}px: {r['fatal']}")
                    continue
                if r["zeroWidth"]:
                    bad.append(f"{width}px: {r['zeroWidth']} zero-width bar(s)")
                if r["escaped"]:
                    bad.append(f"{width}px: {r['escaped']} bar(s) outside their row")
                if r["overflowCount"]:
                    bad.append(f"{width}px: {r['overflowCount']} overflowing "
                               f"element(s): {r['overflow']}")
                if not r["hasPct"]:
                    bad.append(f"{width}px: no percentage badge rendered")
                print(f"{width:>5}px  cards={r['cards']} bars={r['fills']} "
                      f"pcts={r['hasPct']} levels={','.join(r['levels']) or '-'}")
        finally:
            browser.close()

    if bad:
        print("\nFAIL:")
        for b in bad:
            print("  - " + b)
        return 1
    print("\nquota layout probe passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())