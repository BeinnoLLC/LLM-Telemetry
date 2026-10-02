// Router tab (#130): the per-profile model responsibility chart.
// Renders the BUILT sample dashboard and checks that every number and name on
// the tab is derived from router-data.json — the tiers, their pools, the
// category x level matrix, the decision counts and the auth table — and that
// the disabled-router profile falls back to the plain model chain.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(require('os').homedir(), '.local/share/llm-telemetry/reports');
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
    w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(analytics) });
    w.Element.prototype.scrollIntoView = function () {};
  }
});
const w = dom.window, d = w.document;
let p = 0, f = 0;
const chk = (ok, l, x) => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${l}${x ? '  ' + x : ''}`); ok ? p++ : f++; };

// The assertions live in one function so the negative controls below can run
// the SAME checks against a tampered payload and prove they would fail.
function auditSection(sec, prof) {
  const errs = [];
  const tr = prof.tier_router;
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
  // Matrix: every category x level cell shows the routed tier.
  const rows = [...sec.querySelectorAll('.rt-matrix tbody tr')];
  for (const r of rows) {
    const cat = r.querySelector('th').textContent;
    [...r.querySelectorAll('td')].forEach((td, i) => {
      const lvl = router.vocab.levels[i];
      const got = (td.querySelector('.rt-tier') || {}).textContent || '';
      if (got.replace('*', '') !== tr.routes[cat][lvl]) errs.push(`matrix ${cat}/${lvl} ${got} != ${tr.routes[cat][lvl]}`);
    });
  }
  if (rows.length !== router.vocab.categories.length) errs.push(`matrix rows ${rows.length}`);
  // Auth table: one row per provider slot, badge matches the collected type.
  const label = { oauth: 'OAuth', api_key: 'API key', mixed: 'OAuth + key', none: 'No auth', unknown: 'No credential' };
  for (const [slot, a] of Object.entries(prof.auth)) {
    const row = sec.querySelector(`.rt-authtbl tr[data-slot="${slot}"]`);
    if (!row) { errs.push(`no auth row for ${slot}`); continue; }
    const badge = row.querySelector('.rt-auth').textContent;
    if (badge !== label[a.type]) errs.push(`${slot} auth ${badge} != ${label[a.type]}`);
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
  const names = secs.map(s => s.dataset.profile);
  if (allMode) {
    chk(names.sort().join(',') === Object.keys(router.profiles).sort().join(','),
      'All renders one section per profile', names.join(','));
  }
  // The in-tab switcher lists EVERY profile, marked router on/off, and
  // clicking one switches the dashboard to it.
  const jumps = [...d.querySelectorAll('.rt-jump a')];
  chk(jumps.map(a => a.dataset.rtjump).sort().join(',') === Object.keys(router.profiles).sort().join(','),
    'profile switcher lists every profile', jumps.map(a => a.dataset.rtjump).join(','));
  const pj = jumps.find(a => a.dataset.rtjump === 'personal');
  chk(pj && !!pj.querySelector('.rt-dot.rt-mute'), 'router-off profile is marked off in the switcher');
  pj.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  chk(!!d.querySelector('.rt-profile[data-profile="personal"]') && d.querySelectorAll('.rt-profile').length === 1,
    'clicking a profile in the switcher shows that profile');
  chk(!!d.querySelector('.rt-jump a[data-rtjump="personal"][aria-current]'), 'active profile is highlighted');

  const work = router.profiles.work;
  chk(work.tier_router && work.tier_router.enabled, 'fixture: work has the router on');
  w.pick('work');
  let sec = d.querySelector('.rt-profile[data-profile="work"]');
  chk(d.querySelectorAll('.rt-profile').length === 1 && !!sec, 'picking a profile narrows the tab to it');
  const errs = auditSection(sec, work);
  chk(errs.length === 0, 'chart, matrix, shares and auth all match router-data.json', errs.slice(0, 3).join('; '));

  // The org chart: primary on top, then the classifier, then the tiers.
  const org = sec.querySelector('.rt-org');
  chk(org && org.querySelector('.rt-primary .rt-mname').textContent === work.primary.model,
    'primary model heads the chart', work.primary.model);
  const clsNames = [...org.querySelectorAll('.rt-classifier .rt-mname')].map(e => e.textContent);
  chk(clsNames.join('|') === work.tier_router.classifier.pool.map(e => e.model).join('|'),
    'classifier node lists its pool');
  const dflt = sec.querySelector(`.rt-tcard[data-tier="${work.tier_router.default_tier}"] .rt-default`);
  chk(!!dflt, 'default tier is marked');
  chk(sec.querySelectorAll('.rt-strip .rt-step').length === 6, 'flow strip shows the six routing steps');
  chk(!!sec.querySelector('.rt-matrix sup'), 'config-overridden route is starred (plan/easy)');

  // Escalation ladder: a tier with escalate_to names its target.
  const esc = work.tier_router.tiers.find(t => t.escalate_to);
  const escTxt = sec.querySelector(`.rt-tcard[data-tier="${esc.name}"] .rt-foot`).textContent;
  chk(escTxt.includes(esc.escalate_to), `${esc.name} shows escalation to ${esc.escalate_to}`);

  // Decisions: KPIs and the recent list come from the agent log aggregation.
  const kpis = [...sec.querySelectorAll('.rt-kpi b')].map(b => +b.textContent);
  chk(kpis[0] === work.decisions.total && kpis[1] === work.decisions.escalations,
    'decision KPIs match the payload', kpis.join(','));
  chk(sec.querySelectorAll('.rt-recent tbody tr').length === work.decisions.recent.length,
    'recent decisions list every collected row');

  // Logos: brand SVG where Simple Icons has one, monogram otherwise.
  chk(!!sec.querySelector('.rt-logo[title="Anthropic"] svg path'), 'Anthropic renders its inline SVG mark');
  chk(!!sec.querySelector('.rt-logo[title="OpenCode Go"] svg'), 'OpenCode renders its inline SVG mark');
  chk(!sec.querySelector('img.rt-logo-img') && !/cdn\.simpleicons/.test(sec.innerHTML),
    'no logo is fetched from a CDN (works offline)');

  // Background workers include delegation.
  const workers = [...sec.querySelectorAll('.rt-worker .rt-role')].map(e => e.textContent);
  chk(workers.includes('delegation') && workers.includes('compression'), 'workers list aux tasks + delegation', workers.join(','));

  // Secrets: nothing token-shaped, and the masked email stays masked.
  const txt = d.querySelector('#routerview').innerHTML;
  chk(!/FAKEFAKE|sk-ant-|f1ngerpr1nt|dev@example\.com/.test(txt), 'no secret or raw email reaches the DOM');
  chk(/d•••@example\.com/.test(txt), 'OAuth account shown masked');

  // Disabled router: the plain chain, with auth, and no tier chart.
  w.pick('personal');
  sec = d.querySelector('.rt-profile[data-profile="personal"]');
  const pers = router.profiles.personal;
  chk(sec && !sec.querySelector('.rt-tcard'), 'router-off profile has no tier chart');
  const hops = [...sec.querySelectorAll('.rt-chain .rt-mname')].map(e => e.textContent);
  chk(hops.join('|') === [pers.primary, ...pers.chain].map(e => e.model).join('|'),
    'router-off profile shows primary → fallback chain', hops.join(' → '));
  chk(/router off/.test(sec.querySelector('.rt-phead').textContent), 'router-off is labelled');
  chk(!!sec.querySelector('.rt-authtbl tr[data-slot="nous"] .rt-bad'),
    'a slot with no credential is flagged red');

  // Collapsible sections: every card and the profile itself are <details>,
  // open by default, and a fold survives a re-render (persisted per profile).
  w.pick('work');
  sec = d.querySelector('.rt-profile[data-profile="work"]');
  const folds = [...sec.querySelectorAll('details.rt-card')];
  chk(sec.tagName === 'DETAILS' && sec.open, 'profile section is collapsible and starts open');
  chk(folds.length === 6 && folds.every(x => x.open), 'all six work cards are collapsible and start open', `(${folds.length})`);
  const authCard = sec.querySelector('details[data-rtfold="work|auth"]');
  authCard.open = false; authCard.dispatchEvent(new w.Event('toggle'));
  w.pick('work');
  chk(!d.querySelector('details[data-rtfold="work|auth"]').open, 'a folded card stays folded after re-render');
  w.pick('personal');
  chk(d.querySelector('details[data-rtfold="personal|auth"]').open, 'folding is per profile');
  w.pick('work');
  d.querySelector('.rt-profile[data-profile="work"] [data-rtall="close"]').click();
  chk([...d.querySelectorAll('.rt-profile[data-profile="work"] details.rt-card')].every(x => !x.open),
    'collapse all folds every card');
  chk(d.querySelector('.rt-profile[data-profile="work"]').open, '...without folding the profile itself');
  d.querySelector('.rt-profile[data-profile="work"] [data-rtall="open"]').click();
  chk([...d.querySelectorAll('.rt-profile[data-profile="work"] details.rt-card')].every(x => x.open),
    'expand all reopens them');

  // Home card.
  w.pickView('Home');
  const home = d.querySelector('.homecard[data-gohome="Router"]');
  chk(!!home, 'Home has a Router card');

  // ---- Negative controls: the same audit must FAIL on a tampered payload. ----
  w.pick('work'); w.pickView('Router');
  sec = d.querySelector('.rt-profile[data-profile="work"]');
  const bad1 = JSON.parse(JSON.stringify(work));
  bad1.tier_router.tiers[0].pool.push({ model: 'ghost-model', provider: 'x', prov: 'x' });
  chk(auditSection(sec, bad1).length > 0, 'control: an extra pool model is caught');
  const bad2 = JSON.parse(JSON.stringify(work));
  bad2.tier_router.routes.coding.hard = 'trivial';
  chk(auditSection(sec, bad2).length > 0, 'control: a wrong matrix cell is caught');
  const bad3 = JSON.parse(JSON.stringify(work));
  bad3.auth.anthropic.type = 'unknown';
  chk(auditSection(sec, bad3).length > 0, 'control: a wrong auth badge is caught');
  const bad4 = JSON.parse(JSON.stringify(work));
  bad4.decisions.by_tier.trivial += 7;
  chk(auditSection(sec, bad4).length > 0, 'control: a wrong decision share is caught');

  console.log(`\ncheck_router_view.js  ${p} passed, ${f} failed`);
  process.exit(f === 0 ? 0 : 1);
}, 1500);
