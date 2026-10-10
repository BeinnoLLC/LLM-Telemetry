// What-if calculator inside the Prices view (#113 consolidation).
// Boots the built dashboard.html in jsdom, opens the Prices view, and verifies
// the calculator the standalone costs.html sheet used to own now lives in-app:
// grouped select, $ math, and "no rate available" for unpriced models (never $0).
const fs = require('fs');
const { JSDOM } = require('jsdom');
const PAGE = '/home/hazemhagrass/workspace/beinno/LLM-Telemtry/examples/reports/dashboard.html';
const html = fs.readFileSync(PAGE, 'utf8');
let pass = 0, failN = 0;
const chk = (ok, name, extra) => {
  if (ok) { pass++; console.log('OK  ', name); }
  else { failN++; console.log('FAIL', name, extra === undefined ? '' : `(${extra})`); }
};
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://127.0.0.1:8477/dashboard.html',
  pretendToBeVisual: true,
  beforeParse(w) {
    w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
    w.HTMLCanvasElement.prototype.getContext = () => null;
    const Stub = function () { this.destroy = () => {}; this.resize = () => {}; };
    Stub.defaults = { font: { size: 10, family: '', weight: '' }, color: '' };
    w.Chart = Stub;
  } });
setTimeout(() => {
  const w = dom.window, d = w.document;
  w.eval("pickView('Prices')");
  const sel = d.getElementById('cm');
  const tot = d.getElementById('ctot');
  chk(!!sel && !!tot, 'calculator is mounted in the Prices view');
  if (!sel) { console.log(`ALL FAIL (${pass} passed, ${failN} failed)`); process.exit(1); }
  chk(sel.querySelectorAll('optgroup').length === 4,
    'options grouped by cost kind (local/metered/free/unpriced)', sel.children.length);
  // default: a used metered model
  const models = w.COSTS_DATA.models;
  const def = models[+sel.value];
  chk(def && def.source !== 'unpriced' && (def.calls || 0) > 0, 'defaults to a used metered model');
  // 10k in / 5k out on the default model
  const exp = 10e3 / 1e6 * def.in_1m + 5e3 / 1e6 * def.out_1m;
  const got = parseFloat(tot.textContent.replace(/[^0-9.]/g, ''));
  chk(Math.abs(got - exp) < 0.005, 'cost math (in + out, per-1M rates)', `got ${tot.textContent}, want $${exp}`);
  chk(/billed/.test(tot.textContent), 'metered result says "billed"');
  const idx2 = models.findIndex(m => m.source === 'unpriced');
  if (idx2 >= 0) {
    sel.value = String(idx2);
    w.eval('priceWhatIfCalc()');
    chk(/no rate available/.test(d.getElementById('ctot').textContent),
      'unpriced says "no rate available", never $0');
    chk(!/^\$0/.test(d.getElementById('ctot').textContent), 'unpriced never renders $0');
  } else {
    console.log('OK   (sample has no unpriced model — unpriced branch not exercised)');
  }
  console.log(`ALL PASS  (${pass} passed, ${failN} failed)`);
  process.exit(failN ? 1 : 0);
}, 400);
setTimeout(() => { console.log('TIMEOUT'); process.exit(9); }, 15000);