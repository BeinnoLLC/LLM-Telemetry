// Prices view (in-app, was costs.html): P6-01 #59 universe, P6-04 #62
// calculator, P6-05 #63 coverage. Boots the committed sample dashboard.html in
// jsdom (built in CI from the pinned sample catalogue), opens the Prices view,
// and verifies the same contracts the old standalone sheet carried — every
// expected number is reproducible. Unpriced/calculator details are also
// checked by check_price_whatif.js; this file keeps the table-level contracts.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || path.join(__dirname, '..', 'examples', 'reports');
const dashFile = path.join(REPORTS, 'dashboard.html');
const catFile = path.join(REPORTS, 'sample-catalog.json');
let pass = 0, fail = 0;
const chk = (ok, label, extra) => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${extra !== undefined ? '  (' + extra + ')' : ''}`);
  ok ? pass++ : fail++;
};
if (!fs.existsSync(dashFile) || !fs.existsSync(catFile)) {
  console.log('FAIL dashboard.html or sample-catalog.json missing: build the sample app first');
  process.exit(1);
}
const html = fs.readFileSync(dashFile, 'utf8');
const catalog = JSON.parse(fs.readFileSync(catFile, 'utf8')).models;
const analytics = JSON.parse(fs.readFileSync(path.join(REPORTS, 'analytics-data.json'), 'utf8'));
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
  const table = d.getElementById('pricesTableWrap');
  const rows = [...table.querySelectorAll('tbody tr[data-model]')];
  const byModel = Object.fromEntries(rows.map(r => [r.dataset.model, r]));

  // Traffic count: distinct models in the sample payload.
  const used = new Set();
  Object.values(analytics.profiles).forEach(p => (p.rows || []).forEach(r => used.add(r.model)));

  // ---- #59 universe
  chk(rows.length > used.size, 'row count is the universe, not the traffic count',
      `${rows.length} rows, ${used.size} used`);
  const catIds = Object.keys(catalog);
  chk(catIds.every(id => byModel[id] || rows.some(r => r.dataset.oid === id)),
      'every catalogue id is a row (directly or as the id a used model prices from)');
  const unusedPriced = rows.find(r => r.dataset.used === '0' && r.dataset.source === 'openrouter');
  chk(!!unusedPriced, 'a model with no traffic is listed');
  chk(unusedPriced && /\$\d/.test(unusedPriced.textContent), 'and shows its rates',
      unusedPriced && unusedPriced.dataset.model);
  chk(unusedPriced && unusedPriced.classList.contains('pv-unused'), 'unused rows are visibly distinct');
  const usedRow = rows.find(r => r.dataset.used === '1');
  chk(usedRow && !usedRow.classList.contains('unused'), 'used rows are not dimmed');
  const shellTxt = (d.querySelector('.pv-shell-sub') || d.querySelector('#pricesTableWrap')).textContent || '';
  const usedN = rows.filter(r => r.dataset.used === '1').length;
  chk(shellTxt.includes(usedN + ' with observed traffic'),
      'view states how many you have used', shellTxt.slice(0, 120));
  const batch = catIds.find(k => k.endsWith(':batch'));
  chk(batch && byModel[batch] && byModel[batch].dataset.source === 'openrouter',
      'an exact ":batch" catalogue id prices from its own entry', batch);
  const sentinel = catIds.find(k => String(catalog[k].prompt) === '-1');
  chk(sentinel && byModel[sentinel] && byModel[sentinel].dataset.source === 'unpriced',
      'a -1 router sentinel is unpriced, never a negative price', sentinel);
  chk(!/-\$\d|\$-\d/.test(table.textContent), 'no negative money anywhere');

  // ---- #60/#63 freshness
  const fresh = d.querySelector('[data-cat-state]');
  chk(fresh && fresh.dataset.catState === 'pinned', 'Prices view states its catalogue is pinned',
      fresh && fresh.dataset.catState);

  // ---- #62 calculator (full group coverage; math covered by check_price_whatif)
  const sel = d.getElementById('cm');
  const groups = [...sel.querySelectorAll('optgroup')].map(g => g.label.split(' ')[0].toLowerCase());
  chk(sel.options.length === rows.length, 'every model in the table is selectable',
      `${sel.options.length} options`);
  chk(groups.join() === 'local,metered,free,unpriced' || groups.join() === 'local,metered,unpriced',
      'options grouped by cost kind', groups.join());
  const pick = kind => {
    const g = [...sel.querySelectorAll('optgroup')].find(g => g.label.toLowerCase().startsWith(kind));
    if (!g) return null;
    sel.value = g.querySelector('option').value;
    w.eval('priceWhatIfCalc()');
    return { tot: d.getElementById('ctot').textContent, kind: d.getElementById('ctot').dataset.kind };
  };
  const loc = pick('local');
  chk(loc && /electricity/.test(loc.tot) && loc.kind === 'local', 'local result says electricity', loc && loc.tot);
  const met = pick('metered');
  chk(met && /billed/.test(met.tot) && met.kind === 'metered', 'metered result says billed', met && met.tot);
  const un = pick('unpriced');
  chk(un && /no rate/.test(un.tot) && !/\$/.test(un.tot), 'unpriced says "no rate", never $0', un && un.tot);

  console.log(`ALL PASS  (${pass} passed, ${fail} failed)`);
  process.exit(fail ? 1 : 0);
}, 400);
setTimeout(() => { console.log('TIMEOUT'); process.exit(9); }, 20000);