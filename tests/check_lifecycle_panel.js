// #81/P9-04: session-lifecycle panel in the Health view — compression
// pressure only. end_reason breakdown lives in the separate Outcomes card
// (#91, check_outcomes.js) since P10-03 moved it out of this panel.
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

chk(/id="lifecard" hidden>/.test(html),
    'the lifecycle card starts hidden (before any data decides otherwise)');
chk(/function renderLifecycle\(pressure\)\{/.test(html),
    'renderLifecycle takes the pressure payload directly — no hardcoded list to render from');

function boot() {
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://127.0.0.1:8477/dashboard.html',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => null;
      function Stub(ctx, cfg) {
        this.config = cfg; this.data = (cfg && cfg.data) || {}; this.destroy = () => {};
        this.update = () => {}; this.options = (cfg && cfg.options) || {};
        this.scales = {}; this._metasets = []; this.chartArea = {left:0,top:0,right:0,bottom:0};
        this.width = 300; this.height = 150; this.aspectRatio = 2; this.attached = false;
        this.getDatasetMeta = () => ({ data: [], controller: null });
      }
      Stub.register = () => {}; Stub.overrides = {}; Stub.instances = {};
      Stub.getChart = () => null; Stub.registerables = []; Stub.version = 'stub';
      Stub.controllers = {}; Stub.elements = {}; Stub.plugins = {}; Stub.scales = {};
      Stub.defaults = { font: { size: 10, family: '', weight: '' }, color: '' };
      w.Chart = Stub; w.getChart = () => null;
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
    // The real sample data (examples/reports/analytics-data.json) has
    // compression_pressure on the 'work' profile and none on 'personal'.
    w.eval("current = 'work'; renderHealth();");
    const cardWork = d.getElementById('lifecard');
    chk(cardWork && cardWork.hidden === false, 'the lifecycle card is shown for a profile with real compression-pressure data');

    // #91 moved the end_reason chips out of this card entirely.
    const reasonChips = [...d.querySelectorAll('#lifereasons span')];
    chk(reasonChips.length === 0, 'the lifecycle card no longer renders end_reason chips (moved to the Outcomes card)');

    const pressureText = d.getElementById('lifepressure').textContent;
    chk(pressureText.includes('Refactor the billing parser'), 'a compression-pressure session shows its title');
    chk(pressureText.includes('context window exceeded'), 'a compression_failure_error string renders verbatim');

    w.eval("current = 'personal'; renderHealth();");
    const cardPersonal = d.getElementById('lifecard');
    chk(cardPersonal && cardPersonal.hidden === true,
        'the lifecycle card is hidden entirely for a profile with no compression pressure');

    // Targeted check of the hide LOGIC itself: force a real pressure
    // session, then force pressure to zero, and confirm the card only
    // hides on the second state.
    w.eval(`
      current = 'personal';
      DATA.profiles.personal.compression_pressure = [{id:'x', title:'t', fallback_streak:1, ineffective_count:0, error:''}];
      renderHealth();
    `);
    chk(d.getElementById('lifecard').hidden === false,
        'the card is shown as soon as a real compression-pressure session exists');
    w.eval(`
      DATA.profiles.personal.compression_pressure = [];
      renderHealth();
    `);
    chk(d.getElementById('lifecard').hidden === true,
        "once pressure is empty again, the card hides (the actual hide condition, not just today's sample data)");
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 8).join('\n'));
  }
  console.log(`\ncheck_lifecycle_panel.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
