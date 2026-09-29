// #98/P10-10: Attention card — every alerts.RULES rule that tripped.
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
    },
  });
}

const dom = boot();
setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    chk(/id="alertscard"/.test(html), 'the Attention card markup exists');

    // work profile: 5-alert sample fixture (add_alerts_to_samples.py).
    w.eval("current = 'work'; view = 'Home'; render();");
    const card = d.getElementById('alertscard');
    chk(card && card.hidden === false, 'the card is shown for the profile with tripped alerts');
    chk(d.getElementById('alertscount').textContent.includes('5'), 'the count reflects all 5 tripped alerts');

    const rows = [...d.querySelectorAll('#alertslist > div')];
    chk(rows.length === 5, 'exactly 5 alert rows render', rows.length);

    const listText = d.getElementById('alertslist').textContent;
    chk(listText.includes('Delegation failure rate 31.2%'), 'the delegation alert shows its real message');
    chk(listText.includes('orphaned in the last 24h'), 'the orphan-reap alert shows its real message');

    // Severity ordering: the fixture already lists critical, critical,
    // warning, warning, info — renderAlerts must render them in THAT
    // order (the collector's own sort), never re-sort client-side.
    const icons = [...d.querySelectorAll('#alertslist > div > span:first-child')].map(s => s.title);
    chk(JSON.stringify(icons) === JSON.stringify(['critical', 'critical', 'warning', 'warning', 'info']),
        'alerts render in the collector\'s own severity order, unchanged', icons);

    // Jump-to-view button wires to the real pickView() with the real target_view.
    const buttons = [...d.querySelectorAll('#alertslist button')];
    chk(buttons.length === 5, 'every alert has a jump-to-view button', buttons.length);
    chk(buttons[0].getAttribute('onclick') === "pickView('Health')",
        'the first alert\'s button jumps to its real target_view (Health)');
    buttons[0].click();
    const visibleView = [...d.querySelectorAll('.view')].find(v => !v.hidden);
    chk(visibleView && visibleView.dataset.view === 'Health',
        'clicking the jump button actually calls the real pickView() and switches the visible view');

    // ---- the ticket's own negative control: personal profile has only 1 alert ----
    w.eval("current = 'personal'; render();");
    chk(d.getElementById('alertscount').textContent.includes('1'), 'the personal profile shows its own smaller alert count (1)');
    chk(d.querySelectorAll('#alertslist > div').length === 1, 'the personal profile renders exactly 1 alert row');

    // ---- negative control: an entirely empty alerts array hides the card ----
    w.eval(`
      DATA.profiles.personal.alerts = [];
      render();
    `);
    chk(d.getElementById('alertscard').hidden === true,
        'an entirely empty alerts list hides the card entirely (the ticket\'s own negative control)');

    console.log(`\ncheck_alerts.js  ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 10).join('\n'));
    console.log(`\ncheck_alerts.js  ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
}, 1500);
