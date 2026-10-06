// #30: routerview.js as a unit — the Router tab's pure HTML builders and its
// page/fold persistence, called directly. Expected values are hand-derived
// from the module's documented rules (tier hues, auth table, rtAgo bands).
import { isolate } from './lib/isolate.mjs';

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — got ' + JSON.stringify(got) : ''}`); }
};
const eq = (got, want, name) => chk(JSON.stringify(got) === JSON.stringify(want), name, got);
const has = (s, sub, name) => chk(s.includes(sub), name, s);
const lacks = (s, sub, name) => chk(!s.includes(sub), name, s);
const count = (s, sub) => s.split(sub).length - 1;

// Real escapers: the builders' safety is part of what is under test.
const P = await isolate('palette.js', { 'main.js': { DATA: {} }, 'views.js': { PROV: {} } });
const fakeLS = (store = {}) => ({
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  store,
});
async function rv(ls = fakeLS()) {
  return isolate('routerview.js', {
    'palette.js': { $: () => null, esc: P.esc, escA: P.escA },
    'charts.js': { current: null },
    'main.js': { DATA: {} },
  }, { localStorage: ls });
}
const R = await rv();

// --- tier hues: membership, not truthiness (complex's hue is 0) ---
eq(R.rtHue('complex'), 0, 'complex keeps hue 0, not the 220 fallback');
eq(R.rtHue('plan'), 290, 'plan hue');
eq(R.rtHue('trivial'), 160, 'trivial hue');
eq(R.rtHue('made-up'), 220, 'unknown tier falls back to 220');
has(R.rtTierChip('complex'), 'style="--h:0"', 'tier chip carries hue 0');
has(R.rtTierChip('test', '<sup>*</sup>'), 'test<sup>*</sup></span>', 'tier chip appends extra after the name');
has(R.rtTierChip('<x>'), '&lt;x&gt;', 'tier chip escapes the name');

// --- provider logos ---
const an = R.rtLogo('anthropic');
has(an, '<svg class="rt-logo-svg"', 'anthropic uses its brand path');
has(an, '--c:#d97757;--px:18px', 'anthropic colour, default size 18');
has(an, 'title="Anthropic"', 'anthropic display name');
const nous = R.rtLogo('nous', 20);
has(nous, '<span class="rt-mono">N</span>', 'no brand path -> monogram tile');
has(nous, '--px:20px', 'explicit size honoured');
lacks(nous, '<svg', 'monogram has no svg');
const unk = R.rtLogo('xyz-prov');
has(unk, '<span class="rt-mono">XY</span>', 'unknown provider -> first two letters upper-cased');
has(unk, '--c:#8b98ab', 'unknown provider grey');
has(unk, 'title="xyz-prov"', 'unknown provider titled by its id');
has(R.rtLogo(undefined), 'title="unknown"', 'missing provider titled unknown');
has(R.rtLogo(undefined), '<span class="rt-mono">?</span>', 'missing provider monogram ?');
const evil = R.rtLogo('"><b');
has(evil, 'title="&quot;&gt;&lt;b"', 'provider id escaped in the attribute');
has(evil, '<span class="rt-mono">&quot;&gt;</span>'.replace('&quot;', '"'), 'monogram text escaped');
eq(R.RT_LOGO['ollama-cloud'].svg, 'ollama', 'ollama-cloud maps to the ollama mark');

// --- model chip ---
has(R.rtModel(null), '<span class="muted">—</span>', 'no model -> muted dash');
has(R.rtModel({ provider: 'p' }), '—', 'entry without a model -> dash');
const m = { model: 'gpt-x', provider: 'slot1', prov: 'openai' };
has(R.rtModel(m, { 'gpt-x@slot1': 3 }), '<span class="rt-hits" title="router decisions in the window">3×</span>', 'hit count keyed model@provider');
lacks(R.rtModel(m, { 'gpt-x@other': 3 }), 'rt-hits', 'hits for another slot are not counted');
lacks(R.rtModel(m), 'rt-hits', 'no hits map -> no count');
has(R.rtModel({ ...m, url: 'http://h:1' }), 'title="gpt-x via slot1 · http://h:1"', 'title adds the endpoint url');
has(R.rtModel({ ...m, model: '<img>' }), '<span class="rt-mname">&lt;img&gt;</span>', 'model name escaped');

// --- auth + status badges ---
eq(R.rtAuthBadge(undefined), '', 'no auth -> empty');
eq(R.rtAuthBadge({ type: 'oauth' }), '<span class="rt-auth rt-ok">OAuth</span>', 'oauth badge');
eq(R.rtAuthBadge({ type: 'none' }), '<span class="rt-auth rt-mute">No auth</span>', 'none is muted, not bad');
eq(R.rtAuthBadge({ type: 'weird' }), '<span class="rt-auth rt-bad">No credential</span>', 'unknown type -> No credential (bad)');
eq(R.rtStatus(''), '', 'no status -> empty');
has(R.rtStatus('ok'), 'rt-ok', 'ok status');
has(R.rtStatus('dead'), 'rt-bad', 'dead is bad');
has(R.rtStatus('revoked'), 'rt-bad', 'revoked is bad');
has(R.rtStatus('cooldown'), 'rt-warn', 'anything else warns');

// --- rtAgo bands: <90s just now, <90m minutes, <48h hours, else days ---
const now = () => Date.now() / 1000;
eq(R.rtAgo(0), '', 'no timestamp -> empty');
eq(R.rtAgo(now() - 30), 'just now', '30s -> just now');
eq(R.rtAgo(now() - 89), 'just now', '89s -> just now');
eq(R.rtAgo(now() - 91), '2m ago', '91s -> 2m (rounded)');
eq(R.rtAgo(now() - 45 * 60), '45m ago', '45 min');
eq(R.rtAgo(now() - 80 * 60), '80m ago', '80 min still minutes (hours start at 90)');
eq(R.rtAgo(now() - 5401), '2h ago', '90 min crosses to hours');
eq(R.rtAgo(now() - 47 * 3600), '47h ago', '47 h stays in hours');
eq(R.rtAgo(now() - 172801), '2d ago', '48 h crosses to days');
eq(R.rtAgo(now() + 600), 'just now', 'future timestamp clamps to just now');

// --- routing matrix ---
const tr = { routes: { coding: { easy: 'trivial', hard: 'complex' } }, custom_routes: ['coding/easy'] };
const mx = R.rtMatrix({ tier_router: tr, decisions: { by_route: { 'coding/hard': 4 } } }, {});
eq(count(mx, '<td>'), 3, 'one row x default three levels');
has(mx, '<th title="">easy</th><th title="">medium</th><th title="">hard</th>', 'default levels in order');
has(mx, '<td>—</td>', 'unrouted cell is a dash');
eq(count(mx, '<sup'), 1, 'only the overridden cell is starred');
has(mx, '>4</span></td>', 'classifier count shown on coding/hard');
eq(count(mx, 'rt-n'), 1, 'no count where the classifier never said it');
const mx2 = R.rtMatrix({ tier_router: tr }, { categories: ['coding', 'chat'], levels: ['x'] });
eq(count(mx2, '<td>'), 2, 'vocab categories x levels drive the grid');

// --- workers ---
has(R.rtWorkers({}), 'No background tasks configured.', 'empty workers message');
const wk = R.rtWorkers({
  tasks: [{ task: 'title_gen', model: 'a', provider: 'p', doc: 'Names chats', fallbacks: 2 }],
  delegation: { model: 'b', provider: 'p', max_children: 4, fallbacks: 0 },
  moa: { agg: { model: 'c', provider: 'p' }, refs: [1, 2, 3], fanout: 'parallel' },
});
eq(count(wk, 'class="rt-worker"'), 3, 'task + delegation + moa rows');
has(wk, '>title gen</div>', 'underscores become spaces');
has(wk, '+2 fallbacks', 'fallback count shown');
eq(count(wk, 'fallbacks</span>'), 1, 'zero fallbacks not shown');
has(wk, 'Subagents (up to 4 at once).', 'delegation doc');
has(wk, 'Aggregates 3 reference models (parallel).', 'moa doc');

// --- provider/auth table: distinct models per slot across every role ---
eq(R.rtAuthTable({}).includes('No providers.'), true, 'no auth -> No providers.');
const at = R.rtAuthTable({
  auth: {
    slotA: { prov: 'openai', type: 'api_key', creds: [{ label: 'k1', source: 'env', auth_type: 'api_key', last_status: 'dead' }] },
    slotB: { prov: 'slotB', type: 'unknown', creds: [], note: 'set KEY_B' },
  },
  primary: { model: 'm1', provider: 'slotA' },
  chain: [{ model: 'm1', provider: 'slotA' }, { model: 'm2', provider: 'slotA' }],
  tier_router: { classifier: { pool: [{ model: 'm3', provider: 'slotA' }] },
    tiers: [{ pool: [{ model: 'm4', provider: 'slotB' }], fallback: [{ model: 'm1', provider: 'slotA' }] }] },
});
has(at, '<td>3</td></tr>', 'slotA: m1,m2,m3 distinct (m1 counted once)');
has(at, '<td>1</td></tr>', 'slotB: m4 from a tier pool');
has(at, '<b>slotA</b> <span class="muted">openai</span>', 'slot differing from provider shows the provider');
has(at, '<b>slotB</b></td>', 'slot equal to provider shows no suffix');
has(at, 'set KEY_B', 'credential-less slot shows its note');
has(at, 'API key · env', 'cred type and source');
has(at, 'rt-st rt-bad', 'dead credential flagged');
has(at, 'Keys and tokens never leave the server', 'no-secrets note present');

// --- decision log ---
has(R.rtDecisions({}), 'No agent log found for this profile.', 'no decisions -> no log message');
const d = { total: 10, escalations: 3, defaulted: 2, failed_open: 0, budget_exhausted: 0,
  classifier_failures: { a: 1, b: 5 }, window_days: 7, recent: [] };
const dh = R.rtDecisions({ decisions: d });
eq(count(dh, 'rt-kpi rt-kbad'), 1, 'only non-zero bad KPIs are red (escalations never are)');
chk(dh.indexOf('b ×5') < dh.indexOf('a ×1') && dh.includes('a ×1'), 'failures sorted most first');
has(dh, 'No routing decisions in the last 7 days.', 'empty recent list message');
const dr = R.rtDecisions({ decisions: { ...d, classifier_failures: {}, recent: [
  { ts: now() - 30, reason: 'classifier:coding/hard', tier: 'complex', used: 'plan', model: 'x', prov: 'openai' },
  { ts: now() - 30, reason: 'classifier:chat/easy', tier: 'trivial', used: 'trivial', model: 'y', prov: 'openai' },
] } });
lacks(dr, 'Classifier failures', 'no failures line when none');
has(dr, '<td>coding · hard</td>', 'reason prefix stripped and slash spelled out');
eq(count(dr, ' → '), 1, 'escalation arrow only where used differs from tier');

// --- sub-page + fold persistence ---
eq((await rv(fakeLS({ 'hermes-dash-router-page': 'matrix' }))).rtPage, 'matrix', 'stored page restored on load');
eq((await rv(fakeLS({ 'hermes-dash-router-page': 'bogus' }))).rtPage, 'overview', 'unknown stored page -> overview');
eq((await rv({ getItem() { throw new Error('private'); } })).rtPage, 'overview', 'storage throwing -> overview');
const R2 = await rv(fakeLS({ 'hermes-dash-router-page': 'workers' }));
R2.rtPageSet('bogus');
eq(R2.rtPage, 'workers', 'rtPageSet ignores unknown pages');
R2.rtPageSet('workers');
eq(R2.rtPage, 'workers', 'rtPageSet same page is a no-op (no render)');

const saved = globalThis.localStorage;
try {
  const ls = fakeLS();
  globalThis.localStorage = ls;
  R.rtSaveFold('p1|auth', false);
  R.rtSaveFold('p2|auth', false);
  eq([...R.rtFolded()].sort(), ['p1|auth', 'p2|auth'], 'folding is per profile|card');
  R.rtSaveFold('p1|auth', true);
  eq([...R.rtFolded()], ['p2|auth'], 'reopening removes only that key');
  ls.store['hermes-dash-router-folded'] = '{not json';
  eq([...R.rtFolded()], [], 'corrupt fold state -> nothing folded');
} finally {
  if (saved === undefined) delete globalThis.localStorage; else globalThis.localStorage = saved;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
