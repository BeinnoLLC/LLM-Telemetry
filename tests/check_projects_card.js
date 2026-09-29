// #41/P4-04: cost-by-project card — Unattributed is a first-class,
// never-dropped, never-hidden bucket; sums reconcile; excluding it updates
// the header; visually distinct without relying on color alone.
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

chk(/function renderProjects\(rows, fromDate, toDate\)\{/.test(html),
    'renderProjects exists with the standard render-card signature');
chk(/id="projempty" class="muted text-\[length:var\(--fs-xs\)\] mt-3" hidden>/.test(html),
    'the empty-state element starts hidden');
chk(/id="projexclude"/.test(html), 'the exclude-Unattributed toggle checkbox exists in markup');

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

    const card = d.getElementById('projcard');
    chk(card && !card.hidden, 'the project card is present and unhidden for a profile with real data');
    chk(d.getElementById('projempty').hidden === true, 'the empty-state message is hidden when there is real data');

    const chart = w.__created.filter(c => c.canvas && c.canvas.id === 'cProjects' && !c._destroyed).slice(-1)[0];
    const labels = chart.config.data.labels;
    chk(labels.includes('Unattributed'),
        `Unattributed is a visible bucket in the chart labels, got: ${JSON.stringify(labels)}`);

    // Acceptance: sum of all buckets including Unattributed equals the
    // ungrouped total — computed directly from DATA to avoid trusting the
    // same arithmetic the render function itself performed.
    const sumFromChart = chart.config.data.datasets[0].data.reduce((s, v) => s + v, 0);
    const ungroupedTotal = w.eval("DATA.profiles.work.rows.reduce((s,r)=>s+(r.act||r.est||0),0)");
    chk(Math.abs(sumFromChart - ungroupedTotal) < 0.01,
        `chart bucket sum (${sumFromChart.toFixed(4)}) equals the ungrouped row total (${ungroupedTotal.toFixed(4)})`);

    // Acceptance: Unattributed share is a displayed percentage.
    const hdr = d.getElementById('projhdr').textContent;
    chk(/%/.test(hdr) && /unattributed/i.test(hdr),
        `header shows an Unattributed percentage, got: ${hdr}`);

    // Visual distinction without relying on color alone: the Unattributed
    // bar's fill must not be one of the plain PAL colors used for real
    // projects — it uses either a canvas pattern (real browser) or the
    // dedicated fallback string (jsdom, no canvas backend) — either way it
    // must differ from every other bar's flat color.
    const bg = chart.config.data.backgroundColor || chart.config.data.datasets[0].backgroundColor;
    const unattrIdx = labels.indexOf('Unattributed');
    const otherIdxs = labels.map((_, i) => i).filter(i => i !== unattrIdx);
    const unattrFill = bg[unattrIdx];
    chk(otherIdxs.every(i => bg[i] !== unattrFill),
        `Unattributed's fill differs from every real project's fill, got fills: ${JSON.stringify(bg)}`);

    // Acceptance: excluding it updates the header text.
    w.eval("$('projexclude').checked = true; $('projexclude').dispatchEvent(new Event('change'));");
    const hdrExcluded = d.getElementById('projhdr').textContent;
    chk(/excluded/i.test(hdrExcluded),
        `excluding Unattributed updates the header to say so, got: ${hdrExcluded}`);
    chk(hdrExcluded !== hdr, 'the header text actually changes on toggle (not a stale re-render)');

    const chartExcluded = w.__created.filter(c => c.canvas && c.canvas.id === 'cProjects' && !c._destroyed).slice(-1)[0];
    chk(!chartExcluded.config.data.labels.includes('Unattributed'),
        'excluding the toggle actually removes the Unattributed bar from the chart (not just the header text)');

    // Un-exclude and confirm it comes back.
    w.eval("$('projexclude').checked = false; $('projexclude').dispatchEvent(new Event('change'));");
    const chartBack = w.__created.filter(c => c.canvas && c.canvas.id === 'cProjects' && !c._destroyed).slice(-1)[0];
    chk(chartBack.config.data.labels.includes('Unattributed'),
        'un-checking the toggle brings Unattributed back');

    // A tooltip callback explains WHY a session is unattributed.
    const tooltipCb = chartBack.config.options.plugins.tooltip.callbacks.afterLabel;
    const explanation = tooltipCb({ label: 'Unattributed' });
    chk(typeof explanation === 'string' && explanation.length > 10,
        `tooltip explains why a session is unattributed, got: ${explanation}`);
    chk(tooltipCb({ label: 'Nowinv' }) === '',
        'the explanation only appears for the Unattributed bucket, not real projects');
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 10).join('\n'));
  }
  console.log(`\ncheck_projects_card.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
