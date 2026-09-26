// Bandwidth UI: per-session up/down arrows on live rows, and the aggregated
// card above the fold. Both render from the live payload, so both are asserted
// against the built HTML rather than eyeballed.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(require('os').homedir(), '.local/share/llm-telemetry/reports');
const fs = require('fs'), { JSDOM } = require('jsdom');
const raw = fs.readFileSync(REPORTS + '/dashboard.html', 'utf8');
const html = raw.replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
const live = JSON.parse(fs.readFileSync(REPORTS + '/live-data.json', 'utf8'));
const analytics = JSON.parse(fs.readFileSync(REPORTS + '/analytics-data.json', 'utf8'));
// The Transferred card sums the ANALYTICS day-rows (all sessions in range), not
// the live sessions, so its expected totals come from the same place the page
// reads. Every profile: the default tab is the merged "All" view.
const rowsAll = Object.values(analytics.profiles).flatMap(p => p.rows || []);

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://127.0.0.1:8477/dashboard.html',
  beforeParse(w) {
    w.Chart = function () { return { destroy() {}, update() {} }; };
    w.Chart.defaults = { color: '', borderColor: '', font: {} };
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    // Serve the file the page actually asked for. Returning live-data for every
    // request left the analytics-driven tables empty and silently passed.
    w.fetch = (u) => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve(String(u).includes('live-data') ? live : analytics)
    });
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

  // ---- per-session bandwidth moved to status badge (user request) ----------
  // Bandwidth removed from .loecol column and moved inline with "IN PROGRESS NOW"
  // status badge on the title row (far right). LAN display removed entirely.
  const statusBadges = [...d.querySelectorAll('#livelist .chip')].filter(b =>
    b.textContent.includes('IN PROGRESS NOW'));
  
  // Check sessions with bandwidth have it in their status badge
  const badgesWithBw = statusBadges.filter(b => /\u2191.*\u2193|\u2193.*\u2191/.test(b.textContent));
  chk(badgesWithBw.length > 0, 'IN PROGRESS badges show bandwidth inline', `(${badgesWithBw.length})`);
  
  // Badge should show both up and down in compact form
  if (badgesWithBw.length > 0) {
    const txt = badgesWithBw[0].textContent;
    chk(/\u2191/.test(txt) && /\u2193/.test(txt),
      'status badge shows BOTH up and down arrows', `(${txt.replace(/\s+/g,' ').trim().slice(0,60)})`);
    chk(/(B|KB|MB|GB|TB)/.test(txt),
      'status badge shows byte-formatted values');
  }
  
  // LAN display removed per user request - verify it's gone from live rows
  const liveSection = raw.slice(raw.indexOf('data-view="Live"'), raw.indexOf('data-view="Live"') + 8000);
  chk(!/LAN \d+/.test(liveSection), 'LAN per-row bandwidth display removed');
  
  // Gauge column should still exist but without bandwidth row
  const cards = [...d.querySelectorAll('#livelist > div')];
  const gaugeCols = cards.map(c => c.querySelector('.loecol')).filter(Boolean);
  chk(gaugeCols.length > 0, 'gauge columns still present', `(${gaugeCols.length})`);
  chk(gaugeCols.every(col => !col.querySelector('.bw')),
    'bandwidth removed from gauge column (moved to status badge)');

  // ---- aggregated card ---------------------------------------------------
  // One card only (#109): the separate live "Bandwidth" card was removed --
  // two adjacent cards with different scopes read as a contradiction. This is
  // the range-wide Transferred card, which carries both directions.
  const card = d.getElementById('xfercard');
  chk(!!card, 'aggregated transfer card exists');
  chk(!d.getElementById('bwcard'), 'the duplicate live bandwidth card is gone');
  chk(card && !card.hidden, 'card is visible when there is traffic');

  // It must sit ABOVE the fold with the KPIs, not buried in a tab.
  // User asked for it BEFORE the Est. cost card: 2 = DOCUMENT_POSITION_PRECEDING.
  const kpis = d.getElementById('kpis');
  chk(!!card && !!kpis && !!(kpis.compareDocumentPosition(card) & 2),
    'card sits BEFORE the KPI row (above Est. cost)');
  chk(!!card && !card.closest('.view'),
    'card is outside any single view, so it shows on every tab');

  const tot = d.getElementById('xfertot');
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
  const expUp = rowsAll.reduce((s, r) => s + (+r.up_bytes || 0), 0);
  const gb = expUp / 1073741824, mb = expUp / 1048576;
  const wantUp = gb >= 1 ? gb.toFixed(gb < 10 ? 2 : 1) : mb.toFixed(mb < 10 ? 2 : 1);
  chk(expUp === 0 || totTxt.includes(wantUp),
    'aggregate upload equals the sum of internet rows', `(want ${wantUp})`);

  const note = d.getElementById('xfernote');
  chk(/estimat/i.test(card.textContent),
    'card states the figure is estimated');

  // LAN traffic is tracked separately from metered traffic. Real data showed
  // every live session using BOTH a local and a hosted endpoint, so a session
  // must never be summarised by one bucket alone.
  const anyLan = withBw.some(L => (+L.lan_up_bytes||0) > 0);
  chk(anyLan, 'sample exercises the LAN bucket too');
  const mixed = withBw.filter(L => (+L.up_bytes||0) > 0 && (+L.lan_up_bytes||0) > 0);
  chk(mixed.length > 0, 'sample has a MIXED session (both buckets non-zero)', `(${mixed.length})`);
  // The metered total must exclude LAN bytes, or the card overstates the bill.
  const lanUpTot = rowsAll.reduce((s,r)=>s+(+r.lan_up_bytes||0),0);
  chk(lanUpTot > 0 && !totTxt.includes((( expUp + lanUpTot)/1073741824).toFixed(2)),
    'aggregate upload EXCLUDES LAN bytes', `(lan ${(lanUpTot/1048576).toFixed(1)}MB held out)`);
  const noteTxt = d.getElementById('xfernote').textContent;
  chk(/LAN/.test(noteTxt), 'card discloses LAN traffic separately');
  chk(/not metered/i.test(noteTxt), 'card says LAN is not metered');

  // ---- #71: bandwidth columns in the model and provider tables ------------
  // A derived number rendered beside measured ones must say it is derived, or
  // a reader reasonably assumes the tool counted real bytes.
  for (const [id, label] of [['tbl', 'model table'], ['tblProv', 'provider table']]) {
    const t = d.getElementById(id);
    if (!t) { console.log(`  --   ${label} absent, skipping`); continue; }
    const heads = [...t.querySelectorAll('th')].map(h => h.textContent.trim());
    const up = heads.find(h => /Up/.test(h));
    const down = heads.find(h => /Down/.test(h));
    chk(!!up, `${label} has an upload column`, up);
    chk(!!down, `${label} has a download column`, down);
    chk(!!up && /est/i.test(up), `${label} upload header says "est"`);
    chk(!!down && /est/i.test(down), `${label} download header says "est"`);

    const th = [...t.querySelectorAll('th')].find(h => /Up/.test(h.textContent));
    chk(th && /not measured|Derived/i.test(th.getAttribute('title') || ''),
        `${label} upload column explains it is derived`);

    // Values must be byte-formatted, not raw integers or token counts.
    const idx = heads.findIndex(h => /Up/.test(h));
    const firstRow = t.querySelectorAll('tr')[1];
    if (firstRow && idx >= 0) {
      const cell = firstRow.querySelectorAll('td')[idx];
      const txt = cell ? cell.textContent.trim() : '';
      chk(/^(0|[\d.]+\s*(B|KB|MB|GB|TB))$/.test(txt),
          `${label} upload cell is byte-formatted`, `(${txt})`);
      chk(cell && /bwup/.test(cell.className),
          `${label} upload cell carries the shared up colour`);
    }
  }

  // The colour classes must actually exist in CSS, or the cells render unstyled.
  chk(/\.bwup\{color:/.test(html), '.bwup colour is defined in CSS');
  chk(/\.bwdown\{color:/.test(html), '.bwdown colour is defined in CSS');
  chk(!/var\(--blue\)/.test(html), 'no reference to the undefined --blue var');

  console.log(`\n${f===0?'ALL PASS':'FAILED'}  (${p} passed, ${f} failed)`);
  process.exit(f===0?0:1);
  },1400);
