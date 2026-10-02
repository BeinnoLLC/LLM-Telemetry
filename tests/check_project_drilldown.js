// #44/P4-07: project drill-down panel — opens from a matrix cell AND a
// project row label, closes on Escape/scrim-click with focus return,
// numbers reconcile with the payload, est/actual are never conflated.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'examples', 'reports', 'dashboard.html'), 'utf8');

// pdOpen/pdClose moved from an inlined <script> into the ES module split
// (P2-02, #27), so they are no longer present as text in the built page.
// Grep the module source for the two SOURCE assertions below; everything else
// here drives the real DOM and keeps reading the built page. Matching on the
// parameter LIST is also brittle — the refactor renamed the unused third
// parameter to `_highlightModel` — so assert the function exists and takes the
// rows it needs, not an exact spelling.
const viewsJs = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'js', 'views.js'), 'utf8');

let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
}

chk(/export function pdOpen\(project, rows\b/.test(viewsJs), 'pdOpen exists');
chk(/export function pdClose\(\)/.test(viewsJs), 'pdClose exists');
chk(/id="pdrawer" role="dialog" aria-modal="true"/.test(html), 'the panel is a proper aria-modal dialog');
chk(/@media\(max-width:640px\)\{\s*\n\s*#pdrawer\{top:auto;left:0;right:0;bottom:0;width:100vw/.test(html),
    'a 640px breakpoint turns the panel into a full-width bottom sheet');

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

    // Opens from a matrix cell.
    const cell = d.querySelector('td.proj-cell');
    cell.focus();
    cell.click();
    let drawer = d.getElementById('pdrawer');
    chk(drawer.classList.contains('open'), 'the panel opens (class="open") when a matrix cell is clicked');
    chk(drawer.getAttribute('aria-hidden') === 'false', 'aria-hidden flips to false when open');
    const projectFromCell = cell.dataset.project;
    chk(d.getElementById('pdtitle').textContent === projectFromCell,
        `the panel title matches the project that owned the clicked cell (${projectFromCell})`);

    // Numbers reconcile with the payload for that project.
    const payloadCheck = w.eval(`(() => {
      const rows = DATA.profiles.work.rows;
      const proj = ${JSON.stringify(projectFromCell)};
      const projRows = rows.filter(r => (r.project || 'Unattributed') === proj);
      const act = projRows.reduce((s,r)=>s+(r.act||0),0);
      const est = projRows.reduce((s,r)=>s+(r.est||0),0);
      const calls = projRows.reduce((s,r)=>s+(r.calls||0),0);
      return {act, est, calls};
    })()`);
    const bodyText = d.getElementById('pdbody').textContent;
    chk(bodyText.includes('$' + payloadCheck.act.toFixed(2)),
        `panel shows the exact actual cost total from the payload ($${payloadCheck.act.toFixed(2)})`);
    chk(bodyText.includes('$' + payloadCheck.est.toFixed(2)),
        `panel shows the exact estimated cost total from the payload ($${payloadCheck.est.toFixed(2)})`);
    chk(bodyText.includes(payloadCheck.calls.toLocaleString()),
        `panel shows the exact call count total from the payload (${payloadCheck.calls})`);

    // Estimated vs actual are labelled distinctly, not conflated.
    const actualEl = d.querySelector('.pdcost-actual');
    const estEl = d.querySelector('.pdcost-est');
    chk(!!actualEl && !!estEl, 'both an actual-cost element and an estimated-cost element exist separately');
    chk(actualEl.className !== estEl.className, 'the actual and estimated cost elements use DIFFERENT CSS classes');
    chk(estEl.textContent.includes('est.'), 'the estimated figure is explicitly suffixed "(est.)" — never a bare number');

    // Closes on Escape, focus returns to the trigger.
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    drawer = d.getElementById('pdrawer');
    chk(!drawer.classList.contains('open'), 'Escape closes the panel');
    chk(d.activeElement === cell, 'focus returns to the exact cell that opened the panel after Escape');

    // Opens from a project row label too.
    const labelCell = d.querySelector('#projmatrix tbody tr td:first-child');
    labelCell.focus();
    labelCell.click();
    drawer = d.getElementById('pdrawer');
    chk(drawer.classList.contains('open'), 'the panel also opens when a project row label is clicked');
    chk(d.getElementById('pdtitle').textContent === labelCell.textContent,
        'the panel title matches the project whose row label was clicked');

    // Closes on scrim click, focus returns.
    d.getElementById('pdscrim').click();
    drawer = d.getElementById('pdrawer');
    chk(!drawer.classList.contains('open'), 'clicking the scrim closes the panel');
    chk(d.activeElement === labelCell, 'focus returns to the row label after a scrim-click close');

    // Row labels are keyboard-operable (role=button, tabindex, Enter/Space).
    chk(labelCell.getAttribute('role') === 'button', 'a project row label carries role="button" for a11y');
    chk(labelCell.tabIndex === 0, 'a project row label is in the tab order (tabIndex 0)');
    labelCell.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    drawer = d.getElementById('pdrawer');
    chk(drawer.classList.contains('open'), 'pressing Enter on a project row label opens the panel (not mouse-only)');
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 10).join('\n'));
  }
  console.log(`\ncheck_project_drilldown.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
