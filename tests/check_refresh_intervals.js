// #112: Refresh intervals settings card — apply immediately + persist.
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

function boot(fetchImpl) {
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://127.0.0.1:8477/dashboard.html',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => null;
      function Stub(ctx, cfg) { this.config = cfg; this.destroy = () => {}; this.update = () => {}; this.canvas = ctx; }
      Stub.register = () => {}; Stub.overrides = {}; Stub.instances = {}; Stub.getChart = () => null;
      Stub.registerables = []; Stub.version = 'stub'; Stub.controllers = {}; Stub.elements = {}; Stub.plugins = {}; Stub.scales = {};
      Stub.defaults = { font: { size: 10, family: '', weight: '' }, color: '' };
      w.Chart = Stub;
      const backing = new Map();
      Object.defineProperty(w, 'localStorage', {
        value: { getItem: k => backing.get(k) ?? null, setItem: (k, v) => backing.set(k, String(v)),
                 removeItem: k => backing.delete(k), clear: () => backing.clear(),
                 key: i => [...backing.keys()][i] ?? null, get length(){ return backing.size; } },
        configurable: true, writable: true });
      if (fetchImpl) w.fetch = fetchImpl;
    },
  });
}

const dom = boot();
setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    chk(/id="setintervalscard"/.test(html), 'the Refresh intervals card markup exists');

    // ---- defaults seed from POWER.intervals (the sample build's config) ----
    chk(w.eval("LIVE_MS") === 5000, 'LIVE_MS seeds from the sample config default (5s)', w.eval("LIVE_MS"));
    chk(w.eval("REBUILD_MS") === 60000, 'REBUILD_MS seeds from the sample config default (60s)', w.eval("REBUILD_MS"));

    // ---- editing + Save applies to THIS PAGE immediately, before any
    // network round trip resolves (the ticket's own named acceptance:
    // "dashboard respects it immediately") ----
    w.eval(`
      document.getElementById('set_live_poll').value = '10';
      document.getElementById('set_rebuild').value = '120';
    `);
    // Stub fetch so save() doesn't hit a real network call in this test.
    w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    w.eval("saveIntervals();");
    chk(w.eval("LIVE_MS") === 10000,
        'LIVE_MS is updated to the new value SYNCHRONOUSLY, before the save request resolves (the ticket\'s own acceptance criterion)',
        w.eval("LIVE_MS"));
    chk(w.eval("REBUILD_MS") === 120000, 'REBUILD_MS is updated the same way', w.eval("REBUILD_MS"));

    // ---- invalid values rejected with an error message (the ticket's own
    // named acceptance criterion), value NOT applied ----
    w.eval(`
      document.getElementById('set_live_poll').value = '999';
    `);
    w.eval("saveIntervals();");
    chk(w.eval("LIVE_MS") === 10000,
        'an out-of-range value (999s > the 60s max) is REJECTED -- LIVE_MS stays at its last valid value', w.eval("LIVE_MS"));
    chk(d.getElementById('setintervalsmsg').textContent.toLowerCase().includes('fix'),
        'an invalid value shows a real error message to the user', d.getElementById('setintervalsmsg').textContent);

    // ---- Defaults button re-fills the real defaults without applying ----
    w.eval(`
      document.getElementById('set_live_poll').value = '10';
      document.getElementById('setintervalsreset').click();
    `);
    chk(d.getElementById('set_live_poll').value == 5,
        'the Defaults button re-fills the REAL Config-dataclass default (5s), not a placeholder',
        d.getElementById('set_live_poll').value);
    chk(w.eval("LIVE_MS") === 10000,
        'clicking Defaults does NOT apply anything until Save is clicked again (fill-only, per its own label)');

    console.log(`\ncheck_refresh_intervals.js  ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 10).join('\n'));
    console.log(`\ncheck_refresh_intervals.js  ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
}, 1500);
