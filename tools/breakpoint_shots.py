#!/usr/bin/env python3
"""Breakpoint QA screenshots for the built dashboard (#21).

Renders examples/reports/dashboard.html (and costs.html) at five widths ×
both themes × every nav view, and writes PNGs to a directory for manual or
CI-artifact review.

DEV-EXTRA ONLY: requires `playwright` (not a runtime dependency — the
runtime stays PyYAML-only per the repo's own constraint, this script is
QA tooling, never imported by the package). Uses the system Chrome browser
via executable_path rather than Playwright's own bundled Chromium, so no
extra binary download is needed on a box that already has Chrome/Chromium
installed (`playwright install` is NOT required).

Usage:
    python3 tools/breakpoint_shots.py [--out DIR] [--file dashboard.html]

Exit code is non-zero if the built HTML file is missing, or if any page
never finishes its initial render (no non-trivial content, no navdrawer,
a genuinely broken build) — a screenshot filled with placeholder markup is
not a passing QA run.
"""
import argparse
import os
import sys

WIDTHS = [375, 768, 1024, 1440, 1920]
THEMES = ["dark", "light"]
# Fallback view list, used only if the nav cannot be read out of the page (see
# discover_views below). build_dashboard.py writes the real nav, so normally
# nothing consults this -- and when it did, it had drifted, so the Router tab
# (#130) and the Quota tab (#115) were never screenshotted or sanity-checked.
VIEWS = ["Home", "Live", "Flow", "Settings", "Logs", "Health", "Usage", "Cost", "Detail"]

HEIGHT = 1000  # tall enough that most views don't need scrolling to check layout


def discover_views(page):
    """The view names in nav order, read out of the built page's own nav.

    Falls back to the hardcoded VIEWS list if the nav exposes nothing usable —
    a screenshot run with a stale list is still better than one that crashes.
    """
    names = page.evaluate(
        """() => {
            const nav = document.getElementById('navdrawer') || document;
            // data-nav carries the real view name; the href is a slug
            // ("#/logs" for "Logs"), so reading hrefs back would need a
            // round-trip and would hand the caller the wrong casing.
            const found = [...nav.querySelectorAll('[data-nav]')]
                .map(el => (el.dataset.nav || '').trim())
                .filter(Boolean);
            return [...new Set(found)];
        }"""
    )
    names = [n for n in names if n]
    if not names:
        print("WARNING: no views found in the page nav — falling back to the "
              "built-in list, which may be out of date", file=sys.stderr)
        return list(VIEWS)
    return names


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="breakpoint-shots")
    ap.add_argument("--file", default="examples/reports/dashboard.html",
                     help="Built HTML file to screenshot (dashboard.html or costs.html)")
    ap.add_argument("--chrome", default="/usr/bin/google-chrome")
    args = ap.parse_args()

    if not os.path.exists(args.file):
        print(f"ERROR: {args.file} does not exist — build it first "
              f"(python3 -m llm_telemetry.build_dashboard {args.file})", file=sys.stderr)
        return 1

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("ERROR: playwright not installed. This is dev-extra QA tooling, "
              "not a runtime dependency: pip install playwright", file=sys.stderr)
        return 1

    url = "file://" + os.path.abspath(args.file)
    os.makedirs(args.out, exist_ok=True)
    failures = []
    shots = 0

    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=args.chrome, headless=True)
        try:
            probe = browser.new_page()
            probe.goto(url)
            probe.wait_for_timeout(300)
            # A page with no <nav id="navdrawer"> (e.g. a stripped-down dev
            # build) has no data-view sections — screenshotting it with a
            # hash that matches nothing would just produce identical images.
            # Detect this once up front instead of failing the per-view
            # sanity check 90 times.
            has_nav = probe.evaluate("!!document.getElementById('navdrawer')")
            views = discover_views(probe) if has_nav else [None]
            probe.close()

            for width in WIDTHS:
                page = browser.new_page(viewport={"width": width, "height": HEIGHT})
                page.goto(url)
                # The dashboard renders from an inline __DATA__ payload via a
                # synchronous script tag — no network round trip to wait on,
                # but give the chart library one tick to paint.
                page.wait_for_timeout(400)

                for theme in THEMES:
                    if theme == "light":
                        page.evaluate(
                            "document.documentElement.setAttribute('data-theme','light')")
                    else:
                        page.evaluate(
                            "document.documentElement.removeAttribute('data-theme')")

                    for view in views:
                        if view is not None:
                            page.evaluate(f"location.hash = '#{view}'")
                            page.wait_for_timeout(250)

                        # Sanity check: for a multi-view page the target section
                        # must actually be the unhidden one; for a single-view
                        # page just check there is real content. Either way this
                        # catches a build that silently produced an empty shell.
                        if view is not None:
                            ok = page.evaluate(f"""() => {{
                                const el = document.querySelector('[data-view="{view}"]');
                                const nav = document.getElementById('navdrawer');
                                return !!el && !el.hidden && !!nav
                                    && document.body.innerText.trim().length > 40;
                            }}""")
                        else:
                            ok = page.evaluate(
                                "document.body.innerText.trim().length > 40")
                        if not ok:
                            label = view or "(single view)"
                            failures.append(f"{label} @ {width}px/{theme}: "
                                             "view not unhidden or page looks empty")

                        vtag = f"_{view}" if view is not None else ""
                        fname = f"{os.path.splitext(os.path.basename(args.file))[0]}" \
                                f"{vtag}_{width}_{theme}.png"
                        page.screenshot(path=os.path.join(args.out, fname))
                        shots += 1
                page.close()
        finally:
            browser.close()

    print(f"{shots} screenshots written to {args.out}/")
    if failures:
        print(f"\n{len(failures)} view(s) failed the render sanity check:")
        for f in failures:
            print(f"  - {f}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
