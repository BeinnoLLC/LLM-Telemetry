#!/usr/bin/env python3
"""Browser-only check: a 200-char project option must not push the page wide.

Usage: python3 shots/projfilter_overflow.py [dashboard.html] [--shots DIR]
Needs playwright (dev-only) and a system Chrome/Chromium.
Exits non-zero if the select overflows its container or the page scrolls sideways.
"""
import os, sys
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
shots = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else None
args = [a for a in sys.argv[1:] if not a.startswith("--") and a != shots]
page_path = args[0] if args else os.path.join(root, "examples/reports/dashboard.html")
exe = next((p for p in ("/usr/bin/google-chrome", "/snap/bin/chromium") if os.path.exists(p)), None)
LONG = "workspace/" + "very-long-project-name-" * 8 + "end"
LONG = LONG[:200]
bad = 0
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=exe, args=["--no-sandbox"])
    for w in (800, 600, 360):
        pg = b.new_page(viewport={"width": w, "height": 900})
        pg.goto("file://" + os.path.abspath(page_path))
        pg.wait_for_selector('#projfiltersel', state='attached')
        pg.wait_for_timeout(1500)
        pg.evaluate("t=>{document.documentElement.dataset.theme='dark';"
                    "const s=document.getElementById('projfiltersel');"
                    "const o=document.createElement('option');o.value=t;o.textContent=t;"
                    "s.appendChild(o);s.value=t}", LONG)
        pg.wait_for_timeout(300)
        m = pg.evaluate("""()=>{const s=document.getElementById('projfiltersel'),
          c=document.getElementById('projfilterbar'), r=s.getBoundingClientRect(),
          cr=c.getBoundingClientRect(), e=document.documentElement;
          return {selRight:r.right, contRight:cr.right, sw:e.scrollWidth, cw:e.clientWidth}}""")
        ok = m["selRight"] <= m["contRight"] + 0.5 and m["sw"] <= m["cw"]
        bad += not ok
        print(f"{w}px select.right={m['selRight']:.1f} container.right={m['contRight']:.1f} "
              f"scrollWidth={m['sw']} clientWidth={m['cw']} hs={m['sw']-m['cw']} {'ok' if ok else 'FAIL'}")
        if shots:
            os.makedirs(shots, exist_ok=True)
            pg.screenshot(path=os.path.join(shots, f"projfilter-{w}-dark.png"))
        pg.close()
    b.close()
sys.exit(1 if bad else 0)
