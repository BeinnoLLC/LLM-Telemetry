// #81/P9-04: session-lifecycle panel in the Health view.
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
chk(/const LIFE_ABNORMAL = new Set\(\['\(none\)', 'startup_orphan_reap', 'ws_orphan_reap'\]\)/.test(html),
    'abnormal end reasons are the ones the ticket named — orphan reaps and a missing reason on an ended session');
chk(/function renderLifecycle\(reasons, pressure\)\{/.test(html),
    'renderLifecycle takes the payload data directly — no hardcoded reason list to render from');

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
    // end_reasons/compression_pressure on the 'work' profile and a clean
    // (empty) set on 'personal'. Switch profile and re-render both to
    // exercise the "hidden when clean" path with REAL data, not a fixture.
    w.eval("current = 'work'; renderHealth();");
    const cardWork = d.getElementById('lifecard');
    chk(cardWork && cardWork.hidden === false, 'the lifecycle card is shown for a profile with real end_reasons/pressure data');

    const reasonChips = [...d.querySelectorAll('#lifereasons span')];
    chk(reasonChips.length >= 4, `at least the 4 sample end_reasons render as chips, got ${reasonChips.length}`);
    const abnormalChip = reasonChips.find(c => c.textContent.includes('startup_orphan_reap'));
    chk(!!abnormalChip && /#ef4444/.test(abnormalChip.getAttribute('style')),
        'startup_orphan_reap renders in the abnormal (red) style, not the neutral one');
    const normalChip = reasonChips.find(c => c.textContent.includes('agent_close'));
    chk(!!normalChip && !/#ef4444/.test(normalChip.getAttribute('style')),
        'agent_close renders in the neutral style, not flagged as abnormal');

    const pressureText = d.getElementById('lifepressure').textContent;
    chk(pressureText.includes('Refactor the billing parser'), 'a compression-pressure session shows its title');
    chk(pressureText.includes('context window exceeded'), 'a compression_failure_error string renders verbatim');

    w.eval("current = 'personal'; renderHealth();");
    const cardPersonal = d.getElementById('lifecard');
    chk(cardPersonal && cardPersonal.hidden === true,
        'the lifecycle card is hidden entirely for a profile where every session ended cleanly with no pressure');

    // Targeted check of the hide LOGIC itself (not just today's fixture data
    // happening to be clean): force an all-agent_close reason set with a
    // real pressure session, then force pressure to zero too, and confirm
    // the card only hides on the SECOND state.
    w.eval(`
      current = 'personal';
      DATA.profiles.personal.end_reasons = [{reason:'agent_close', n:9}];
      DATA.profiles.personal.compression_pressure = [{id:'x', title:'t', fallback_streak:1, ineffective_count:0, error:''}];
      renderHealth();
    `);
    chk(d.getElementById('lifecard').hidden === false,
        'a clean end_reason set alone does NOT hide the card if a real compression-pressure session exists');
    w.eval(`
      DATA.profiles.personal.compression_pressure = [];
      renderHealth();
    `);
    chk(d.getElementById('lifecard').hidden === true,
        "once pressure is also empty, an all-agent_close reason set hides the card (the actual hide condition, not just today's sample data)");
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 8).join('\n'));
  }
  console.log(`\ncheck_lifecycle_panel.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
