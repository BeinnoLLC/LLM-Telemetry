// Aggregated transfer totals (#86). The card must summarise the DATE-FILTERED
// analytics rows, not the live sessions, and the rendered figure must equal the
// sum of the rows it claims to summarise — a total that quietly disagrees with
// its own source is the failure mode worth guarding.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(require('os').homedir(), '.local/share/llm-telemetry/reports');
const fs = require('fs'), { JSDOM } = require('jsdom');

const raw = fs.readFileSync(REPORTS + '/dashboard.html', 'utf8');
const html = raw.replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
const live = JSON.parse(fs.readFileSync(REPORTS + '/live-data.json', 'utf8'));
const analytics = JSON.parse(fs.readFileSync(REPORTS + '/analytics-data.json', 'utf8'));

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://127.0.0.1:8477/dashboard.html#/usage',
  beforeParse(w) {
    w.Chart = function () { return { destroy() {}, update() {} }; };
    w.Chart.defaults = { color: '', borderColor: '', font: {} };
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.fetch = (u) => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve(String(u).includes('live-data') ? live : analytics)
    });
  }
});

let p = 0, f = 0;
const chk = (ok, l, x) => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${l}${x ? '  ' + x : ''}`); ok ? p++ : f++; };

// Parse "1.2 GB" / "830 MB" back to bytes so the rendered string can be
// compared against the payload rather than trusted. fmtB uses BINARY units
// (1024-based), so the multipliers must match or the cross-check drifts ~7% at
// GB scale and the comparison silently passes on a wrong tolerance.
function toBytes(s) {
  const m = /([\d.]+)\s*(B|KB|MB|GB|TB)/i.exec(s || '');
  if (!m) return null;
  const mult = {
    B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776
  }[m[2].toUpperCase()];
  return +m[1] * mult;
}

setTimeout(() => {
  const w = dom.window, d = w.document;
  const card = d.getElementById('xfercard');
  chk(!!card, 'transfer card exists');
  chk(card && !card.hidden, 'card is visible when the range has traffic');

  // It must be a DIFFERENT number from the live card, or it is just a copy.
  const bwcard = d.getElementById('bwcard');
  chk(!!bwcard, 'live bandwidth card still exists (both questions kept)');

  const tot = d.getElementById('xfertot');
  const txt = (tot && tot.textContent || '').replace(/\s+/g, ' ').trim();
  chk(/up/i.test(txt) && /down/i.test(txt), 'both directions labelled', `(${txt.slice(0, 60)})`);
  chk(/\d/.test(txt), 'figures are populated');

  // Cross-check: the rendered up total must equal the sum of the rows. Uses the
  // ALL profile the page defaults to, summed the same way the page does.
  const prof = analytics.profiles;
  const names = Object.keys(prof);
  const merged = [];
  names.forEach(n => (prof[n].rows || []).forEach(r => merged.push(r)));
  // The page defaults to a merged "All" profile; with one profile in the sample
  // the two coincide. Sum every profile so the check holds either way.
  const sumUp = merged.reduce((a, r) => a + (+r.up_bytes || 0), 0);
  const sumDown = merged.reduce((a, r) => a + (+r.down_bytes || 0), 0);
  chk(sumUp > 0, 'sample rows carry upload bytes', `(${(sumUp / 1048576).toFixed(0)} MiB)`);

  const spans = [...tot.querySelectorAll('.text-\\[17px\\]')].map(s => s.textContent.trim());
  const shownUp = toBytes(spans[0]), shownDown = toBytes(spans[1]);
  // 2% tolerance: fmtB rounds to 1-2 decimals, so exact equality is wrong to
  // demand, but an order-of-magnitude or wrong-source error still fails.
  const near = (a, b) => a != null && b > 0 && Math.abs(a - b) / b < 0.02;
  chk(near(shownUp, sumUp), 'rendered upload equals the sum of the rows',
    `(shown ${spans[0]} vs rows ${(sumUp / 1073741824).toFixed(2)} GB)`);
  chk(near(shownDown, sumDown), 'rendered download equals the sum of the rows',
    `(shown ${spans[1]} vs rows ${(sumDown / 1048576).toFixed(1)} MB)`);

  // This is the whole point of the ticket: the total must NOT be the live-only
  // figure, which is orders of magnitude smaller.
  const liveUp = (live.profiles ? Object.values(live.profiles) : [])
    .flatMap(x => x.live || []).reduce((a, L) => a + (+L.up_bytes || 0), 0);
  chk(!near(shownUp, liveUp) || liveUp === 0,
    'total is the range figure, not the live-session figure',
    `(live would be ${(liveUp / 1048576).toFixed(1)} MB)`);

  // Honesty requirements.
  chk(/estimat/i.test(card.textContent), 'card discloses the figure is estimated');
  const note = (d.getElementById('xfernote') || {}).textContent || '';
  const hasLan = merged.some(r => (+r.lan_up_bytes || 0) + (+r.lan_down_bytes || 0) > 0);
  chk(!hasLan || /not metered/i.test(note),
    'LAN traffic disclosed separately and labelled', `(${note})`);
  chk(/row/i.test(note), 'note says how many rows were summarised', `(${note})`);
  chk(tot.querySelector('.bwup') && tot.querySelector('.bwdown'),
    'reuses the shared up/down colour classes');

// --- the two cards must not look interchangeable -------------------------
// They sat adjacent showing 23.8 GB and 12.1 GB, both labelled "estimated",
// with nothing saying one covers every session in the date range and the other
// covers only sessions open right now (whose lifetime totals ignore the range).
(() => {
  const xfer = dom.window.document.getElementById('xfercard');
  const bw = dom.window.document.getElementById('bwcard');
  if (!xfer || !bw) { chk(false, 'both transfer cards exist'); return; }
  const xt = xfer.textContent.toLowerCase();
  const bt = bw.textContent.toLowerCase();
  chk(/all sessions/.test(xt) && /date range/.test(xt),
      'Transferred names its scope (all sessions, date range)');
  chk(/open sessions/.test(bt), 'Bandwidth names its scope (open sessions only)');
  chk(/lifetime/.test(bt), 'Bandwidth says its totals are lifetime, not range-bound');
  // The distinguishing words must actually differ between the two cards.
  const scopeOf = el => (el.querySelector('.lbl span') || {}).textContent || '';
  chk(scopeOf(xfer).trim() !== scopeOf(bw).trim(),
      'the two scope captions are not identical');
  chk(!!(bw.querySelector('[title]') || {}).title,
      'Bandwidth carries a tooltip explaining it is not a subset of Transferred');
})();

  console.log(`\n${f === 0 ? 'ALL PASS' : 'FAILED'}  (${p} passed, ${f} failed)`);
  process.exit(f === 0 ? 0 : 1);
}, 1600);
