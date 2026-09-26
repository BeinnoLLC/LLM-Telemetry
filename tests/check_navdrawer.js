// Left nav drawer (#3). The rail is the primary section nav: it must list
// every view, mark the current one, route on click, and carry live counts.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(require('os').homedir(), '.local/share/llm-telemetry/reports');
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

let p = 0, f = 0;
const chk = (ok, l, x) => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${l}${x ? '  ' + x : ''}`); ok ? p++ : f++; };

setTimeout(() => {
  const w = dom.window, d = w.document;
  const rail = d.getElementById('navdrawer');
  chk(!!rail, 'nav drawer exists');

  // The rail is position:fixed, so it must be a direct body child — any
  // transformed ancestor would trap it. The file already documents this trap
  // for the logs drawer; the same applies here.
  chk(rail && rail.parentElement === d.body, 'rail is a direct child of body (fixed-position trap)');
  chk(rail && rail.getAttribute('aria-label') === 'Sections', 'rail is a labelled landmark');

  // Every view gets an entry, or the rail is not a complete nav.
  const views = [...d.querySelectorAll('.view')].map(v => v.dataset.view);
  const items = [...d.querySelectorAll('[data-nav]')].map(a => a.dataset.nav);
  chk(items.length === views.length, 'one rail item per view',
    `(${items.length}/${views.length}: ${items.join(',')})`);
  chk(views.every(v => items.includes(v)), 'no view is missing from the rail');

  // Items are real links so middle-click / copy-link behave.
  const first = d.querySelector('[data-nav]');
  chk(first && first.tagName === 'A' && /^#\//.test(first.getAttribute('href')),
    'rail items are anchors with hash hrefs', first && first.getAttribute('href'));

  // Exactly one active item, and it matches the visible view.
  const visible = [...d.querySelectorAll('.view')].filter(v => !v.hidden).map(v => v.dataset.view);
  const active = [...d.querySelectorAll('[data-nav][aria-current="page"]')].map(a => a.dataset.nav);
  chk(active.length === 1, 'exactly one item marked current', `(${active.length})`);
  chk(active[0] === visible[0], 'active item matches the visible view',
    `(rail=${active[0]} view=${visible[0]})`);

  // Clicking routes and moves the highlight. Guard the lookup: with the rail
  // unrendered this is null, and dereferencing it would crash the run instead
  // of reporting a clean failure.
  const cost = d.querySelector('[data-nav="Cost"]');
  chk(!!cost, 'rail has a Cost item to click');
  if (!cost) { console.log(`\nFAILED  (${p} passed, ${f} failed)`); process.exit(1); }
  cost.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  const nowVisible = [...d.querySelectorAll('.view')].filter(v => !v.hidden).map(v => v.dataset.view);
  chk(nowVisible.includes('Cost'), 'clicking a rail item switches the view', `(${nowVisible.join(',')})`);
  chk(cost.getAttribute('aria-current') === 'page', 'clicked item becomes current');
  chk(d.querySelectorAll('[data-nav][aria-current="page"]').length === 1,
    'still exactly one item current after navigating');
  chk(/#\/cost$/.test(w.location.hash), 'rail click updates the hash', `(${w.location.hash})`);

  // Badges: present for Live, and hidden rather than showing a zero.
  const liveBadge = d.querySelector('[data-navbadge="Live"]');
  chk(!!liveBadge, 'Live item carries a badge element');
  const n = (analytics.profiles[Object.keys(analytics.profiles)[0]].live || []).length;
  if (liveBadge) {
    chk(liveBadge.hidden === (Number(liveBadge.textContent) === 0),
      'badge is hidden exactly when the count is zero',
      `(text=${liveBadge.textContent} hidden=${liveBadge.hidden})`);
  }

  // Secondary entries complete the nav.
  chk(!!d.querySelector('#navdrawer a[href="costs.html"]'), 'rail links to the price sheet');
  chk(!!d.getElementById('navlogs'), 'rail has a Logs entry');

  console.log(`\n${f === 0 ? 'ALL PASS' : 'FAILED'}  (${p} passed, ${f} failed)`);
  process.exit(f === 0 ? 0 : 1);
}, 1600);