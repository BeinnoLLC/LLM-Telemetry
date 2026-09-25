// Bandwidth UI: per-session up/down arrows on live rows, and the aggregated
// card above the fold. Both render from the live payload, so both are asserted
// against the built HTML rather than eyeballed.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(require('os').homedir(), '.local/share/llm-telemetry/reports');
const fs = require('fs'), { JSDOM } = require('jsdom');
const raw = fs.readFileSync(REPORTS + '/dashboard.html', 'utf8');
const html = raw.replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
const live = JSON.parse(fs.readFileSync(REPORTS + '/live-data.json', 'utf8'));

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://127.0.0.1:8477/dashboard.html',
  beforeParse(w) {
    w.Chart = function () { return { destroy() {}, update() {} }; };
    w.Chart.defaults = { color: '', borderColor: '', font: {} };
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(live) });
  }
});
const w = dom.window, d = w.document;
let p = 0, f = 0;
const chk = (ok, l, x) => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${l}${x ? '  ' + x : ''}`); ok ? p++ : f++; };

// What the payload actually carries, so expectations come from data not guesses.
const prof = Object.values(live.profiles || {});
const sessions = prof.flatMap(x => x.live || []);
const withBw = sessions.filter(L => (+L.up_bytes || 0) || (+L.down_bytes || 0));

setTimeout(() => {
  // ---- payload contract --------------------------------------------------
  chk(typeof live.bytes_per_token === 'number' && live.bytes_per_token > 1,
    'payload carries bytes_per_token', `(${live.bytes_per_token})`);
  chk(withBw.length > 0, 'sample has live sessions with byte counts', `(${withBw.length})`);

  // ---- per-session arrows ------------------------------------------------
  const rows = [...d.querySelectorAll('#livelist .bw')];
  chk(rows.length === withBw.length,
    'every live session with bytes renders a bandwidth row', `(${rows.length}/${withBw.length})`);

  const ups = [...d.querySelectorAll('#livelist .bw .bwup')];
  const downs = [...d.querySelectorAll('#livelist .bw .bwdown')];
  chk(ups.length === rows.length && downs.length === rows.length,
    'each row has BOTH an up and a down arrow', `(${ups.length}up/${downs.length}down)`);

  // The arrows must be actual glyphs, not empty spans relying on CSS content.
  chk(ups.every(e => e.textContent.trim() === '\u2191'), 'up arrow renders ↑');
  chk(downs.every(e => e.textContent.trim() === '\u2193'), 'down arrow renders ↓');

  // Direction must be visually distinguishable, or the arrows are decoration.
  const upCol = ups.length ? w.getComputedStyle(ups[0]).color : '';
  const downCol = downs.length ? w.getComputedStyle(downs[0]).color : '';
  chk(!!upCol && !!downCol && upCol !== downCol,
    'up and down are different colours', `(${upCol} vs ${downCol})`);

  // Honesty: a derived number must say so on hover, not only in a doc.
  chk(rows.every(r => /estimat/i.test(r.getAttribute('title') || '')),
    'bandwidth rows disclose that the figure is estimated');

  // ---- aggregated card ---------------------------------------------------
  const card = d.getElementById('bwcard');
  chk(!!card, 'aggregated bandwidth card exists');
  chk(card && !card.hidden, 'card is visible when there is traffic');

  // It must sit ABOVE the fold with the KPIs, not buried in a tab.
  const kpis = d.getElementById('kpis');
  chk(!!card && !!kpis && !!(kpis.compareDocumentPosition(card) & 4),
    'card is positioned after the KPI row, near the top');
  chk(!!card && !card.closest('.view'),
    'card is outside any single view, so it shows on every tab');

  const tot = d.getElementById('bwtot');
  const totTxt = tot ? tot.textContent : '';
  chk(/\u2191/.test(totTxt) && /\u2193/.test(totTxt),
    'aggregate shows both directions in ONE card');
  chk(/\d/.test(totTxt) && /(B|KB|MB|GB|TB)/.test(totTxt),
    'aggregate shows byte-formatted values', `(${totTxt.replace(/\s+/g, ' ').trim().slice(0, 60)})`);

  // Totals must equal the sum of the non-LAN rows: a card that disagrees with
  // its own rows is the cross-page inconsistency this project keeps hitting.
  // Totals must equal the sum of the METERED bytes across all rows. Not a
  // bw_local filter: every real session used both a local and a hosted endpoint,
  // so the split is per-endpoint, and up_bytes already excludes LAN traffic.
  const expUp = withBw.reduce((s, L) => s + (+L.up_bytes || 0), 0);
  const gb = expUp / 1073741824, mb = expUp / 1048576;
  const wantUp = gb >= 1 ? gb.toFixed(gb < 10 ? 2 : 1) : mb.toFixed(mb < 10 ? 2 : 1);
  chk(expUp === 0 || totTxt.includes(wantUp),
    'aggregate upload equals the sum of internet rows', `(want ${wantUp})`);

  const note = d.getElementById('bwnote');
  chk(!!note && /derived|estimat/i.test(note.textContent),
    'card states the figure is derived and names the factor');
  chk(!!note && note.textContent.includes(String(live.bytes_per_token)),
    'card reports the SAME factor the collector used', `(${live.bytes_per_token})`);

  // LAN traffic is tracked separately from metered traffic. Real data showed
  // every live session using BOTH a local and a hosted endpoint, so a session
  // must never be summarised by one bucket alone.
  const anyLan = withBw.some(L => (+L.lan_up_bytes||0) > 0);
  chk(anyLan, 'sample exercises the LAN bucket too');
  const mixed = withBw.filter(L => (+L.up_bytes||0) > 0 && (+L.lan_up_bytes||0) > 0);
  chk(mixed.length > 0, 'sample has a MIXED session (both buckets non-zero)', `(${mixed.length})`);
  // The metered total must exclude LAN bytes, or the card overstates the bill.
  const lanUpTot = withBw.reduce((s,L)=>s+(+L.lan_up_bytes||0),0);
  chk(lanUpTot > 0 && !totTxt.includes((( expUp + lanUpTot)/1073741824).toFixed(2)),
    'aggregate upload EXCLUDES LAN bytes', `(lan ${(lanUpTot/1048576).toFixed(1)}MB held out)`);
  const noteTxt = d.getElementById('bwnote').textContent;
  chk(/LAN/.test(noteTxt), 'card discloses LAN traffic separately');
  chk(/not metered/i.test(noteTxt), 'card says LAN is not metered');

  console.log(`\n${f===0?'ALL PASS':'FAILED'}  (${p} passed, ${f} failed)`);
  process.exit(f===0?0:1);
  },1400);
