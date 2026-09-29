// #83/P9-06: concurrency band — hourly active-session count, peak label,
// subagent vs top-level split, empty-state handling.
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

chk(/function renderConcurrency\(concurrency, fromDate, toDate\)\{/.test(html),
    'renderConcurrency takes the range bounds explicitly, matching how render() filters everything else');
chk(/id="concempty" class="muted text-\[length:var\(--fs-xs\)\] mt-3" hidden>/.test(html),
    'the empty-state element starts hidden and exists separately from the chart canvas');

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
        this.canvas = ctx;
        created.push(this);
      }
      Stub.register = () => {}; Stub.overrides = {}; Stub.instances = {};
      Stub.getChart = (el) => created.filter(c => c.canvas === el && !c._destroyed).slice(-1)[0] || null;
      Stub.registerables = []; Stub.version = 'stub';
      Stub.controllers = {}; Stub.elements = {}; Stub.plugins = {}; Stub.scales = {};
      Stub.defaults = { font: { size: 10, family: '', weight: '' }, color: '' };
      w.Chart = Stub; w.getChart = () => null; w.__created = created;
      const origDestroy = () => {};
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

    const card = d.getElementById('conccard');
    chk(card && !card.hidden, 'the concurrency card is present and unhidden for a profile with real data');
    const empty = d.getElementById('concempty');
    chk(empty.hidden === true, 'the empty-state message is hidden when there is real data to chart');

    const peakText = d.getElementById('concpeak').textContent;
    // Sample data: 2026-09-25 10:00 has top:8 sub:20 = 28 total, the exact
    // number from the ticket's own finding ("max sessions started in a
    // single hour: 28").
    chk(peakText.includes('28'), `the peak total (28, matching the ticket's own finding) is labelled, got: ${peakText}`);
    chk(peakText.includes('2026-09-25 10:00'), `the peak hour timestamp is labelled, got: ${peakText}`);
    chk(peakText.includes('8 top-level'), `the top-level count at peak is labelled, got: ${peakText}`);
    chk(peakText.includes('20 subagent'), `the subagent count at peak is labelled, got: ${peakText}`);

    const chart = w.__created.filter(c => c.canvas && c.canvas.id === 'cConcurrency' && !c._destroyed).slice(-1)[0];
    const labels = chart.config.data.labels;
    chk(labels.some(l => l.includes('10:00')), `chart x-axis includes the peak hour label, got: ${JSON.stringify(labels)}`);
    const topDs = chart.config.data.datasets.find(ds => ds.label === 'top-level');
    const subDs = chart.config.data.datasets.find(ds => ds.label === 'subagent');
    chk(!!topDs && !!subDs, 'both a top-level and a subagent dataset exist (the split the ticket asks for)');
    const queueDs = chart.config.data.datasets.find(ds => ds.label === 'queue depth (now)');
    chk(!!queueDs && queueDs.type === 'line',
        'the local-inference queue depth overlays as its own line dataset, per the ticket');

    // Range filtering: narrowing to a date with zero concurrency rows must
    // render the EMPTY state, not a broken/zero-length axis.
    w.eval("$('from').value='2020-01-01'; $('to').value='2020-01-02'; render();");
    chk(d.getElementById('concempty').hidden === false,
        'an out-of-range window with zero concurrency data shows the empty state, not a broken chart');

    // Personal profile: sample data has subagent count 0 in its only hour —
    // this must not crash rendering a stacked bar with a zero series.
    w.eval("current = 'personal'; $('from').value=''; $('to').value=''; render();");
    chk(d.getElementById('concempty').hidden === true,
        'a profile with subagent count always 0 still renders (no crash on an all-zero series)');
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 10).join('\n'));
  }
  console.log(`\ncheck_concurrency_band.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
