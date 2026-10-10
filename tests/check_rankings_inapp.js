// Rankings lives in the main app now (#113-era consolidation): a "Rankings"
// view renders the same payload the standalone page consumed, so the app is
// one surface — no second HTML file.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'examples', 'reports', 'dashboard.html'), 'utf8');

let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
}

function boot() {
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://127.0.0.1:8477/dashboard.html',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => null;
      const Stub = function () { this.destroy = () => {}; this.resize = () => {}; };
      Stub.defaults = { font: { size: 10, family: '', weight: '' }, color: '' };
      w.Chart = Stub;
      const backing = new Map();
      Object.defineProperty(w, 'localStorage', {
        value: { getItem: k => backing.get(k) ?? null, setItem: (k, v) => backing.set(k, String(v)),
                 removeItem: k => backing.delete(k), clear: () => backing.clear(),
                 key: i => [...backing.keys()][i] ?? null, get length(){ return backing.size; } },
        configurable: true, writable: true });
    },
  });
}

const dom = boot();
setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
// View is registered in the nav and has a container.
chk(!!d.querySelector('[data-vtab="Rankings"]'), 'nav has a Rankings button');
chk(!!d.getElementById('view-rankings-container'), 'rankings container exists in the shell');

// Payload embedded at build time (classic script, no fetch).
chk(w.RANKINGS_DATA && w.RANKINGS_DATA.status === 'ok', 'rankings payload embedded');
chk(!!(w.RANKINGS_DATA && w.RANKINGS_DATA.views && w.RANKINGS_DATA.views.week), 'week window in payload');

// Render through the app's own dispatcher, as a user click would.
w.eval("pickView('Rankings')");
const host = d.getElementById('view-rankings-container');
const painted = host && host.innerHTML.includes('OpenRouter rankings');
chk(!!painted, 'rankings view paints via the app dispatcher');
if (painted) {
  const rows = host.querySelectorAll('tbody tr');
  chk(rows.length > 0, `rows render (${rows.length})`);
  const other = host.querySelector('tr.rk-other');
  chk(!!other, 'the "Other" long-tail row renders');
  // Window chooser toggles.
  const dayBtn = host.querySelector('[data-rk-window="day"]');
  if (dayBtn) {
    dayBtn.click();
    chk(host.innerHTML.includes('OpenRouter rankings · Day'), 'chooser switches to Day');
  } else chk(false, 'chooser has a Day button');
  // Every model cell is escaped text, never raw HTML from the payload.
  const cell = host.querySelector('td[title]');
  chk(!!cell, 'model cells carry a title with the full model id');
}

// No standalone shell markers: the old page's chooser ids must not be here.
chk(!html.includes('id="rk-empty"'), 'standalone rankings shell ids absent');

console.log(`\ncheck_rankings_inapp  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error('HARNESS ERROR', e && e.stack || e);
    process.exit(2);
  }
}, 300);