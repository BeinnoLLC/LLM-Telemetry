// Explore strip (LST-178): the former tall landing cards are now a compact
// strip below the live board — icon, title, one headline value, one line of
// blurb. The strip must still be real links (href, rel, focus ring), still
// carry the SAME derived values as before, still collapse to a 2-column
// grid at <=480px, and still offer a >=44px full-card tap target.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(__dirname, '..', 'examples', 'reports');
const fs = require('fs'), { JSDOM } = require('jsdom');

const raw = fs.readFileSync(REPORTS + '/dashboard.html', 'utf8');
const html = raw.replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
const live = JSON.parse(fs.readFileSync(REPORTS + '/live-data.json', 'utf8'));
const analytics = JSON.parse(fs.readFileSync(REPORTS + '/analytics-data.json', 'utf8'));

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://127.0.0.1:8477/dashboard.html',
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
const w = dom.window, d = w.document;
let p = 0, f = 0;
const chk = (ok, l, x) => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${l}${x ? '  ' + x : ''}`); ok ? p++ : f++; };

setTimeout(() => {
  const home = d.querySelector('[data-view="Home"]');
  const strip = d.getElementById('homecards');
  chk(!!home && !!strip, 'Home has the Explore strip container');

  // Placement: the strip must sit BELOW the live board, not before it.
  const livegrid = d.querySelector('.livegrid');
  chk(!!livegrid && !!(strip.compareDocumentPosition(livegrid) & w.Node.DOCUMENT_POSITION_PRECEDING),
    'strip is rendered below the live board');
  chk(home.textContent.includes('Explore'), 'strip is labelled "Explore"');

  const cards = [...strip.querySelectorAll('.homecard')];
  chk(cards.length >= 10, 'strip renders the full card set compactly', `(${cards.length})`);

  // Real links: every card is an <a> with an in-app hash href and
  // rel="noopener noreferrer" (a card that only looks clickable is a
  // dead end for middle-click and open-in-new-tab).
  chk(cards.every(c => c.tagName === 'A' && /^#\//.test(c.getAttribute('href'))),
    'every card is a real <a href="#/..."> link');
  chk(cards.every(c => (c.getAttribute('rel') || '').includes('noopener')
    && (c.getAttribute('rel') || '').includes('noreferrer')),
    'every card ships rel="noopener noreferrer"');
  const views = new Set([...d.querySelectorAll('.view')].map(v => v.dataset.view));
  const bad = cards.filter(c => !views.has(c.dataset.gohome));
  chk(bad.length === 0, 'no card points at a missing view', bad.map(b => b.dataset.gohome).join(',') || 'none');

  // Compact anatomy: icon badge, title, headline value, 1-line blurb.
  const anatomy = cards.filter(c =>
    c.querySelector('.kpi-badge .hc-ico') &&
    c.querySelector('.xp-title') &&
    c.querySelector('.hc-stat') &&
    c.querySelector('.xp-blurb'));
  chk(anatomy.length === cards.length, 'every card has icon + title + value + blurb',
    `(${anatomy.length}/${cards.length})`);
  const empties = cards.filter(c =>
    !c.querySelector('.hc-stat').textContent.trim() ||
    !c.querySelector('.xp-blurb').textContent.trim());
  chk(empties.length === 0, 'no card renders an empty value or blurb');

  // Headline values must come from the same payload the old homecards used
  // (renderHome), not from data baked into the markup. The Usage card's call
  // count is derived from date-scoped rows; assert a real count renders
  // rather than a placeholder.
  const usage = cards.find(c => c.dataset.gohome === 'Usage');
  const usageStat = usage && usage.querySelector('.hc-stat').textContent.trim();
  const payloadCalls = (Object.values(analytics.profiles || {})[0] || {}).rows
    ? Object.values(analytics.profiles)[0].rows.reduce((s, r) => s + (+r.calls || 0), 0) : 0;
  chk(payloadCalls > 0 && /^\d/.test(usageStat || '') && !/^\u2014$/.test(usageStat || ''),
    'Usage card shows a derived call count', `(payload total ${payloadCalls}; card: ${usageStat})`);

  // The bandwidth card's value still uses the shared bw colour classes.
  const bw = cards.find(c => /bandwidth/i.test(c.querySelector('.xp-title') ? c.querySelector('.xp-title').textContent : c.textContent));
  chk(!!bw && !!bw.querySelector('.bwup') && !!bw.querySelector('.bwdown'),
    'bandwidth card keeps .bwup/.bwdown headline value');

  // Keyboard: visible focus ring must be declared, and jsdom must resolve the
  // card to a flex tap target at least 44px tall (Apple HIG / WCAG 2.5.5).
  // Cards carry both classes; the ring is the shared .homecard rule.
  chk(/\.homecard:focus-visible\{outline:2px solid/.test(html),
    'cards declare a visible focus-visible ring');
  const xcard = cards[0];
  let cs = {};
  try { cs = w.getComputedStyle(xcard); } catch (e) { /* no CSSOM view in this jsdom */ }
  chk(cs.minHeight === '44px' || /min-height:44px/.test(html.slice(html.search(/\.xcard\{/, 0))),
    'cards compute to the 44px minimum tap-target height', `(computed: ${cs.minHeight})`);
  chk(cs.display === 'flex' || /\.xcard\{[^}]*display:flex/.test(html),
    'cards lay out as one compact row', `(computed: ${cs.display})`);

  // 480px breakpoint: the built CSS must pin the strip to exactly two
  // columns once the viewport is at or under 480px.
  const mq = /@media\(max-width:480px\)\{[^@]*?\.grid-home\{grid-template-columns:repeat\(2,1fr\)/.exec(html);
  chk(!!mq, 'strip collapses to a 2-column grid at <=480px');
  // And the desktop rule must NOT pin a two-column track (it stays auto-fit).
  const base = /\.grid-home\{[^}]*\}/.exec(html);
  chk(!!base && !/repeat\(2,1fr\)/.test(base[0]),
    '>=481px keeps the auto-fit wrapping strip', base && base[0]);

  // 2 columns on a narrow viewport means smaller cells: the compact paddings
  // and one-line ellipsis keep every card a single tidy row instead of a tall
  // landing card. Blurb must be nowrap + ellipsis (1-line by construction).
  chk(/\.xp-blurb\{[^}]*text-overflow:ellipsis/.test(html),
    'blurb renders as one line (nowrap + ellipsis)');
  chk(/\.xcard\{[^}]*padding:/.test(html), 'compact card padding is defined in CSS');


  // LST-178 polish: no card may be forced to span the full row at <=480px
  // (it strands its neighbour in a half-empty row).
  const mqBody = (/@media\(max-width:480px\)\{[\s\S]*?\n\s*\}\n/.exec(html) || [''])[0];
  const spans = (mqBody.match(/[^{}]*\{[^{}]*grid-column\s*:\s*1\s*\/\s*-1[^{}]*\}/g) || [])
    .map(r => r.trim());
  chk(mqBody.length > 0 && spans.length === 0,
    '<=480px: no card spans both columns', spans.join(' | ') || 'ok');
  // Cards in a row must stay flush: the grid stretches, never start/center.
  const gh = /\.grid-home\{[^}]*\}/.exec(html);
  chk(!!gh && /align-items:stretch/.test(gh[0]) && !/align-items:(start|center|end|baseline)/.test(gh[0]),
    'strip grid uses align-items:stretch', gh && gh[0]);
  chk(!/\.xcard\{[^}]*align-self:/.test(html), 'cards do not self-align out of their row');

  console.log(`\n${f === 0 ? 'ALL PASS' : 'FAILED'}  (${p} passed, ${f} failed)`);
  process.exit(f === 0 ? 0 : 1);
}, 1500);
