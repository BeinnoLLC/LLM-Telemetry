// #43/P4-06: project x provider distribution — stacked horizontal bar,
// shared provider palette/icons, normalise-to-100% toggle, keyboard-
// reachable legend.
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

chk(/function renderProjectDistribution\(rows\)\{/.test(html), 'renderProjectDistribution exists');
chk(/id="projdistnorm"/.test(html), 'the normalise-to-100% toggle exists in markup');
chk(/id="projdistlegend"/.test(html), 'a dedicated legend container exists');

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
    },
  });
}

const dom = boot();
setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    w.eval("current = 'work'; $('from').value=''; $('to').value=''; render();");

    const chart = w.__created.filter(c => c.canvas && c.canvas.id === 'cProjDist' && !c._destroyed).slice(-1)[0];
    chk(!!chart, 'the distribution chart renders for a profile with data');
    chk(d.getElementById('projdistempty').hidden === true, 'the empty state is hidden when there is data');

    // Segments sum to the project total (acceptance criterion, absolute mode).
    const projects = chart.config.data.labels;
    const payloadTotals = w.eval(`(() => {
      const rows = DATA.profiles.work.rows;
      const byProject = {};
      rows.forEach(r => {
        const proj = r.project || 'Unattributed';
        byProject[proj] = (byProject[proj] || 0) + (r.act || r.est || 0);
      });
      return byProject;
    })()`);
    let sumsOk = true;
    projects.forEach((proj, i) => {
      const segSum = chart.config.data.datasets.reduce((s, ds) => s + (ds.data[i] || 0), 0);
      if (Math.abs(segSum - payloadTotals[proj]) > 0.01) sumsOk = false;
    });
    chk(sumsOk, 'every project bar\'s segments sum to that project\'s total cost from the payload (absolute mode)');

    // Provider colours/icons identical to the shared PROV table (used by
    // Health/Live views) — not a second palette.
    const sharedProv = w.eval("PROV");
    let colorsMatch = true;
    chart.config.data.datasets.forEach(ds => {
      const provKey = ds.label.split(' ').slice(1).join(' ');
      if (sharedProv[provKey] && ds.backgroundColor !== sharedProv[provKey].fg) colorsMatch = false;
    });
    chk(colorsMatch, 'every dataset\'s color exactly matches PROV[provider].fg — the shared palette, not a second one');

    const iconsMatch = chart.config.data.datasets.every(ds => {
      const provKey = ds.label.split(' ').slice(1).join(' ');
      return !sharedProv[provKey] || ds.label.startsWith(sharedProv[provKey].icon);
    });
    chk(iconsMatch, 'every dataset label is prefixed with the exact icon glyph from the shared PROV table');

    // Normalise-to-100% toggle.
    w.eval("$('projdistnorm').checked = true; $('projdistnorm').dispatchEvent(new Event('change'));");
    const normChart = w.__created.filter(c => c.canvas && c.canvas.id === 'cProjDist' && !c._destroyed).slice(-1)[0];
    let allHundred = true;
    normChart.config.data.labels.forEach((proj, i) => {
      const segSum = normChart.config.data.datasets.reduce((s, ds) => s + (ds.data[i] || 0), 0);
      if (Math.abs(segSum - 100) > 0.5) allHundred = false;
    });
    chk(allHundred, 'in normalised mode, every bar\'s segments sum to 100 (within floating-point tolerance)');

    // Absolute mode is the default (unchecked at boot) — re-verify by
    // re-loading a fresh boot rather than trusting the toggle's own state,
    // since we just flipped it above.
    const dom2 = boot();
    setTimeout(() => {
      const w2 = dom2.window, d2 = w2.document;
      w2.eval("current = 'work'; $('from').value=''; $('to').value=''; render();");
      chk(d2.getElementById('projdistnorm').checked === false,
          'the normalise toggle defaults to UNCHECKED (absolute mode is the default, per the ticket)');

      // Legend: real focusable <button> elements, not canvas-only.
      const legendButtons = [...d2.querySelectorAll('#projdistlegend button')];
      chk(legendButtons.length > 0, 'the legend renders real <button> elements (keyboard-focusable by default)');
      chk(legendButtons.every(b => b.getAttribute('type') === 'button'),
          'every legend button has type="button" (so it never accidentally submits a form)');

      // Toggling a legend button hides that provider's segment.
      if (legendButtons.length) {
        const chart2 = w2.__created.filter(c => c.canvas && c.canvas.id === 'cProjDist' && !c._destroyed).slice(-1)[0];
        legendButtons[0].click();
        chk(chart2.isDatasetVisible(0) === false,
            'clicking a legend button toggles that dataset\'s visibility on the actual chart instance');
        chk(legendButtons[0].getAttribute('aria-pressed') === 'false',
            'the button\'s aria-pressed state reflects the toggle (a11y announcement)');
      }

      console.log(`\ncheck_project_distribution.js  ${pass} passed, ${fail} failed`);
      process.exit(fail ? 1 : 0);
    }, 1500);
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 10).join('\n'));
    console.log(`\ncheck_project_distribution.js  ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
}, 1500);
