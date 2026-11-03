// UI pass U-1: one KPI card anatomy on a 12-column grid (equal 138px heights,
// shared baselines), KPI strip + Transferred bar on Home only, sidebar that
// cannot clip. jsdom does no layout, so geometry is asserted on the rules that
// produce it (and on the DOM structure that keeps the baselines shared); the
// measured pixel values were checked in a real browser (see the pass screenshots).
const fs = require('fs'), { JSDOM } = require('jsdom');
const REPORTS = process.env.LLM_TELEMETRY_REPORTS || require('path').join(__dirname, '..', 'examples', 'reports');
const html = fs.readFileSync(REPORTS + '/dashboard.html', 'utf8').replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
let failed = 0, total = 0;
const chk = (c, l, x) => { total++; console.log((c ? '  OK   ' : '  FAIL ') + l + (x ? `  (${x})` : '')); if (!c) failed++; };
const has = re => re.test(html);

function boot(hash, store) {
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'http://127.0.0.1:8477/dashboard.html' + (hash || ''),
    beforeParse(w) {
      w.Chart = function () { return { destroy() {}, update() {}, resize() {} }; };
      w.Chart.defaults = { font: {}, plugins: { legend: {} } };
      w.Chart.getChart = () => null;
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.fetch = () => Promise.reject(new Error('offline'));
      if (store) for (const [k, v] of Object.entries(store)) w.localStorage.setItem(k, v);
    }
  });
}

// ---- rules ---------------------------------------------------------------
chk(has(/\.statgrid\{display:grid;grid-template-columns:repeat\(12,minmax\(0,1fr\)\);gap:8px;grid-auto-rows:138px\}/),
  'both KPI rows share one 12-column grid with 138px rows');
chk(has(/\.statgrid\.live>\.stat\{grid-column:span 3\}/) && has(/\.statgrid\.totals>\.stat\{grid-column:span 2\}/), 'live row = 4 x span 3, totals row = 6 x span 2');
chk(has(/\.stat\{display:grid;grid-template-rows:18px 38px 18px 28px;row-gap:4px;padding:12px 16px/), 'card anatomy is fixed grid tracks (shared baselines)');
chk(has(/\.stat-value\{font:600 28px\/38px/) && has(/\.stat-label\{font:500 13px\/18px/) && has(/\.stat-sub\{font:400 13px\/18px/), 'every text slot is 13px or larger');
chk(has(/\.page:not\(\[data-pageview="Home"\]\) > #kpis\{display:none\}/), 'KPI strip is hidden on every non-Home view');
chk(!has(/\.lkpi|\.grid-kpi|\.kpi-card|\.kpi-ring/), 'the two old card families are gone from the CSS');
// sidebar
chk(has(/--nav-w:240px/), 'nav is 240px wide');
chk(has(/#navdrawer\{[^}]*scrollbar-gutter:stable/), 'expanded sidebar reserves its scrollbar gutter (no item narrows when it scrolls)');
chk(has(/body\.navcollapsed #navdrawer \.nvlabel,\s*body\.navcollapsed #navdrawer \.navbrand \.brandword\{ display:none; \}/), 'collapsed rail removes labels (display:none), not clips them');
chk(has(/\.navitem \.nvlabel\{[^}]*min-width:0;[^}]*overflow-wrap:anywhere/), 'nav labels wrap instead of clipping');
chk(has(/\.navitem \.nvbadge\{[^}]*flex:none/), 'nav badge is never squeezed');
chk(has(/@media \(max-height:820px\)\{ \.navitem\{ min-height:36px; \}/), 'short windows compact the nav so it fits 768px');

// follow-up: shared value baseline, toast below the header, clean collapsed rail
chk(has(/a\.card\.stat\{display:grid\}/), 'the link-card (Active alerts) keeps the grid anatomy: a.card display:block no longer wins');
chk(has(/\.notices\{position:fixed;[^}]*top:calc\(var\(--notices-top,var\(--bar-h,52px\)\) \+ 12px\);right:var\(--pad,16px\)/), 'toast stack is right-aligned to the content edge, 12px under its anchor');
chk(has(/function noticePlace\(\)\{[^]*?pagehead[^]*?getBoundingClientRect\(\)\.bottom[^]*?\+ 12\)/), 'toast stack is placed 12px below the page header (never over its buttons)');
chk(has(/\.toast\{[^}]*box-shadow:0 0 0 1px var\(--border\),0 14px 32px/), 'toast has a 1px border token ring plus elevation shadow');
chk(has(/\.toast-x\{min-height:32px;min-width:32px;[^}]*border:0;box-shadow:none/), 'toast close is a 32px target with no border or shadow bar');
chk(has(/body\.navcollapsed #navdrawer \.navitem::after\{[^}]*position:fixed;/), 'collapsed-rail tooltips are fixed, so they add no scroll width to the 40px items');

// ---- DOM: Home ------------------------------------------------------------
const home = boot('');
setTimeout(() => {
  const d = home.window.document;
  const stats = [...d.querySelectorAll('.stat')];
  chk(d.querySelectorAll('#livekpis > .stat').length === 4 && d.querySelectorAll('#kpis > .stat').length === 6, 'Home has 4 live + 6 total cards');
  chk(stats.every(c => c.children.length === 4 && ['stat-label', 'stat-value', 'stat-sub', 'stat-viz'].every((k, i) => c.children[i].classList.contains(k))),
    'all 10 cards have the same label/value/sub/viz slots in the same order');
  chk(!/In progress/i.test(d.getElementById('kpis').textContent), '"In progress" is folded into the live row, not a 7th card');
  const meters = d.querySelectorAll('#kpis .stat-meter[role="meter"]');
  chk(meters.length === 2, 'bounded percentages are thin meters', meters.length);
  chk(!d.getElementById('unpricedbanner') && !!d.getElementById('notices'), 'banner element replaced by the notices region');
  chk(!d.querySelector('.page > #xfercard') && !!d.querySelector('#bwpanel #xfercard'), 'Transferred is no longer a Home-level bar (U-2): it sits in the Bandwidth panel');
  // sidebar: every item has a name for the icon-only rail
  const items = [...d.querySelectorAll('#navdrawer .navitem')];
  chk(items.length > 5 && items.every(a => (a.getAttribute('aria-label') || '').trim().length > 0), 'every nav item has an aria-label (icon-only rail still has names)', items.length);
  chk(items.every(a => a.querySelector('.nvlabel') && a.querySelector('.nvbadge')), 'label and badge are real elements of every item');
  home.window.close();

  // ---- DOM: non-Home routes ------------------------------------------------
  const use = boot('#/usage');
  setTimeout(() => {
    const u = use.window.document, pg = u.querySelector('.page');
    chk(pg && pg.dataset.pageview !== 'Home', 'on #/usage the page is not in Home mode', pg && pg.dataset.pageview);
    chk(!!u.getElementById('kpis') && !!u.getElementById('xfercard'), 'the strip exists in the DOM (CSS hides it off Home); Transferred lives in Bandwidth');
    use.window.close();
    console.log(`\ncheck_ui_u1.js  ${total - failed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }, 1500);
}, 1500);
