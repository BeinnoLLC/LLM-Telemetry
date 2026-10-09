// #150: main.js as a unit — the payload merge and the boot wiring, no page
// load. Expected values are hand-derived from the merge rules in main.js
// (sums vs concatenation, the sorts, the documented caps, the rate rounding),
// NOT captured from current output, so a change in a rule fails here instead of
// only shifting a table on the dashboard.
//
// Two globals can only be the real things: `getComputedStyle` and the DOM are
// installed on globalThis before the module is evaluated, because main.js reads
// them at load time and `isolate()` restores its injected globals afterwards.
import { isolate } from './lib/isolate.mjs';

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — got ' + JSON.stringify(got) : ''}`); }
};
const eq = (got, want, name) => chk(JSON.stringify(got) === JSON.stringify(want), name, got);

// ---- a DOM small enough to reason about --------------------------------
const el = () => {
  const classes = new Set();
  return {
    onclick: null, textContent: '', style: {},
    classList: {
      add: c => classes.add(c), remove: c => classes.delete(c),
      contains: c => classes.has(c), toggle: c => classes.has(c) ? classes.delete(c) : classes.add(c),
    },
    _classes: classes,
    setAttribute() {}, remove() {}, appendChild() {},
    querySelectorAll: () => [], addEventListener() {},
  };
};
const els = {};
const attrs = {};
globalThis.document = {
  documentElement: {
    getAttribute: k => (k in attrs ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = String(v); },
    removeAttribute: k => { delete attrs[k]; },
  },
  getElementById: id => (els[id] ||= el()),
  querySelectorAll: () => [], addEventListener() {},
};
globalThis.localStorage = {
  _d: {},
  getItem(k) { return k in this._d ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
};
globalThis.getComputedStyle = () => ({ getPropertyValue: k => (k === '--known' ? '  #fff  ' : '') });
const timers = [];
globalThis.setTimeout = (fn, ms) => { timers.push([fn, ms]); return timers.length; };
globalThis.requestAnimationFrame = () => 0;

// ---- spies -------------------------------------------------------------
const calls = { render: 0, readTheme: 0, pickView: [], pick: [], setFilters: 0, merged: [] };
const M = await isolate('main.js', {
  'palette.js': {
    $: id => (els[id] ||= el()),
    pick: v => { calls.pick.push(v); },
    readTheme: () => { calls.readTheme++; },
  },
  'charts.js': { CHART_ANIM_DONE: false, current: 'x' },
  'views.js': { render: () => { calls.render++; } },
  'live.js': { mergeDelegations: list => { calls.merged.push(list); return { merged: list.length }; } },
  'router.js': {
    pickView: v => { calls.pickView.push(v); },
    setFiltersFromHash: () => { calls.setFilters++; },
    view: 'dashboard', viewFromHash: () => null,
  },
}, {
  __DATA__: { profiles: { p1: { rows: [] } } },
  __LOCAL_HOSTS__: ['192.168.1.12'],
  __SCHEMA_VERSION__: 7,
});

// ---- the payload contract ----------------------------------------------
eq(M.DATA, { profiles: { p1: { rows: [] } } }, 'DATA is the injected payload');
eq(M.LOCAL_HOSTS, ['192.168.1.12'], 'LOCAL_HOSTS is injected from config');
eq(M.SCHEMA_VERSION, 7, 'SCHEMA_VERSION is injected from config');
eq(M.css('--known'), '#fff', 'css() trims the computed value');
eq(M.css('--missing'), '#888', 'css() falls back when the variable is empty');

// ---- boot wiring --------------------------------------------------------
eq(calls.setFilters, 1, 'setFiltersFromHash runs once at boot');
eq(calls.pickView, ['dashboard'], 'pickView uses router.view when the hash is empty');
eq(calls.pick, ['x'], 'pick paints the current chart');
eq(typeof M.installAll, 'function', 'installAll still exists for its three call sites');
eq(M.installAll(), undefined, 'installAll is a no-op (#121 removed the All profile)');

// ---- merge: nothing to merge -------------------------------------------
eq(M.buildAll({}), null, 'buildAll(null-ish) returns null with no profiles');
eq(M.buildAll({ p1: {} }), null, 'one profile is not a merge');
eq(M.buildAll({ All: { rows: [{ date: 'd' }] } }), null, 'the All key alone is not a merge');

// ---- merge: concatenation, tagging and sums ----------------------------
const hours = [{ hour: 'h1' }];
const rowsList = [
  { date: '2026-01-02', calls: 1 }, { date: '2026-01-01', calls: 2 },
];
const merged = M.buildAll({
  All: { rows: [{ date: '2026-12-31' }] },          // must be ignored
  p1: {
    rows: rowsList, hour_rows: [{ hour: 'x' }], hours, sessions: [{ id: 's1' }],
    live: [{ ts: 5 }], tools_recent: [{ tool: 'read', calls: 3 }],
    failures_recent: [{ when: '2026-01-01T00:00:01Z', kind: 'a' }],
    health: [{ model: 'gpt', ok: 1, fail: 1, total: 2, kinds: { throttle: 1 },
               last: '2026-01-01T00:00:00Z', last_kind: 'throttle', last_msg: 'late' }],
    end_reasons: [{ reason: 'stop', n: 2 }],
    compression_pressure: [{ ineffective_count: 1, fallback_streak: 9, id: 'a' }],
    recent_sessions: [{ last_ts: 10, id: 'a' }], resend: [{ resend_usd: 1.5, id: 'a' }],
    heatmap: [{ d: '2026-01-02', p: 'openai', url: 'https://a', m: 'gpt', v: 2 }],
    node_sessions: { n1: [{ calls: 1, id: 'a' }] },
    delegations: ['p1-deleg'], bandwidth_daily: [{ day: '2026-01-01' }],
  },
  p2: {
    rows: [{ date: '2026-01-03' }], hour_rows: [{ hour: 'y' }], hours: [{ hour: 'h2' }],
    sessions: [{ id: 's2' }], live: [{ ts: 7 }], tools_recent: [{ tool: 'read', calls: 4 }, { tool: 'write', calls: 1 }],
    failures_recent: [{ when: '2026-01-02T00:00:01Z', kind: 'b' }],
    health: [{ model: 'gpt', ok: 3, fail: 0, total: 3, kinds: { unavailable: 2 } },
             { model: 'claude', ok: 0, fail: 0, total: 0 }],
    end_reasons: [{ reason: 'stop', n: 1 }, { reason: 'length', n: 5 }],
    compression_pressure: [{ ineffective_count: 4, fallback_streak: 1, id: 'b' }],
    recent_sessions: [{ last_ts: 99, id: 'b' }], resend: [{ resend_usd: 0.5, id: 'b' }],
    heatmap: [{ d: '2026-01-01', p: 'openai', url: 'https://a', m: 'gpt', v: 1 },
              { d: '2026-01-02', p: 'openai', url: 'https://a', m: 'gpt', v: 3 },
              { d: '2026-01-02', p: 'anthropic', url: 'https://b', m: 'claude', v: 7 }],
    node_sessions: { n1: [{ calls: 9, id: 'b' }] },
    delegations: ['p2-deleg'],
  },
});

eq(merged.rows.length, 3, 'rows concatenate across profiles');
eq(merged.rows[0].profile, 'p1', 'every merged row is tagged with its profile');
eq(merged.rows.some(r => r.date === '2026-12-31'), false, 'the All key is skipped');
eq(merged.hours.length, 2, 'hours concatenate');
eq(merged.hours[0] === hours[0], true, 'hours are pushed by reference, not cloned');
eq(merged.sessions.length, 2, 'sessions concatenate');
eq(merged.live.map(l => l.profile), ['p1', 'p2'], 'live entries are tagged');
eq(merged.tools_recent, [{ tool: 'read', calls: 7 }, { tool: 'write', calls: 1 }],
   'tools_recent sums per tool and sorts by calls');
eq(merged.failures_recent.map(f => f.when),
   ['2026-01-02T00:00:01Z', '2026-01-01T00:00:01Z'], 'failures_recent sorts newest first');
eq(merged.end_reasons, [{ reason: 'length', n: 5 }, { reason: 'stop', n: 3 }],
   'end_reason counts add up across profiles, then sort by count');
eq(merged.min_date, '2026-01-01', 'min_date is the earliest row date');
eq(merged.max_date, '2026-01-03', 'max_date is the latest row date');
eq(merged.bandwidth_daily.length, 1, 'bandwidth rows concatenate rather than sum');
eq(merged.delegations, { merged: 2 }, 'delegations go through mergeDelegations');
eq(calls.merged.at(-1), [['p1-deleg'], ['p2-deleg']],
   'mergeDelegations receives one list per real profile');

// ---- merge: per-model reliability --------------------------------------
eq(merged.health.length, 2, 'health has one row per model across profiles');
eq(merged.health[0].model, 'gpt', 'the row with failures sorts first');
eq([merged.health[0].ok, merged.health[0].fail, merged.health[0].total], [4, 1, 5],
   'ok/fail/total add up across profiles');
eq(merged.health[0].kinds, { throttle: 1, unavailable: 2 }, 'failure kinds add up per kind');
eq(merged.health[0].rate, 80, 'rate is ok/total in tenths of a percent');
eq(merged.health[0].last, '2026-01-01T00:00:00Z', 'the latest last_* wins');
eq([merged.health[0].last_kind, merged.health[0].last_msg], ['throttle', 'late'],
   'last_kind/last_msg travel with the winning last');
eq(merged.health[1].rate, null, 'a model with no calls has a null rate, not 0');
eq([merged.health[1].ok, merged.health[1].fail], [0, 0], 'the empty model still reports zeros');

// ---- merge: lists are re-ranked, not summed ----------------------------
eq(merged.compression_pressure.map(r => [r.id, r.profile]), [['b', 'p2'], ['a', 'p1']],
   'compression_pressure ranks by ineffective_count and tags the profile');
eq(merged.recent_sessions.map(s => s.id), ['b', 'a'], 'recent_sessions sort by last_ts desc');
eq(merged.resend.map(r => r.id), ['a', 'b'], 'resend sorts by cost desc');
eq(merged.heatmap.map(h => [h.d, h.p, h.v]),
   [['2026-01-01', 'openai', 1], ['2026-01-02', 'openai', 5], ['2026-01-02', 'anthropic', 7]],
   'heatmap sums equal (day, provider, url, model) cells, keeps other providers apart, sorts by day');
eq(merged.node_sessions.n1.map(s => s.id), ['b', 'a'], 'node sessions merge and re-sort by calls');

// ---- merge: the documented caps ----------------------------------------
const many = n => Array.from({ length: n }, (_, i) => i);
const capped = M.buildAll({
  p1: {
    rows: [], compression_pressure: many(45).map(i => ({ ineffective_count: i, fallback_streak: i })),
    recent_sessions: many(45).map(i => ({ last_ts: i })), resend: many(70).map(i => ({ resend_usd: i })),
    failures_recent: many(70).map(i => ({ when: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z` })),
    node_sessions: { n: many(9).map(i => ({ calls: i })) },
  },
  p2: { rows: [] },
});
eq(capped.compression_pressure.length, 40, 'compression_pressure caps at 40');
eq(capped.recent_sessions.length, 40, 'recent_sessions caps at 40');
eq(capped.resend.length, 60, 'resend caps at 60');
eq(capped.failures_recent.length, 60, 'failures_recent caps at 60, not the per-profile 14');
eq(capped.node_sessions.n.length, 5, 'node_sessions caps at 5 per node');
eq(capped.min_date, null, 'no dated rows means a null min_date');
eq(capped.max_date, null, 'no dated rows means a null max_date');

// ---- merge: a profile with nothing in it -------------------------------
const sparse = M.buildAll({ p1: {}, p2: {} });
eq([sparse.rows.length, sparse.health.length, sparse.end_reasons.length], [0, 0, 0],
   'two empty profiles merge to empty lists rather than throwing');
eq(sparse.tools_recent, [], 'an absent tools_recent is an empty list');
eq(sparse.node_sessions, {}, 'an absent node_sessions is an empty map');

// ---- theme toggle -------------------------------------------------------
eq(attrs['data-theme'], undefined, 'a dark preference sets no attribute');
els['theme'].onclick();
eq(attrs['data-theme'], 'light', 'the first click switches to light');
eq(localStorage.getItem('hermes-dash-theme'), 'light', 'the choice is persisted');
eq(calls.readTheme, 1, 'readTheme re-reads the palette after a switch');
eq(calls.render, 1, 'the view re-renders after a switch');
els['theme'].onclick();
eq(attrs['data-theme'], undefined, 'the second click switches back to dark');
eq(localStorage.getItem('hermes-dash-theme'), 'dark', 'the switch back is persisted too');
eq(calls.render, 2, 'every switch re-renders');

// ---- bootDone: the preloader -------------------------------------------
const timersBefore = timers.length;                 // the boot poll may already have one
let bootErr = null;
try { M.bootDone(); } catch (e) { bootErr = e; }
eq(els['boot']._classes.has('gone'), true, 'bootDone marks the preloader gone');
eq(timers.at(-1)[1], 400, 'the preloader is removed after 400ms');
chk(bootErr instanceof TypeError && /constant/i.test(bootErr.message),
    'bootDone stops at the stub charts binding (the built page bundles it mutable)', bootErr && bootErr.message);
chk(timers.at(-1)[0] !== undefined, 'the removal is scheduled, not immediate');
try { M.bootDone(); } catch { /* the same stub-only throw */ }
eq(timers.length - timersBefore, 1, 'a second bootDone does not schedule a second removal');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
