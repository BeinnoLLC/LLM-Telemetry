// Router tab (#130): the per-profile model responsibility chart.
// Renders the BUILT sample dashboard and checks that every number and name on
// the tab is derived from router-data.json — the tiers, their pools, the
// category x level matrix, the decision counts and the auth table — and that
// the disabled-router profile falls back to the plain model chain.
//
// The tab is split into sub-pages (#130), so the checks drive the page strip and
// one of them asserts the pages PARTITION the content rather than quietly
// dropping it. The fetch stub serves payloads BY URL: a stub that answers every
// request with analytics-data.json is what once let the Router tab blank on
// refresh with no suite noticing (see check_router_refresh.js).
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(__dirname, '..', 'examples', 'reports');
const fs = require('fs'), { JSDOM } = require('jsdom');

const raw = fs.readFileSync(REPORTS + '/dashboard.html', 'utf8');
const html = raw.replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
const router = JSON.parse(fs.readFileSync(REPORTS + '/router-data.json', 'utf8'));
const analytics = JSON.parse(fs.readFileSync(REPORTS + '/analytics-data.json', 'utf8'));

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://127.0.0.1:8477/dashboard.html#/router',
  beforeParse(w) {
    w.Chart = function () { return { destroy() {}, update() {} }; };
    w.Chart.defaults = { color: '', borderColor: '', font: {} };
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.fetch = (url) => {
      const key = String(url).split('?')[0].split('/').pop();
      const body = key === 'router-data.json' ? router : analytics;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    };
    w.Element.prototype.scrollIntoView = function () {};
  }
});
const w = dom.window, d = w.document;
let p = 0, f = 0;
const chk = (ok, l, x) => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${l}${x ? '  ' + x : ''}`); ok ? p++ : f++; };

// The page strip, driven the way a reader drives it.
const PAGES = ['overview', 'matrix', 'decisions', 'workers', 'providers'];
function goPage(id) {
  const btn = d.querySelector(`.rt-pages [data-rtpage="${id}"]`);
  if (!btn) return false;
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
}
function secOf(name) { return d.querySelector(`.rt-profile[data-profile="${name}"]`); }
function cardIds(name) {
  return [...secOf(name).querySelectorAll('details.rt-card')].map(x => x.dataset.rtfold.split('|')[1]);
}

// The assertions live in one function so the negative controls below can run
// the SAME checks against a tampered payload and prove they would fail.
// `what` names the page the caller has navigated to, so each check reads only
// the cards that page is responsible for.
function auditSection(sec, prof, what) {
  const errs = [];
  const tr = prof.tier_router;
  if (what === 'overview') {
    const cards = [...sec.querySelectorAll('.rt-tcard')];
    if (cards.length !== tr.tiers.length) errs.push(`tier cards ${cards.length} != ${tr.tiers.length}`);
    for (const t of tr.tiers) {
      const c = sec.querySelector(`.rt-tcard[data-tier="${t.name}"]`);
      if (!c) { errs.push(`no card for ${t.name}`); continue; }
      const names = [...c.querySelectorAll(':scope > .rt-models .rt-mname')].map(e => e.textContent);
      const want = t.pool.map(e => e.model);
      if (names.join('|') !== want.join('|')) errs.push(`${t.name} pool ${names} != ${want}`);
      const whys = [...c.querySelectorAll('.rt-why')].map(e => e.textContent.replace(/\s/g, ''));
      const wantWhy = t.why.map(x => `${x.category}·${x.level}`);
      if (whys.join('|') !== wantWhy.join('|')) errs.push(`${t.name} why ${whys} != ${wantWhy}`);
      const n = (prof.decisions.by_tier || {})[t.name] || 0;
      const pct = prof.decisions.total ? Math.round(100 * n / prof.decisions.total) : 0;
      const share = c.querySelector('.rt-share').textContent;
      if (share !== (n ? `${pct}%` : '0')) errs.push(`${t.name} share ${share} != ${pct}%`);
    }
  }
  if (what === 'matrix') {
    // Every category x level cell shows the routed tier.
    const rows = [...sec.querySelectorAll('.rt-matrix tbody tr')];
    if (rows.length !== router.vocab.categories.length) errs.push(`matrix rows ${rows.length}`);
    for (const r of rows) {
      const cat = r.querySelector('th').textContent;
      [...r.querySelectorAll('td')].forEach((td, i) => {
        const lvl = router.vocab.levels[i];
        const got = (td.querySelector('.rt-tier') || {}).textContent || '';
        if (got.replace('*', '') !== tr.routes[cat][lvl]) errs.push(`matrix ${cat}/${lvl} ${got} != ${tr.routes[cat][lvl]}`);
      });
    }
  }
  if (what === 'providers') {
    // Auth table: one row per provider slot, badge matches the collected type.
    const label = { oauth: 'OAuth', api_key: 'API key', mixed: 'OAuth + key', none: 'No auth', unknown: 'No credential' };
    for (const [slot, a] of Object.entries(prof.auth)) {
      const row = sec.querySelector(`.rt-authtbl tr[data-slot="${slot}"]`);
      if (!row) { errs.push(`no auth row for ${slot}`); continue; }
      const badge = row.querySelector('.rt-auth').textContent;
      if (badge !== label[a.type]) errs.push(`${slot} auth ${badge} != ${label[a.type]}`);
    }
  }
  return errs;
}

setTimeout(() => {
  const view = d.querySelector('[data-view="Router"]');
  chk(view && !view.hidden, '#/router opens the Router view');
  chk(!!d.querySelector('.navitem[href="#/router"], [data-nav="Router"], a[href="#/router"]'),
    'the nav rail links to the Router tab');

  // Whatever profile the page starts on, "All" must show every profile.
  const allMode = 'All' in analytics.profiles;
  if (allMode) w.pick('All');
  const secs = [...d.querySelectorAll('.rt-profile')];
  if (allMode) {
    chk(secs.map(s => s.dataset.profile).sort().join(',') === Object.keys(router.profiles).sort().join(','),
      'All renders one section per profile', secs.map(s => s.dataset.profile).join(','));
  }

  // ---- the page strip ------------------------------------------------------
  const strip = [...d.querySelectorAll('.rt-pages [data-rtpage]')];
  chk(strip.length === 5, 'the tab has five sub-pages', `(${strip.length})`);
  chk(!d.querySelector('.rt-jump'),
    'no profile switcher mid-page — the header chip strip already switches profile');
  chk(!!d.querySelector('.rt-pages [data-rtpage="overview"][aria-current="page"]'),
    'the opening sub-page is marked as current');
  chk(!goPage('nope-nope'), 'an unknown sub-page id is refused');

  // Each page shows its own cards and only its own: the split must partition
  // the content, not hide half of it on a page nobody can reach.
  w.pick('work');
  const perPage = { overview: ['flow', 'chart'], matrix: ['matrix'], decisions: ['decisions'],
                    workers: ['workers'], providers: ['auth'] };
  for (const id of PAGES) {
    goPage(id);
    chk(cardIds('work').join(',') === perPage[id].join(','),
      `the ${id} page shows exactly its own cards`, cardIds('work').join(','));
  }
  const every = new Set(PAGES.flatMap(id => { goPage(id); return cardIds('work'); }));
  chk(every.size === 6, 'the five pages together cover all six cards', [...every].join(','));

  goPage('overview');
  const work = router.profiles.work;
  chk(work.tier_router && work.tier_router.enabled, 'fixture: work has the router on');
  w.pick('work');
  chk(d.querySelectorAll('.rt-profile').length === 1 && !!secOf('work'), 'picking a profile narrows the tab to it');
  let errs = auditSection(secOf('work'), work, 'overview');
  chk(errs.length === 0, 'the responsibility chart matches router-data.json', errs.slice(0, 3).join('; '));

  // The org chart: primary on top, then the classifier, then the tiers.
  const org = secOf('work').querySelector('.rt-org');
  chk(org && org.querySelector('.rt-primary .rt-mname').textContent === work.primary.model,
    'primary model heads the chart', work.primary.model);
  chk([...org.querySelectorAll('.rt-classifier .rt-mname')].map(e => e.textContent).join('|')
      === work.tier_router.classifier.pool.map(e => e.model).join('|'),
    'classifier node lists its pool');
  chk(!!secOf('work').querySelector(`.rt-tcard[data-tier="${work.tier_router.default_tier}"] .rt-default`),
    'default tier is marked');
  chk(secOf('work').querySelectorAll('.rt-strip .rt-step').length === 6, 'flow strip shows the six routing steps');

  // Escalation ladder: a tier with escalate_to names its target.
  const esc = work.tier_router.tiers.find(t => t.escalate_to);
  chk(secOf('work').querySelector(`.rt-tcard[data-tier="${esc.name}"] .rt-foot`).textContent.includes(esc.escalate_to),
    `${esc.name} shows escalation to ${esc.escalate_to}`);

  // Matrix page: every cell, and the config override starred.
  goPage('matrix');
  errs = auditSection(secOf('work'), work, 'matrix');
  chk(errs.length === 0, 'every matrix cell matches the routed tier', errs.slice(0, 3).join('; '));
  chk(!!secOf('work').querySelector('.rt-matrix sup'), 'config-overridden route is starred (plan/easy)');

  // Decisions page: KPIs and the recent list come from the agent log.
  goPage('decisions');
  const kpis = [...secOf('work').querySelectorAll('.rt-kpi b')].map(b => +b.textContent);
  chk(kpis[0] === work.decisions.total && kpis[1] === work.decisions.escalations,
    'decision KPIs match the payload', kpis.join(','));
  chk(secOf('work').querySelectorAll('.rt-recent tbody tr').length === work.decisions.recent.length,
    'recent decisions list every collected row');

  // Workers page: background tasks include delegation.
  goPage('workers');
  const workers = [...secOf('work').querySelectorAll('.rt-worker .rt-role')].map(e => e.textContent);
  chk(workers.includes('delegation') && workers.includes('compression'), 'workers list aux tasks + delegation', workers.join(','));

  // Providers page: logos render inline, and nothing sensitive reaches the DOM.
  goPage('providers');
  chk(!!secOf('work').querySelector('.rt-logo[title="Anthropic"] svg path'), 'Anthropic renders its inline SVG mark');
  chk(!!secOf('work').querySelector('.rt-logo[title="OpenCode Go"] svg'), 'OpenCode renders its inline SVG mark');
  chk(!secOf('work').querySelector('img.rt-logo-img') && !/cdn\.simpleicons/.test(d.querySelector('#routerview').innerHTML),
    'no logo is fetched from a CDN (works offline)');
  errs = auditSection(secOf('work'), work, 'providers');
  chk(errs.length === 0, 'every auth row matches the collected credential type', errs.slice(0, 3).join('; '));
  const txt = d.querySelector('#routerview').innerHTML;
  chk(!/FAKEFAKE|sk-ant-|f1ngerpr1nt|dev@example\.com/.test(txt), 'no secret or raw email reaches the DOM');
  chk(/d•••@example\.com/.test(txt), 'OAuth account shown masked');

  // Disabled router: the plain chain, with auth, and no tier chart.
  w.pick('personal');
  goPage('overview');
  const pers = router.profiles.personal;
  chk(secOf('personal') && !secOf('personal').querySelector('.rt-tcard'), 'router-off profile has no tier chart');
  chk([...secOf('personal').querySelectorAll('.rt-chain .rt-mname')].map(e => e.textContent).join('|')
      === [pers.primary, ...pers.chain].map(e => e.model).join('|'),
    'router-off profile shows primary → fallback chain');
  chk(/router off/.test(secOf('personal').querySelector('.rt-phead').textContent), 'router-off is labelled');
  // ...and the pages it has no data for say so, rather than showing an empty grid.
  goPage('matrix');
  chk(!!secOf('personal').querySelector('.rt-chain') && !secOf('personal').querySelector('.rt-matrix'),
    'a router-off profile gets its chain on the matrix page, not an empty grid');
  goPage('providers');
  chk(!!secOf('personal').querySelector('.rt-authtbl tr[data-slot="nous"] .rt-bad'),
    'a slot with no credential is flagged red');

  // ---- collapsible sections ----------------------------------------------
  w.pick('work');
  goPage('providers');
  const sec = secOf('work');
  chk(sec.tagName === 'DETAILS' && sec.open, 'profile section is collapsible and starts open');
  const folds = [...sec.querySelectorAll('details.rt-card')];
  chk(folds.length === 1 && folds.every(x => x.open), 'the page card is collapsible and starts open', `(${folds.length})`);
  const authCard = sec.querySelector('details[data-rtfold="work|auth"]');
  authCard.open = false; authCard.dispatchEvent(new w.Event('toggle'));
  w.pick('work');
  chk(!d.querySelector('details[data-rtfold="work|auth"]').open, 'a folded card stays folded after re-render');
  w.pick('personal');
  chk(d.querySelector('details[data-rtfold="personal|auth"]').open, 'folding is per profile');
  w.pick('work');
  d.querySelector('.rt-profile[data-profile="work"] [data-rtall="close"]').click();
  chk(cardIds('work').length && [...secOf('work').querySelectorAll('details.rt-card')].every(x => !x.open),
    'collapse all folds every card');
  chk(secOf('work').open, '...without folding the profile itself');
  d.querySelector('.rt-profile[data-profile="work"] [data-rtall="open"]').click();
  chk([...secOf('work').querySelectorAll('details.rt-card')].every(x => x.open), 'expand all reopens them');

  // The chosen page is per browser, and survives a re-render.
  goPage('decisions');
  w.pick('work');
  chk(!!d.querySelector('.rt-pages [data-rtpage="decisions"][aria-current="page"]'),
    'the chosen sub-page persists across a re-render');
  goPage('overview');

  // Home card.
  w.pickView('Home');
  chk(!!d.querySelector('.homecard[data-gohome="Router"]'), 'Home has a Router card');

  // ---- Negative controls: the same audit must FAIL on a tampered payload. ----
  w.pick('work'); w.pickView('Router'); goPage('overview');
  const bad1 = JSON.parse(JSON.stringify(work));
  bad1.tier_router.tiers[0].pool.push({ model: 'ghost-model', provider: 'x', prov: 'x' });
  chk(auditSection(secOf('work'), bad1, 'overview').length > 0, 'control: an extra pool model is caught');
  goPage('matrix');
  const bad2 = JSON.parse(JSON.stringify(work));
  bad2.tier_router.routes.coding.hard = 'trivial';
  chk(auditSection(secOf('work'), bad2, 'matrix').length > 0, 'control: a wrong matrix cell is caught');
  goPage('providers');
  const bad3 = JSON.parse(JSON.stringify(work));
  bad3.auth.anthropic.type = 'unknown';
  chk(auditSection(secOf('work'), bad3, 'providers').length > 0, 'control: a wrong auth badge is caught');
  goPage('overview');
  const bad4 = JSON.parse(JSON.stringify(work));
  bad4.decisions.by_tier.trivial += 7;
  chk(auditSection(secOf('work'), bad4, 'overview').length > 0, 'control: a wrong decision share is caught');

  console.log(`\ncheck_router_view.js  ${p} passed, ${f} failed`);
  process.exit(f === 0 ? 0 : 1);
}, 1500);
