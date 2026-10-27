// G2 (Grafana restyle, step 11): the shared arc gauge behind the .loe dial and
// the Home KPI rings. Loads the BUILT dashboard from examples/reports/dashboard.html.
//   (a) track arc + value arc, value-arc length proportional to the value
//   (b) value-arc colour follows the thresholds
//   (c) no needle elements
//   (d) the centred number text equals the formatted value
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

const dom = boot();
setTimeout(() => {
  const w = dom.window, d = w.document;
  const LEN = 40 * 1.5 * Math.PI;              // R=40, 270° of arc
  const mount = h => { const el = d.createElement('div'); el.innerHTML = h; return el; };
  const frac = el => { const v = el.querySelector('.gval');
    return v ? 1 - parseFloat(v.getAttribute('stroke-dashoffset')) / parseFloat(v.getAttribute('stroke-dasharray').split(' ')[0]) : 0; };
  try {
    const ring = (p, o) => mount(w.eval(`radialRing(${p}, ${JSON.stringify(o || {label:'Success rate', warnAt:90, badAt:70})})`));
    // (a) track + value arc, proportional length
    for (const p of [97, 50, 8]) {
      const el = ring(p), svg = el.querySelector('svg');
      chk(!!svg && !!el.querySelector('.gtrack') && !!el.querySelector('.gval'), `(a) ${p}%: svg with a track arc and a value arc`);
      const v = el.querySelector('.gval');
      chk(Math.abs(parseFloat(v.getAttribute('stroke-dasharray').split(' ')[0]) - LEN) < 0.1, `(a) ${p}%: the arc's full length is 270° of R=40`, v.getAttribute('stroke-dasharray'));
      chk(Math.abs(frac(el) - p / 100) < 0.01, `(a) ${p}%: dash fraction is ${p / 100} within 1%`, frac(el).toFixed(3));
    }
    const loe = mount(w.eval(`loeIcon({id:'a1', tools:['delegate_task','terminal','read_file']}, {id:'a1', label:'x'})`));
    chk(!!loe.querySelector('.gtrack') && !!loe.querySelector('.gval'), '(a) .loe dial: track arc and value arc present');
    // (b) thresholds
    const col = el => el.querySelector('.gval').getAttribute('stroke');
    chk(col(ring(97)) === 'var(--z-ok)', '(b) ring 97% (>= warnAt 90) is green', col(ring(97)));
    chk(col(ring(75)) === 'var(--z-warn)', '(b) ring 75% (>= badAt 70) is amber', col(ring(75)));
    chk(col(ring(20)) === 'var(--z-bad)', '(b) ring 20% (< badAt 70) is red', col(ring(20)));
    const dial = tools => mount(w.eval(`loeIcon({tools:${JSON.stringify(tools)}}, {id:'t${tools.length}', label:'x'})`));
    chk(col(dial(['read_file','a','b'])) === 'var(--z-ok)', '(b) .loe light load (<40%) is green');
    chk(col(dial(['terminal','a','b'])) === 'var(--z-warn)', '(b) .loe medium load (>=40%) is amber');
    chk(col(dial(['terminal','execute_code','delegate_task'])) === 'var(--z-bad)', '(b) .loe heavy load (>=70%) is red');
    // (c) no needle
    chk(!loe.querySelector('.needle') && !loe.querySelector('line'), '(c) .loe dial has no needle element');
    chk(!ring(97).querySelector('.needle'), '(c) ring has no needle element');
    chk(!/class="needle"|\.needle\b|needle-t|@keyframes needle/.test(html), '(c) no needle/tremor markup, CSS or JS ships in the page');
    // (d) centred number equals the formatted value
    const num = el => el.querySelector('.gnum');
    chk(num(ring(97)).textContent === '97%', '(d) ring 97 shows "97%"', num(ring(97)).textContent);
    chk(num(ring(96.6)).textContent === '97%', '(d) ring 96.6 rounds to "97%"', num(ring(96.6)).textContent);
    chk(num(ring(null)).textContent === '—', '(d) no data shows an em dash, not 0%', num(ring(null)).textContent);
    chk(num(loe).textContent === `${loe.querySelector('[role=meter]').getAttribute('aria-valuenow')}%`,
        '(d) .loe number equals its aria-valuenow + "%"', num(loe).textContent);
    chk(num(ring(97)).getAttribute('text-anchor') === 'middle' && num(ring(97)).getAttribute('x') === '50', '(d) the number is centred on the arc');
    // integration: the Home KPI strip
    const rings = [...d.querySelectorAll('#kpis .kring')];
    chk(rings.length >= 2, 'Home KPI strip renders the arc rings', rings.length);
    chk(rings.every(r => r.querySelector('.gtrack') && r.querySelector('.gnum') && r.getAttribute('role') === 'meter' && r.getAttribute('aria-label')),
        'each Home ring keeps role=meter, aria-label, track and number');
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 6).join('\n'));
  }
  console.log(`\ncheck_arc_gauge.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
