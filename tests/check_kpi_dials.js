// #11: radial KPI dials for bounded metrics + sparklines for unbounded
// counters in the KPI strip (#kpis).
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
  try {
    // ---- unit-level checks on the two new render primitives ---------------
    const okRing = w.eval(`radialRing(97, {label:'Success rate', warnAt:95, badAt:80})`);
    chk(/role="meter"/.test(okRing), 'radialRing has role="meter"');
    chk(/aria-valuenow="97"/.test(okRing), 'radialRing reports the real value via aria-valuenow');
    chk(/stroke="var\(--z-ok\)"/.test(okRing), 'a healthy value uses the shared --z-ok colour (same vocabulary as the gauge, #8)');
    const badRing = w.eval(`radialRing(20, {label:'Success rate', warnAt:95, badAt:80})`);
    chk(/stroke="var\(--z-bad\)"/.test(badRing), 'a low value uses the shared --z-bad colour');
    const nullRing = w.eval(`radialRing(null, {label:'Cache hit rate'})`);
    chk(/no data/.test(nullRing) || /—/.test(nullRing), 'a null/no-data value shows an explicit no-data state, not a fabricated 0%');
    chk(!/<circle[^>]*stroke="var\(--z-bad\)"/.test(nullRing), 'a no-data ring does not paint the danger colour (that would misread as "0% healthy")');

    const spark = w.eval(`sparkSvg([10, 12, 30, 8, 40, 50, 45], '#22c55e')`);
    chk(/<polyline/.test(spark), 'sparkSvg draws a real polyline from real values');
    chk(/<circle/.test(spark), 'sparkSvg marks the latest point');
    const flatSpark = w.eval(`sparkSvg([5,5,5,5], '#22c55e')`);
    chk(flatSpark === '', 'sparkSvg renders nothing for a flat/constant series (no fake trend)');
    const shortSpark = w.eval(`sparkSvg([5], '#22c55e')`);
    chk(shortSpark === '', 'sparkSvg renders nothing with fewer than 2 points');

    // ---- integration: the built KPI strip actually uses them ---------------
    const kpis = d.getElementById('kpis');
    chk(!!kpis, '#kpis strip exists');
    const rings = kpis.querySelectorAll('.kring');
    chk(rings.length >= 2, 'the KPI strip renders at least 2 rings (success rate + cache hit rate)', rings.length);
    const sparks = kpis.querySelectorAll('.kspark');
    chk(sparks.length >= 2, 'the KPI strip renders at least 2 sparklines (calls + tokens)', sparks.length);
    // The KPI strip must still be ONE flat grid, not a differently-shaped
    // sub-layout for ring cards — the grid-kpi CSS (#11's "fits one row at
    // 1440px, two at 768px" requirement) needs every card in the same flow.
    chk(kpis.children.length === 7, 'the strip still has exactly 7 KPI cards (unbounded + bounded together)', kpis.children.length);
    chk([...kpis.children].every(c => c.classList.contains('card')), 'every KPI card (ring or plain) shares the same .card recipe');

    // Unbounded metrics (API calls / tokens) keep their real number visible
    // alongside the sparkline — a trend line must not replace the figure.
    const callsCard = [...kpis.children].find(c => /API calls/.test(c.textContent));
    chk(!!callsCard && /\d/.test(callsCard.querySelector('.font-semibold').textContent),
        'API calls KPI still shows the real number, not just a sparkline');

    // ---- KPI cards each carry an icon (icons + trend sparklines everywhere) --
    const icons = kpis.querySelectorAll('.kpi-icon');
    chk(icons.length === 7, 'every one of the 7 KPI cards renders an icon glyph', icons.length);

    // Sessions and Est. cost now get a real 7-day trend too (icons + trend
    // charts on every card, not just calls/tokens).
    const sessCard = [...kpis.children].find(c => /Sessions/.test(c.textContent));
    const costCard = [...kpis.children].find(c => /Est\. cost/.test(c.textContent));
    chk(!!sessCard && !!sessCard.querySelector('.kspark'), 'Sessions KPI carries a trend sparkline');
    chk(!!costCard && !!costCard.querySelector('.kspark'), 'Est. cost KPI carries a trend sparkline');

    // ---- sparkSvg accepts a custom size for the local-inference bars -------
    const smallSpark = w.eval(`sparkSvg([10,20,15,30], '#22c55e', {w:44,h:14,pad:1.5})`);
    chk(/viewBox="0 0 44 14"/.test(smallSpark), 'sparkSvg honours a custom w/h/pad for compact contexts (olBar)');
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 6).join('\n'));
  }
  console.log(`\ncheck_kpi_dials.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
