// Unit tests for the Health / Failures / Ollama / Sessions slice of views.js
// (#30: import the module directly, no built page).
//
// Covered: FKIND + installKindCSS + fk + rateColor + FAILTRACK + GB +
// OUTCOME_ABNORMAL/OUTCOME_LABELS + SRC_BADGE + OL_SEEN/OL_HIST, renderHealth,
// renderHealthSummary, failMsgClean, groupFailures, renderFailures (incl. the
// kind/model filter chips and their click wiring), renderDeleg (all four
// panels, their caps and the empty/missing states), renderLifecycle,
// renderOutcomes, renderToolReliability, olTrack, renderOllama (incl. the #114
// sticky card), sesstreeNode, renderSessionsTree, installSesstree,
// renderContext and renderHeatmap (quartile levels, provider gradients and the
// legend).
//
// Deliberately NOT covered here: renderHeatmap's month header labels (they
// depend on the run date's week-of-month mapping, so a hand-derived expectation
// would have to re-implement Date arithmetic rather than assert a rule), and
// the boot-order comment around installKindCSS() (the TDZ placement is a static
// property of the file, not a behaviour of any callable).
//
// Every expected string below is derived BY HAND from the rules in
// src/llm_telemetry/web/js/views.js — the thresholds in rateColor, the
// percentage rounding in the health bars, the message cleaning in
// failMsgClean, the queue scaling in renderOllama, the ago()/fmt() formatting
// in sesstreeNode. Nothing here is captured from program output; if a case
// fails, re-read the module rather than copying what it printed.
import { isolate } from './lib/isolate.mjs';

let pass = 0, fail = 0;
function ok(cond, msg){ if (cond) { pass++; return; } fail++; console.log(`  FAIL: ${msg}`); }
function eq(a, b, msg){ ok(a === b, `${msg}\n        got ${JSON.stringify(a)}\n        exp ${JSON.stringify(b)}`); }
function has(s, sub, msg){ ok(String(s).includes(sub), `${msg}\n        missing ${JSON.stringify(sub)}\n        in      ${JSON.stringify(String(s).slice(0, 260))}`); }
function lacks(s, sub, msg){ ok(!String(s).includes(sub), `${msg}\n        unexpected ${JSON.stringify(sub)}\n        in         ${JSON.stringify(String(s).slice(0, 260))}`); }
function count(s, sub){ return String(s).split(sub).length - 1; }

// The real formatters live in palette.js; load it with its own siblings stubbed
// so esc/short/ago/fmt/emptyHTML/icon/PAL behave exactly as on the dashboard.
const P = await isolate('palette.js', {
  'charts.js': { bounds: () => [0, 1], current: null },
  'views.js': { PROV: {}, provIcon: () => '', render: () => {} },
  'router.js': { presets: () => {} },
  'main.js': { DATA: {}, css: () => {} },
});

// ── fake DOM ────────────────────────────────────────────────────────────────
// `$` is bound once per isolate, so it reads a mutable map; each case resets it
// with only the ids it wants present (an absent id exercises the early return).
let DOM = new Map();
function mkEl(id){
  return {
    id, innerHTML: '', textContent: '', hidden: undefined, listeners: {}, lastQ: {},
    addEventListener(t, f){ this.listeners[t] = f; },
    // Only `[data-xx]` selectors are used by the slice (renderFailures' chips):
    // parse the current markup and hand back buttons whose onclick the code sets.
    querySelectorAll(sel){
      const attr = sel.match(/^\[data-([\w-]+)\]$/)[1];
      const re = new RegExp(`data-${attr}="([^"]*)"`, 'g'), out = [];
      for (let x; (x = re.exec(this.innerHTML));) out.push({ dataset: { [attr]: x[1] }, onclick: null });
      return (this.lastQ[sel] = out);
    },
  };
}
const dom = (...ids) => { DOM = new Map(ids.map(i => [i, mkEl(i)])); return Object.fromEntries(DOM); };
const $ = id => DOM.get(id) || null;
function click(el, sel, val){
  const key = sel.slice(6, -1);
  const b = (el.lastQ[sel] || []).find(x => x.dataset[key] === val);
  ok(!!b, `click: no ${sel} button "${val}"`);
  if (b) b.onclick();
}
// Assert a call with missing DOM is harmless: a throw is reported as a failure
// instead of aborting the whole suite (which would hide every later case).
function noThrow(fn, msg){
  let err = null;
  try { fn(); } catch (e) { err = e; }
  ok(!err, `${msg}${err ? ` — threw ${err.message}` : ''}`);
}

// views.js runs installKindCSS() and a document click listener at load time,
// so a fake document is installed for the evaluation only.
const styles = [];
const fakeDocument = {
  createElement: () => ({}),
  head: { appendChild: s => styles.push(s) },
  addEventListener: () => {},
};

// The load-time guards (schema check, zero-profiles notice) throw or bail on a
// stale/empty payload, so the stub carries a matching schema_version and one profile.
const DATA = { schema_version: 1, profiles: { p1: {} } };
const load = (o = {}) => (Object.keys(DATA.profiles).length || (DATA.profiles = { p1: {} }), isolate('views.js', {
  'palette.js': {
    $, AC: '#AC', BD: '#BD', MU: '#MU', PAL: P.PAL,
    ago: P.ago, esc: P.esc, escA: P.escA, fmt: P.fmt, short: P.short,
    emptyHTML: P.emptyHTML, icon: P.icon, money: P.money,
    colorOf: m => 'col:' + m,
  },
  'charts.js': {
    current: 'p1',
    // Deterministic stand-ins: the bar/spark markup is charts.js's contract,
    // this suite only checks which numbers views.js feeds into them.
    olBar: (pct, lbl, val, inv, spark) => `[bar ${lbl}|${pct}|${val}|${inv ? 'inv' : ''}|${spark ? spark.join(',') : '-'}]`,
    ctxSpark: (series, comps) => `[spark ${series.length} ${(comps || []).length}]`,
  },
  'router.js': { PROJECT_FILTER: o.PROJECT_FILTER || '' },
  'main.js': { DATA, SCHEMA_VERSION: 1, LOCAL_HOSTS: [] },
}, { document: fakeDocument }));

const D = await load();

// ═══ FKIND / installKindCSS / fk / rateColor ═════════════════════════════════
{
  eq(Object.keys(D.FKIND).join(','), 'rate_limit,overloaded,timeout,auth,server_error,unavailable,tool', 'FKIND: seven kinds in order');
  eq(D.FKIND.server_error.t, '5xx', 'FKIND: server_error reads as 5xx');
  eq(D.FKIND.rate_limit.t, 'throttled', 'FKIND: rate_limit reads as throttled');

  eq(styles.length, 1, 'installKindCSS: one <style> appended at load');
  const css = styles[0].textContent;
  eq(css.split('\n').length, 7, 'installKindCSS: one rule per kind');
  has(css, '.k-rate_limit{background:#f59e0b2e;color:#f59e0b}', 'installKindCSS: background is the kind colour + 2e alpha');
  has(css, '.k-unavailable{background:#64b5c92e;color:#64b5c9}', 'installKindCSS: unavailable is slate-blue, not grey');

  eq(JSON.stringify(D.fk('timeout')), JSON.stringify({ c: '#60a5fa', t: 'timeout' }), 'fk: known kind');
  eq(JSON.stringify(D.fk('weird')), JSON.stringify({ c: '#MU', t: 'weird' }), 'fk: unknown kind keeps its name, muted colour');
  eq(D.fk('').t, '—', 'fk: empty kind shows a dash');
  eq(D.fk(undefined).t, '—', 'fk: undefined kind shows a dash');

  eq(D.rateColor(null), '#MU', 'rateColor: null is muted');
  eq(D.rateColor(100), '#22c55e', 'rateColor: 100 green');
  eq(D.rateColor(95), '#22c55e', 'rateColor: 95 is the green boundary');
  eq(D.rateColor(94.9), '#f59e0b', 'rateColor: just under 95 is amber');
  eq(D.rateColor(80), '#f59e0b', 'rateColor: 80 is the amber boundary');
  eq(D.rateColor(79.9), '#ef4444', 'rateColor: just under 80 is red');
  eq(D.rateColor(0), '#ef4444', 'rateColor: 0 red');
  eq(D.FAILTRACK, 'rgba(239,68,68,.22)', 'FAILTRACK: red wash');
}

// ═══ failMsgClean ════════════════════════════════════════════════════════════
{
  eq(D.failMsgClean(null), '', 'failMsgClean: null -> empty');
  eq(D.failMsgClean('HTTP 524: {"title": "A timeout occurred", "x": 1}'), 'HTTP 524 · A timeout occurred',
    'failMsgClean: Cloudflare blob -> status + title');
  eq(D.failMsgClean('{"title":"Bad gateway"}'), 'Bad gateway', 'failMsgClean: title without a status line');
  eq(D.failMsgClean('boom thread=abc123 at prompt-turn-12:4.x end'), 'boom at end',
    'failMsgClean: thread= and prompt-turn ids stripped, spaces collapsed');
  eq(D.failMsgClean('  spaced   out  '), 'spaced out', 'failMsgClean: trims and collapses');
}

// ═══ groupFailures ═══════════════════════════════════════════════════════════
{
  const G = D.groupFailures([
    { model: 'acme/m1', kind: 'timeout', msg: 'slow thread=1', when: '2026-10-01 10:00:00' },
    { model: 'm1', kind: 'timeout', msg: 'slow thread=2', when: '2026-10-01 12:30:00' },
    { model: 'acme/m1', kind: 'timeout', msg: 'slow', when: '2026-10-01 09:00:00' },
    { model: 'acme/m1', kind: 'auth', msg: 'slow', when: '2026-10-02 08:00:00' },
    { model: 'm2', kind: 'timeout', msg: 'slow' },
  ]);
  eq(G.length, 3, 'groupFailures: short model + kind + cleaned msg is one group');
  eq(G.map(g => g.kind).join(','), 'auth,timeout,timeout', 'groupFailures: newest last first');
  eq(G[1].n, 3, 'groupFailures: three m1 timeouts merged (ids stripped, provider prefix ignored)');
  eq(G[1].first, '2026-10-01 09:00:00', 'groupFailures: first is the earliest');
  eq(G[1].last, '2026-10-01 12:30:00', 'groupFailures: last is the latest');
  eq(G[1].model, 'acme/m1', 'groupFailures: model from the first row seen');
  eq(G[1].raw, 'slow thread=1', 'groupFailures: raw from the first row seen');
  eq(G[1].msg, 'slow', 'groupFailures: msg is the cleaned one');
  eq(G[2].model, 'm2', 'groupFailures: row with no `when` sorts last');
  eq(G[2].last, '', 'groupFailures: missing when stays empty');
}

// ═══ renderHealthSummary ═════════════════════════════════════════════════════
{
  dom();
  noThrow(() => D.renderHealthSummary([], []), 'renderHealthSummary: missing element is a no-op');

  const { hsummary } = dom('hsummary');
  const H = [
    { model: 'p/alpha', total: 10, ok: 10, fail: 0, rate: 100 },
    { model: 'p/beta', total: 20, ok: 15, fail: 5, rate: 75 },
    { model: 'p/gamma', total: 2, ok: 0, fail: 2, rate: 0 },     // thin: never "worst"
    { model: 'p/delta', total: 8, ok: 7, fail: 1, rate: 87.5 },
  ];
  const F = [{ model: 'p/beta', kind: 'timeout', msg: 'x', when: 'a' }, { model: 'p/beta', kind: 'timeout', msg: 'x', when: 'b' }];
  D.renderHealthSummary(H, F);
  const s = hsummary.innerHTML;
  eq(count(s, 'class="card hsumc"'), 4, 'summary: four cards');
  has(s, '<div class="hsumv" style="color:#f59e0b">80%</div>', 'summary: 32/40 = 80%, amber');
  has(s, '32 of 40 calls', 'summary: ok of total');
  has(s, '<div class="hsumv" style="color:#ef4444">2</div>', 'summary: failure count in red');
  has(s, '1 distinct errors', 'summary: identical failures grouped');
  has(s, '3 <span class="muted" style="font-size:var(--fs-md)">of 4</span>', 'summary: 3 of 4 models failing');
  has(s, '<div class="hsumv" style="color:col:beta">beta</div>', 'summary: worst judged model (>=5 calls) is beta, not 0/2 gamma');
  has(s, '75% · 5 failed', 'summary: worst sub-line');
  has(s, P.icon('target'), 'summary: icons come from palette.icon');

  D.renderHealthSummary([], []);
  const e = hsummary.innerHTML;
  has(e, '<div class="hsumv" style="">—</div>', 'summary empty: no rate -> dash, no colour');
  has(e, '0 of 0 calls', 'summary empty: zero calls');
  has(e, '<div class="hsumv" style="color:#22c55e">0</div>', 'summary empty: zero failures in green');
  has(e, 'none recorded', 'summary empty: no failures sub-line');
  has(e, 'nothing below 100%', 'summary empty: no worst model');
  has(e, 'background:color-mix(in srgb,#MU 14%', 'summary empty: badge falls back to MU');
}

// ═══ renderHealth ════════════════════════════════════════════════════════════
const HEALTH = () => ([
  { model: 'p/alpha', total: 10, ok: 10, fail: 0, rate: 100, kinds: {} },
  { model: 'p/beta', total: 4, ok: 1, fail: 3, rate: 25, kinds: { auth: 1, timeout: 2 } },
  { model: 'p/zero', total: 0, ok: 0, fail: 0, rate: null },
  { model: 'p/dead', total: 5, ok: 0, fail: 5, rate: 0, kinds: { unavailable: 5 } },
  { model: 'p/nul', total: 1, ok: 1, fail: 0, rate: null },
]);
const rowsOf = html => html.split('<div class="flex items-center gap-2.5 hrow').slice(1);
{
  DATA.profiles = { p1: { health: HEALTH() } };
  const { healthgrid, hsummary } = dom('healthgrid', 'hsummary');
  D.renderHealth(null);
  const g = healthgrid.innerHTML;
  const R = rowsOf(g);
  eq(R.length, 4, 'health: total-0 rows dropped');
  lacks(g, '>zero<', 'health: zero-call model absent');
  ok(hsummary.innerHTML.length > 0, 'health: summary painted alongside');

  const [a, b, d, n] = R;
  has(a, 'title="">', 'health alpha: not thin, empty title');
  has(a, 'style="background:#BD"', 'health alpha: normal track colour');
  has(a, '<div style="width:100.00%;background:#22c55e"></div>', 'health alpha: ok segment 100.00%');
  has(a, 'color:#22c55e">100%</div>', 'health alpha: rate green');
  has(a, '>10 of 10</div>', 'health alpha: count without failures');
  has(a, 'style="width:172px;color:col:alpha" title="alpha">alpha</div>', 'health alpha: short name, colorOf');

  ok(b.startsWith(' hthin"'), 'health beta: <5 calls is thin');
  has(b, 'title="Fewer than 5 calls — too few to judge"', 'health beta: thin tooltip');
  has(b, '<div style="width:25.00%;background:#22c55e"></div>', 'health beta: ok 1/4');
  has(b, '<div title="timeout: 2" style="width:50.00%;background:#60a5fa"></div>', 'health beta: timeout segment');
  has(b, '<div title="auth: 1" style="width:25.00%;background:#ef4444"></div>', 'health beta: auth segment');
  has(b, '1 of 4 · <span style="color:#ef4444">3 failed</span>', 'health beta: count says what each number is');
  ok(b.indexOf('>timeout 2</span>') < b.indexOf('>auth 1</span>') && b.indexOf('>auth 1</span>') > 0,
    'health beta: chips sorted by count desc');
  has(b, 'style="background:#60a5fa22;color:#60a5fa">timeout 2</span>', 'health beta: chip colour from FKIND');

  has(d, 'style="background:rgba(239,68,68,.22)"', 'health dead: 100% failure gets FAILTRACK');
  has(d, 'color:#ef4444">0%</div>', 'health dead: 0% red');
  lacks(d, 'hthin', 'health dead: 5 calls is not thin');
  has(d, '>unavailable 5</span>', 'health dead: unavailable chip');

  has(n, 'style="width:52px;color:#MU">—</div>', 'health nul: null rate -> dash, muted');

  DATA.profiles = { p1: { health: Array.from({ length: 20 }, (_, i) => ({ model: 'm' + i, total: 10, ok: 10, fail: 0, rate: 100 })) } };
  D.renderHealth(null);
  eq(rowsOf(healthgrid.innerHTML).length, 14, 'health: capped at 14 rows');

  DATA.profiles = { p1: { health: [] } };
  D.renderHealth(null);
  eq(healthgrid.innerHTML, '<div class="muted text-[length:var(--fs-sm)]">No calls recorded.</div>', 'health: empty message');

  DATA.profiles = {};
  D.renderHealth(null);
  has(healthgrid.innerHTML, 'No calls recorded.', 'health: unknown profile is empty, not a throw');
}

// Project filter: rows narrow WHICH models appear; rates stay global.
{
  const DP = await load({ PROJECT_FILTER: 'R&D' });
  DATA.profiles = { p1: { health: HEALTH() } };
  const { healthgrid } = dom('healthgrid');
  DP.renderHealth([{ model: 'p/alpha' }, { model: 'p/alpha' }]);
  const R = rowsOf(healthgrid.innerHTML);
  eq(R.length, 1, 'health filter: only models the project used');
  has(R[0], '>alpha</div>', 'health filter: alpha kept');
  has(R[0], 'color:#22c55e">100%</div>', 'health filter: rate unchanged');

  DP.renderHealth([{ model: 'other' }]);
  eq(healthgrid.innerHTML, '<div class="muted text-[length:var(--fs-sm)]">No calls recorded for "R&amp;D" in this range.</div>',
    'health filter: empty message names the (escaped) project');

  DP.renderHealth(null);
  eq(rowsOf(healthgrid.innerHTML).length, 4, 'health filter: no rows -> no narrowing');
}

// ═══ renderFailures ══════════════════════════════════════════════════════════
const FAILS = () => ([
  { model: 'x/m1', kind: 'timeout', msg: 'slow', when: '2026-10-01 10:00:00' },
  { model: 'x/m1', kind: 'timeout', msg: 'slow', when: '2026-10-01 11:05:00' },
  { model: 'x/m2', kind: 'auth', msg: '<denied> & "no"', when: '2026-10-02 09:00:00' },
]);
{
  const DF = await load();
  dom();
  noThrow(() => DF.renderFailures(FAILS()), 'failures: missing #faillist is a no-op');

  const { faillist: fl, failfilters: ff, failcount: fc } = dom('faillist', 'failfilters', 'failcount');
  const F = FAILS();
  DF.renderFailures(F);
  eq(fc.textContent, '3 failures in 2 groups · last 7 days', 'failures: unfiltered count line');
  const rows = fl.innerHTML.split('frow"').slice(1);
  eq(rows.length, 2, 'failures: two groups');
  has(rows[0], 'title="m2">m2</span>', 'failures: newest group (auth, 10-02) first');
  has(rows[0], 'title="&lt;denied> &amp; &quot;no&quot;">&lt;denied> &amp; &quot;no&quot;</span>',
    'failures: message escaped with the local attribute-safe esc');
  has(rows[0], '>10-02 09:00</span>', 'failures: single event shows MM-DD HH:MM');
  has(rows[0], ' style="visibility:hidden">', 'failures: x1 counter hidden');
  has(rows[0], 'style="background:#ef444422;color:#ef4444">auth</span>', 'failures: kind chip');
  has(fl.innerHTML, 'data-n="2"', 'failures: group size on the row');
  has(rows[1], '>10-01 10:00 → 11:05</span>', 'failures: repeated group shows first → last time');
  has(rows[1], ' title="2 identical failures">&times;2</span>', 'failures: x2 counter');

  const f = ff.innerHTML;
  has(f, '<span class="fflbl">Kind</span>', 'filters: kind row');
  has(f, '<button class="fchip on" data-fk="all"', 'filters: all kinds active');
  has(f, 'style="border-color:#AC;color:#AC">all <span class="muted">3</span></button>', 'filters: all chip coloured AC with total');
  has(f, '<button class="fchip" data-fk="timeout"', 'filters: timeout chip inactive');
  ok(f.indexOf('data-fk="timeout"') < f.indexOf('data-fk="auth"'), 'filters: kinds sorted by count');
  has(f, '<span class="fflbl">Model</span>', 'filters: model row with >1 model');
  has(f, 'style="">all models</button>', 'filters: all-models chip has no count');
  has(f, 'data-fm="m1"', 'filters: model chips use short names');

  click(ff, '[data-fk]', 'auth');
  eq(DF.failKind, 'auth', 'click kind: state updated');
  eq(fc.textContent, '1 of 3 failures (1 groups)', 'click kind: filtered count line');
  eq(fl.innerHTML.split('frow"').length - 1, 1, 'click kind: one group left');
  has(ff.innerHTML, '<button class="fchip on" data-fk="auth"\n        style="border-color:#ef4444;color:#ef4444">', 'click kind: active chip in kind colour');

  click(ff, '[data-fm]', 'm1');
  eq(DF.failModel, 'm1', 'click model: state updated');
  eq(fl.innerHTML, '<div class="empty"><div class="e-ico">✓</div><div class="e-msg">No failures match this filter.</div>'
    + '<div class="e-hint">Clear the kind/model filter above to see everything.</div></div>', 'click model: empty-filter state');
  eq(fc.textContent, '0 of 3 failures (0 groups)', 'click model: zero of total');

  click(ff, '[data-fm]', 'all models');
  eq(DF.failModel, 'all', 'click all models: maps back to "all"');

  // Stale selection: kind 'auth' is gone from the next payload.
  DF.renderFailures(F.slice(0, 2));
  eq(DF.failKind, 'all', 'failures: vanished kind resets to all');
  lacks(ff.innerHTML, 'fflbl">Model', 'failures: single model -> no model row');

  DF.renderFailures([]);
  eq(fl.innerHTML, '<div class="empty"><div class="e-ico">✓</div><div class="e-msg">No failures recorded in the last 7 days.</div></div>',
    'failures: empty payload, no hint');
  eq(fc.textContent, '0 failures in 0 groups · last 7 days', 'failures: empty count line');
}

// ═══ renderLifecycle ═════════════════════════════════════════════════════════
{
  const { lifecard, lifereasons, lifepressure } = dom('lifecard', 'lifereasons', 'lifepressure');
  D.renderLifecycle([]);
  eq(lifecard.hidden, true, 'lifecycle: no pressure hides the card');

  lifereasons.innerHTML = 'old';
  D.renderLifecycle([
    { id: 's<1>', title: 'T&', fallback_streak: 2, ineffective_count: 0, error: 'boom' },
    { id: 's2', title: 'U', fallback_streak: 0, ineffective_count: 3 },
  ]);
  const h = lifepressure.innerHTML;
  eq(lifecard.hidden, false, 'lifecycle: shown');
  eq(lifereasons.innerHTML, '', 'lifecycle: reasons cleared (moved to outcomes)');
  has(h, 'Compression pressure — 2 session(s)', 'lifecycle: header count');
  has(h, 'title="s&lt;1&gt;">T&amp;</span>', 'lifecycle: id/title escaped');
  has(h, 'fallback streak 2', 'lifecycle: streak bit');
  lacks(h, '0 ineffective', 'lifecycle: zero counts omitted');
  has(h, '3 ineffective', 'lifecycle: ineffective bit');
  has(h, 'title="boom">error</span>', 'lifecycle: error marker');
  eq(count(h, 'ui-monospace'), 1, 'lifecycle: error detail line only for the erroring session');

  D.renderLifecycle(Array.from({ length: 25 }, (_, i) => ({ id: 's' + i, title: 't' + i })));
  eq(count(lifepressure.innerHTML, 'py-0.5"'), 20, 'lifecycle: capped at 20 rows');
  has(lifepressure.innerHTML, '— 25 session(s)', 'lifecycle: header keeps the full count');
}

// ═══ renderOutcomes ══════════════════════════════════════════════════════════
{
  const E = dom('outcard', 'outkpis', 'outbysource', 'outreaptrend', 'outsilentlist');
  D.renderOutcomes(undefined);
  eq(E.outcard.hidden, true, 'outcomes: nothing ended -> hidden');

  D.renderOutcomes({
    by_reason: { cron_complete: 6, '(none)': 2, ws_orphan_reap: 2 },
    reaped: [{}, {}],
    silent: [{ id: 'a', title: 'Lost <1>', source: 'cli', model: 'm' }, { id: 'b', title: 'L2', source: 'tui' }],
    by_source_reason: { cron: { ws_orphan_reap: 2, cron_complete: 6 }, cli: { '(none)': 2 } },
    reap_trend: [{ date: '2026-10-01', n: 2 }],
  });
  eq(E.outcard.hidden, false, 'outcomes: shown');
  const k = E.outkpis.innerHTML;
  has(k, '<div class="dkv" style="">10</div><div class="dkl">Sessions ended · 30d</div>', 'outcomes: total');
  has(k, '<div class="dkv" style="color:#ef4444">2</div><div class="dkl">Orphan reaps</div>', 'outcomes: reaps red');
  has(k, '<div class="dkv" style="color:#f59e0b">2</div><div class="dkl">Ended silently</div>', 'outcomes: silent amber');
  has(k, '>60.0%</div><div class="dkl">Ended cleanly</div>', 'outcomes: (10-2-2)/10 clean');

  const s = E.outbysource.innerHTML;
  has(s, 'cron <span class="muted">(8)</span>', 'outcomes: per-source total');
  ok(s.indexOf('cron_complete <b>6</b>') < s.indexOf('Reaped (websocket) <b>2</b>'), 'outcomes: reasons sorted by count');
  has(s, 'title="ws_orphan_reap: 2 session(s)">&#9888; Reaped (websocket) <b>2</b>', 'outcomes: abnormal reason flagged + labelled');
  has(s, '&#9888; Ended silently <b>2</b>', 'outcomes: (none) is abnormal "Ended silently"');
  lacks(s, '&#9888; cron_complete', 'outcomes: normal reason not flagged');

  has(E.outreaptrend.innerHTML, 'title="2026-10-01">10-01: 2</span>', 'outcomes: reap trend chip, MM-DD');
  const l = E.outsilentlist.innerHTML;
  has(l, 'Ended silently — 2 session(s)', 'outcomes: silent list header');
  has(l, 'data-tsession="a" data-tprofile="p1" data-title="Lost &lt;1&gt;"', 'outcomes: timeline button wiring');
  has(l, '<span class="muted">tui \u00b7 </span>', 'outcomes: missing model is blank');

  D.renderOutcomes({ by_reason: { cron_complete: 4 } });
  has(E.outkpis.innerHTML, '<div class="dkv" style="color:#22c55e">0</div><div class="dkl">Orphan reaps</div>', 'outcomes clean: reaps green');
  has(E.outkpis.innerHTML, '>100.0%</div>', 'outcomes clean: 100% clean');
  eq(E.outreaptrend.innerHTML, '', 'outcomes clean: no trend');
  eq(E.outsilentlist.innerHTML, '', 'outcomes clean: no silent list');
}

// ═══ renderToolReliability ═══════════════════════════════════════════════════
{
  const E = dom('toolcard', 'toolrows', 'toolcmds');
  D.renderToolReliability([], null);
  eq(E.toolcard.hidden, true, 'tools: none -> hidden');

  D.renderToolReliability([
    { name: 'terminal', calls: 1200, fail_rate: 0.25, prev_fail_rate: 0.1, tok_wasted: 5000 },
    { name: 'read', calls: 10, fail_rate: 0, prev_fail_rate: 0.005 },
    { name: 'web', calls: 3, fail_rate: 0.05, prev_fail_rate: 0.2 },
    { name: 'x', calls: 1, fail_rate: null },
  ], [{ cmd: 'rm <x>', n: 4 }]);
  const [t, r, w, x] = E.toolrows.innerHTML.split('py-1"').slice(1);
  has(t, '1,200 calls', 'tools terminal: calls');
  has(t, 'style="color:#ef4444;min-width:3.5rem;text-align:right">25.0%</span>', 'tools terminal: >=20% red');
  has(t, '<span style="color:#ef4444" title="was 10.0% in the prior 30 days">\u2191</span>', 'tools terminal: worse -> red up');
  has(t, '5,000 tok wasted', 'tools terminal: waste');
  has(r, 'style="color:#22c55e;min-width:3.5rem;text-align:right">0.0%</span>', 'tools read: 0 green');
  has(r, '<span class="muted">\u2192</span>', 'tools read: <1pt change is flat');
  has(w, 'color:#f59e0b;', 'tools web: >0 <20% amber');
  has(w, '<span style="color:#22c55e" title="was 20.0% in the prior 30 days">\u2193</span>', 'tools web: better -> green down');
  has(x, '<span style=";min-width:3.5rem;text-align:right"><span class="muted">no confident calls</span></span>', 'tools x: null rate');
  lacks(x, '\u2192', 'tools x: no trend without both rates');
  has(E.toolcmds.innerHTML, 'Top failing terminal commands', 'tools: cmd header');
  has(E.toolcmds.innerHTML, 'rm &lt;x&gt; <b>4</b>', 'tools: cmd escaped with count');

  D.renderToolReliability([{ name: 'a', calls: 1, fail_rate: 0 }], undefined);
  eq(E.toolcmds.innerHTML, '', 'tools: no cmds -> empty');
}

// ═══ GB / olTrack ════════════════════════════════════════════════════════════
{
  eq(D.GB(1.5e9), '1.5G', 'GB: one decimal');
  eq(D.GB(0), '0.0G', 'GB: zero');
  eq(D.OL_HIST_CAP, 20, 'OL_HIST_CAP: 20 points');

  const DO = await load();
  eq(DO.olTrack('h', 'cpu', null), null, 'olTrack: null value is not recorded');
  eq(DO.OL_HIST.size, 0, 'olTrack: nothing stored for null');
  let arr;
  for (let i = 1; i <= 25; i++) arr = DO.olTrack('h', 'cpu', i);
  eq(arr.length, 20, 'olTrack: capped');
  eq(arr[0] + '..' + arr[19], '6..25', 'olTrack: oldest points dropped first');
  ok(DO.OL_HIST.get('h\tcpu') === arr, 'olTrack: keyed host<TAB>metric, returns the stored series');
  eq(DO.olTrack('h', 'gpu', 0).join(), '0', 'olTrack: zero is recorded; metrics do not share a series');
  eq(DO.olTrack('h2', 'cpu', 7).join(), '7', 'olTrack: hosts do not share a series');
}

// ═══ renderOllama ════════════════════════════════════════════════════════════
{
  const DO = await load();
  dom();
  noThrow(() => DO.renderOllama({ hosts: [] }), 'ollama: missing elements is a no-op');

  const E = dom('ollama', 'olcard', 'olsub');
  DO.renderOllama(null);
  eq(E.olcard.hidden, true, 'ollama: hidden before first sighting');
  eq(DO.OL_SEEN, false, 'ollama: not yet seen');

  const BOX = {
    label: 'box', up: true, urls: [{ base: 'http://a:11434' }, { base: 'http://b:11434' }],
    version: '0.9.1', ms: 12, installed: 7, queue: 2, vram_total: 16e9,
    loaded: [
      { name: 'qwen3:8b', vram: 6e9, ctx: 8192, res: 46, caps: ['completion', 'tools', 'vision'] },
      { name: 'llama3', vram: 2e9, ctx: 0, res: null },
    ],
    load: { cpu: 12.4, gpu: 85.6, gpu_mem: null, gpus: [{ i: 0, name: 'RTX', util: 85.6, used: 6144, total: 16384, temp: 61.2 }] },
    work: { calls: 1234, tokens: 2500000, tasks: { main: 3, patch: 9 } },
  };
  const FAR = { label: 'far', up: false, err: 'x'.repeat(100) };
  DO.renderOllama({ hosts: [BOX, FAR] });
  eq(DO.OL_SEEN, true, 'ollama: seen');
  eq(E.olcard.hidden, false, 'ollama: shown');
  const [box, far] = E.ollama.innerHTML.split('<div class="olcard').slice(1);
  has(box, '<div class="olurls">2 endpoints → this box: http://a:11434 · http://b:11434</div>', 'ollama: aliased endpoints');
  has(box, '<span class="olver">v0.9.1 · 12ms · 7 models</span>', 'ollama: version line');
  has(box, '<span class="olbadge">▣ local</span>', 'ollama: local badge');
  has(box, '[bar queue|50|2 waiting||50]', 'ollama: queue 2 -> 50%, tracked');
  has(box, '[bar vram|50|8.0G||50]', 'ollama: vram 8G of 16G');
  has(box, '[bar cpu|12.4|12%||12.4]', 'ollama: cpu bar');
  has(box, '[bar gpu|85.6|86%||85.6]', 'ollama: gpu bar');
  lacks(box, 'gpu mem', 'ollama: null gpu_mem omitted, not zero');
  has(box, '<span class="olgpu" title="RTX">GPU0 86% · 6.0/16.0G · 61&deg;C</span>', 'ollama: per-GPU chip');
  has(box, '<span class="olmn" style="color:col:qwen3:8b">qwen3:8b</span><span class="olcap tools">tools</span><span class="olcap vision">vision</span>',
    'ollama: caps without completion');
  has(box, '8,192 tok · 6.0G vram', 'ollama: ctx + vram');
  has(box, '[bar on GPU|46|46%|inv|-]', 'ollama: residency bar is inverted, untracked');
  eq(count(box, '[bar on GPU'), 1, 'ollama: null residency -> no bar');
  has(box, '0 tok · 2.0G vram', 'ollama: zero ctx');
  has(box, '24h: <b>1,234</b> calls', 'ollama: calls');
  has(box, '<b>2.5M</b> tok', 'ollama: tokens in millions');
  has(box, '<span>patch <b>9</b> · main <b>3</b></span>', 'ollama: tasks sorted desc');

  ok(far.startsWith(' down">'), 'ollama: down host card');
  has(far, '<span class="olver">unreachable</span>', 'ollama: down label');
  has(far, `<div class="olidle">${'x'.repeat(90)}</div>`, 'ollama: error cut at 90 chars');
  eq(E.olsub.innerHTML, '1/2 up · 2 models resident', 'ollama: sub line');

  // #114 sticky: an empty refresh keeps the last content.
  const before = E.ollama.innerHTML;
  DO.renderOllama({ hosts: [] });
  eq(E.olcard.hidden, false, 'ollama sticky: card stays visible');
  eq(E.ollama.innerHTML, before, 'ollama sticky: content untouched');

  // Second sighting extends the client-side history.
  DO.renderOllama({ hosts: [BOX], age: 200 });
  has(E.ollama.innerHTML, '[bar queue|50|2 waiting||50,50]', 'ollama: history grows across renders');
  eq(E.olsub.innerHTML, '1/1 up · 2 models resident · <span class="olstale">stale 3m</span>', 'ollama: stale after 90s');

  DO.renderOllama({ hosts: [BOX], age: 90 });
  lacks(E.olsub.innerHTML, 'stale', 'ollama: 90s is not stale');

  DO.renderOllama({ hosts: [{ label: 'idle', up: true, ms: 3, installed: 0 }, { label: 'gone', up: false }] });
  const [idle, gone] = E.ollama.innerHTML.split('<div class="olcard').slice(1);
  has(idle, 'v? · 3ms · 0 models', 'ollama idle: unknown version');
  has(idle, '[bar queue|0|clear||0]', 'ollama idle: empty queue reads clear');
  has(idle, '[bar vram|0|0.0G||0]', 'ollama idle: nothing loaded, no capacity -> 0%');
  has(idle, 'idle — no model resident', 'ollama idle: idle line');
  lacks(idle, '[bar cpu', 'ollama idle: no load telemetry -> no cpu bar');
  lacks(idle, 'olurls', 'ollama idle: single/no endpoint -> no alias line');
  has(idle, '<b>0</b> calls', 'ollama idle: zero calls');
  has(idle, '<b>0.0M</b> tok</span></div>', 'ollama idle: no tasks span');
  has(gone, '<div class="olidle">no response</div>', 'ollama: down without err');

  DO.renderOllama({ hosts: [{ label: 'full', up: true, loaded: [{ name: 'm', vram: 1e9 }] }] });
  has(E.ollama.innerHTML, '[bar vram|100|1.0G||100]', 'ollama: no vram_total but a model loaded -> 100%');
}

// ═══ sesstreeNode ════════════════════════════════════════════════════════════
const LEAF = () => ({ id: 's1', title: 'Fix <bug>', source: 'cron', model: 'm', started: 1000, ended: 1090, tok: 12345, cost: 0.5, end_reason: 'cron_complete' });
{
  const h = D.sesstreeNode(LEAF(), 2);
  has(h, '<div class="sesstree-row" style="padding-left:2.5rem">', 'node: indent 1.25rem per depth');
  has(h, '<span class="sesstree-toggle-spacer"></span>', 'node: leaf has a spacer, not a toggle');
  has(h, '<span class="sesstree-title" title="s1">Fix &lt;bug&gt;</span>', 'node: title escaped');
  has(h, '<span class="chip sesstree-chip">Cron</span>', 'node: source badge label');
  has(h, '<span class="muted sesstree-model">m</span>', 'node: model');
  has(h, '<span class="muted sesstree-dur">2m</span>', 'node: 90s -> ago() rounds to 2m');
  has(h, '<span class="muted sesstree-tok">12.3K tok</span>', 'node: tokens via fmt');
  has(h, '<span class="sesstree-cost">$0.5000</span>', 'node: cost 4dp, no rollup on a leaf');
  has(h, '<span class="chip sesstree-endreason">cron_complete</span>', 'node: end reason');
  has(h, 'data-tsession="s1" data-tprofile="p1" data-title="Fix &lt;bug&gt;"', 'node: timeline button');
  lacks(h, 'sesstree-row-failed', 'node: clean end is not failed');

  const v = (o) => D.sesstreeNode({ ...LEAF(), ...o }, 0);
  has(v({ ended: null }), 'sesstree-dur">running</span>', 'node: started without end is running');
  has(v({ started: null, ended: null }), 'sesstree-dur">—</span>', 'node: never started is a dash');
  has(v({ source: 'weird<x>' }), 'sesstree-chip">weird&lt;x&gt;</span>', 'node: unknown source escaped verbatim');
  has(v({ source: '' }), 'sesstree-chip">—</span>', 'node: no source is a dash');
  has(v({ model: '' }), 'sesstree-model">—</span>', 'node: no model is a dash');
  has(v({ end_reason: null }), 'sesstree-endreason">(none)</span>', 'node: null end reason');
  has(v({ cost: undefined, tok: 0 }), '$0.0000', 'node: missing cost is zero');
  has(v({ cost_is_actual: false }), '$0.5000 <span class="muted" style="font-size:var(--fs-xs)">(est.)</span>', 'node: estimated cost marked');
  const bad = v({ end_reason: 'provider_error' });
  has(bad, 'class="sesstree-row sesstree-row-failed"', 'node: error end reason flags the row');
  has(bad, 'class="chip sesstree-endreason sesstree-endreason-failed">provider_error', 'node: and the chip');
  has(v({ end_reason: 'FAILED_hard' }), 'sesstree-row-failed', 'node: failure match is case-insensitive');

  const ROOT = { id: 'root', title: 'Root', cost: 1, child_count: 2, failed_child_count: 1,
    children: [LEAF(), { ...LEAF(), id: 's2' }] };
  const r = D.sesstreeNode(ROOT, 0);
  has(r, ' <span class="muted" style="font-size:var(--fs-xs)">(own + 2 descendants, 1 failed)</span>', 'node: rollup');
  has(r, 'data-sesstree-toggle="root" aria-expanded="true" aria-label="Collapse children of Root">\u25BE</button>', 'node: expanded toggle');
  has(r, '<div class="sesstree-children">', 'node: children rendered');
  eq(count(r, 'padding-left:1.25rem'), 2, 'node: children one level deeper');

  has(D.sesstreeNode({ ...ROOT, child_count: 1, failed_child_count: 0, children: [LEAF()] }, 0),
    '(own + 1 descendant)</span>', 'node: singular rollup, no failed clause');

  D.sesstreeCollapsed.add('root');
  const c = D.sesstreeNode(ROOT, 0);
  has(c, 'aria-expanded="false" aria-label="Expand children of Root">\u25B8</button>', 'node: collapsed toggle');
  lacks(c, 'sesstree-children', 'node: collapsed hides children');
  D.sesstreeCollapsed.delete('root');
}

// ═══ renderSessionsTree ══════════════════════════════════════════════════════
{
  dom();
  noThrow(() => D.renderSessionsTree([]), 'tree: missing #sesstree is a no-op');

  const E = dom('sesstree', 'sesstreeempty', 'sesstreesub');
  const kid = () => [LEAF()];
  D.renderSessionsTree([
    { id: 'lonely', title: 'Lonely', children: [] },
    { id: 'A', title: 'A', cost: 1, child_count: 1, children: kid() },
    { id: 'B', title: 'B', cost: 5, child_count: 1, children: kid() },
  ]);
  eq(E.sesstreesub.textContent, '2 parents with children', 'tree: sub line');
  eq(E.sesstreeempty.hidden, true, 'tree: empty state hidden');
  lacks(E.sesstree.innerHTML, 'Lonely', 'tree: childless roots excluded');
  const w = E.sesstree.innerHTML;
  ok(w.indexOf('data-sesstree-toggle="B"') < w.indexOf('data-sesstree-toggle="A"'), 'tree: roots by cost desc');

  D.renderSessionsTree([{ id: 'A', title: 'A', child_count: 1, children: kid() }]);
  eq(E.sesstreesub.textContent, '1 parent with children', 'tree: singular sub line');

  D.renderSessionsTree(null);
  eq(E.sesstree.innerHTML, '', 'tree: null forest clears');
  eq(E.sesstreeempty.hidden, false, 'tree: empty state shown');
  eq(E.sesstreesub.textContent, '', 'tree: no sub line');
}

// ═══ installSesstree ═════════════════════════════════════════════════════════
{
  dom();
  noThrow(() => D.installSesstree(), 'install: missing #sesstree is a no-op');

  const E = dom('sesstree');
  D.installSesstree();
  const onClick = E.sesstree.listeners.click;
  ok(typeof onClick === 'function', 'install: click listener attached');
  onClick({ target: { closest: () => null } });
  eq(D.sesstreeCollapsed.size, 0, 'install: click off a toggle changes nothing');
  // A toggle click flips the set and then calls the module's own full render(),
  // which is outside this slice — swallow whatever it does with the fake DOM.
  const btn = { dataset: { sesstreeToggle: 'n1' } };
  try { onClick({ target: { closest: () => btn } }); } catch {}
  ok(D.sesstreeCollapsed.has('n1'), 'install: toggle collapses');
  try { onClick({ target: { closest: () => btn } }); } catch {}
  ok(!D.sesstreeCollapsed.has('n1'), 'install: second toggle expands');
}

// ═══ renderContext ═══════════════════════════════════════════════════════════
{
  const E = dom('ctxcard', 'ctxreasoning', 'ctxcooldowns', 'ctxsessions');
  D.renderContext(null);
  eq(E.ctxcard.hidden, true, 'context: no data -> hidden');

  D.renderContext({
    sessions: [
      { id: 's<1>', series: [[0, 1], [1, 2]], compactions: [{ ineffective: true }, { ineffective: false }] },
      { id: 's2', series: [], compactions: [{}] },
    ],
    reasoning_by_model: [{ model: 'm', reasoning_tokens: 1500, share: 0.256 }],
    cooldowns: [],
  });
  eq(E.ctxcard.hidden, false, 'context: shown');
  has(E.ctxreasoning.innerHTML, '1,500 tok', 'context: reasoning tokens');
  has(E.ctxreasoning.innerHTML, '>25.6%</span>', 'context: share 1dp');
  has(E.ctxcooldowns.innerHTML, 'No sessions currently in a compaction-failure cooldown.', 'context: empty cooldowns');
  const [s1, s2] = E.ctxsessions.innerHTML.split('py-2"').slice(1);
  has(s1, '>s&lt;1&gt;</span>', 'context: session id escaped');
  has(s1, '[spark 2 2]', 'context: series + compactions handed to ctxSpark');
  has(s1, '2 compactions</span>', 'context: plural');
  has(s1, '>1 ineffective</span>', 'context: ineffective count');
  has(s2, '1 compaction</span>', 'context: singular');
  lacks(s2, 'ineffective', 'context: none ineffective -> no marker');

  D.renderContext({ cooldowns: [{ title: 'T', error_head: 'e<1>' }] });
  eq(E.ctxcard.hidden, false, 'context: cooldowns alone show the card');
  has(E.ctxcooldowns.innerHTML, 'title="e&lt;1&gt;">e&lt;1&gt;</div>', 'context: cooldown error escaped');
  has(E.ctxreasoning.innerHTML, 'No reasoning tokens in range.', 'context: empty reasoning');
  has(E.ctxsessions.innerHTML, 'No session context data in range.', 'context: empty sessions');
}

// ═══ bare constants the panels measure against ═══════════════════════════════
{
  eq(D.FAILTRACK, 'rgba(239,68,68,.22)', 'FAILTRACK: the red wash hex');
  eq(Object.keys(D.FKIND).length, 7, 'FKIND: seven failure kinds');
  eq(D.FKIND.rate_limit.c, '#f59e0b', 'FKIND: rate_limit colour');
  eq(D.FKIND.overloaded.t, 'overloaded', 'FKIND: overloaded label');
  eq(D.FKIND.timeout.c, '#60a5fa', 'FKIND: timeout colour');
  eq(D.FKIND.auth.c, '#ef4444', 'FKIND: auth colour');
  eq(D.FKIND.server_error.t, '5xx', 'FKIND: server_error label is 5xx, not server_error');
  eq(D.FKIND.unavailable.c, '#64b5c9', 'FKIND: unavailable is slate-blue, not grey');
  eq(D.FKIND.tool.c, '#818cf8', 'FKIND: tool colour');
  has(styles[0].textContent, '.k-rate_limit{background:#f59e0b2e;color:#f59e0b}', 'installKindCSS: chip rule is built from FKIND');
  has(styles[0].textContent, '.k-tool{background:#818cf82e;color:#818cf8}', 'installKindCSS: every kind gets a rule');
  eq(D.fk('nope').c, '#MU', 'fk: an unknown kind falls back to MU');
  eq(D.fk('nope').t, 'nope', 'fk: an unknown kind keeps its own name');
  eq(D.fk(null).t, '\u2014', 'fk: a missing kind reads as an em dash');
  ok(D.fk('auth') === D.FKIND.auth, 'fk: a known kind returns the FKIND entry itself');

  eq(D.rateColor(null), '#MU', 'rateColor: null (unmeasured) is MU, not red');
  eq(D.rateColor(95), '#22c55e', 'rateColor: 95 exactly is green');
  eq(D.rateColor(94.99), '#f59e0b', 'rateColor: 94.99 is amber');
  eq(D.rateColor(80), '#f59e0b', 'rateColor: 80 exactly is amber');
  eq(D.rateColor(79.99), '#ef4444', 'rateColor: 79.99 is red');
  eq(D.rateColor(0), '#ef4444', 'rateColor: zero is red, not MU');

  eq(D.GB(0), '0.0G', 'GB: zero');
  eq(D.GB(1e9), '1.0G', 'GB: exactly one gig');
  eq(D.GB(999999999), '1.0G', 'GB: just under a gig rounds up to one decimal');
  eq(D.GB(12.34e9), '12.3G', 'GB: one decimal place only');
  eq(D.GB(-1e9), '-1.0G', 'GB: sign is preserved');

  eq(D.OUTCOME_ABNORMAL.size, 3, 'OUTCOME_ABNORMAL: three reasons');
  for (const k of D.OUTCOME_ABNORMAL) ok(k in D.OUTCOME_LABELS, `OUTCOME_LABELS: ${k} has a label`);
  ok(!D.OUTCOME_ABNORMAL.has('ok'), 'OUTCOME_ABNORMAL: a clean exit is not abnormal');
  eq(D.OUTCOME_LABELS['(none)'], 'Ended silently', 'OUTCOME_LABELS: silent end');
  eq(D.OUTCOME_LABELS.startup_orphan_reap, 'Reaped (startup)', 'OUTCOME_LABELS: startup reap');
  eq(D.OUTCOME_LABELS.ws_orphan_reap, 'Reaped (websocket)', 'OUTCOME_LABELS: websocket reap');

  eq(Object.keys(D.SRC_BADGE).length, 7, 'SRC_BADGE: seven sources');
  eq(D.SRC_BADGE.desktop, 'Desktop', 'SRC_BADGE: desktop');
  eq(D.SRC_BADGE.oneshot, 'One-shot', 'SRC_BADGE: oneshot');
  eq(D.SRC_BADGE.gateway, 'Gateway', 'SRC_BADGE: gateway');

  eq(D.OL_HIST instanceof Map, true, 'OL_HIST: a Map');
  eq(D.OL_SEEN, false, 'OL_SEEN: starts false (sticky card is not pre-armed)');
  eq(D.sesstreeCollapsed instanceof Set, true, 'sesstreeCollapsed: a Set');
  eq(D.sesstreeCollapsed.size, 0, 'sesstreeCollapsed: starts empty');
}

// ═══ renderDeleg (#90) ════════════════════════════════════════════════════════
{
  const DD = await load();
  const el = dom('delegcard', 'delegkpi', 'delegmodels', 'delegreasons', 'delegtools', 'deleglist');

  DATA.profiles.p1.delegations = null;
  DD.renderDeleg();
  eq(el.delegcard.hidden, true, 'deleg: no delegations payload hides the card');
  eq(el.delegkpi.innerHTML, '', 'deleg: nothing is written without a payload');

  DATA.profiles.p1.delegations = { children: 10, ok: 10, rate: 96, wasted_hours: 0, cost_usd: 12.5 };
  DD.renderDeleg();
  eq(el.delegcard.hidden, false, 'deleg: a payload shows the card');
  has(el.delegkpi.innerHTML, '<span class="dkpi-n">10</span><span class="lbl">children</span>', 'deleg kpi: child count');
  has(el.delegkpi.innerHTML, '<span class="dkpi-n ok">96%</span><span class="lbl">completed</span>', 'deleg kpi: >=95% rate is ok');
  has(el.delegkpi.innerHTML, '<span class="dkpi-n ">0h</span><span class="lbl">burned on failures</span>', 'deleg kpi: no burned time leaves the class empty, not bad');
  has(el.delegkpi.innerHTML, '<span class="dkpi-n">$12.50</span><span class="lbl">child spend</span>', 'deleg kpi: spend via money()');
  eq(el.delegmodels.innerHTML, '<div class="muted text-[length:var(--fs-xs)]">No child runs.</div>', 'deleg models: empty state');
  eq(el.delegreasons.innerHTML, '<span class="muted text-[length:var(--fs-xs)]">No failures in range.</span>', 'deleg reasons: empty state');
  eq(el.delegtools.innerHTML, '<div class="muted text-[length:var(--fs-xs)]">No tool calls recorded.</div>', 'deleg tools: empty state');
  eq(el.deleglist.innerHTML, '<div class="muted text-[length:var(--fs-xs)]">Nothing yet.</div>', 'deleg recent: empty state');

  DATA.profiles.p1.delegations = {
    children: 10, ok: 8, rate: 80, wasted_hours: 2.5, cost_usd: 0.005,
    by_model: [
      { model: 'anthropic/claude-sonnet-5', rate: 100, n: 1, wasted_hours: 0 },
      { model: 'qwen3-coder:480b-cloud', rate: 56, n: 3, wasted_hours: 4 },
      { model: 'thin', rate: 150, n: 2 },
      { model: 'thin', rate: -5, n: 2 },
    ],
    reasons: { rate_limit: 2 },
    tools: [
      { tool: 'read_file', rate: 99.2, calls: 1, fail: 0 },
      { tool: 'web_search', rate: 50, calls: 2, fail: 1 },
    ],
    recent: [
      { status: 'completed', goal: 'summarise <the> file', model: 'anthropic/claude-sonnet-5', seconds: 90 },
      { status: 'failed', failure_reason: 'timeout', goal: '', model: 'm2', seconds: 3600 },
    ],
  };
  DD.renderDeleg();
  has(el.delegkpi.innerHTML, '<span class="dkpi-n bad">80%</span>', 'deleg kpi: <95% rate is bad');
  has(el.delegkpi.innerHTML, '<span class="dkpi-n bad">2.5h</span>', 'deleg kpi: burned time is bad when children-ok > 0');
  has(el.delegkpi.innerHTML, '<span class="dkpi-n">$0.01</span>', 'deleg kpi: a sub-cent spend rounds to $0.01 (money() is 2dp)');

  const mods = el.delegmodels.innerHTML;
  has(mods, '<div class="dname" title="anthropic/claude-sonnet-5">claude-sonnet-5</div>', 'deleg models: title keeps the full id, the label is short()');
  has(mods, '<span style="width:100%" class="ok"></span>', 'deleg models: 100% bar is ok and full width');
  has(mods, '<div class="dpct ok">100%</div>', 'deleg models: 100% is printed raw');
  has(mods, '1 run</div>', 'deleg models: singular run, and no "lost" suffix at 0 wasted hours');
  has(mods, 'qwen3-coder:480b-cloud', 'deleg models: a slashless id is not shortened');
  has(mods, '<span style="width:56%" class="bad"></span>', 'deleg models: 56% bar is bad');
  has(mods, '3 runs · 4h lost', 'deleg models: plural runs and wasted hours');
  eq(count(mods, '<span style="width:100%" class="ok"></span>'), 2, 'deleg models: a >100% rate clamps the bar to 100% (the ok class comes from the raw rate)');
  has(mods, '<div class="dpct ok">150%</div>', 'deleg models: the printed rate is unclamped');
  has(mods, '<span style="width:0%" class="bad"></span>', 'deleg models: a negative rate clamps the bar to 0%');
  has(mods, '<div class="dpct bad">-5%</div>', 'deleg models: printed rate stays negative');

  has(el.delegreasons.innerHTML, '<span class="chip" style="text-transform:none">rate_limit <b>2</b></span>', 'deleg reasons: raw reason name + count chip');
  const tls = el.delegtools.innerHTML;
  has(tls, '<div class="dname">read_file</div>', 'deleg tools: tool name');
  has(tls, '<span style="width:99.2%" class="ok"></span>', 'deleg tools: 99.2% is ok (>=95)');
  has(tls, '1 call</div>', 'deleg tools: singular call, no failure suffix');
  has(tls, '2 calls · 1 failed', 'deleg tools: plural calls and failures');

  const rec = el.deleglist.innerHTML;
  has(rec, '<span class="ddot ok"></span>', 'deleg recent: completed -> ok dot');
  has(rec, '<span class="ddot bad"></span>', 'deleg recent: failed -> bad dot');
  has(rec, 'title="summarise &lt;the&gt; file">summarise &lt;the&gt; file</div>', 'deleg recent: goal is escaped in title and text');
  has(rec, '<div class="muted text-[length:var(--fs-xs)]">claude-sonnet-5 · 2m</div>', 'deleg recent: short(model) + ago(seconds), no reason when completed');
  has(rec, '(no goal recorded)', 'deleg recent: a missing goal placeholder');
  has(rec, 'm2 · 1h · timeout', 'deleg recent: failure_reason preferred over exit_reason/status');

  // Caps: the panels are bounded, and a stale payload must not grow them.
  DATA.profiles.p1.delegations.tools = Array.from({ length: 9 }, (_, i) => ({ tool: 't' + i, rate: 100, calls: 1 }));
  DATA.profiles.p1.delegations.recent = Array.from({ length: 13 }, (_, i) => ({ status: 'completed', goal: 'g' + i, model: 'm', seconds: 5 }));
  DD.renderDeleg();
  eq(count(el.delegtools.innerHTML, 'class="dname"'), 8, 'deleg tools: capped at 8 rows');
  eq(count(el.deleglist.innerHTML, 'class="dgoal"'), 12, 'deleg recent: capped at 12 rows');
  eq(count(el.deleglist.innerHTML, 'class="ddot ok"'), 12, 'deleg recent: every row got its dot');

  // children:0 is "nothing ran", not "a run with 0 children" — the card hides.
  DATA.profiles.p1.delegations = { children: 0, ok: 0, rate: 0, wasted_hours: 0, cost_usd: 0 };
  DD.renderDeleg();
  eq(el.delegcard.hidden, true, 'deleg: zero children hides the card');

  const orphan = dom('delegkpi');
  noThrow(() => DD.renderDeleg(), 'deleg: a missing #delegcard is a no-op');
  eq(orphan.delegkpi.innerHTML, '', 'deleg: the early return never writes the KPIs');
}

// ═══ renderHeatmap ═══════════════════════════════════════════════════════════
{
  const DH = await load();
  const el = dom('heatmap', 'heatsub', 'heatcard');
  // Dates are relative to today and land inside the 52-week grid for any run day.
  const back = d => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
  const d1 = back(3), d2 = back(10), d3 = back(5), d4 = back(7);

  DH.renderHeatmap([]);
  eq(el.heatcard.hidden, true, 'heatmap: no rows hides the card');
  eq(el.heatmap.innerHTML, '', 'heatmap: no rows writes nothing');
  DH.renderHeatmap(null);
  eq(el.heatcard.hidden, true, 'heatmap: null payload hides the card');
  DH.renderHeatmap([{ v: 5 }, { d: '' }]);
  eq(el.heatcard.hidden, true, 'heatmap: rows without a date are filtered out');

  DH.renderHeatmap([
    { d: d1, v: 1 },
    { d: d2, v: 100 },
    { d: d3, v: 0 },
    { d: d4, v: 3, p: 'anthropic', m: 'claude-sonnet-5' },
    { d: d4, v: 2, p: 'fireworks' },
  ]);
  eq(el.heatcard.hidden, false, 'heatmap: rows show the card');
  const html = el.heatmap.innerHTML;
  eq(el.heatsub.textContent, `3 active days · 106 calls · busiest ${d2} (100)`, 'heatmap sub: active days, total and busiest day');

  has(html, '<div class="hm-grid">', 'heatmap: the grid is rendered');
  has(html, `<i class="hm-d l1" style="background:color-mix(in srgb, var(--accent) 34%, var(--border))" title="${d1} \u00b7 1 calls \u00b7 ? 100%"></i>`,
    'heatmap: lone un-priced day is level 1 / 34% accent');
  has(html, `<i class="hm-d l3" style="background:color-mix(in srgb, var(--accent) 70%, var(--border))" title="${d2} \u00b7 100 calls \u00b7 ? 100%"></i>`,
    'heatmap: the busiest day is level 3 / 70% (quartiles over [1,5,100])');
  has(html, `background:linear-gradient(135deg, color-mix(in srgb, hsl(17 66% 55%) 52%, var(--border)) 0.00% 60.00%,color-mix(in srgb, #ff663d 52%, var(--border)) 60.00% 100.00%)`,
    'heatmap: a two-provider day is a hard-stop gradient sized by share');
  has(html, `title="${d4} \u00b7 5 calls \u00b7 anthropic 60% \u00b7 fireworks 40%"`, 'heatmap: tooltip lists providers by share, biggest first');
  has(html, `<i class="hm-d l0" style="" title="${d3} \u00b7 0 calls \u00b7 ? NaN%"></i>`,
    'heatmap: a present-but-zero day is level 0, keeps the style attribute, and divides by zero in its tooltip');
  has(html, `<i class="hm-d l0" title="`, 'heatmap: a grid day with no payload row gets no style attribute');

  has(html, '<i class="hm-sw" style="background:var(--accent)"></i><span class="muted">?</span>', 'heatmap legend: an unknown provider key uses the accent');
  has(html, '<i class="hm-sw" style="background:hsl(17 66% 55%)"></i><span class="muted">anthropic</span>', 'heatmap legend: anthropic uses PROV.fg');
  has(html, '<i class="hm-sw" style="background:#ff663d"></i><span class="muted">fireworks</span>', 'heatmap legend: fireworks uses PROV.fg');
  ok(html.indexOf('>?</span>') < html.indexOf('>anthropic</span>') && html.indexOf('>anthropic</span>') < html.indexOf('>fireworks</span>'),
    'heatmap legend: providers ordered by total calls (101 / 3 / 2)');
  has(html, '<span class="muted">less</span>', 'heatmap key: less label');
  has(html, '<span class="muted">more</span>', 'heatmap key: more label');
  eq(count(html, '<div class="hm-w">') >= 52 && count(html, '<div class="hm-w">') <= 54, true, 'heatmap: 52-54 whole-week columns');
  eq(count(html, '<i class="hm-d'), 7 * count(html, '<div class="hm-w">') + 6, 'heatmap: 7 cells per week plus the 6-swatch intensity key');
  eq(count(html, 'hm-d hm-pad'), 6 - new Date().getDay(), 'heatmap: only the unfinished final week is padded');

  const orphan = dom('heatsub');
  noThrow(() => DH.renderHeatmap([{ d: d1, v: 1 }]), 'heatmap: a missing #heatmap is a no-op');
  eq(orphan.heatsub.textContent, '', 'heatmap: the early return never touches #heatsub');
}

console.log(`unit_views_health: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
