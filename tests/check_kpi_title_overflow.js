// LST-252: KPI stat-card titles overflowed their card boundary. `.kpi-name`
// was `white-space:nowrap` with no `min-width:0`, so at 3-up grid widths (or
// narrow viewports) the uppercase title ("CACHE HIT RATE", "SUCCESS RATE")
// escaped the card edge. Cards are ~145-155px wide, narrower than the
// longest title beside the badge, so ellipsis would hide text; the fix lets
// the title wrap onto two lines inside the 36px header (min-width:0,
// overflow-wrap:anywhere) and keeps a `title=` attribute with the full label. Loads the BUILT dashboard.html.
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

// ---- CSS-level checks (against the inline stylesheet of the built page) --
// Pull the `.kpi-name{...}` declaration block out of the built CSS. The
// builder minifies but keeps multi-line rules, so match up to the closing
// brace of the first such block.
const m = html.match(/\.stat-label\{font:[^}]*\}/);
const kpiNameRule = m ? m[0] : '';

function boot() {
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://127.0.0.1:8477/dashboard.html',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
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

const cssSane = !!m;
const dom = boot();
setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    // UI pass U-1: titles are short fixed copy on ONE line (13px, nowrap) and are
    // clipped with an ellipsis at the card edge at worst, never spilling out.
    chk(cssSane, '.stat-label rule present in built dashboard CSS');
    for (const decl of ['white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis']) {
      chk(kpiNameRule.includes(decl), `.stat-label has ${decl} (title cannot escape the card)`, kpiNameRule || 'rule not found');
    }
    chk(/\.stat\{[^}]*min-width:0/.test(html), '.stat may shrink below its content width (min-width:0)');

    // The rendered strip: every title carries its full text as the hover
    // tooltip, so the full label is always available.
    const names = [...d.querySelectorAll('#kpis .stat-label')];
    chk(names.length >= 6, `KPI strip rendered titles (got ${names.length})`);
    let titled = 0, matches = 0;
    for (const el of names) {
      const t = (el.textContent || '').trim();
      if (el.getAttribute('title') === t) matches++;
      if (el.hasAttribute('title') && t) titled++;
    }
    chk(matches === names.length,
      'every .stat-label has title= equal to its full label',
      `${matches}/${names.length} match`);
    chk(titled === names.length,
      'every .stat-label title attribute is non-empty');
  } catch (e) {
    fail++; console.log('  FAIL unexpected error — ' + e.message);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 150);
