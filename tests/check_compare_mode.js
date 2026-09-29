// #99/P10-11: Compare mode — this period vs the previous, deltas everywhere.
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
      function Stub(ctx, cfg) { this.config = cfg; this.destroy = () => {}; this.update = () => {}; this.canvas = ctx; }
      Stub.register = () => {}; Stub.overrides = {}; Stub.instances = {}; Stub.getChart = () => null;
      Stub.registerables = []; Stub.version = 'stub'; Stub.controllers = {}; Stub.elements = {}; Stub.plugins = {}; Stub.scales = {};
      Stub.defaults = { font: { size: 10, family: '', weight: '' }, color: '' };
      w.Chart = Stub;
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
    chk(/id="comparetoggle"/.test(html), 'the Compare checkbox markup exists');

    // ---- pure delta math, per the ticket's own verification wording ----
    // "fixture rows across two 7-day windows -> deltas equal the
    // hand-computed difference"
    const upDelta = w.eval("compareDelta(120, 100, 'calls')");
    chk(upDelta.abs === 20, 'compareDelta computes the exact hand-computed absolute delta (120-100=20)', upDelta.abs);
    chk(Math.abs(upDelta.pct - 20) < 1e-9, 'compareDelta computes the exact hand-computed percent delta (20%)', upDelta.pct);
    chk(upDelta.dir === 'up' && upDelta.good === true,
        'a metric with good=up (calls) shows an increase as GOOD', upDelta);

    // "a metric with good=down renders a cost increase red"
    const costUp = w.eval("compareDelta(150, 100, 'cost')");
    chk(costUp.dir === 'up' && costUp.good === false,
        'a metric with good=down (cost) shows an INCREASE as BAD (the ticket\'s own named case)', costUp);
    const costHtml = w.eval("deltaHtml(compareDelta(150, 100, 'cost'))");
    chk(costHtml.includes('#ef4444'), 'the cost increase renders the real bad-red color', costHtml);

    const costDown = w.eval("compareDelta(80, 100, 'cost')");
    chk(costDown.dir === 'down' && costDown.good === true,
        'a metric with good=down (cost) shows a DECREASE as GOOD');

    // "negative control: previous period empty -> deltas render n/a, never Infinity%"
    const zeroPrevDelta = w.eval("compareDelta(50, 0, 'calls')");
    chk(zeroPrevDelta.na === true, 'a zero previous value produces na:true (the ticket\'s own negative control)');
    const zeroPrevHtml = w.eval("deltaHtml(compareDelta(50, 0, 'calls'))");
    chk(!zeroPrevHtml.includes('Infinity') && zeroPrevHtml.includes('n/a'),
        'a zero previous value renders "n/a" text, never the literal string Infinity', zeroPrevHtml);
    const nullPrevHtml = w.eval("deltaHtml(compareDelta(50, null, 'calls'))");
    chk(nullPrevHtml.includes('n/a'), 'a null previous value (no prior data at all) also renders "n/a"');

    const flatDelta = w.eval("compareDelta(100, 100, 'calls')");
    chk(flatDelta.dir === 'flat' && flatDelta.good === null,
        'an unchanged value is "flat", colored neither good nor bad');

    // previousPeriod(): equal-length window immediately before the range.
    const prev7 = w.eval("previousPeriod('2026-09-15', '2026-09-21')"); // 7 days
    chk(prev7.from === '2026-09-08' && prev7.to === '2026-09-14',
        'previousPeriod() returns the equal-length (7 day) window immediately before', prev7);
    const prev1 = w.eval("previousPeriod('2026-09-15', '2026-09-15')"); // 1 day
    chk(prev1.from === '2026-09-14' && prev1.to === '2026-09-14',
        'previousPeriod() handles a single-day range correctly', prev1);

    // ---- KPI card integration: toggling Compare renders real deltas ----
    w.eval(`
      current = 'work'; view = 'Home';
      $('from').value = ''; $('to').value = '';
      COMPARE_ON = false; render();
    `);
    chk(d.querySelectorAll('.kdelta').length === 0,
        'Compare OFF: no delta chips render on the KPI cards at all');

    w.eval("COMPARE_ON = true; render();");
    const deltaChips = d.querySelectorAll('.kdelta');
    chk(deltaChips.length > 0, 'Compare ON: delta chips render on the KPI cards', deltaChips.length);

    console.log(`\ncheck_compare_mode.js  ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 10).join('\n'));
    console.log(`\ncheck_compare_mode.js  ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
}, 1500);
