// #13: mobile pass (<=640px) — header, KPI strip, Live view, controls, tap
// targets. Loads the BUILT dashboard.html.
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
    // ---- markup/structure checks (viewport-independent) -------------------
    const rangebar = d.getElementById('rangebar');
    chk(!!rangebar, '#rangebar exists (collapsible range card, #13)');
    const rangetoggle = d.getElementById('rangetoggle');
    chk(!!rangetoggle, '#rangetoggle chip exists');
    chk(rangetoggle.getAttribute('aria-controls') === 'rangebar', 'rangetoggle names the region it controls (a11y)');

    // Clicking the toggle opens/closes the bar via a real class, not inline style.
    chk(!rangebar.classList.contains('rangeopen'), 'range card starts collapsed');
    rangetoggle.click();
    chk(rangebar.classList.contains('rangeopen'), 'clicking the toggle opens the range card');
    chk(rangetoggle.getAttribute('aria-expanded') === 'true', 'aria-expanded flips to true when open');
    rangetoggle.click();
    chk(!rangebar.classList.contains('rangeopen'), 'clicking again closes it');
    chk(rangetoggle.getAttribute('aria-expanded') === 'false', 'aria-expanded flips back to false');

    // The toggle's label reflects the actual selected range, not a static string.
    chk(/\d{4}-\d{2}-\d{2}/.test(rangetoggle.textContent), 'the collapsed chip shows the real active date range', rangetoggle.textContent);

    // Live rows carry a stable class so the mobile stacking rule can target them.
    const liverows = d.querySelectorAll('#livelist .liverow');
    chk(liverows.length > 0, '"In progress now" rows carry a stable .liverow class', liverows.length);
    liverows.forEach(r => {
      chk(!!r.querySelector('.metacol'), 'every liverow still has its metacol');
      chk(!!r.querySelector('.loecol'), 'every liverow still has its loecol (gauge)');
    });

    // ---- CSS rule checks (source-level, since jsdom does not evaluate media
    // queries) — confirm the actual rules this ticket asked for exist. -------
    chk(/@media\(max-width:640px\)\{[^}]*\.grid-kpi\{grid-template-columns:repeat\(2/.test(html) ||
        /grid-kpi\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/.test(html),
        'KPI strip goes to 2 columns at <=640px');
    chk(/@media\(max-width:400px\)\{[\s\S]{0,200}?\.grid-kpi\{grid-template-columns:1fr\}/.test(html),
        'KPI strip goes to 1 column below 400px');
    chk(/#livelist \.liverow\{flex-direction:column/.test(html),
        'Live rows stack meta under the title at mobile width');
    chk(/\.olgrid\{grid-template-columns:1fr\}/.test(html),
        '.olgrid (Ollama host cards) forced to a single column at mobile width (was minmax(310px,1fr))');
    chk(/\.chip, button\{min-height:44px;min-width:44px/.test(html),
        'chips/buttons get a 44x44 minimum tap target at mobile width');
    chk(/#rangebar\{flex-direction:column/.test(html),
        'the range card itself switches to a stacked column layout at mobile width');

    // ---- no regression on desktop: the mobile rules must live INSIDE the
    // max-width:640px block, not leak out unconditionally. -----------------
    const mobileBlockMatch = html.match(/@media\(max-width:640px\)\{([\s\S]*?)\n\s*\}\n @media\(max-width:400px\)/);
    chk(!!mobileBlockMatch, 'the mobile rules are scoped inside a single @media(max-width:640px) block');
    if (mobileBlockMatch) {
      const block = mobileBlockMatch[1];
      chk(block.includes('.grid-kpi{grid-template-columns:repeat(2'), 'KPI 2-col rule lives inside the mobile block');
      chk(block.includes('.olgrid{grid-template-columns:1fr}'), 'olgrid 1-col rule lives inside the mobile block');
    }
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 6).join('\n'));
  }
  console.log(`\ncheck_mobile_pass.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
