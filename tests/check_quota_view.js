// Quota tab (#115): per-profile provider headroom.
// Renders the BUILT sample dashboard and checks that every number on the tab
// comes from quota-data.json — the usage windows, the worst-fill figure, the
// account balances and the provider notes — and that every level colour is the
// COLLECTOR's threshold, not one restated here.
//
// Three things this file is careful about, all learned the hard way here:
//
//  1. The expected level is computed by calling the VIEW'S OWN qvLevel/qvPct off
//     the booted page (win.eval), never by a second copy of the rules here. A
//     copy would drift, and then this suite would happily assert the old rule.
//  2. The checks are SPLIT BY PAGE, because driving the page strip re-renders
//     the view. A control that corrupts the DOM and then calls the whole audit
//     finds the corruption already overwritten, and reports "nothing broke" —
//     which is how a broken negative control looks exactly like a passing one.
//  3. Each control names the specific failure it must produce. "Something broke"
//     is not evidence that the check under test can fail.
//
// The fetch stub serves payloads BY URL: a stub that answers every request with
// the same payload is what once let the Router tab blank on refresh with no suite
// noticing (see check_router_refresh.js).
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(__dirname, '..', 'examples', 'reports');
const fs = require('fs'), { JSDOM } = require('jsdom');

const html = fs.readFileSync(REPORTS + '/dashboard.html', 'utf8')
  .replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
const quota = JSON.parse(fs.readFileSync(REPORTS + '/quota-data.json', 'utf8'));
const analytics = JSON.parse(fs.readFileSync(REPORTS + '/analytics-data.json', 'utf8'));

// The BUILT page carries its payload EMBEDDED as `let DATA = {...}`, and the
// view reads DATA.quota — not fetch. So a fetch stub proves nothing here: it is
// the refresh path, not the render path. Every boot therefore REWRITES the
// embedded DATA for the quota keys and lets the page render itself from that.
// (Passing a payload to fetch() here was a false pass — the tamper was ignored
// and the audit happily re-read the original numbers.)
const DATA_RE = /let DATA = (\{[\s\S]*?\});/;

function boot(quotaPayload) {
  let page = html;
  if (quotaPayload) {
    // Swap the quota slice only; everything else in DATA stays as built.
    const src = DATA_RE.exec(page);
    if (!src) throw new Error('the built page has no embedded DATA literal to patch');
    const data = JSON.parse(src[1]);
    const next = quotaPayload.profiles || {};
    page = page.replace(DATA_RE, `let DATA = ${JSON.stringify({
      ...data, quota: next, quota_meta: {
        collected_at: quotaPayload.collected_at,
        attention_percent: quotaPayload.attention_percent,
        summary: quotaPayload.summary
      }
    })};`);
  }
  return new JSDOM(page, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'http://127.0.0.1:8477/dashboard.html#/quota',
    beforeParse(w) {
      w.Chart = function () { return { destroy() {}, update() {} }; };
      // font must be PRE-SHAPED: the page assigns Chart.defaults.font.size at
      // boot, and a bare {} throws inside the analytics block — which kills the
      // render and makes every unrelated check fail.
      w.Chart.defaults = { color: '', borderColor: '', font: { size: 11, family: 'sans-serif', weight: 'normal' } };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      // jsdom declares localStorage as a prototype getter, so a plain assignment
      // is silently ignored — a seeded boot would read empty storage.
      const store = {};
      Object.defineProperty(w, 'localStorage', {
        value: {
          getItem: k => (k in store ? store[k] : null),
          setItem: (k, v) => { store[k] = String(v); },
          removeItem: k => { delete store[k]; },
          clear: () => { for (const k of Object.keys(store)) delete store[k]; }
        }, configurable: true, writable: true
      });
      w.fetch = (url) => {
        const key = String(url).split('?')[0].split('/').pop();
        const body = key === 'quota-data.json' ? quotaPayload : analytics;
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
      };
      w.Element.prototype.scrollIntoView = function () {};
    }
  });
}

const PAGES = ['headroom', 'balances', 'notes'];

function goPage(doc, win, id) {
  const btn = doc.querySelector(`.rt-pages [data-qvpage="${id}"]`);
  if (!btn) return false;
  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
}
const provs = (doc) => [...doc.querySelectorAll('.qv-prov')];
// A card carries its own provider id; the fold keys around it are profile|section.
const provId = (card) => card.dataset.provider;
const viewText = (doc) => doc.getElementById('quotaview').textContent;
const cardOf = (doc, id) => provs(doc).find(c => provId(c) === id);
const has = (elm, cls) => !!elm && new RegExp('(^|\\s)' + cls + '(\\s|$)').test(elm.className);

// jsdom 30 dropped the top-level `.document` shortcut, so take it off the window
// (same shape tests/check_router_view.js uses).
const dom = boot(quota);
const W = dom.window, D = W.document;
let p = 0, f = 0;
const chk = (ok, l, x) => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${l}${x ? '  ' + x : ''}`); ok ? p++ : f++; };

// Every check takes an explicit document and RETURNS its errors, so a control can
// run one check against a deliberately broken render.
function ready(doc, win) {
  if (!doc.getElementById('quotaview')) {
    return '#quotaview is missing: the page render threw during boot';
  }
  const qvPct = win.eval('qvPct'), qvLevel = win.eval('qvLevel');
  if (typeof qvPct !== 'function' || typeof qvLevel !== 'function') {
    return 'qvPct/qvLevel are not on the built page: the module was not flattened in';
  }
  return null;
}

// The Headroom page, already on screen. Callers must goPage() first.
function checkHeadroom(doc, win, payload) {
  const errs = [];
  const say = (ok, l) => { if (!ok) errs.push(l); };
  const qvPct = win.eval('qvPct'), qvLevel = win.eval('qvLevel');
  const work = payload.profiles.work;
  const att = payload.attention_percent;

  for (const card of provs(doc)) {
    const id = provId(card);
    const prov = work.providers[id];
    if (!prov) { errs.push(`${id}: rendered a provider the payload does not have`); continue; }

    const worst = qvPct(prov.max_used_percent);
    const badge = card.querySelector('.qv-head .qv-pct');
    // A provider the collector flagged is bad regardless of its percentage:
    // that flag is what "about to run out" means here.
    const wantLvl = prov.attention ? 'bad' : qvLevel(worst, att);
    say(has(badge, 'qv-' + wantLvl),
        `${id} badge is not qv-${wantLvl}`, badge ? `classes="${badge.className}"` : 'no badge');
    const wantTxt = worst === null ? 'no reading' : `${worst}% max`;
    say(badge && badge.textContent.includes(wantTxt), `${id} badge text is wrong`,
        `${badge ? JSON.stringify(badge.textContent) : 'none'} != ${JSON.stringify(wantTxt)}`);

    // Each window gets its own row and its own bar.
    const rows = [...card.querySelectorAll('.qv-win')];
    const wins = prov.windows || [];
    say(rows.length === wins.length,
        `${id} shows ${rows.length} window rows but the payload has ${wins.length}`);
    for (const w of wins) {
      const name = (row) => { const n = row.querySelector('.qv-wname'); return n ? n.textContent : ''; };
      const row = rows.find(r => name(r) === w.label);
      if (!row) { errs.push(`${id}: window row "${w.label}" is missing`); continue; }
      const pct = qvPct(w.used_percent);
      const lvl = qvLevel(pct, att);
      say(row.dataset.level === lvl, `${id}/${w.label} row level "${row.dataset.level}" != ${lvl}`);
      const fill = row.querySelector('.qv-fill');
      say(has(fill, 'qv-' + lvl), `${id}/${w.label} fill is not qv-${lvl}`);
      // A bar that always renders fullwidth looks right and measures wrong, so
      // the width is compared to the number, not merely to its presence.
      const width = fill && (fill.style.width || fill.getAttribute('width'));
      const wantW = pct === null ? 0 : Math.max(0, Math.min(100, pct));
      say(String(width) === `${wantW}%`, `${id}/${w.label} bar width "${width}" != ${wantW}%`);
      const track = row.querySelector('.qv-track');
      say(track && String(track.getAttribute('aria-label')).includes(pct === null ? 'no reading' : `${pct}%`),
          `${id}/${w.label} bar has no honest aria-label`);
      // No reading must never read as "plenty left".
      if (pct === null) say(row.dataset.level === 'mute', `${id}/${w.label} unreadable value is not muted`);
    }
  }

  const near = provs(doc).filter(c => has(c, 'qv-near')).map(provId).sort();
  const wantNear = Object.entries(work.providers)
    .filter(([, v]) => v.attention).map(([k]) => k).sort();
  say(JSON.stringify(near) === JSON.stringify(wantNear),
      `attention set ${JSON.stringify(near)} != collector's ${JSON.stringify(wantNear)}`);

  const txt = viewText(doc);
  for (const [id, prov] of Object.entries(work.providers)) {
    for (const w of prov.windows) {
      say(txt.includes(w.label), `${id}: window label "${w.label}" is missing`);
      const shown = qvPct(w.used_percent);
      say(shown === null || txt.includes(`${shown}%`), `${id}: ${shown}% is missing`);
    }
  }
  say(!/\bNaN\b/.test(txt), 'Headroom renders NaN');
  return errs;
}

// The summary strip above the cards. Every number must be derived from the
// payload's provider rows, so the strip can never quietly disagree with the
// cards below it (that is the whole reason it is computed, not written out).
function checkKpis(doc, payload) {
  const errs = [];
  const say = (ok, l) => { if (!ok) errs.push(l); };
  for (const [name, pdata] of Object.entries(payload.profiles)) {
    const strip = doc.querySelector(`.rt-profile[data-profile="${name}"] .qv-kpis`);
    const provs = Object.values(pdata.providers || {});
    if (!provs.length) {
      // A profile with nothing to count must not render an empty shell of tiles.
      say(!strip, `${name}: rendered a KPI strip for a profile with no providers`);
      continue;
    }
    if (!strip) { errs.push(`${name}: no KPI strip`); continue; }
    const tiles = [...strip.querySelectorAll('.qv-kpi')];
    const val = (l) => tiles.find(t => t.querySelector('span')?.textContent === l)
      ?.querySelector('.qv-kv')?.textContent;
    const wantProv = provs.length;
    const wantAvail = provs.filter(p => !p.unavailable_reason).length;
    const wantNear = provs.filter(p => p.attention).length;
    const keys = provs.flatMap(p => p.accounts || []);
    const wantKeys = keys.filter(a => a.status === 'ok').length;
    say(val(wantProv === 1 ? 'provider' : 'providers') === String(wantProv),
        `${name}: provider count tile is wrong`);
    say(val('available') === `${wantAvail}/${wantProv}`,
        `${name}: available tile "${val('available')}" != ${wantAvail}/${wantProv}`);
    say(val('near limit') === String(wantNear), `${name}: near-limit tile is wrong`);
    // The keys tile is conditional: it must appear iff the profile has keys.
    say(!!val('keys usable') === (keys.length > 0),
        `${name}: keys-usable tile ${keys.length ? 'is missing' : 'should not be there'}`);
    if (keys.length) {
      say(val('keys usable') === `${wantKeys}/${keys.length}`,
          `${name}: keys-usable tile "${val('keys usable')}" != ${wantKeys}/${keys.length}`);
    }
  }
  return errs;
}

function checkBalances(doc, payload) {
  const errs = [];
  const say = (ok, l) => { if (!ok) errs.push(l); };
  const txt = viewText(doc);
  for (const [id, prov] of Object.entries(payload.profiles.work.providers)) {
    for (const bal of prov.balances || []) {
      // Printed verbatim: the provider's own decimal string, never reformatted.
      say(txt.includes(bal.total_balance),
          `${id}: balance ${bal.total_balance} is missing or reformatted`);
    }
  }
  // A provider with no balance must not put NaN or undefined on the page.
  say(!/\bNaN\b|\bundefined\b/.test(txt), 'Balances shows NaN/undefined');
  return errs;
}

function checkNoSecrets(doc) {
  const errs = [];
  const whole = doc.getElementById('quotaview').innerHTML;
  for (const frag of ['sk-', 'ghp_', 'session_token', 'api_key', 'Bearer ']) {
    if (whole.includes(frag)) errs.push(`the DOM contains "${frag}"`);
  }
  return errs;
}

// --- the sample payload must pass, page by page ----------------------------
const bootErr = ready(D, W);
if (bootErr) {
  chk(false, bootErr);
} else {
  const all = [];
  for (const pg of PAGES) {
    if (!goPage(D, W, pg)) { all.push(`page strip has no "${pg}" tab`); continue; }
    if (viewText(D).length === 0) all.push(`page "${pg}" rendered nothing`);
  }
  goPage(D, W, 'headroom');
  all.push(...checkHeadroom(D, W, quota));
  all.push(...checkKpis(D, quota));
  if (!viewText(D).includes('97.5%')) all.push('the 97.5% window is missing from Headroom');
  goPage(D, W, 'balances');
  all.push(...checkBalances(D, quota));
  if (!viewText(D).includes('118.42')) all.push('the OpenRouter balance is missing from Balances');
  goPage(D, W, 'notes');
  if (!viewText(D).includes('not logged in')) all.push('the unavailable reason is missing from Notes');
  all.push(...checkNoSecrets(D));
  for (const e of all) chk(false, e);
  chk(all.length === 0, 'the sample quota payload passes every check');

  chk(PAGES.every(pg => !!D.querySelector(`.rt-pages [data-qvpage="${pg}"]`)),
      'the page strip offers headroom, balances and notes');

  // Count on the page that carries the cards: after the walk above the view is
  // left on Notes, where there are no provider cards by design.
  goPage(D, W, 'headroom');
  chk(provs(D).length === Object.keys(quota.profiles.work.providers).length,
      'every provider in the payload is rendered', `${provs(D).length} cards`);
  // A profile the Hermes quota plugin has not cached must say so, not render a shell.
  chk(/No quota data/.test(D.body.textContent),
      'a profile with no quota cache shows the empty state');
  chk(!!quota.profiles.personal, 'the fixture includes a profile with no quota cache');

  // --- per-key rows (#115 follow-up) -----------------------------------------
  // A provider with several keys must show each one separately: a pool that
  // collapses to one provider-level bar hides which key is actually spent.
  const multi = Object.entries(quota.profiles.work.providers)
    .filter(([, pr]) => (pr.accounts || []).length >= 2);
  chk(multi.length >= 2, 'the fixture has at least two providers with several keys',
      multi.map(([id, pr]) => `${id}:${pr.accounts.length}`).join(' '));
  const keyProblems = [];
  for (const [pid, pr] of multi) {
    const card = cardOf(D, pid);
    const rows = card ? [...card.querySelectorAll('.qv-acct')] : [];
    if (rows.length !== pr.accounts.length) {
      keyProblems.push(`${pid}: ${rows.length} key rows for ${pr.accounts.length} accounts`); continue;
    }
    const names = rows.map(r => r.querySelector('.qv-aname')?.textContent);
    const idx = rows.map(r => r.querySelector('.qv-aidx')?.textContent).filter(Boolean);
    // The badge is conditional: shown only when labels collide inside a pool,
    // where it is the only handle. When shown, the numbers must still be unique.
    const labels = pr.accounts.map(a => a.label);
    const collides = new Set(labels).size !== labels.length;
    if (collides) {
      if (idx.length !== rows.length) keyProblems.push(`${pid}: labels collide but the ordinal badge is missing (${idx})`);
      else if (new Set(idx).size !== rows.length) keyProblems.push(`${pid}: ordinal badges are not unique (${idx})`);
    } else if (idx.length) {
      keyProblems.push(`${pid}: ordinal badge shown for keys with distinct labels (${idx})`);
    }
    for (const a of pr.accounts) {
      if (!names.includes(a.label)) keyProblems.push(`${pid}: key "${a.label}" has no row`);
    }
    const inuse = rows.filter(r => r.dataset.inuse === '1');
    if (inuse.length !== pr.accounts.filter(a => a.in_use).length)
      keyProblems.push(`${pid}: in-use marker count ${inuse.length} != payload`);
    for (const a of pr.accounts.filter(a => a.status === 'exhausted' || a.status === 'dead')) {
      const row = rows.find(r => r.querySelector('.qv-aname')?.textContent === a.label);
      if (!row || row.dataset.level === 'ok') keyProblems.push(`${pid}: spent key "${a.label}" is not flagged`);
    }
    // Worst-first: the first rendered row must be at least as bad as the last.
    // data-level is the view's own vocabulary (bad < warn < ok < mute).
    const rank = { bad: 0, warn: 1, ok: 2, mute: 3 };
    const lv = rows.map(r => rank[r.dataset.level] ?? 4);
    if (lv[0] > lv[lv.length - 1]) keyProblems.push(`${pid}: keys are not ordered worst-first (${lv})`);
    const sum = card.querySelector('.qv-keysum')?.textContent || '';
    if (!sum.startsWith(`${pr.accounts.length} key`)) keyProblems.push(`${pid}: key summary reads "${sum}"`);
  }
  for (const e of keyProblems) chk(false, e);
  chk(keyProblems.length === 0, 'every multi-key provider lists each key as its own distinguishable row');
  const s = quota.summary || {};
  chk(s.accounts >= 7 && s.accounts === s.accounts_usable + s.accounts_spent,
      'the summary counts keys and splits them into usable + spent', JSON.stringify(s));
}

// --- negative controls ------------------------------------------------------
// Each corrupts an ALREADY-RENDERED page, then runs only the check it targets.
// Because no page click happens in between, the corruption survives — see note
// (2) at the top for what happens otherwise.
function corruptHeadroom(breakIt, label, expect) {
  const fresh = boot(quota);
  const d = fresh.window.document, w = fresh.window;
  if (ready(d, w)) { chk(false, `control: ${label} (could not boot)`); return; }
  goPage(d, w, 'headroom');
  breakIt(d, w);
  const found = checkHeadroom(d, w, quota);
  const hit = found.some(e => e.includes(expect));
  chk(hit, `control: ${label} is detected`,
      hit ? found.find(e => e.includes(expect))
          : 'NOT DETECTED — audit said: ' + (found[0] || 'nothing wrong at all'));
}

corruptHeadroom(d => { cardOf(d, 'openrouter').querySelector('.qv-fill').style.width = '100%'; },
                'a bar width that no longer equals its number', 'bar width');
corruptHeadroom(d => { cardOf(d, 'openrouter').classList.remove('qv-near'); },
                'a provider dropped from the rendered attention set', 'attention set');
corruptHeadroom(d => {
  // anthropic's FIRST window is 5h at 41.5%, which is already qv-ok — flipping it
  // to qv-ok changes nothing. Target the one that should NOT be green: the 7-day
  // window at 88%, which the collector calls warn.
  const row = [...cardOf(d, 'anthropic').querySelectorAll('.qv-win')]
    .find(r => r.dataset.level === 'warn');
  row.querySelector('.qv-fill').className = 'qv-fill qv-ok';
}, 'a window recoloured against the collector threshold', 'fill is not qv-');
corruptHeadroom(d => { cardOf(d, 'anthropic').querySelector('.qv-head .qv-pct').textContent = '12% max'; },
                'a badge that disagrees with max_used_percent', 'badge text is wrong');
corruptHeadroom(d => { cardOf(d, 'anthropic').querySelector('.qv-win .qv-wname').textContent = 'monthly'; },
                'a window relabelled away from the payload', 'window row');
// The secret scan spans every page, so it gets its own runner.
function corruptAllPages(breakIt, label, expect) {
  const fresh = boot(quota);
  const d = fresh.window.document, w = fresh.window;
  goPage(d, w, 'headroom');
  breakIt(d, w);
  const found = [...checkNoSecrets(d)];
  const hit = found.some(e => e.includes(expect));
  chk(hit, `control: ${label} is detected`,
      hit ? found.find(e => e.includes(expect)) : 'NOT DETECTED — audit said: ' + (found[0] || 'nothing wrong at all'));
}
corruptAllPages(d => { d.getElementById('quotaview').innerHTML += '<span>sk-leaked0123456789</span>'; },
                'a provider API key reaching the DOM', 'the DOM contains "sk-"');
corruptAllPages(d => { d.getElementById('quotaview').innerHTML += '<i>Bearer abc.def.ghi</i>'; },
                'an authorization header reaching the DOM', 'the DOM contains "Bearer "');

// A window whose value cannot be read must render as "no reading", never NaN —
// and this one is driven through the PAYLOAD, because that is the only way to
// reach qvPct's own guard.
const junk = JSON.parse(JSON.stringify(quota));
junk.profiles.work.providers.openrouter.windows[0].used_percent = 'n/a';
const junkDom = boot(junk);
if (ready(junkDom.window.document, junkDom.window)) {
  chk(false, 'control: an unreadable window value (could not boot)');
} else {
  goPage(junkDom.window.document, junkDom.window, 'headroom');
  const jt = viewText(junkDom.window.document);
  chk(!/\bNaN\b/.test(jt) && jt.includes('—'),
      'control: an unreadable window value renders as "no reading", not NaN',
      jt.includes('—') ? 'rendered as —' : jt.slice(0, 120));
}

// A payload with no quota data at all must empty the tab rather than throw.
const empty = { ...quota, profiles: { work: { providers: {}, cache_fetched_at: null, note: 'no-quota-cache' } } };
const emptyDom = boot(empty);
goPage(emptyDom.window.document, emptyDom.window, 'headroom');
chk(!/\bNaN\b/.test(viewText(emptyDom.window.document))
    && provs(emptyDom.window.document).length === 0,
    'control: a profile with no providers renders empty, not broken',
    `${provs(emptyDom.window.document).length} cards`);

// Control for the conditional badge: force a label collision inside one pool and
// the numbers must come back. Without this the "badge is absent" assertion above
// would also pass if qvAccount simply never rendered a badge at all.
const dup = JSON.parse(JSON.stringify(quota));
const dupProv = dup.profiles.work.providers.anthropic;
dupProv.accounts[1].label = dupProv.accounts[0].label;
const dupDom = boot(dup);
goPage(dupDom.window.document, dupDom.window, 'headroom');
{
  const card = cardOf(dupDom.window.document, 'anthropic');
  const idx = card ? [...card.querySelectorAll('.qv-aidx')].map(e => e.textContent) : [];
  chk(idx.length === dupProv.accounts.length && new Set(idx).size === idx.length,
      'control: two keys sharing a label fall back to unique ordinal badges',
      `${idx.length} badges: ${idx.join(',')}`);
}

// --- precision: a noisy float must not reach the page ----------------------
// The provider owns the value; it does not own the precision. A quota API that
// answers 88.333333 must read "88.33%", not six decimals carried into the text,
// the bar width and the aria-label. The sample payload holds only clean values,
// so this needs its own payload with one deliberately noisy window.
{
  const noisy = JSON.parse(JSON.stringify(quota));
  noisy.profiles.work.providers.openrouter.windows[0].used_percent = 88.333333;
  const nDom = boot(noisy);
  goPage(nDom.window.document, nDom.window, 'headroom');
  const nTxt = viewText(nDom.window.document);
  chk(nTxt.includes('88.33%'),
      'a 6-decimal provider value renders rounded to 2dp',
      `"88.33%" ${nTxt.includes('88.33%') ? 'present' : 'MISSING'}`);
  chk(!nTxt.includes('88.333333'),
      'the raw 6-decimal float never reaches the page',
      nTxt.includes('88.333333') ? 'LEAKED' : 'clean');
  // A clean value is the provider's own precision and must survive untouched:
  // no trailing zero added, no second decimal invented.
  chk(nTxt.includes('41.5%') && !nTxt.includes('41.50%'),
      'a clean 1dp value is printed verbatim', '41.5%');
  chk(nTxt.includes('63.25%'),
      'a clean 2dp value is printed verbatim', '63.25%');
}

console.log(`\ncheck_quota_view.js  ${p} passed, ${f} failed`);
// jsdom's pretendToBeVisual timer keeps the event loop alive, so without an
// explicit exit the suite hangs forever in CI.
process.exit(f ? 1 : 0);