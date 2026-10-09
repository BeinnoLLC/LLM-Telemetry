// Unit tests for quotaview.js — the Quota tab's HTML builders and its
// page/fold persistence (#30: import the module directly, no built page).
//
// Every expected string below is derived BY HAND from the rules in
// src/llm_telemetry/web/js/quotaview.js — the rounding in qvPct, the bands in
// qvLevel, the key ordering in qvAccounts, the off/on states of counters.
// Nothing here is captured from program output; if a case fails, re-read the
// module rather than copying what it printed.
//
// The `qv-*` / `rt-*` class names and `data-*` attributes asserted here are the
// same contracts tests/check_quota_view.js and tools/quota_layout_probe.py
// guard against the built HTML — do not weaken either side.
import { isolate } from './lib/isolate.mjs';

let pass = 0, fail = 0;
function ok(cond, msg){ if (cond) { pass++; return; } fail++; console.log(`  FAIL: ${msg}`); }
function eq(a, b, msg){ ok(a === b, `${msg}\n        got ${JSON.stringify(a)}\n        exp ${JSON.stringify(b)}`); }
function has(s, sub, msg){ ok(String(s).includes(sub), `${msg}\n        missing ${JSON.stringify(sub)}\n        in      ${JSON.stringify(String(s).slice(0, 260))}`); }
function lacks(s, sub, msg){ ok(!String(s).includes(sub), `${msg}\n        unexpected ${JSON.stringify(sub)}\n        in         ${JSON.stringify(String(s).slice(0, 260))}`); }
function count(s, sub){ return String(s).split(sub).length - 1; }

// The real escapers live in palette.js; load it with its own siblings stubbed
// so the strings under test are escaped exactly as the dashboard escapes them.
const P = await isolate('palette.js', {
  'charts.js': { bounds: () => [0, 1], current: null },
  'views.js': { PROV: {}, provIcon: () => '', render: () => {} },
  'router.js': { presets: () => {} },
  'main.js': { DATA: {}, css: () => {} },
});

// Fresh copy of the unit per call. Collaborators are stubbed deterministically:
//   $            -> returns nothing (renderQuotaView bails before touching the DOM)
//   current      -> the charts "selected profile"
//   DATA         -> the global dashboard payload (mutable, so one isolate can
//                   serve many payloads as long as `current` does not change)
//   rtLogo/rtAgo -> fixed strings, so qvHead/qvSection output is exact
const load = (o = {}) => isolate('quotaview.js', {
  'palette.js': { $: o.$ || (() => null), esc: P.esc, escA: P.escA },
  'charts.js': { current: 'current' in o ? o.current : null },
  'main.js': { DATA: o.DATA || {} },
  'routerview.js': {
    rtLogo: o.rtLogo || ((id, sz) => `[logo ${id} ${sz}]`),
    rtAgo: o.rtAgo || (() => 'AGO'),
  },
});

const D = await load();                                              // no threshold
const A = await load({ DATA: { quota_meta: { attention_percent: 80 } } }); // 80% threshold

// ── qvPct: null stays null, real numbers round to two decimals ───────────────
eq(D.qvPct(null), null, 'null reading stays null');
eq(D.qvPct(undefined), null, 'undefined reading stays null');
eq(D.qvPct(''), null, 'empty string is not a number');
eq(D.qvPct('abc'), null, 'non-numeric string is not a number');
eq(D.qvPct(0), 0, 'zero is a real reading, not a missing one');
eq(D.qvPct(41.5), 41.5, 'clean value passes through untouched');
eq(D.qvPct(63.25), 63.25, 'two decimals pass through untouched');
eq(D.qvPct(88.333333), 88.33, 'noisy float is cut to two decimals');
eq(D.qvPct(1.239), 1.24, 'third decimal rounds up');
eq(D.qvPct('50'), 50, 'numeric string parses');

// ── qvAttention: the collector-owned threshold, never guessed in JS ─────────
eq(D.qvAttention(), null, 'no quota_meta -> no threshold');
eq(A.qvAttention(), 80, 'threshold read from quota_meta');
eq((await load({ DATA: { quota_meta: { attention_percent: 0 } } })).qvAttention(), null, 'zero threshold is treated as absent');
eq((await load({ DATA: { quota_meta: { attention_percent: -5 } } })).qvAttention(), null, 'negative threshold is treated as absent');
eq((await load({ DATA: { quota_meta: { attention_percent: 'abc' } } })).qvAttention(), null, 'non-numeric threshold is treated as absent');
eq((await load({ DATA: { quota_meta: { attention_percent: '75' } } })).qvAttention(), 75, 'numeric-string threshold parses');

// ── QV_PAGES: the sub-page tabs, in order ───────────────────────────────────
eq(D.QV_PAGES.length, 3, 'three quota sub-pages');
eq(D.QV_PAGES.map(p => p[0]).join(','), 'headroom,balances,notes', 'page ids and order');
eq(D.QV_PAGES.map(p => p[1]).join(','), 'Headroom,Balances,Notes', 'page labels');
eq(D.QV_PAGES.map(p => p[2]).join('|'),
  'Where each provider stands, worst first|Account credit reported by the provider|Provider messages, with secrets scrubbed',
  'page subtitles');

// ── qvLevel: mute / ok / warn / bad ─────────────────────────────────────────
eq(D.qvLevel(null, 80), 'mute', 'no reading is mute, never ok');
eq(D.qvLevel(50, null), 'warn', 'no threshold is warn, never ok');
eq(D.qvLevel(50, undefined), 'warn', 'undefined threshold is warn');
eq(D.qvLevel(80, 80), 'bad', 'at the threshold is bad');
eq(D.qvLevel(79, 80), 'warn', 'just under the threshold is warn');
eq(D.qvLevel(60, 80), 'warn', 'the 60% warn band starts at exactly 60');
eq(D.qvLevel(59, 80), 'ok', 'below 60 is ok');
eq(D.qvLevel(0, 80), 'ok', 'zero usage is ok');
eq(D.qvLevel(30, 40), 'ok', 'a low threshold drags the warn band down with it');
eq(D.qvLevel(40, 40), 'bad', 'low threshold: at the threshold is bad');
eq(D.qvLevel(50, 40), 'bad', 'over a low threshold is bad');

// ── qvCalls: tri-state availability ─────────────────────────────────────────
const calls = (v) => JSON.stringify(D.qvCalls(v));
eq(calls(null), JSON.stringify({ t: 'not reported', cls: 'mute' }), 'null -> not reported');
eq(calls(undefined), JSON.stringify({ t: 'not reported', cls: 'mute' }), 'undefined -> not reported');
eq(calls(true), JSON.stringify({ t: 'callable', cls: 'ok' }), 'true -> callable');
eq(calls(false), JSON.stringify({ t: 'exhausted', cls: 'bad' }), 'false -> exhausted');
eq(calls(0), JSON.stringify({ t: 'exhausted', cls: 'bad' }), 'zero -> exhausted, not "not reported"');

// ── qvIsFree: word-boundary match on plan/label ─────────────────────────────
eq(D.qvIsFree({ plan: 'free' }), true, 'plan "free" is free');
eq(D.qvIsFree({ plan: 'Free' }), true, 'case-insensitive');
eq(D.qvIsFree({ label: 'llama:free' }), true, 'free after a colon is a boundary');
eq(D.qvIsFree({ plan: 'not-free' }), true, 'hyphen is a boundary');
eq(D.qvIsFree({ plan: 'freedom' }), false, '"freedom" is not free');
eq(D.qvIsFree({ plan: 'costfree' }), false, '"free" inside a longer word is not free');
eq(D.qvIsFree({}), false, 'no plan or label -> not free');

// ── qvBar: width clamps, label keeps the true number ────────────────────────
const bar = D.qvBar(null, 80);
has(bar, '<span class="qv-track" role="img"', 'bar is a labelled track');
has(bar, 'aria-label="no reading"', 'missing reading labels as "no reading"');
has(bar, '<i class="qv-fill qv-mute" style="width:0%"></i>', 'missing reading -> mute fill at 0%');
has(D.qvBar(50, 80), '<i class="qv-fill qv-ok" style="width:50%"></i>', 'under band -> ok fill');
has(D.qvBar(50, 80), 'aria-label="50% used"', 'ok fill keeps the reading');
has(D.qvBar(65, 80), '<i class="qv-fill qv-warn" style="width:65%"></i>', 'warn band fill');
has(D.qvBar(90, 80), '<i class="qv-fill qv-bad" style="width:90%"></i>', 'bad band fill');
has(D.qvBar(120, 80), 'style="width:100%"', 'over 100 clamps the drawn width');
has(D.qvBar(120, 80), 'aria-label="120% used"', 'over 100 keeps the true number in the label');

// ── qvWindow: one usage window row ──────────────────────────────────────────
const win = D.qvWindow({ label: '5h', used_percent: 88.333333, reset_at: '2026-01-01T00:00:00Z' }, 80);
has(win, '<div class="qv-win" data-level="bad" title="resets 2026-01-01T00:00:00Z">', 'row carries its level and the reset tip');
has(win, '<span class="qv-wname">5h</span>', 'window name is the label');
has(win, '<span class="qv-pct qv-bad">88.33%</span>', 'window percent is rounded');
has(win, '<span class="muted qv-reset" title="2026-01-01T00:00:00Z">resets 2026-01-01T00:00:00Z</span>', 'reset line shown beside the reading');
const win0 = D.qvWindow({}, 80);
has(win0, 'data-level="mute"', 'unmeasured window is mute');
has(win0, '<span class="qv-wname">window</span>', 'unlabelled window defaults to "window"');
has(win0, '<span class="qv-pct qv-mute">—</span>', 'missing reading renders an em dash');
lacks(win0, 'qv-reset', 'no reset line without a reset_at');
lacks(win0, ' title=', 'no row tip without a reset_at');
const winE = D.qvWindow({ label: '<x>', reset_at: 'a"b<c' }, 80);
has(winE, 'title="a&quot;b&lt;c"', 'reset_at escaped in the attribute');
has(winE, '>resets a"b&lt;c</span>', 'reset_at escaped in the text (quote kept)');
has(winE, '<span class="qv-wname">&lt;x&gt;</span>', 'window label escaped in the text');

// ── qvAcctLevel / qvAcctState / qvAcctWhy ───────────────────────────────────
eq(D.qvAcctLevel({ status: 'ok' }), 'ok', 'ok key is ok');
eq(D.qvAcctLevel({ status: 'exhausted' }), 'warn', 'exhausted key is warn');
eq(D.qvAcctLevel({ status: 'dead' }), 'bad', 'dead key is bad');
eq(D.qvAcctLevel({ status: 'weird' }), 'mute', 'unknown key status is mute');
eq(D.qvAcctLevel({}), 'mute', 'missing key status is mute');

eq(D.qvAcctState({ status: 'ok', in_use: true }), 'in use', 'ok + in_use -> in use');
eq(D.qvAcctState({ status: 'ok' }), 'standby', 'idle ok key -> standby');
eq(D.qvAcctState({ status: 'exhausted' }), 'exhausted', 'exhausted state');
eq(D.qvAcctState({ status: 'dead' }), 'needs re-login', 'dead state -> needs re-login');
eq(D.qvAcctState({}), 'not reported', 'missing status -> not reported');

eq(D.qvAcctWhy({ failure_reason: 'pool says no' }), 'pool says no', 'failure_reason wins');
eq(D.qvAcctWhy({ last_error_reason: 'rate limited' }), 'rate limited', 'last_error_reason used when no failure_reason');
eq(D.qvAcctWhy({ failure_reason: 'x', last_error_code: 429 }), 'x', 'reason outranks the HTTP code');
eq(D.qvAcctWhy({ last_error_code: 429 }), 'HTTP 429', 'bare error code rendered as HTTP n');
eq(D.qvAcctWhy({}), '', 'no reason and no code -> empty');

// ── qvAcctExpiry: derived from a future timestamp, robust to clock drift ────
const inSec = (s) => Date.now() + s * 1000;
eq(D.qvAcctExpiry(0), '', 'zero timestamp -> empty');
eq(D.qvAcctExpiry(-5), '', 'negative timestamp -> empty');
eq(D.qvAcctExpiry('nope'), '', 'non-numeric timestamp -> empty');
eq(D.qvAcctExpiry(undefined), '', 'missing timestamp -> empty');
eq(D.qvAcctExpiry(inSec(-60)), 'expired', 'past timestamp -> expired');
eq(D.qvAcctExpiry(inSec(30)), 'expires in 1m', 'under a minute floors at 1m');
eq(D.qvAcctExpiry(inSec(120)), 'expires in 2m', 'minutes band');
eq(D.qvAcctExpiry(inSec(2 * 3600)), 'expires in 2h', 'hours band');
eq(D.qvAcctExpiry(inSec(3 * 86400)), 'expires in 3d', 'days band');

// ── qvAcctOrigin: credential source, last path segment decides ──────────────
eq(D.qvAcctOrigin({ source: 'api_key' }), 'API key', 'api_key');
eq(D.qvAcctOrigin({ source: 'env' }), 'environment', 'env');
eq(D.qvAcctOrigin({ source: 'environment' }), 'environment', 'environment spelled out');
eq(D.qvAcctOrigin({ source: 'keychain' }), 'keychain', 'keychain');
eq(D.qvAcctOrigin({ source: 'vault' }), 'vault', 'vault');
eq(D.qvAcctOrigin({ source: 'token' }), 'token', 'token');
eq(D.qvAcctOrigin({ auth_type: 'oauth' }), 'OAuth', 'falls back to auth_type');
eq(D.qvAcctOrigin({ source: 'keyring:file' }), 'auth file', 'last colon segment decides');
eq(D.qvAcctOrigin({ source: 'some/file' }), 'auth file', 'last slash segment decides');
eq(D.qvAcctOrigin({}), '', 'no source -> empty');
eq(D.qvAcctOrigin({ source: '   ' }), '', 'blank source -> empty');
eq(D.qvAcctOrigin({ source: 'mystery' }), '', 'unknown source is not echoed back');

// ── qvAcctUsage: per-key usage chips, levelled on the shared threshold ──────
eq(A.qvAcctUsage({}), '', 'no usage -> empty');
eq(A.qvAcctUsage({ usage: [] }), '', 'empty usage list -> empty');
const uch = A.qvAcctUsage({ usage: [{ label: '5h', used_percent: 30 }] });
has(uch, '<span class="qv-auchips">', 'chips wrapped in a container');
has(uch, '<span class="qv-achip qv-ok">5h 30%</span>', 'under threshold -> ok chip');
has(A.qvAcctUsage({ usage: [{ label: '5h', used_percent: 85 }] }), '<span class="qv-achip qv-bad">5h 85%</span>', 'at/over threshold -> bad chip');
has(A.qvAcctUsage({ usage: [{ label: 'x', used_percent: null }] }), '<span class="qv-achip qv-mute">x —</span>', 'unmeasured window -> mute chip with a dash');
has(A.qvAcctUsage({ usage: [{ label: '5h', used_percent: 65 }] }), '<span class="qv-achip qv-warn">5h 65%</span>', 'warn band chip');
has(D.qvAcctUsage({ usage: [{ label: '5h', used_percent: 30 }] }), 'qv-warn', 'no threshold -> chips warn rather than claim ok');

// ── qvAccount: one credential row ───────────────────────────────────────────
const acct = A.qvAccount({
  label: 'prod', id: 'a1', status: 'exhausted', in_use: false,
  request_count: 1, source: 'env', expires_at_ms: inSec(2 * 3600), models: ['gpt-5'],
}, 0, false);
has(acct, '<div class="qv-acct" data-level="warn" data-inuse="0">', 'row carries level and in-use flag');
has(acct, '<span class="qv-adot" aria-hidden="true"></span>', 'status dot present');
has(acct, '<b class="qv-aname">prod</b>', 'label is the name');
has(acct, '<span class="qv-astat qv-warn">exhausted</span>', 'state uses the same level scale');
has(acct, '<span class="qv-abits">1 call · environment · expires in 2h</span>', 'bits: count, origin, expiry');
has(acct, '<div class="qv-amodels" title="gpt-5">cooling: gpt-5</div>', 'cooling models line');
lacks(acct, 'qv-aidx', 'no ordinal while labels are unique');
lacks(acct, 'qv-why', 'no why box without a reason');

has(A.qvAccount({ label: 'k', status: 'ok' }, 2, true), '<span class="qv-aidx">#3</span>', 'ordinal is the payload index + 1');
has(A.qvAccount({ label: 'k', status: 'ok', request_count: 2 }, 0, false), '>2 calls<', 'call count pluralises');
has(A.qvAccount({ label: 'k', status: 'ok', in_use: true }, 0, false), 'data-inuse="1"', 'in_use truthy -> data-inuse 1');
has(A.qvAccount({ id: 'only-id', status: 'ok' }, 0, false), '<b class="qv-aname">only-id</b>', 'falls back to id when unlabelled');
has(A.qvAccount({}, 0, false), '<b class="qv-aname">key</b>', 'falls back to "key" when nameless');
has(A.qvAccount({ label: 'k', status: 'ok', models: ['', 'm1'] }, 0, false), '<div class="qv-amodels" title="m1">cooling: m1</div>', 'blank cooling models are dropped');

const dead = A.qvAccount({ label: 'k', status: 'dead', failure_reason: 'token revoked', in_use: true }, 0, false);
has(dead, 'data-level="bad"', 'dead key renders bad');
has(dead, 'data-inuse="1"', 'in-use dead key still flags in_use');
has(dead, '>needs re-login</span>', 'dead key says needs re-login');
has(dead, '<div class="qv-why" title="token revoked">token revoked</div>', 'reason becomes the why box');

const acctE = A.qvAccount({ label: '<x>', status: 'ok', failure_reason: 'a"b<c' }, 0, false);
has(acctE, '<b class="qv-aname">&lt;x&gt;</b>', 'label escaped in text');
has(acctE, '<div class="qv-why" title="a&quot;b&lt;c">a"b&lt;c</div>', 'reason escaped in the title, quote kept in text');

// ── qvAccounts: ranking, spend count, duplicate ordinals ────────────────────
const accs = A.qvAccounts({
  accounts: [{ label: 'a', status: 'ok' }, { label: 'b', status: 'exhausted' }, { label: 'c', status: 'dead' }],
});
has(accs, '<div class="qv-accts">', 'accounts wrapped in a container');
has(accs, '<div class="qv-keysum">3 keys · <b>2 spent</b></div>', 'summary counts the spent keys');
ok(accs.indexOf('>c</b>') < accs.indexOf('>b</b>') && accs.indexOf('>b</b>') < accs.indexOf('>a</b>'),
  'worst first: dead, then exhausted, then ok');
lacks(accs, 'qv-aidx', 'unique labels need no ordinals');
has(A.qvAccounts({ accounts: [{ label: 'solo', status: 'ok' }] }), '<div class="qv-keysum">1 key</div>', 'singular key count');
lacks(A.qvAccounts({ accounts: [{ label: 'solo', status: 'ok' }] }), 'spent', 'no spent segment when nothing is spent');
eq(A.qvAccounts({}), '', 'no accounts key -> empty');
eq(A.qvAccounts({ accounts: [] }), '', 'empty account list -> empty');

const dup = A.qvAccounts({ accounts: [{ label: 'same', status: 'ok' }, { label: 'same', status: 'ok' }] });
has(dup, '<span class="qv-aidx">#1</span>', 'first of a duplicated label gets an ordinal');
has(dup, '<span class="qv-aidx">#2</span>', 'second of a duplicated label gets an ordinal');

const unk = A.qvAccounts({ accounts: [{ label: 'u', status: 'weird' }, { label: 'd', status: 'dead' }] });
has(unk, '<div class="qv-keysum">2 keys · <b>1 spent</b></div>', 'only dead/exhausted count as spent');
ok(unk.indexOf('>d</b>') < unk.indexOf('>u</b>'), 'unknown status sorts after known-bad');

// ── qvBalance: one provider's credit ────────────────────────────────────────
eq(D.qvBalance({}), '', 'no amounts -> empty');
eq(D.qvBalance({ total_balance: '', granted_balance: null }), '', 'blank and null amounts are filtered out');
eq(D.qvBalance({ total_balance: '10.50' }),
  '<div class="qv-bal"><span class="qv-amt"><b>10.50</b> <span class="muted">total</span></span></div>',
  'total with no currency unit');
has(D.qvBalance({ currency: 'USD', granted_balance: '5' }), '<span class="qv-cur">USD</span>', 'currency unit shown');
has(D.qvBalance({ currency: 'USD', granted_balance: '5' }), '<b>5</b> <span class="muted">granted</span>', 'granted amount labelled');
has(D.qvBalance({ total_balance: 0 }), '<b>0</b>', 'zero is a reported amount, kept');
has(D.qvBalance({ total_balance: '9', granted_balance: '1', topped_up_balance: '2' }), '<span class="muted">topped up</span>', 'topped-up amount labelled');
eq(count(D.qvBalance({ total_balance: '9', granted_balance: '1', topped_up_balance: '2' }), 'qv-amt'), 3, 'three amounts rendered');
has(D.qvBalance({ currency: '<U>', total_balance: 'a<b' }), '<span class="qv-cur">&lt;U&gt;</span>', 'currency escaped');
has(D.qvBalance({ currency: '<U>', total_balance: 'a<b' }), '<b>a&lt;b</b>', 'amount escaped');

// ── qvHead: provider identity row ───────────────────────────────────────────
const hd = A.qvHead('anthropic', { label: 'Anthropic', max_used_percent: 65, api_calls_available: true, plan: 'pro' });
has(hd, '<div class="qv-head">[logo anthropic 22]', 'logo drawn at size 22 for this provider');
has(hd, '<b class="qv-name">Anthropic</b>', 'label is the provider name');
has(hd, '<span class="qv-plan">pro</span>', 'plan shown');
has(hd, '<span class="rt-st rt-ok">callable</span>', 'callable status chip');
has(hd, '<span class="qv-pct qv-warn">65% max</span>', 'worst window maps through qvLevel');
has(A.qvHead('p', { label: 'P', max_used_percent: 10, attention: true }), '<span class="qv-pct qv-bad">10% max</span>', 'attention flag forces bad regardless of the number');
has(A.qvHead('p', { label: 'P', attention: true }), '<span class="qv-pct qv-bad">no reading</span>', 'attention with no reading is still bad');
const hdMute = A.qvHead('p', { label: 'P' });
has(hdMute, '<span class="rt-st rt-mute">not reported</span>', 'missing api_calls_available -> not reported');
has(hdMute, '<span class="qv-pct qv-mute">no reading</span>', 'missing worst reading -> mute');
has(A.qvHead('p', { label: 'P', api_calls_available: false }), '<span class="rt-st rt-bad">exhausted</span>', 'false api_calls_available -> exhausted');
has(A.qvHead('p', { label: 'llama:free' }), '<span class="qv-free" title="no-cost plan">free</span>', 'free plan badge');
has(A.qvHead('p', { label: 'P', unavailable_reason: 'quota gone' }), '<span class="qv-why" title="quota gone">quota gone</span>', 'unavailable reason shown');
const hdE = A.qvHead('weird"id', { label: '<L>', plan: '<P>', unavailable_reason: 'a"b' });
has(hdE, '[logo weird"id 22]', 'logo receives the raw provider id');
has(hdE, '<b class="qv-name">&lt;L&gt;</b>', 'label escaped');
has(hdE, '<span class="qv-plan">&lt;P&gt;</span>', 'plan escaped');
has(hdE, '<span class="qv-why" title="a&quot;b">a"b</span>', 'reason escaped in the title, quote kept in text');

// ── qvProviders: the grid, worst first, unmeasured last ─────────────────────
eq(D.qvProviders({}),
  '<div class="muted">No providers in this profile yet.</div>',
  'no providers, no note -> quiet "empty" line, no plugin blame');
has(D.qvProviders({ note: 'stale' }),
  'No quota data (stale) — the Hermes quota plugin has not cached this profile yet.',
  'cache note folded into the message');
has(D.qvProviders({ note: 'stale' }), 'Run the plugin under this profile once to cache its headroom.',
  'uncached card names the mechanism that fills it');

const grid = A.qvProviders({ providers: { a: { max_used_percent: 10 }, b: { max_used_percent: 80 }, c: {} } });
has(grid, '<div class="qv-grid">', 'grid wrapper');
ok(grid.indexOf('data-provider="b"') < grid.indexOf('data-provider="a"') &&
   grid.indexOf('data-provider="a"') < grid.indexOf('data-provider="c"'),
  'cards sorted worst first, unmeasured last');
has(grid, '<div class="muted qv-wins-none">No usage windows reported.</div>', 'windowless provider gets the none message');
has(A.qvProviders({ providers: { p: { attention: true } } }), 'qv-prov qv-near', 'near-limit card flagged');
lacks(A.qvProviders({ providers: { p: {} } }), 'qv-near', 'quiet card not flagged');
has(A.qvProviders({ providers: { 'a"b': {} } }), 'data-provider="a&quot;b"', 'provider id escaped in the data attribute');
const wins = A.qvProviders({ providers: { p: { windows: [{ label: '5h', used_percent: 30 }] } } });
has(wins, '<div class="qv-wins">', 'windows container present');
has(wins, '<span class="qv-wname">5h</span>', 'window rendered inside the card');
lacks(wins, 'qv-keysum', 'no key summary when the cache reports no per-key records');

// ── qvBalances: the balances sub-page ───────────────────────────────────────
eq(D.qvBalances({}), '<div class="muted">No provider reports an account balance.</div>', 'no balances -> message');
eq(D.qvBalances({ providers: { a: { balances: [] } } }), '<div class="muted">No provider reports an account balance.</div>', 'empty balance lists are filtered out');
const bals = D.qvBalances({ providers: { a: { label: 'A', balances: [{ total_balance: '1', currency: 'USD' }] }, b: { label: 'B' } } });
has(bals, '<div class="qv-balrow"><b>A</b>', 'balance row labelled by provider');
has(bals, '<span class="qv-cur">USD</span>', 'balance rendered inside the row');
lacks(bals, '<b>B</b>', 'provider without balances is omitted');
has(D.qvBalances({ providers: { 'x"y': { balances: [{ total_balance: '1' }] } } }), '<b>x"y</b>', 'label falls back to the provider id');

// ── qvNotes: the notes sub-page, plus the scrub notice ──────────────────────
const noteHead = '<div class="rt-note muted">Free text is reproduced as the provider sent it, after credential-shaped substrings were replaced with [REDACTED] on the server. Keys and tokens never reach this page.</div>';
eq(D.qvNotes({}), noteHead + '<div class="muted">No provider notes.</div>', 'no notes -> notice plus empty message');
const notes = D.qvNotes({ providers: {
  a: { label: 'A', details: ['first note', 'second'] },
  b: { label: 'B' },
  c: { label: 'C', unavailable_reason: 'down' },
} });
has(notes, '<div class="qv-note"><b>A</b><div class="qv-detail">first note</div><div class="qv-detail">second</div></div>', 'details listed in order');
has(notes, '<div class="qv-note"><b>C</b><div class="qv-why">down</div></div>', 'unavailable reason becomes a note');
lacks(notes, '<b>B</b>', 'provider with neither details nor reason is omitted');
has(notes, noteHead, 'scrub notice always present');
lacks(D.qvNotes({ providers: { a: { details: ['ok'] } } }), 'No provider notes.', 'empty message dropped once notes exist');
has(D.qvNotes({ providers: { a: { details: ['<b>x</b>'] } } }), '<div class="qv-detail">&lt;b&gt;x&lt;/b&gt;</div>', 'detail text escaped');
has(D.qvNotes({ providers: { a: { unavailable_reason: 'a"b' } } }), '<div class="qv-why">a"b</div>', 'reason text keeps a plain quote');

// ── persistence: localStorage is read at call time, so swap the global ──────
const savedLS = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const fakeLS = (store = {}) => ({
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  store,
});
const setLS = (v) => Object.defineProperty(globalThis, 'localStorage', { value: v, configurable: true, writable: true });
try {
  setLS(fakeLS({ 'hermes-dash-quota-page': 'balances' }));
  eq(D.qvPageGet(), 'balances', 'stored page is restored');
  globalThis.localStorage.store['hermes-dash-quota-page'] = 'bogus';
  eq(D.qvPageGet(), 'headroom', 'unknown stored page falls back to headroom');
  setLS({ getItem() { throw new Error('private mode'); } });
  eq(D.qvPageGet(), 'headroom', 'storage that throws falls back to headroom');

  const ls2 = fakeLS();
  setLS(ls2);
  D.qvPageSet('notes');
  eq(ls2.store['hermes-dash-quota-page'], 'notes', 'qvPageSet stores a known page');
  D.qvPageSet('bogus');
  eq(ls2.store['hermes-dash-quota-page'], 'notes', 'qvPageSet ignores an unknown page');

  const ls3 = fakeLS();
  setLS(ls3);
  D.qvSaveFold('p1|headroom', false);
  D.qvSaveFold('p2|headroom', false);
  eq([...D.qvFolded()].sort().join(','), 'p1|headroom,p2|headroom', 'fold state is keyed profile|card');
  D.qvSaveFold('p1|headroom', true);
  eq([...D.qvFolded()].join(','), 'p2|headroom', 'reopening removes only that key');
  ls3.store['hermes-dash-quota-folded'] = '{not json';
  eq([...D.qvFolded()].length, 0, 'corrupt fold state -> nothing folded');
  setLS({ getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } });
  eq([...D.qvFolded()].length, 0, 'storage that throws -> nothing folded');
  let foldThrew = false;
  try { D.qvSaveFold('k', false); } catch { foldThrew = true; }
  eq(foldThrew, false, 'qvSaveFold swallows a storage write failure');

  delete globalThis.localStorage;
  eq([...D.qvFolded()].length, 0, 'no storage at all -> nothing folded');
  eq(D.qvPageGet(), 'headroom', 'no storage at all -> headroom');

  // ── qvKpis: the four summary tiles ────────────────────────────────────────
  eq(D.qvKpis({}), '', 'no providers -> no tiles');
  eq(D.qvKpis({ providers: {} }), '', 'empty provider map -> no tiles');
  const k = D.qvKpis({ providers: {
    a: {},
    b: { unavailable_reason: 'x' },
    c: { attention: true, accounts: [{ status: 'ok' }, { status: 'dead' }] },
  } });
  has(k, '<div class="qv-kpi"><b class="qv-kv">3</b><span>providers</span></div>', 'provider count tile (plural)');
  has(k, '<div class="qv-kpi qv-kpi-warn"><b class="qv-kv">2/3</b><span>available</span></div>', 'availability tile warns when one is down');
  has(k, '<div class="qv-kpi qv-kpi-bad"><b class="qv-kv">1</b><span>near limit</span></div>', 'near-limit tile is bad when non-zero');
  has(k, '<div class="qv-kpi qv-kpi-warn"><b class="qv-kv">1/2</b><span>keys usable</span></div>', 'keys-usable tile warns when a key is down');
  const k1 = D.qvKpis({ providers: { p: {} } });
  has(k1, '<div class="qv-kpi"><b class="qv-kv">1</b><span>provider</span></div>', 'provider count tile (singular)');
  has(k1, '<div class="qv-kpi qv-kpi-ok"><b class="qv-kv">0</b><span>near limit</span></div>', 'near-limit tile is ok at zero');
  lacks(k1, 'keys usable', 'no keys tile when no provider reports keys');

  // ── qvSection: one profile's <details> block ──────────────────────────────
  setLS(fakeLS());
  const sec = D.qvSection('alpha', { providers: { p: {} } });
  has(sec, '<details class="rt-profile" data-profile="alpha" data-qvfold="alpha|*" open>', 'profile block open by default');
  has(sec, '<h2>alpha</h2>', 'profile name heading');
  has(sec, '<span class="rt-auth rt-ok">all clear</span>', 'all-clear badge when nothing is near');
  has(sec, '1 provider', 'provider count, singular');
  has(sec, ' · threshold unknown', 'threshold-unknown note when no attention_percent');
  has(sec, 'Provider headroom', 'headroom card title');
  has(sec, 'share of each usage window consumed, worst first', 'headroom card subtitle');
  has(sec, 'data-qvfold="alpha|headroom" open>', 'headroom card open by default');
  has(sec, '<div class="rt-cbody">', 'card body wrapper');
  has(sec, '<button type="button" data-qvall="open">expand all</button>', 'expand-all control');
  has(sec, '<button type="button" data-qvall="close">collapse all</button>', 'collapse-all control');
  has(D.qvSection('beta', { providers: { p: {}, q: {} } }), '2 providers', 'provider count, plural');

  const secNear = A.qvSection('beta', { providers: { p: { attention: true }, q: { attention: true } } });
  has(secNear, '<span class="rt-auth rt-warn">2 near limit</span>', 'near-limit badge');
  lacks(secNear, 'threshold unknown', 'no unknown-threshold note when the collector shipped one');

  has(A.qvSection('gamma', { providers: { p: {} }, cache_fetched_at: '2026-01-01T00:00:00Z' }), ' · cached AGO', 'cache age appended when stamped');

  setLS(fakeLS({ 'hermes-dash-quota-folded': JSON.stringify(['alpha|*', 'alpha|headroom']) }));
  const secFold = D.qvSection('alpha', { providers: { p: {} } });
  has(secFold, 'data-qvfold="alpha|*">', 'a folded profile renders collapsed');
  has(secFold, 'data-qvfold="alpha|headroom">', 'a folded card renders collapsed');
  lacks(secFold, 'data-qvfold="alpha|*" open>', 'folded profile carries no open attribute');

  const lsP = fakeLS({ 'hermes-dash-quota-page': 'balances' });
  setLS(lsP);
  const secB = D.qvSection('alpha', { providers: { p: {} } });
  has(secB, 'Account balances', 'balances sub-page selected from storage');
  has(secB, 'credit the provider reports', 'balances card subtitle');
  lacks(secB, 'Provider headroom', 'headroom card not rendered on the balances page');
  lsP.store['hermes-dash-quota-page'] = 'notes';
  has(D.qvSection('alpha', { providers: { p: {} } }), 'Provider notes', 'notes sub-page selected from storage');
  has(D.qvSection('alpha', { providers: { p: {} } }), 'as sent, after scrubbing', 'notes card subtitle');

  // ── qvStat: the one-line summary ──────────────────────────────────────────
  eq(D.qvStat(), 'No data', 'no quota payload at all');
  eq((await load({ current: 'p1', DATA: { quota: { p1: { providers: { a: {}, b: { attention: true } } } } } })).qvStat(),
    '1/2 near limit', 'single profile counts its near-limit providers');
  eq((await load({ current: 'p1', DATA: { quota: { p1: { providers: { a: {} } } } } })).qvStat(),
    '1 provider clear', 'single clear provider, singular');
  eq((await load({ current: 'p1', DATA: { quota: { p1: { providers: { a: {}, b: {} } } } } })).qvStat(),
    '2 providers clear', 'two clear providers, plural');
  eq((await load({ current: 'missing', DATA: { quota: { p1: { providers: { a: {} } } } } })).qvStat(),
    '1 provider clear', 'unknown current profile falls back to the whole cache');
  eq((await load({ current: 'All', DATA: { quota: {
    p1: { providers: { a: {} } },
    p2: { providers: { b: { unavailable_reason: 'x' } } },
  } } })).qvStat(), '1/2 available', 'fleet view counts availability across profiles');
  eq((await load({ current: 'All', DATA: {
    quota: { p1: { providers: { a: {} } }, p2: { providers: { b: {} } } },
    quota_meta: { summary: { available: 5, providers: 9 } },
  } })).qvStat(), '5/9 available', 'fleet view prefers the collector summary when present');
  eq((await load({ current: 'p1', DATA: { quota: { p1: { note: 'no-quota-cache' } } } })).qvStat(),
    'not cached', 'a selected uncached profile says so, never "providers clear"');
  eq((await load({ current: 'All', DATA: { quota: {
    p1: { note: 'no-quota-cache' }, p2: { note: 'no-quota-cache' },
  } } })).qvStat(), 'no cached profiles', 'fleet of only-uncached profiles says so');

  // ── qvFleet: the tab-scope overview strip (#152) ──────────────────────────
  eq((await load({ DATA: {} })).qvFleet(), '', 'no quota payload -> no fleet strip');
  eq((await load({ DATA: { quota: { p1: { note: 'no-quota-cache' } } } })).qvFleet(),
    '', 'no providers anywhere -> no fleet strip');
  const fk = (await load({ DATA: {
    quota: {
      p1: { providers: { a: {}, b: { attention: true } } },
      p2: { providers: { c: { unavailable_reason: 'down' }, d: {} } },
    },
    quota_meta: {},
  } })).qvFleet();
  has(fk, '<div class="qv-fleet">', 'fleet strip wrapper');
  has(fk, '<div class="qv-fkpi"><b class="qv-kv">4</b><span>providers</span></div>', 'fleet provider count');
  has(fk, '<div class="qv-fkpi qv-kpi-warn"><b class="qv-kv">3/4</b><span>with figures</span></div>',
    'fleet availability warns when one is down');
  has(fk, '<div class="qv-fkpi qv-kpi-bad"><b class="qv-kv">1</b><span>near limit</span></div>', 'fleet near-limit tile is bad when non-zero');
  lacks(fk, 'keys usable', 'no keys tile when no provider reports accounts');
  const spent = (await load({ DATA: {
    quota: { p1: { providers: { a: { accounts: [
      { status: 'ok' }, { status: 'exhausted' }, { status: 'dead' }, {},
    ] } } } },
    quota_meta: {},
  } })).qvFleet();
  has(spent, '<div class="qv-fkpi qv-kpi-warn"><b class="qv-kv">2/4</b><span>keys usable</span></div>',
    'fleet keys tile mirrors the collector: only exhausted/dead count out');
  const fk2 = (await load({ DATA: {
    quota: { p1: { providers: { a: {}, b: {} } } },
    quota_meta: {},
  } })).qvFleet();
  has(fk2, '<div class="qv-fkpi qv-kpi-ok"><b class="qv-kv">0</b><span>near limit</span></div>', 'fleet near-limit tile is ok at zero');
  has(fk2, '<div class="qv-fkpi"><b class="qv-kv">2/2</b><span>with figures</span></div>', 'fleet availability ok when all up');

  // ── qvUncached: one explainer, not one shell per profile (#152) ───────────
  eq((await load({ DATA: {} })).qvUncached(), '', 'no payload -> no explainer');
  eq((await load({ DATA: { quota: { p1: { providers: { a: {} } } } } })).qvUncached(),
    '', 'no uncached profiles -> no explainer');
  const un = (await load({ DATA: { quota: {
    gamma: { note: 'no-quota-cache' },
    beta: { note: 'no-quota-cache' },
    alpha: { providers: { a: {} } },
  } } })).qvUncached();
  has(un, 'class="card rt-card qv-uncached"', 'explainer card wrapper');
  has(un, '<b class="lbl">No quota data (no-quota-cache)</b>', 'explainer names the collector note');
  has(un, 'has not cached profiles beta, gamma', 'explainer lists the uncached profiles, sorted');
  has(un, 'one cache per profile home', 'explainer states the mechanism');
  has(un, 'Hermes has run under it with the quota plugin installed', 'explainer names what fills the cache');

  // ── renderQuotaView ───────────────────────────────────────────────────────
  const qvEl = { innerHTML: '', querySelectorAll: () => [] };
  const subEl = { textContent: '' };
  const Rv = await load({ $: (id) => (id === 'quotaview' ? qvEl : id === 'quotasub' ? subEl : null), DATA: {} });
  setLS(fakeLS());
  Rv.renderQuotaView();
  eq(qvEl.innerHTML,
    '<div class="card rt-card muted">No quota data — the Hermes quota plugin has not cached any profile yet.</div>',
    'empty quota renders the single message card');
  eq(subEl.textContent, 'refreshed hourly', 'sub line without a collected_at stamp');

  const qvEl2 = { innerHTML: '', querySelectorAll: () => [] };
  const subEl2 = { textContent: '' };
  const Rv2 = await load({
    $: (id) => (id === 'quotaview' ? qvEl2 : id === 'quotasub' ? subEl2 : null),
    DATA: { quota_meta: { collected_at: 1 }, quota: { p1: { providers: { p: {} } } } },
  });
  setLS(fakeLS());
  Rv2.renderQuotaView();
  eq(subEl2.textContent, 'refreshed hourly · last AGO', 'sub line shows the cache age when stamped');
  has(qvEl2.innerHTML, '<nav class="rt-pages" aria-label="Quota pages">', 'page strip rendered');
  has(qvEl2.innerHTML, '<button type="button" data-qvpage="headroom" aria-current="page"', 'active page marked current');
  has(qvEl2.innerHTML, 'class="rt-page rt-page-on"', 'active page class applied');
  has(qvEl2.innerHTML, '<button type="button" data-qvpage="balances"', 'inactive page button present');
  lacks(qvEl2.innerHTML, 'data-qvpage="balances" aria-current', 'only the active page is current');
  has(qvEl2.innerHTML, 'data-profile="p1"', 'a section is rendered per cached profile');
  has(qvEl2.innerHTML, 'Provider headroom', 'active sub-page body rendered inside the section');
} finally {
  if (savedLS) Object.defineProperty(globalThis, 'localStorage', savedLS);
  else delete globalThis.localStorage;
}

console.log(`unit_quotaview: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
