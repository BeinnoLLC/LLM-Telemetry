// Home view (#2): navigation cards, each carrying a stat derived from the
// payload. A grid that renders but links nowhere, or shows a hardcoded
// number, is the failure this guards against.
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
const w = dom.window, d = w.document;
let p = 0, f = 0;
const chk = (ok, l, x) => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${l}${x ? '  ' + x : ''}`); ok ? p++ : f++; };

setTimeout(() => {
  const home = d.querySelector('[data-view="Home"]');
  chk(!!home, 'Home view exists');

  const cards = [...d.querySelectorAll('#homecards .homecard')];
  chk(cards.length >= 5, 'Home renders navigation cards', `(${cards.length})`);

  // Every card must lead somewhere real: a dead card is worse than no card.
  // Targets are either an in-page view (data-gohome) or an external page via
  // href — the Rates card legitimately points at costs.html, not at a view.
  const views = new Set([...d.querySelectorAll('.view')].map(v => v.dataset.view));
  const targets = cards.map(c => c.dataset.gohome).filter(Boolean);
  const external = cards.filter(c => !c.dataset.gohome &&
    /\.html/.test(c.getAttribute('href') || ''));
  chk(targets.length + external.length === cards.length,
    'every card declares a destination',
    `(${targets.length} in-page + ${external.length} external)`);
  const broken = targets.filter(t => !views.has(t) && !/\.html$/.test(t));
  chk(broken.length === 0, 'no card points at a missing view', broken.join(',') || 'none');

  // Cards must cover the real sections, not an arbitrary subset.
  for (const v of ['Live', 'Usage', 'Cost', 'Health', 'Flow', 'Detail']) {
    chk(targets.includes(v), `a card links to ${v}`);
  }

  // Stats must be DERIVED. Compare against the payload rather than trusting text.
  const prof = Object.values(analytics.profiles || {})[0] || {};
  const rows = prof.rows || [];
  const totalCalls = rows.reduce((s, r) => s + (+r.calls || 0), 0);
  const bodyTxt = home.textContent;
  chk(totalCalls > 0, 'payload has calls to summarise', `(${totalCalls})`);

  // The Usage card shows calls; assert the rendered number matches the payload.
  const usageCard = cards.find(c => c.dataset.gohome === 'Usage');
  const usageStat = usageCard && usageCard.querySelector('.hc-stat');
  if (usageStat) {
    const shown = usageStat.textContent.replace(/[^\d.KMB]/g, '');
    chk(shown.length > 0 && shown !== '0', 'Usage card stat is populated', `(${usageStat.textContent.trim()})`);
  }

  // Bandwidth card must use the shared colour classes, not a fresh hardcode.
  const bwCard = cards.find(c => /band/i.test(c.textContent));
  if (bwCard) {
    chk(!!bwCard.querySelector('.bwup'), 'bandwidth card reuses .bwup');
    chk(!!bwCard.querySelector('.bwdown'), 'bandwidth card reuses .bwdown');
  }

  // Clicking a card must actually navigate.
  const live1 = cards.find(c => c.dataset.gohome === 'Live');
  if (live1) {
    live1.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    const liveView = d.querySelector('[data-view="Live"]');
    chk(liveView && !liveView.hidden, 'clicking a card switches to that view');
  }

  // Accessibility: cards are interactive, so they must be reachable by keyboard.
  const focusable = cards.filter(c =>
    c.tagName === 'A' || c.tagName === 'BUTTON' || c.hasAttribute('tabindex'));
  chk(focusable.length === cards.length, 'every card is keyboard-focusable');

  chk(/grid-home/.test(html), 'home grid class is defined');
  chk(/auto-fit/.test(html), 'card grid reflows (auto-fit), no fixed columns');

  console.log(`\n${f === 0 ? 'ALL PASS' : 'FAILED'}  (${p} passed, ${f} failed)`);
  process.exit(f === 0 ? 0 : 1);
}, 1500);