// #45/P4-08: cost/calls/tokens/sessions weighting toggle — four modes
// (Cost default), drives matrix + provider bars in one pass, units
// labelled everywhere, persists across reload, Sessions mode renders
// honestly despite a dominant Unattributed bucket.
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

chk(/id="projweight" role="radiogroup"/.test(html), 'the weighting control exists as a radiogroup');
chk(/data-w="cost"[^>]*class="chip on"/.test(html), 'Cost is the default-selected mode in the markup');
chk(/data-w="calls"/.test(html) && /data-w="tokens"/.test(html) && /data-w="sessions"/.test(html),
    'all four modes (cost/calls/tokens/sessions) exist as options');

function boot() {
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://127.0.0.1:8477/dashboard.html',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => null;
      const created = [];
      function Stub(ctx, cfg) {
        this.config = cfg; this.data = (cfg && cfg.data) || {}; this.destroy = () => { this._destroyed = true; };
        this.update = () => {}; this.options = (cfg && cfg.options) || {};
        this.scales = {}; this._metasets = []; this.chartArea = {left:0,top:0,right:0,bottom:0};
        this.width = 300; this.height = 150; this.aspectRatio = 2; this.attached = false;
        this.getDatasetMeta = () => ({ data: [], controller: null });
        this._visibility = (cfg.data.datasets || []).map(() => true);
        this.isDatasetVisible = (i) => this._visibility[i];
        this.setDatasetVisibility = (i, v) => { this._visibility[i] = v; };
        this.canvas = ctx;
        created.push(this);
      }
      Stub.register = () => {}; Stub.overrides = {}; Stub.instances = {};
      Stub.getChart = (el) => created.filter(c => c.canvas === el && !c._destroyed).slice(-1)[0] || null;
      Stub.registerables = []; Stub.version = 'stub';
      Stub.controllers = {}; Stub.elements = {}; Stub.plugins = {}; Stub.scales = {};
      Stub.defaults = { font: { size: 10, family: '', weight: '' }, color: '' };
      w.Chart = Stub; w.getChart = () => null; w.__created = created;
      const backing = new Map();
      Object.defineProperty(w, 'localStorage', {
        value: { getItem: k => backing.get(k) ?? null, setItem: (k, v) => backing.set(k, String(v)),
                 removeItem: k => backing.delete(k), clear: () => backing.clear(),
                 key: i => [...backing.keys()][i] ?? null, get length(){ return backing.size; } },
        configurable: true, writable: true });
      w.__backing = backing;
    },
  });
}

const dom = boot();
setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    w.eval("current = 'work'; $('from').value=''; $('to').value=''; render();");

    chk(w.eval("PROJ_WEIGHT") === 'cost', 'PROJ_WEIGHT defaults to cost when nothing is persisted');

    // Matrix + provider chart both change in one pass when the mode changes.
    const matrixCostText = d.getElementById('projmatrix').textContent;
    const distChartCost = w.__created.filter(c => c.canvas && c.canvas.id === 'cProjDist' && !c._destroyed).slice(-1)[0];
    const distCostData = JSON.stringify(distChartCost.config.data.datasets.map(ds => ds.data));

    d.querySelector('#projweight button[data-w="calls"]').click();

    const matrixCallsText = d.getElementById('projmatrix').textContent;
    chk(matrixCallsText !== matrixCostText, 'switching to Calls mode changes the matrix\'s rendered numbers');

    const distChartCalls = w.__created.filter(c => c.canvas && c.canvas.id === 'cProjDist' && !c._destroyed).slice(-1)[0];
    const distCallsData = JSON.stringify(distChartCalls.config.data.datasets.map(ds => ds.data));
    chk(distCallsData !== distCostData, 'switching to Calls mode ALSO changes the provider bars in the same pass (one control, not two)');

    // Matrix total in Calls mode matches a direct calls-sum from the payload.
    const payloadCallsTotal = w.eval("DATA.profiles.work.rows.reduce((s,r)=>s+(+r.calls||0),0)");
    chk(matrixCallsText.includes(String(payloadCallsTotal)) || matrixCallsText.includes(payloadCallsTotal.toLocaleString()),
        `matrix grand total in Calls mode matches the payload's raw call-count sum (${payloadCallsTotal})`);

    // Axis/unit labelling.
    chk(matrixCallsText.includes('Calls'), 'the matrix header labels the current unit (Calls)');
    chk(!!distChartCalls.config.options.scales.x.title && distChartCalls.config.options.scales.x.title.display,
        'the provider chart\'s x-axis carries a visible title/unit label');
    chk(distChartCalls.config.options.scales.x.title.text.toLowerCase().includes('calls'),
        `the axis title text names the current unit, got: ${distChartCalls.config.options.scales.x.title.text}`);

    // Sessions mode renders sensibly (not hidden/blank) despite a dominant
    // Unattributed bucket.
    d.querySelector('#projweight button[data-w="sessions"]').click();
    const matrixSessionsText = d.getElementById('projmatrix').textContent;
    chk(matrixSessionsText.length > 50, 'Sessions mode still renders a real, non-empty matrix');
    chk(matrixSessionsText.includes('Unattributed'), 'Sessions mode still shows Unattributed as a bucket, not hidden');
    chk(!d.getElementById('projmatrixempty') || d.getElementById('projmatrixempty').hidden === true,
        'the matrix empty-state is NOT shown in Sessions mode (there IS data, just dominated by one bucket)');

    // aria-pressed reflects the active mode.
    const sessionsBtn = d.querySelector('#projweight button[data-w="sessions"]');
    const costBtn = d.querySelector('#projweight button[data-w="cost"]');
    chk(sessionsBtn.getAttribute('aria-pressed') === 'true', 'the active mode button has aria-pressed=true');
    chk(costBtn.getAttribute('aria-pressed') === 'false', 'the inactive mode buttons have aria-pressed=false');

    // Persistence: the choice is written to localStorage immediately.
    chk(w.__backing.get('hermes-dash-projweight') === 'sessions',
        'the chosen weighting is persisted to localStorage immediately on click');

    // Choice survives reload: boot a FRESH dom sharing the same backing
    // store and confirm it picks up 'sessions' without any click.
    const dom2 = new JSDOM(html, {
      runScripts: 'dangerously', url: 'http://127.0.0.1:8477/dashboard.html', pretendToBeVisual: true,
      beforeParse(w2) {
        w2.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
        w2.HTMLCanvasElement.prototype.getContext = () => null;
        function Stub2(ctx, cfg) { this.config = cfg; this.destroy = () => {}; this.update = () => {}; this.canvas = ctx;
          this._visibility = (cfg.data.datasets || []).map(() => true);
          this.isDatasetVisible = (i) => this._visibility[i]; this.setDatasetVisibility = (i,v) => { this._visibility[i]=v; }; }
        Stub2.register = () => {}; Stub2.overrides = {}; Stub2.instances = {}; Stub2.getChart = () => null;
        Stub2.registerables = []; Stub2.version = 'stub'; Stub2.controllers = {}; Stub2.elements = {}; Stub2.plugins = {}; Stub2.scales = {};
        Stub2.defaults = { font: { size: 10, family: '', weight: '' }, color: '' };
        w2.Chart = Stub2;
        Object.defineProperty(w2, 'localStorage', {
          value: { getItem: k => w.__backing.get(k) ?? null, setItem: (k, v) => w.__backing.set(k, String(v)),
                   removeItem: k => w.__backing.delete(k), clear: () => w.__backing.clear(),
                   key: i => [...w.__backing.keys()][i] ?? null, get length(){ return w.__backing.size; } },
          configurable: true, writable: true });
      },
    });
    setTimeout(() => {
      const w2 = dom2.window, d2 = w2.document;
      chk(w2.eval("PROJ_WEIGHT") === 'sessions',
          'a fresh page load picks up the persisted weighting from localStorage without any interaction');
      const sessionsBtn2 = d2.querySelector('#projweight button[data-w="sessions"]');
      chk(sessionsBtn2.classList.contains('on'), 'the persisted choice is reflected in the UI on load (correct button marked on)');

      console.log(`\ncheck_project_weight.js  ${pass} passed, ${fail} failed`);
      process.exit(fail ? 1 : 0);
    }, 1500);
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 10).join('\n'));
    console.log(`\ncheck_project_weight.js  ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
}, 1500);
