// Unpriced traffic is visible, never a silent $0 (P9-05, #82; P6-02 #60 TTL text).
const fs = require('fs');
const path = require('path');
const {JSDOM} = require('jsdom');
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || path.join(__dirname, '..', 'examples', 'reports');
const html0 = fs.readFileSync(path.join(REPORTS, 'dashboard.html'), 'utf8')
  .replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
const data0 = JSON.parse(fs.readFileSync(path.join(REPORTS, 'analytics-data.json'), 'utf8'));

let p = 0, f = 0;
const chk = (ok, name, extra = '') => {
  if (ok) p++; else f++;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
};

// Replace the embedded payload so each case controls exactly what is unpriced.
function page(mutate){
  const d = JSON.parse(JSON.stringify(data0));
  mutate(d);
  const embedded = html0.replace(/let DATA = [\s\S]*?;\n/, () => 'let DATA = ' + JSON.stringify(d) + ';\n');
  return new JSDOM(embedded, {runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'http://127.0.0.1:8477/dashboard.html#/detail',
    beforeParse(w){
      w.Chart = function(){ return {destroy(){}, update(){}}; };
      w.Chart.defaults = {color: '', borderColor: '', font: {}};
      w.Chart.getChart = () => null;
      w.fetch = () => Promise.reject(new Error('offline'));
      w.matchMedia = () => ({matches: false, addListener(){}, removeListener(){}, addEventListener(){}});
    }});
}
const addUnpriced = d => {
  for (const prof of Object.values(d.profiles)) {
    prof.rows.push({...prof.rows[0], model: 'acme/mystery-9', provider: 'custom', base_url: 'https://api.acme.example/v1',
      cost_class: 'unknown', priced: false, market_value_usd: 0, billed_usd: 0, energy_usd: 0, calls: 77});
  }
};

const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  // Case 1: the committed sample. Nothing with traffic is unpriced, so the
  // banner stays hidden.
  let dom = page(() => {});
  await wait(900);
  let d = dom.window.document;
  chk(d.getElementById('unpricedbanner').hidden, 'no unpriced traffic: banner hidden');
  chk(/OpenRouter catalogue \(cached \d+[mhd]\)/.test(d.body.textContent),
    'Est. cost note states the catalogue TTL from the constant');
  chk(!/refreshed daily/.test(d.body.textContent), 'the wrong "refreshed daily" claim is gone');

  const rowOf = (doc, m) => [...doc.querySelectorAll('#tbl tr[data-model]')].find(tr => tr.dataset.model === m);
  const ft = rowOf(d, 'step-3.7-flash:free');
  chk(ft && ft.querySelector('.ftmark') && !ft.querySelector('.unpriced') && !ft.querySelector('.elecmark'),
    ':free tier renders as "free tier", not unpriced or elec');
  const loc = rowOf(d, 'qwen3-coder:30b');
  chk(loc && loc.querySelector('.elecmark') && !loc.querySelector('.unpriced'),
    'local renders as elec, not unpriced');
  const sub = rowOf(d, 'claude-opus-5');
  chk(sub && !sub.querySelector('.unpriced') && /\$\d/.test(sub.textContent),
    'a priced model renders its dollar figure');
  dom.window.close();

  // Case 2: one model with traffic and no rate.
  dom = page(addUnpriced);
  await wait(900);
  d = dom.window.document;
  const b = d.getElementById('unpricedbanner');
  chk(!b.hidden, 'unpriced traffic: banner shown');
  chk(/1 model with traffic has no price/.test(b.textContent), 'banner count comes from the payload', `(${b.textContent.slice(0, 60)})`);
  chk(/mystery-9/.test(b.textContent), 'banner names the model');
  chk(/understated/.test(b.textContent), 'banner says Est. cost is understated');
  chk(b.querySelector('a[href="costs.html"]'), 'banner links to the price sheet');
  const un = rowOf(d, 'mystery-9');
  chk(un && un.querySelector('.unpriced') && !/\$0\.00/.test(un.textContent),
    'unpriced row reads "unpriced", not "$0.00"');
  const cls = m => { const r = rowOf(d, m); return r && (r.querySelector('.unpriced') ? 'u' : r.querySelector('.elecmark') ? 'e' : r.querySelector('.ftmark') ? 'f' : 'p'); };
  chk(new Set([cls('mystery-9'), cls('qwen3-coder:30b'), cls('step-3.7-flash:free')]).size === 3,
    'unpriced, local and free tier are three distinct states');
  dom.window.close();

  console.log(f ? `FAILED  (${p} passed, ${f} failed)` : `ALL PASS  (${p} passed, ${f} failed)`);
  process.exit(f ? 1 : 0);
})();
