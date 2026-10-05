/*
 * Quota tab (#115): how much headroom is left on every provider, per profile.
 *
 * The dashboard never holds a provider credential, so it cannot ask a provider
 * anything. This view renders DATA.quota, which collect_quota.py copies out of
 * the Hermes quota plugin's cache (refreshed hourly by
 * systemd/llm-telemetry-quota.timer) through a strict whitelist. Everything on
 * screen is therefore a *description* of headroom, never a credential: window
 * fill levels, plan names, reset times and account balances.
 *
 * Structured like the Router tab (#130) on purpose — same folding, same sub-page
 * strip, same card grammar — so the two tabs read as one dashboard. The provider
 * mark and the relative-time formatter are reused from routerview.js so the two
 * tabs can never disagree about what a provider looks like.
 *
 * There is deliberately NO module-level mutable state: the build replays only
 * the declaration blocks order.json lists, so a non-exported top-level `let`
 * would be silently dropped from the page. Fold and sub-page state live in
 * localStorage and are read on demand instead.
 */
import { $, esc, escA } from './palette.js';
import { current } from './charts.js';
import { DATA } from './main.js';
import { rtLogo, rtAgo } from './routerview.js';

// One question per sub-page, as on the Router tab: four dense cards per profile
// read as a wall, and the fleet view multiplies it.
export const QV_PAGES = [
  ['headroom', 'Headroom', 'Where each provider stands, worst first'],
  ['balances', 'Balances', 'Account credit reported by the provider'],
  ['notes', 'Notes', 'Provider messages, with secrets scrubbed'],
];

// The attention threshold is owned by the collector (collect_quota.py
// ATTENTION_PERCENT) and shipped in quota_meta, so it is read, never restated
// here: a second copy in JS would drift and quietly change what "near limit"
// means. A build with no threshold gets no green reading rather than a guess.
export function qvAttention(){
  const n = Number((DATA.quota_meta || {}).attention_percent);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// A window's fill level, or null when the provider did not report one.
export function qvPct(v){
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ok < 60 <= warn < attention <= bad. A missing level is 'mute', not 'ok':
// "we don't know" must never read as "plenty left".
export function qvLevel(pct, attention){
  if (pct === null) return 'mute';
  if (!Number.isFinite(attention)) return 'warn';
  if (pct >= attention) return 'bad';
  return pct >= Math.min(60, attention) ? 'warn' : 'ok';
}

// Whether the provider can actually be called right now.
export function qvCalls(v){
  if (v === null || v === undefined) return {t: 'not reported', cls: 'mute'};
  return v ? {t: 'callable', cls: 'ok'} : {t: 'exhausted', cls: 'bad'};
}

// A plan that costs nothing, so the badge can say so. Matches the label too:
// some providers put ":free" on the model, not the plan.
export function qvIsFree(prov){
  return /(^|[^a-z])free($|[^a-z])/i.test(`${prov.plan || ''} ${prov.label || ''}`);
}

// A metered bar. Both elements are display:block spans (see dashboard.css): an
// inline box ignores the width and renders 0x0 — the exact bug the repo's
// check_inline_sized_elements.js gate exists for.
export function qvBar(pct, attention){
  const lvl = qvLevel(pct, attention);
  const w = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return `<span class="qv-track" role="img" aria-label="${escA(pct === null ? 'no reading' : `${pct}% used`)}">` +
    `<i class="qv-fill qv-${lvl}" style="width:${w}%"></i></span>`;
}

// One usage window: its name, its bar, and when it refills.
export function qvWindow(w, attention){
  const pct = qvPct(w.used_percent);
  const lvl = qvLevel(pct, attention);
  const reset = w.reset_at
    ? `<span class="muted qv-reset" title="${escA(w.reset_at)}">resets ${esc(w.reset_at)}</span>` : '';
  // The reset timestamp also rides on the row itself: below 520px the reset
  // span is hidden to keep the bar visible, and a title on a hidden element is
  // unreachable, so this is the only way to keep it on mobile.
  const rowTip = w.reset_at ? ` title="resets ${escA(w.reset_at)}"` : '';
  return `<div class="qv-win" data-level="${lvl}"${rowTip}>` +
    `<span class="qv-wname">${esc(w.label || 'window')}</span>` +
    `<span class="qv-pct qv-${lvl}">${pct === null ? '—' : `${pct}%`}</span>` +
    qvBar(pct, attention) + reset + '</div>';
}

// ---------------------------------------------------------------------------
// Keys. A provider is a container; the thing that actually runs out of quota
// is one credential. A provider holding three keys reported one number before
// this, so a healthy key hid two exhausted siblings — the collapse was the
// bug. Every key now gets its own row with its own verdict.
//
// All of this comes from the cache record, which the plugin writes through a
// naming whitelist: ids, verdicts and counters, never a credential. The one
// field derived from a secret is `in_use`, and it arrives already reduced to a
// boolean — computed inside the plugin process, where the comparison stays.
// ---------------------------------------------------------------------------

// A key's verdict, mapped onto the same ok/warn/bad/mute scale as a window, so
// one glance covers both. 'exhausted' is a window that has not rolled over yet;
// 'dead' needs a human to re-enrol the key, so the two must not look alike.
export function qvAcctLevel(a){
  const s = a.status;
  if (s === 'dead') return 'bad';
  if (s === 'exhausted') return 'warn';
  return s === 'ok' ? 'ok' : 'mute';
}

// What the row says about state. Not-measured stays distinct from healthy for
// the same reason a missing window level is 'mute': silence is not good news.
export function qvAcctState(a){
  if (a.status === 'ok') return a.in_use ? 'in use' : 'standby';
  if (a.status === 'exhausted') return 'exhausted';
  if (a.status === 'dead') return 'needs re-login';
  return 'not reported';
}

// Why a key stopped, preferring the pool's own words over the HTTP code: a
// provider's error body explains far more than "429" does.
export function qvAcctWhy(a){
  const why = a.failure_reason || a.last_error_reason || '';
  if (why) return why;
  return a.last_error_code ? `HTTP ${a.last_error_code}` : '';
}

// An expiry, as a duration the reader can act on. rtAgo() cannot be reused: it
// clamps a future timestamp to "just now", which is the opposite of true for a
// token that has not expired yet.
export function qvAcctExpiry(ms){
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  const s = n / 1000 - Date.now() / 1000;
  const left = s < 0 ? 'expired' : s < 3600 ? `${Math.max(1, Math.round(s / 60))}m`
    : s < 172800 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
  return s < 0 ? left : `expires in ${left}`;
}

// How the key got here, in words rather than field names. The raw values are
// snake_case identifiers from the credential pool, and one of them spells a
// credential kind literally; neither belongs on a dashboard. Kept inside the
// function it serves: a top-level const would start a block the build has to
// find in order.json by name, and this one has no business being public.
export function qvAcctOrigin(a){
  const words = {api_key: 'API key', oauth: 'OAuth', token: 'token',
    env: 'environment', environment: 'environment', file: 'auth file',
    vault: 'vault', keychain: 'keychain'};
  const raw = String(a.source || a.auth_type || '').trim();
  if (!raw) return '';
  const key = raw.split(/[:/]/).pop().toLowerCase();
  return words[key] || words[raw.toLowerCase()] || '';
}

// A key's own usage windows, as one dense line of chips. Deliberately NOT the
// full window row: those nested inside a provider card would read as the
// provider's own limits twice over, and they carry .qv-win/.qv-fill classes the
// page's bar audit counts and recolours. A chip shows the same number at a
// glance and stays out of that contract's way.
export function qvAcctUsage(a){
  const wins = a.usage || [];
  if (!wins.length) return '';
  return '<span class="qv-auchips">' + wins.map(w => {
    const pct = qvPct(w.used_percent);
    const lvl = qvLevel(pct, qvAttention());
    return `<span class="qv-achip qv-${lvl}">${esc(w.label)} ${pct === null ? '—' : pct + '%'}</span>`;
  }).join('') + '</span>';
}

// One key. The row reads left to right as: which key, what state, how much it
// has been used. The ordinal badge is identity: two keys can share a label, and
// the pool's id is opaque, so position is the only honest handle to show.
export function qvAccount(a, i){
  const lvl = qvAcctLevel(a);
  const why = qvAcctWhy(a);
  const exp = qvAcctExpiry(a.expires_at_ms);
  const origin = qvAcctOrigin(a);
  const bits = [];
  if (a.request_count !== null && a.request_count !== undefined && a.request_count !== '') {
    bits.push(`${esc(a.request_count)} call${Number(a.request_count) === 1 ? '' : 's'}`);
  }
  if (origin) bits.push(esc(origin));
  if (exp) bits.push(esc(exp));
  const models = (a.models || []).filter(Boolean);
  const cooling = models.length
    ? `<div class="qv-amodels" title="${escA(models.join(', '))}">cooling: ${esc(models.join(', '))}</div>` : '';
  const inuse = a.in_use ? '<span class="qv-ainuse" title="the key the next request would use">in use</span>' : '';
  const whyEl = why ? `<div class="qv-why" title="${escA(why)}">${esc(why)}</div>` : '';
  return `<div class="qv-acct" data-level="${lvl}" data-inuse="${a.in_use ? '1' : '0'}">` +
    `<div class="qv-acctop"><span class="qv-adot" aria-hidden="true"></span>` +
    `<span class="qv-aidx">#${i + 1}</span>` +
    `<b class="qv-aname">${esc(a.label || a.id || 'key')}</b>` + inuse +
    `<span class="qv-astat qv-${lvl}">${esc(qvAcctState(a))}</span>` +
    (bits.length ? `<span class="qv-abits">${bits.join(' · ')}</span>` : '') +
    qvAcctUsage(a) + '</div>' +
    whyEl + cooling + '</div>';
}

// The keys of one provider, worst first so an exhausted key is not buried under
// healthy ones. Returns '' when the cache predates per-key records, which keeps
// an older cache rendering exactly as it did before.
export function qvAccounts(prov){
  const accts = prov.accounts || [];
  if (!accts.length) return '';
  const rank = {dead: 0, exhausted: 1, ok: 2};
  const order = [...accts].sort((a, b) =>
    (rank[a.status] === undefined ? 3 : rank[a.status]) - (rank[b.status] === undefined ? 3 : rank[b.status]));
  // Display order is worst-first; the ordinal badge is NOT that order. The badge
  // is the only handle two same-labelled keys can be told apart by, so it is
  // assigned from the payload's own order -- which the collector already sorts
  // by pool priority. Badging from the sorted index instead would renumber a
  // key the moment a sibling changed state, i.e. stop naming the key it sits by.
  const ordinal = new Map(accts.map((a, i) => [a, i]));
  const spent = accts.filter(a => a.status === 'exhausted' || a.status === 'dead').length;
  const head = `<div class="qv-keysum">${accts.length} key${accts.length === 1 ? '' : 's'}` +
    (spent ? ` · <b>${spent} spent</b>` : '') + '</div>';
  return `<div class="qv-accts">${head}${order.map(a => qvAccount(a, ordinal.get(a))).join('')}</div>`;
}

// One account balance. Amounts are already strings (decimal precision is the
// provider's, not ours), so they are printed verbatim.
export function qvBalance(b){
  const parts = [['total', b.total_balance], ['granted', b.granted_balance], ['topped up', b.topped_up_balance]]
    .filter(([, v]) => v !== null && v !== undefined && v !== '');
  const unit = b.currency ? `<span class="qv-cur">${esc(b.currency)}</span>` : '';
  if (!parts.length) return '';
  return `<div class="qv-bal">${unit}${parts.map(([l, v]) =>
    `<span class="qv-amt"><b>${esc(v)}</b> <span class="muted">${esc(l)}</span></span>`).join('')}</div>`;
}

// The one-line answer for a provider: worst window, plan, callability.
export function qvHead(pid, prov){
  const attention = qvAttention();
  const worst = qvPct(prov.max_used_percent);
  const lvl = prov.attention ? 'bad' : qvLevel(worst, attention);
  const calls = qvCalls(prov.api_calls_available);
  const why = prov.unavailable_reason
    ? `<span class="qv-why" title="${escA(prov.unavailable_reason)}">${esc(prov.unavailable_reason)}</span>` : '';
  return `<div class="qv-head">${rtLogo(pid, 18)}` +
    `<b class="qv-name">${esc(prov.label || pid)}</b>` +
    (prov.plan ? `<span class="qv-plan">${esc(prov.plan)}</span>` : '') +
    (qvIsFree(prov) ? '<span class="qv-free" title="no-cost plan">free</span>' : '') +
    `<span class="rt-st rt-${calls.cls}">${esc(calls.t)}</span>` +
    `<span class="qv-pct qv-${lvl}">${worst === null ? 'no reading' : `${worst}% max`}</span>` + why + '</div>';
}

// Every provider of one profile, worst first: the tab exists to answer "where am
// I about to run out", so the answer is at the top and needs no sort control.
export function qvProviders(pdata){
  const attention = qvAttention();
  const rows = Object.entries(pdata.providers || {});
  if (!rows.length) {
    return `<div class="muted">No quota data${pdata.note ? ` (${esc(pdata.note)})` : ''} — ` +
      'the Hermes quota plugin has not cached this profile yet.</div>';
  }
  rows.sort((a, b) => {
    const wa = qvPct(a[1].max_used_percent), wb = qvPct(b[1].max_used_percent);
    return (wb === null ? -1 : wb) - (wa === null ? -1 : wa);
  });
  return rows.map(([pid, prov]) => {
    const wins = (prov.windows || []).map(w => qvWindow(w, attention)).join('') ||
      '<div class="muted qv-wins-none">No usage windows reported.</div>';
    // Keys sit between the provider summary and its windows: the summary is the
    // provider's own answer (which is the in-use key alone), and the windows
    // break that answer down by limit. The key rows say what the summary cannot
    // — that the provider holds more than one credential, and how each is doing.
    return `<div class="qv-prov${prov.attention ? ' qv-near' : ''}" data-provider="${escA(pid)}">` +
      qvHead(pid, prov) + qvAccounts(prov) + `<div class="qv-wins">${wins}</div></div>`;
  }).join('');
}

export function qvBalances(pdata){
  const rows = Object.entries(pdata.providers || {})
    .filter(([, prov]) => (prov.balances || []).length);
  if (!rows.length) return '<div class="muted">No provider reports an account balance.</div>';
  return rows.map(([pid, prov]) => `<div class="qv-balrow"><b>${esc(prov.label || pid)}</b>` +
    prov.balances.map(qvBalance).join('') + '</div>').join('');
}

export function qvNotes(pdata){
  const out = Object.entries(pdata.providers || {}).map(([pid, prov]) => {
    const lines = prov.details || [];
    if (!lines.length && !prov.unavailable_reason) return '';
    return `<div class="qv-note"><b>${esc(prov.label || pid)}</b>` +
      (prov.unavailable_reason ? `<div class="qv-why">${esc(prov.unavailable_reason)}</div>` : '') +
      lines.map(d => `<div class="qv-detail">${esc(d)}</div>`).join('') + '</div>';
  }).filter(Boolean);
  const head = '<div class="rt-note muted">Free text is reproduced as the provider sent it, after credential-shaped ' +
    'substrings were replaced with [REDACTED] on the server. Keys and tokens never reach this page.</div>';
  return out.length ? head + out.join('') : head + '<div class="muted">No provider notes.</div>';
}

// Sub-page selection persists per browser; an unknown stored id falls back.
export function qvPageGet(){
  const key = 'hermes-dash-quota-page';
  try {
    const p = localStorage.getItem(key);
    return QV_PAGES.some(([id]) => id === p) ? p : 'headroom';
  } catch { return 'headroom'; }
}

export function qvPageSet(id){
  if (!QV_PAGES.some(([p]) => p === id)) return;
  try { localStorage.setItem('hermes-dash-quota-page', id); } catch { /* private mode */ }
  renderQuotaView();
}

// Folded cards persist per browser, keyed "<profile>|<card>", exactly as the
// Router tab does — folding one profile must not fold another.
export function qvFolded(){
  try { return new Set(JSON.parse(localStorage.getItem('hermes-dash-quota-folded') || '[]')); }
  catch { return new Set(); }
}

export function qvSaveFold(key, open){
  const s = qvFolded();
  if (open) s.delete(key); else s.add(key);
  try { localStorage.setItem('hermes-dash-quota-folded', JSON.stringify([...s])); } catch { /* private mode */ }
}

// One profile: a folding header (how many providers, how many near a limit,
// when the hourly job last ran) and the current sub-page's card inside it.
export function qvSection(name, pdata){
  const folded = qvFolded();
  const card = (id, title, sub, body) => {
    const key = `${name}|${id}`;
    return `<details class="card rt-card" data-qvfold="${escA(key)}"${folded.has(key) ? '' : ' open'}>` +
      `<summary class="lbl">${esc(title)}${sub ? ` <span class="muted rt-lblsub">${esc(sub)}</span>` : ''}</summary>` +
      `<div class="rt-cbody">${body}</div></details>`;
  };
  const PAGES = {
    headroom: () => card('headroom', 'Provider headroom',
      'share of each usage window consumed, worst first', qvProviders(pdata)),
    balances: () => card('balances', 'Account balances', 'credit the provider reports', qvBalances(pdata)),
    notes: () => card('notes', 'Provider notes', 'as sent, after scrubbing', qvNotes(pdata)),
  };
  const body = (PAGES[qvPageGet()] || PAGES.headroom)();
  const provs = Object.values(pdata.providers || {});
  const n = provs.length;
  const near = provs.filter(p => p.attention).length;
  const pkey = `${name}|*`;
  return `<details class="rt-profile" data-profile="${escA(name)}" data-qvfold="${escA(pkey)}"${folded.has(pkey) ? '' : ' open'}>
    <summary class="rt-phead"><h2>${esc(name)}</h2>
      <span class="rt-auth ${near ? 'rt-warn' : 'rt-ok'}">${near ? `${near} near limit` : 'all clear'}</span>
      <span class="muted">${n} provider${n === 1 ? '' : 's'}${
        qvAttention() === null ? ' · threshold unknown' : ''}${
        pdata.cache_fetched_at ? ` · cached ${esc(rtAgo(Date.parse(pdata.cache_fetched_at) / 1000))}` : ''}</span>
      <span class="rt-foldall"><button type="button" data-qvall="open">expand all</button><button type="button" data-qvall="close">collapse all</button></span>
    </summary>${body}</details>`;
}

// Home card stat: the current profile's answer, or the fleet's when the merge
// is selected. Mirrors routerStat()'s shape.
export function qvStat(){
  const all = DATA.quota || {};
  const meta = DATA.quota_meta || {};
  const names = (current && current !== 'All' && all[current]) ? [current] : Object.keys(all);
  if (!names.length) return 'No data';
  const provs = [];
  for (const n of names) provs.push(...Object.values((all[n] || {}).providers || {}));
  const near = provs.filter(p => p.attention).length;
  const avail = provs.filter(p => !p.unavailable_reason).length;
  if (names.length === 1) {
    const n = provs.length;
    return near ? `${near}/${n} near limit` : `${n} provider${n === 1 ? '' : 's'} clear`;
  }
  return `${(meta.summary && meta.summary.available) || avail}/${(meta.summary && meta.summary.providers) || provs.length} available`;
}

export function renderQuotaView(){
  const el = $('quotaview');
  if (!el) return;
  const all = DATA.quota || {};
  const meta = DATA.quota_meta || {};
  const names = (current && all[current]) ? [current] : Object.keys(all).sort();
  const sub = $('quotasub');
  if (sub) {
    sub.textContent = meta.collected_at
      ? `refreshed hourly · last ${rtAgo(meta.collected_at)}` : 'refreshed hourly';
  }
  if (!names.length) {
    el.innerHTML = '<div class="card rt-card muted">No quota data — the Hermes quota plugin has not cached any profile yet.</div>';
    return;
  }
  const page = qvPageGet();
  const strip = `<nav class="rt-pages" aria-label="Quota pages">${QV_PAGES.map(([id, label, tip]) => {
    const on = id === page;
    return `<button type="button" data-qvpage="${escA(id)}"${on ? ' aria-current="page"' : ''}` +
      ` title="${escA(tip)}" class="rt-page${on ? ' rt-page-on' : ''}">${esc(label)}</button>`;
  }).join('')}</nav>`;
  el.innerHTML = strip + names.map(n => qvSection(n, all[n])).join('');
  el.querySelectorAll('details[data-qvfold]').forEach(dt =>
    dt.addEventListener('toggle', () => qvSaveFold(dt.dataset.qvfold, dt.open)));
  el.querySelectorAll('[data-qvall]').forEach(b => b.addEventListener('click', ev => {
    ev.preventDefault(); ev.stopPropagation();   // inside <summary>: must not fold the profile
    const open = b.dataset.qvall === 'open';
    b.closest('.rt-profile').querySelectorAll('details.rt-card').forEach(dt => {
      dt.open = open; qvSaveFold(dt.dataset.qvfold, open);
    });
  }));
  el.querySelectorAll('[data-qvpage]').forEach(b =>
    b.addEventListener('click', () => qvPageSet(b.dataset.qvpage)));
}