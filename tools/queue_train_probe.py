"""#140 visual probe for the task-queue railway strip.

Renders the built dashboard headless (its own Chromium profile), drives the
queue through busy and fleet-clear states, and asserts what jsdom cannot:
the running cars really move, stay evenly coupled, and the strip fits its
card. Writes screenshots next to OUT for a human look.

  .venv/bin/python tools/queue_train_probe.py examples/reports/dashboard.html [OUT]
"""
import os
import sys

from playwright.sync_api import sync_playwright

BUSY = """() => {
  DATA.ollama = DATA.ollama || {hosts: []};
  if (!DATA.ollama.hosts.length) DATA.ollama.hosts = [{label: 'gpu-1', up: true, queue: 0}];
  DATA.ollama.hosts[0].queue = 5;
  const P = DATA.profiles[current] || (DATA.profiles[current] = {});
  P.live = [
    {id: 'a', model: 'qwen3-coder', title: 'Refactor auth', idle_s: 1, profile: 'default'},
    {id: 'b', model: 'claude-opus-5', title: 'Write tests', idle_s: 4, profile: 'work'},
    {id: 'c', model: 'gpt-5', title: 'Fix CI', idle_s: 9, profile: 'pixel'},
    {id: 'd', model: 'kimi', title: 'Docs pass', idle_s: 12, profile: 'default'}];
  P.recent_sessions = Array.from({length: 7}, (_, i) => ({id: 'r' + i, title: 'done ' + i, last_ts: 1e9 + i, dur_s: 300}));
  renderQueue();
}"""
CLEAR = "() => { DATA.ollama.hosts.forEach(h => h.queue = 0); DATA.profiles[current].live = []; renderQueue(); }"
XS = "() => [...document.querySelectorAll('#qt-running .qt-r:not(.qt-leaving)')].map(c => c.getBoundingClientRect().x)"


def main():
    src = os.path.abspath(sys.argv[1])
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.environ.get("TMPDIR", "/tmp"), "qtrain")
    fails = []

    def chk(cond, msg):
        print(("ok   " if cond else "FAIL ") + msg)
        if not cond:
            fails.append(msg)

    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1400, "height": 900}, device_scale_factor=2)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto("file://" + src + "#/live")
        pg.wait_for_timeout(1500)
        pg.evaluate(BUSY)
        pg.wait_for_timeout(900)
        card = pg.locator("#qtrain").locator("xpath=..")
        card.screenshot(path=out + "-busy.png")
        a = pg.evaluate(XS)
        pg.wait_for_timeout(700)
        b2 = pg.evaluate(XS)
        chk(len(a) == 4, f"4 running cars on the line ({len(a)})")
        moved = [round(y - x) for x, y in zip(a, b2)]
        chk(all(m > 10 for m in moved) or any(m < -100 for m in moved),
            f"cars move along the line (dx {moved})")
        gaps = [round(a[i] - a[i + 1]) for i in range(len(a) - 1)]
        chk(len(set(gaps)) == 1 and gaps[0] > 18, f"train is evenly coupled (gaps {gaps})")
        sw, cw = pg.evaluate("() => { const t = document.getElementById('qtrain'); return [t.scrollWidth, t.clientWidth]; }")
        chk(sw <= cw + 1, f"strip fits its card ({sw} <= {cw})")
        pg.evaluate(CLEAR)
        pg.wait_for_timeout(1500)
        card.screenshot(path=out + "-clear.png")
        chk("clear" in pg.evaluate("() => document.getElementById('qtrain').className"), "fleet clear state")
        chk(pg.locator("#qt-running .qt-patrol").count() == 1, "one patrol car on an empty line")
        pg.emulate_media(reduced_motion="reduce")
        pg.evaluate(BUSY)
        pg.wait_for_timeout(300)
        r1 = pg.evaluate(XS)
        pg.wait_for_timeout(500)
        chk(r1 == pg.evaluate(XS), "reduced motion: cars hold still")
        chk(not errs, f"no page errors {errs[:2]}")
        b.close()
    print(f"\nqueue_train_probe: {'FAILED ' + str(len(fails)) if fails else 'all green'} — screenshots {out}-*.png")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
