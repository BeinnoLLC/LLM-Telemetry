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
    chk(!/<path[^>]*stroke="var\(--z-bad\)"/.test(nullRing), 'a no-data ring does not paint the danger colour (that would misread as "0% healthy")');

    const spark = w.eval(`sparkSvg([10, 12, 30, 8, 40, 50, 45], '#22c55e')`);
    chk(/<polyline/.test(spark), 'sparkSvg draws a real polyline from real values');
    chk(/<circle/.test(spark), 'sparkSvg marks the latest point');
    const flatSpark = w.eval(`sparkSvg([5,5,5,5], '#22c55e')`);
    chk(flatSpark === '', 'sparkSvg renders nothing for a flat/constant series (no fake trend)');
    const shortSpark = w.eval(`sparkSvg([5], '#22c55e')`);
    chk(shortSpark === '', 'sparkSvg renders nothing with fewer than 2 points');

    // ---- integration: the built KPI strip actually uses them ---------------
    // UI pass U-1: bounded percentages are thin meters (role=meter), not rings.
    const kpis = d.getElementById('kpis');
    chk(!!kpis, '#kpis strip exists');
    const meters = kpis.querySelectorAll('.stat-meter[role="meter"]');
    chk(meters.length === 2 && [...meters].every(m => m.getAttribute('aria-label') && m.hasAttribute('aria-valuenow')),
      'the strip renders 2 meters (success + cache hit) with aria-label and aria-valuenow', meters.length);
    chk(kpis.querySelectorAll('.kring').length === 0, 'no ring gauges left in the strip');
    chk(kpis.querySelectorAll('.kspark').length >= 3, 'the strip renders sparklines for the unbounded counters', kpis.querySelectorAll('.kspark').length);
    chk(kpis.children.length === 6, 'the strip has exactly 6 KPI cards ("In progress" folded into the live row)', kpis.children.length);
    chk([...kpis.children].every(c => c.classList.contains('card') && c.classList.contains('stat')), 'every KPI card shares the one .card.stat recipe');
    chk([...kpis.children].every(c => c.children.length === 4 && ['stat-label', 'stat-value', 'stat-sub', 'stat-viz'].every((k, n) => c.children[n].classList.contains(k))),
      'every card has the same four slots in the same order: label, value, sub, viz');
    chk(kpis.querySelectorAll('.kpi-icon').length === 0, 'no per-card icons');
    const callsCard = [...kpis.children].find(c => /API calls/.test(c.textContent));
    chk(!!callsCard && /\d/.test(callsCard.querySelector('.stat-value').textContent), 'API calls KPI still shows the real number');
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
