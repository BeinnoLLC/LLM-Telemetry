// Local models are electricity, never "free" (P7-04, #68; P7-01, #65).
const fs = require('fs');
const path = require('path');
const {JSDOM} = require('jsdom');
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || path.join(require('os').homedir(), '.local/share/llm-telemetry/reports');

const html = fs.readFileSync(REPORTS + '/dashboard.html', 'utf8')
  .replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
const A = JSON.parse(fs.readFileSync(REPORTS + '/analytics-data.json', 'utf8'));
let p = 0, f = 0;
const chk = (ok, l, x) => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${l}${x ? '  ' + x : ''}`); ok ? p++ : f++; };

const rows = Object.values(A.profiles).flatMap(x => x.rows || []);
const local = rows.filter(r => r.cost_class === 'local');
const freeTier = rows.filter(r => r.cost_class === 'free');

// Payload contract first: the page can only be as honest as its data.
chk(local.length > 0, 'sample carries local rows', `(${local.length})`);
chk(local.every(r => (r.energy_usd || 0) >= 0 && r.billed_usd === 0), 'local rows: energy carried, nothing billed');
chk(local.some(r => r.energy_usd > 0), 'local rows carry a non-zero electricity cost');
chk(local.every(r => Math.abs((r.market_value_usd || 0) - (r.energy_usd || 0)) < 1e-9),
  'a local row\'s est. cost IS its electricity');
chk(!rows.some(r => r.cost_class === 'free' && !/:free$/i.test(r.model)),
  'class "free" is only ever an OpenRouter :free tier');
chk(freeTier.every(r => (r.market_value_usd || 0) === 0), ':free tier rows price at $0');

const dom = new JSDOM(html, {runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://127.0.0.1:8477/dashboard.html#/cost',
  beforeParse(w) {
    w.Chart = function () { return {destroy() {}, update() {}}; };
    w.Chart.defaults = {color: '', borderColor: '', font: {}};
    w.Chart.getChart = () => null;
    w.matchMedia = () => ({matches: false, addListener() {}, removeListener() {}, addEventListener() {}});
    const live = JSON.parse(fs.readFileSync(REPORTS + '/live-data.json', 'utf8'));
    w.fetch = () => Promise.resolve({ok: true, status: 200, json: () => Promise.resolve(live)});
  }});
const w = dom.window, d = w.document;

setTimeout(() => {
  // The All tab merges every profile, so every model appears once.
  const allBtn = d.querySelector('[data-tab="All"]');
  if (allBtn) allBtn.click();
  const localModels = [...new Set(local.map(r => r.model.split('/').pop()))];
  const trs = [...d.querySelectorAll('#tbl tr[data-model]')];
  chk(trs.length > 0, 'model table rendered', `(${trs.length} rows)`);

  const localTrs = trs.filter(tr => tr.dataset.cost === 'local');
  chk(localTrs.length >= 1, 'local models are marked as local rows', `(${localTrs.length})`);
  const bad = localTrs.filter(tr => /\bfree\b/i.test(tr.textContent));
  chk(bad.length === 0, 'no local row renders the string "free"', bad.map(t => t.dataset.model).join(','));

  const withElec = localTrs.filter(tr => tr.querySelector('.elecmark'));
  chk(withElec.length === localTrs.length, 'every local row shows the "elec" marker', `(${withElec.length}/${localTrs.length})`);
  const nonzero = localTrs.filter(tr => { const m = /~\$([\d.]+)/.exec(tr.textContent); return m && +m[1] > 0; });
  chk(nonzero.length >= 1, 'local rows show a real, non-zero electricity figure', `(${nonzero.length})`);
  const plainZero = localTrs.filter(tr => /(^|\s)\$0\.00(\s|$)/.test(tr.lastElementChild.previousElementSibling.textContent));
  chk(plainZero.length === 0, 'no local row reads a bare "$0.00"');

  const others = trs.filter(tr => tr.dataset.cost !== 'local');
  chk(!others.some(tr => tr.querySelector('.elecmark')), 'billed/subscription rows carry no "elec" marker');

  // The "elec" figure agrees with the payload for the biggest local model.
  const top = localModels.map(m => [m, local.filter(r => r.model.split('/').pop() === m)
    .reduce((s, r) => s + (r.energy_usd || 0), 0)]).sort((a, b) => b[1] - a[1])[0];
  const topTr = trs.find(tr => tr.dataset.model === top[0]);
  const shown = topTr && /~\$([\d.]+)/.exec(topTr.textContent);
  chk(shown && Math.abs(+shown[1] - top[1]) < 0.01, 'electricity figure matches the payload',
    `(${top[0]}: shown ${shown && shown[1]}, payload ${top[1].toFixed(4)})`);

  // Headline: electricity is visible inside Est. cost, not hidden in it.
  const kpis = d.getElementById('kpis');
  chk(kpis && /incl\./.test(kpis.textContent) && kpis.querySelector('.elecmark'),
    'Est. cost KPI states how much of it is electricity');

  // No prose on the page may still claim local runs cost nothing.
  const prose = d.body.textContent.replace(/\s+/g, ' ');
  chk(!/local models? (at|cost|are) \$?0(\.00)?\b|local models? (are|is) free/i.test(prose),
    'no page text claims local models cost $0 or are free');

  console.log(f ? `FAILED  (${p} passed, ${f} failed)` : `ALL PASS  (${p} passed, ${f} failed)`);
  process.exit(f ? 1 : 0);
}, 900);
