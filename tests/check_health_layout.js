// Health page layout (#110): headline strip, grouped failures, labelled
// filters, consistent success numbers.
const fs = require('fs');
const path = require('path');
const {JSDOM} = require('jsdom');
const REPORTS = process.env.LLM_TELEMETRY_REPORTS || path.join(__dirname, '..', 'examples', 'reports');
const html = fs.readFileSync(REPORTS + '/dashboard.html', 'utf8');
const A = JSON.parse(fs.readFileSync(REPORTS + '/analytics-data.json', 'utf8'));

let p = 0, f = 0;
const chk = (ok, l, x) => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${l}${x ? '  ' + x : ''}`); ok ? p++ : f++; };

// Data sanity first: a row claiming more successes than calls is what put
// "150% success" on the page.
Object.entries(A.profiles).forEach(([n, pr]) => {
  const bad = (pr.health || []).filter(h => h.ok + h.fail !== h.total || h.ok > h.total);
  chk(bad.length === 0, `${n}: every health row has ok + fail = total`, bad.length ? `(${bad[0].model})` : '');
});

const dom = new JSDOM(html.replace(/<script src="https:\/\/[^"]+"><\/script>/g, ''), {
  url: 'http://127.0.0.1:8477/dashboard.html#/health',
  runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(w) {
    w.Chart = function () { return {destroy() {}, update() {}}; };
    w.Chart.defaults = {color: '', borderColor: '', font: {}};
    w.matchMedia = () => ({matches: false, addListener() {}, removeListener() {}});
    const live = JSON.parse(fs.readFileSync(REPORTS + '/live-data.json', 'utf8'));
    w.fetch = () => Promise.resolve({ok: true, status: 200, json: () => Promise.resolve(live)});
  }});
const w = dom.window, d = w.document;
const click = el => el && el.dispatchEvent(new w.MouseEvent('click', {bubbles: true}));

setTimeout(() => {
  // Order: summary first, delegated runs last.
  const kids = [...d.querySelectorAll('[data-view="Health"] > div')];
  const cards = kids.map(c => c.id || (c.querySelector('.lbl')?.textContent || '').trim().split('\n')[0]);
  chk(cards[0] === 'hsummary', 'headline strip comes first', `(${cards.join(' | ')})`);
  chk(cards[cards.length - 1] === 'delegcard', 'delegated runs sit last');

  const sum = d.getElementById('hsummary');
  const tiles = sum ? [...sum.querySelectorAll('.hsumc')] : [];
  chk(tiles.length === 4, 'headline strip has four tiles', `(${tiles.length})`);
  const pct = (sum?.textContent.match(/(\d+(?:\.\d+)?)%/) || [])[1];
  chk(pct !== undefined && +pct <= 100, 'overall success is a real percentage', `(${pct}%)`);

  // Filters are labelled rows, not one anonymous chip wall.
  const labels = [...d.querySelectorAll('#failfilters .fflbl')].map(e => e.textContent.trim().toLowerCase());
  chk(labels.includes('kind') && labels.includes('model'), 'filter rows are labelled kind / model', `(${labels})`);

  // Identical errors are grouped with a count.
  const rows = [...d.querySelectorAll('#faillist > div')];
  const counts = rows.map(r => r.querySelector('.fcnt')).filter(e => e && /^×\d+$/.test(e.textContent.trim()));
  chk(rows.length > 0, 'failure list renders', `(${rows.length})`);
  chk(counts.length > 0, 'repeated errors show a ×N count', `(${counts.length})`);
  const grouped = counts.reduce((a, c) => a + (+c.textContent.replace(/\D/g, '') || 0), 0) + (rows.length - counts.length);
  const shown = +((d.getElementById('failcount').textContent.match(/(\d+) failures? in/) || [])[1] || 0);
  chk(grouped === shown, 'grouped counts add back up to the failure total', `(${grouped} vs ${shown})`);

  // Filtering still works on grouped rows.
  const kchip = [...d.querySelectorAll('#failfilters [data-fk]')].find(c => c.dataset.fk !== 'all');
  click(kchip);
  const after = [...d.querySelectorAll('#faillist > div')];
  chk(after.length > 0 && after.length <= rows.length, 'kind filter narrows the grouped list', `(${rows.length} -> ${after.length})`);

  console.log(`\n${f ? 'FAILED' : 'ALL PASS'}  (${p} passed, ${f} failed)`);
  process.exit(f ? 1 : 0);
}, 2500);
