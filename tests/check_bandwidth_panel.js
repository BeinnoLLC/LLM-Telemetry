// Bandwidth trend + context re-send panel (P8-05, #72).
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

// Capture every chart the page builds so the trend's data can be inspected.
const charts = [];
const dom = new JSDOM(html, {runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://127.0.0.1:8477/dashboard.html#/usage',
  beforeParse(w) {
    w.Chart = function (el, cfg) { charts.push({id: el && el.id, cfg}); return {destroy() {}, update() {}}; };
    w.Chart.defaults = {color: '', borderColor: '', font: {}};
    w.Chart.getChart = () => null;
    w.matchMedia = () => ({matches: false, addListener() {}, removeListener() {}, addEventListener() {}});
    const live = JSON.parse(fs.readFileSync(REPORTS + '/live-data.json', 'utf8'));
    w.fetch = () => Promise.resolve({ok: true, status: 200, json: () => Promise.resolve(live)});
  }});
const w = dom.window, d = w.document;

// Expected values straight from the persisted series, merged the way the All
// tab merges it (concatenation), over the full range.
const S = Object.values(A.profiles).flatMap(x => x.bandwidth_daily || []);
const sum = (k, rs = S) => rs.reduce((a, r) => a + (+r[k] || 0), 0);
const fresh = sum('input_tokens') + sum('cache_write_tokens');
const wantX = (fresh + sum('cache_read_tokens')) / fresh;

setTimeout(() => {
  chk(S.length > 0, 'sample carries a persisted bandwidth series', `(${S.length} rows)`);
  const card = d.getElementById('bwpanel');
  chk(card && !card.hidden, 'bandwidth panel renders on the Usage view');
  chk(card && card.closest('[data-view="Usage"]'), 'panel lives inside the Usage view');

  // Estimate disclosure in the HEADER, not only a footnote (phase constraint).
  chk(/estimated, not measured/.test(d.getElementById('bwpsub').textContent),
    'header states figures are estimates', `("${d.getElementById('bwpsub').textContent}")`);
  const note = d.getElementById('bwpnote').textContent;
  chk(/bytes\/token/.test(note) && /not measured/.test(note), 'note names the method');
  chk(/frozen/.test(note), 'note explains frozen history');

  const tiles = [...d.querySelectorAll('#bwpkpi .bwpt')].map(t => t.textContent.replace(/\s+/g, ' '));
  chk(tiles.length === 4, 'four headline tiles', `(${tiles.length})`);
  const shownX = parseFloat((tiles[0] || '').match(/([\d.]+)×/)?.[1]);
  chk(Math.abs(shownX - wantX) < 0.051, 're-send headline matches the series', `(${shownX} vs ${wantX.toFixed(2)})`);
  const wantR = Math.round(sum('up_bytes') / sum('down_bytes'));
  chk((tiles[1] || '').includes(`${wantR.toLocaleString()}:1`), 'up:down ratio shown explicitly', `(${tiles[1]} want ${wantR}:1)`);
  chk(/LAN/.test(tiles[3] || '') && /not metered/.test(tiles[3] || ''), 'LAN tile is separate and says not metered');

  // The trend reads the ledger, not the day rows.
  const tr = charts.filter(c => c.id === 'cBwTrend').pop();
  chk(!!tr, 'trend chart built');
  if (tr) {
    const ds = Object.fromEntries(tr.cfg.data.datasets.map(x => [x.label, x]));
    const days = [...new Set(S.map(r => r.date))].sort();
    chk(tr.cfg.data.labels.length === days.length, 'one point per ledger day', `(${tr.cfg.data.labels.length}/${days.length})`);
    const upSeries = ds.upload.data.reduce((a, b) => a + b, 0);
    chk(upSeries === sum('up_bytes'), 'trend upload sums to the ledger', `(${upSeries} vs ${sum('up_bytes')})`);
    const rowsUp = Object.values(A.profiles).flatMap(x => x.rows || []).reduce((a, r) => a + (+r.up_bytes || 0), 0);
    chk(ds.download && ds.download.yAxisID === 'y1' && ds.upload.yAxisID === 'y',
      'download on its own axis (not an invisible sliver under upload)');
    chk(ds.LAN && ds.LAN.yAxisID === 'y1', 'LAN plotted separately from internet');
    // Prove the source: tamper with the ledger only and the trend must move.
    const cur = w.eval('current');
    const prof = w.eval('DATA').profiles[cur];
    const before = charts.length;
    prof.bandwidth_daily = prof.bandwidth_daily.map(r => ({...r, up_bytes: 7}));
    w.eval('render()');
    const tr2 = charts.slice(before).filter(c => c.id === 'cBwTrend').pop();
    const up2 = tr2 ? tr2.cfg.data.datasets.find(x => x.label === 'upload').data.reduce((a, b) => a + b, 0) : -1;
    chk(up2 === 7 * prof.bandwidth_daily.length, 'trend is drawn from the persisted series, not recomputed rows',
      `(${up2}; rows would give ${rowsUp})`);
  }

  // Re-send per model: worst first, flags only well above the median.
  const rs = [...d.querySelectorAll('#bwresend .bwrrow')];
  chk(rs.length > 0, 're-send rows render', `(${rs.length})`);
  const xs = rs.map(r => +r.dataset.x);
  chk(xs.every((x, i) => i === 0 || xs[i - 1] >= x), 'rows sorted worst first');
  const hot = rs.filter(r => r.classList.contains('hot'));
  const medTxt = (d.getElementById('bwresend').textContent.match(/fleet median ([\d.]+)/) || [])[1];
  chk(!!medTxt, 'fleet median stated', `(${medTxt})`);
  chk(hot.length > 0 && hot.every(r => +r.dataset.x >= 2 * +medTxt - 0.1),
    'flags only models at 2x+ the median', `(${hot.map(r => r.dataset.model + ' ' + r.dataset.x).join(', ')})`);
  chk(rs.filter(r => !r.classList.contains('hot')).every(r => +r.dataset.x < 2 * +medTxt + 0.1),
    'no model under 2x median is flagged');

  // Per-model figure: recompute one model by hand from the ledger.
  const m0 = rs[0] && rs[0].dataset.model;
  if (m0) {
    const mine = S.filter(r => w.eval('short')(r.model) === m0);
    const fr = sum('input_tokens', mine) + sum('cache_write_tokens', mine);
    const x = (fr + sum('cache_read_tokens', mine)) / fr;
    chk(Math.abs(x - +rs[0].dataset.x) < 0.01, `per-model ratio for ${m0} matches a hand computation`, `(${x.toFixed(2)})`);
  }

  // A date range with no ledger rows must say so rather than show zeros.
  d.getElementById('from').value = '1999-01-01'; d.getElementById('to').value = '1999-01-02';
  w.eval('render()');
  chk(/No bandwidth recorded/.test(d.getElementById('bwpkpi').textContent), 'empty range says so, not zeros');

  console.log(`\n${f ? 'FAILED' : 'ALL PASS'}  (${p} passed, ${f} failed)`);
  process.exit(f ? 1 : 0);
}, 400);
