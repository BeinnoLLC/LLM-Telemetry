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
    const fbar = d.getElementById('filterbar');
    chk(!!fbar, '#filterbar exists (one filter card, U-2)');
    const seg = d.getElementById('presets');
    chk(seg && seg.getAttribute('role') === 'radiogroup', 'the range presets are one radiogroup');
    chk(seg.querySelectorAll('[role=radio]').length === 8, 'seven presets plus Custom are radios', seg.querySelectorAll('[role=radio]').length);
    const cu = seg.querySelector('[data-key=custom]');
    chk(cu.getAttribute('aria-controls') === 'rangepop', 'Custom names the popover it opens (a11y)');
    chk(d.getElementById('rangepop').hidden, 'the date popover starts closed');
    cu.click();
    chk(!d.getElementById('rangepop').hidden && cu.getAttribute('aria-expanded') === 'true', 'clicking Custom opens the date popover');
    d.getElementById('rangeapply').click();
    chk(d.getElementById('rangepop').hidden && cu.getAttribute('aria-expanded') === 'false', 'Apply closes it');
    chk(!!d.getElementById('fbfilters') && !!d.getElementById('fbsheet'), 'phones get a Filters button and a bottom sheet');

    // Live rows carry a stable class so the mobile stacking rule can target them.
    const liverows = d.querySelectorAll('#livelist .liverow');
    chk(liverows.length > 0, '"Workers" rows carry a stable .liverow class', liverows.length);
    liverows.forEach(r => {
      chk(!!r.querySelector('.metacol'), 'every liverow still has its metacol');
      chk(!!r.querySelector('.loecol'), 'every liverow still has its loecol (gauge)');
    });

    // ---- CSS rule checks (source-level, since jsdom does not evaluate media
    // queries) — confirm the actual rules this ticket asked for exist. -------
    chk(/@media\(max-width:899px\)\{ \.statgrid\.live>\.stat,\.statgrid\.totals>\.stat\{grid-column:span 6\} \}/.test(html),
        'KPI cards go 2-up at <=899px');
    chk(/@media\(max-width:359px\)\{ \.statgrid\.live>\.stat,\.statgrid\.totals>\.stat\{grid-column:1\/-1\} \}/.test(html),
        'KPI cards stay 2-up on phones and go to 1 column only below 360px');
    chk(/\.lvscroll\{overflow:auto;[^}]*min-width:0/.test(html),
        'live table scrolls inside its own panel (overflow:auto, min-width:0) at every width');
    chk(!/#livelist \.liverow\{flex-direction:column/.test(html),
        'live rows no longer stack as cards at mobile width');
    chk(/\.olgrid\{grid-template-columns:1fr\}/.test(html),
        '.olgrid (Ollama host cards) forced to a single column at mobile width (was minmax(310px,1fr))');
    chk(/\.chip, button\{min-height:44px;min-width:44px/.test(html),
        'chips/buttons get a 44x44 minimum tap target at mobile width');
    chk(/\.filterbar \.seg-btn\{min-height:44px/.test(html) && /\.filterbar\.sheet-open \.fb-sheet\{display:flex\}/.test(html),
        'phones: 44px range segments and the filters bottom sheet');

    // ---- no regression on desktop: the mobile rules must live INSIDE the
    // max-width:640px block, not leak out unconditionally. -----------------
    const mobileBlockMatch = html.match(/@media\(max-width:640px\)\{([\s\S]*?)\n\s*\}\n @media\(max-width:400px\)/);
    chk(!!mobileBlockMatch, 'the mobile rules are scoped inside a single @media(max-width:640px) block');
    if (mobileBlockMatch) {
      const block = mobileBlockMatch[1];
      chk(block.includes('.olgrid{grid-template-columns:1fr}'), 'olgrid 1-col rule lives inside the mobile block');
    }
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 6).join('\n'));
  }
  console.log(`\ncheck_mobile_pass.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
