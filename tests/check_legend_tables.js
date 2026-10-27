// G3 (Grafana restyle, steps 9-10): legend tables under the multi-series time
// charts, and the Home "Calls & tokens, last 6h" time-series panel. Loads the
// BUILT dashboard from examples/reports/dashboard.html.
//   (a) legend Max/Mean/Last equal the values computed from the chart's dataset arrays
//   (b) click / Enter / Space on a row hides the dataset and toggles it back
//   (c) the Home time-series panel exists with >= 1 dataset and its legend
//   (d) no NaN/undefined in legend cells for empty or partial series
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

const byId = {};
function boot() {
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://127.0.0.1:8477/dashboard.html',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => null;
      function Stub(el, cfg) {
        this.config = cfg; this.data = (cfg && cfg.data) || {}; this.destroy = () => {};
        this.options = (cfg && cfg.options) || {};
        this.scales = {}; this._metasets = []; this.chartArea = {left:0,top:0,right:0,bottom:0};
        this.width = 300; this.height = 150; this.aspectRatio = 2; this.attached = false;
        this.getDatasetMeta = () => ({ data: [], controller: null });
        this.hidden = new Set(); this.updates = 0;
        this.update = () => { this.updates++; };
        this.isDatasetVisible = i => !this.hidden.has(i);
        this.setDatasetVisibility = (i, on) => { if (on) this.hidden.delete(i); else this.hidden.add(i); };
        byId[el.id] = this;
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
  const key = (el, k) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const cells = tr => [...tr.children].map(c => c.textContent.trim());
  const build = (id, datasets, fmts) => {
    const host = d.createElement('div'), cv = d.createElement('canvas');
    cv.id = id; host.appendChild(cv); d.body.appendChild(host);
    w.eval(`mk(${JSON.stringify(id)}, 'line', ['a','b','c','d'], ${JSON.stringify(datasets)}, {lgt: ${fmts}})`);
    return { host, wrap: host.nextElementSibling, chart: byId[id] };
  };
  try {
    // (a) stats come from the dataset arrays
    const known = [{ label: 'calls', data: [2, 10, 4, 8], borderColor: '#5794f2' },
                   { label: 'tokens', data: [1000, 2500, 500, 0], borderColor: '#ff9830' }];
    const A = build('tA', known, '[v => String(v), v => (v/1000).toFixed(1) + "k"]');
    chk(!!A.wrap && A.wrap.classList.contains('lgt-wrap') && !!A.wrap.querySelector('table.lgt'), '(a) a legend table follows the chart');
    chk(JSON.stringify([...A.wrap.querySelectorAll('thead th')].map(t => t.textContent)) === '["","Name","Max","Mean","Last"]', '(a) columns are swatch, Name, Max, Mean, Last');
    const rows = [...A.wrap.querySelectorAll('tbody tr')].map(cells);
    chk(rows.length === 2, '(a) one row per dataset', rows.length);
    chk(rows[0][1] === 'calls' && rows[0][2] === '10' && rows[0][3] === '6' && rows[0][4] === '8',
        '(a) calls: max 10, mean 6, last 8 from [2,10,4,8]', JSON.stringify(rows[0]));
    chk(rows[1][1] === 'tokens' && rows[1][2] === '2.5k' && rows[1][3] === '1.0k' && rows[1][4] === '0.0k',
        '(a) tokens in its own unit: max 2.5k, mean 1.0k, last 0.0k', JSON.stringify(rows[1]));
    chk(A.wrap.querySelector('tbody tr i').style.background !== '', '(a) each row has a colour swatch');
    chk(A.chart.options.plugins.legend.display === false, '(a) the canvas legend is off when the table is shown');
    // (b) toggle by click, Enter and Space
    const tr = A.wrap.querySelector('tbody tr'), btn = tr.querySelector('button');
    btn.click();
    chk(A.chart.hidden.has(0) && A.chart.updates === 1 && btn.getAttribute('aria-pressed') === 'false' && tr.classList.contains('off'),
        '(b) click hides dataset 0, updates the chart, marks the row off');
    btn.click();
    chk(!A.chart.hidden.has(0) && btn.getAttribute('aria-pressed') === 'true', '(b) click again shows it');
    key(btn, 'Enter');
    chk(A.chart.hidden.has(0), '(b) Enter on the row button hides it');
    key(btn, 'Enter');
    chk(!A.chart.hidden.has(0), '(b) Enter again shows it');
    key(btn, ' ');
    chk(A.chart.hidden.has(0), '(b) Space hides it');
    key(btn, ' ');
    chk(!A.chart.hidden.has(0), '(b) Space again shows it');
    key(btn, 'a');
    chk(!A.chart.hidden.has(0), '(b) other keys do nothing');
    chk(btn.tagName === 'BUTTON' && btn.type === 'button', '(b) the row control is a real button (tab-focusable)');
    // (d) empty and partial series
    const D = build('tD', [{ label: 'empty', data: [], borderColor: '#fff' },
                           { label: 'gaps', data: [null, undefined, NaN], borderColor: '#fff' },
                           { label: 'partial', data: [null, 4, undefined, 2], borderColor: '#fff' },
                           { label: 'nolabel', data: [1], borderColor: '#fff' }], 'fmt');
    const dr = [...D.wrap.querySelectorAll('tbody tr')].map(cells);
    const text = D.wrap.textContent;
    chk(!/NaN|undefined|null|Infinity/.test(text), '(d) no NaN/undefined/null text anywhere in the table', text);
    chk(dr[0].slice(2).join() === '—,—,—' && dr[1].slice(2).join() === '—,—,—', '(d) empty and all-null series show em dashes', JSON.stringify(dr));
    chk(dr[2][2] === '4' && dr[2][3] === '3' && dr[2][4] === '2', '(d) partial series uses only its finite points: max 4 mean 3 last 2', JSON.stringify(dr[2]));
    // (c) the Home panel
    const panel = d.getElementById('homeseries');
    chk(!!panel && /last 6h/i.test(panel.textContent), '(c) the Home time-series panel exists, titled "last 6h"');
    chk(!!panel && !!panel.querySelector('canvas#cHome6h'), '(c) it holds the chart canvas');
    const H = byId.cHome6h;
    chk(!!H && H.data.datasets.length >= 1, '(c) the chart has at least one dataset', H && H.data.datasets.length);
    const lgrows = panel ? [...panel.querySelectorAll('.lgt tbody tr')] : [];
    chk(lgrows.length === (H ? H.data.datasets.length : -1) && lgrows.length >= 1, '(c) its legend has a row per dataset', lgrows.length);
    chk(panel && !/NaN|undefined/.test(panel.textContent), '(c)/(d) the panel has no NaN/undefined');
    // panel data: known hour rows land in the right hour buckets
    const now = new Date(); now.setMinutes(30, 0, 0);
    const pad = n => String(n).padStart(2, '0');
    const at = ago => { const t = new Date(now.getTime() - ago * 3600e3);
      return { date: `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`, hour: t.getHours() }; };
    const hs = JSON.parse(w.eval(`JSON.stringify(homeSeries(${JSON.stringify({ hour_rows: [
      { ...at(0), calls: 5, inp: 100, outp: 20 }, { ...at(0), calls: 1, inp: 10, outp: 0 },
      { ...at(2), calls: 7, inp: 1, outp: 2 }, { ...at(9), calls: 99, inp: 9, outp: 9 }] })}, ${now.getTime()}))`));
    chk(hs.labels.length === 6 && hs.calls[5] === 6 && hs.calls[3] === 7 && hs.calls.reduce((a, b) => a + b) === 13,
        '(c) homeSeries sums same-hour rows, places them, drops rows older than 6h', JSON.stringify(hs.calls));
    chk(hs.tokens[5] === 130 && hs.tokens[3] === 3, '(c) tokens = input + output per hour', JSON.stringify(hs.tokens));
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 6).join('\n'));
  }
  console.log(`\ncheck_legend_tables.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
