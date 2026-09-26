// Off-canvas drawer (#4). jsdom does not apply media queries, so matchMedia is
// stubbed to report the width under test and the JS paths are driven directly.
// This checks behaviour (classes, aria, focus, close paths), not pixel layout.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(require('os').homedir(), '.local/share/llm-telemetry/reports');
const fs = require('fs'), { JSDOM } = require('jsdom');

const raw = fs.readFileSync(REPORTS + '/dashboard.html', 'utf8');
const html = raw.replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
const live = JSON.parse(fs.readFileSync(REPORTS + '/live-data.json', 'utf8'));
const analytics = JSON.parse(fs.readFileSync(REPORTS + '/analytics-data.json', 'utf8'));

// width drives the matchMedia stub, so the page takes the mobile code path.
function boot(width) {
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'http://127.0.0.1:8477/dashboard.html#/live',
    beforeParse(w) {
      w.Chart = function () { return { destroy() {}, update() {} }; };
      w.Chart.defaults = { color: '', borderColor: '', font: {} };
      w.matchMedia = (q) => {
        const m = /max-width:\s*(\d+)px/.exec(q);
        return {
          matches: m ? width <= +m[1] : false,
          addListener() {}, removeListener() {},
          addEventListener() {}, removeEventListener() {}
        };
      };
      w.fetch = (u) => Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve(String(u).includes('live-data') ? live : analytics)
      });
    }
  });
}

let p = 0, f = 0;
const chk = (ok, l, x) => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${l}${x ? '  ' + x : ''}`); ok ? p++ : f++; };

// ---- mobile: 375px ------------------------------------------------------
const m = boot(375);
setTimeout(() => {
  const w = m.window, d = w.document;
  const body = d.body, toggle = d.getElementById('navtoggle');
  const scrim = d.getElementById('navscrim'), rail = d.getElementById('navdrawer');

  chk(!!toggle, 'hamburger exists');
  chk(!!scrim, 'scrim exists');
  chk(scrim && scrim.parentElement === body, 'scrim is a direct body child');
  chk(toggle && toggle.getAttribute('aria-controls') === 'navdrawer',
    'hamburger points at the drawer');

  // Closed by default on mobile, and out of the a11y tree while hidden.
  chk(!body.classList.contains('navopen'), 'panel starts closed on mobile');
  chk(rail && rail.getAttribute('aria-hidden') === 'true',
    'hidden panel is out of the accessibility tree');
  chk(toggle && toggle.getAttribute('aria-expanded') === 'false',
    'hamburger reports collapsed');

  // Open it.
  toggle.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  chk(body.classList.contains('navopen'), 'hamburger opens the panel');
  chk(toggle.getAttribute('aria-expanded') === 'true', 'hamburger reports expanded');
  chk(!rail.hasAttribute('aria-hidden'), 'open panel is back in the a11y tree');
  chk(rail.contains(d.activeElement), 'focus moves into the open panel',
    `(${d.activeElement && d.activeElement.className})`);

  // Esc closes and returns focus.
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  chk(!body.classList.contains('navopen'), 'Esc closes the panel');
  chk(d.activeElement === toggle, 'focus returns to the hamburger');

  // Scrim closes.
  toggle.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  scrim.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  chk(!body.classList.contains('navopen'), 'scrim click closes the panel');

  // Choosing a section closes the sheet, or it would cover the result.
  toggle.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const item = d.querySelector('[data-nav="Cost"]');
  item.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  chk(!body.classList.contains('navopen'), 'activating a section closes the panel');
  const vis = [...d.querySelectorAll('.view')].filter(v => !v.hidden).map(v => v.dataset.view);
  chk(vis.includes('Cost'), 'and the section actually changed', `(${vis.join(',')})`);

  // No scroll lock left behind: the ticket calls this out explicitly.
  chk(!body.classList.contains('navopen'), 'no scroll-lock class left after closing');

  // ---- desktop: 1440px --------------------------------------------------
  const dk = boot(1440);
  setTimeout(() => {
    const dw = dk.window, dd = dw.document;
    const drail = dd.getElementById('navdrawer');
    chk(!dd.body.classList.contains('navopen'), 'desktop never sets the open class');
    chk(!drail.hasAttribute('aria-hidden'),
      'desktop rail stays in the accessibility tree');

    console.log(`\n${f === 0 ? 'ALL PASS' : 'FAILED'}  (${p} passed, ${f} failed)`);
    process.exit(f === 0 ? 0 : 1);
  }, 1400);
}, 1500);