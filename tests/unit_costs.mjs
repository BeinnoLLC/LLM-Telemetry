// #150 → in-app: the price sheet's calculator lives in views.js now (it is a
// view, not a page). The pure pieces (wiParseTokens token-shorthand parsing,
// wiMoney's display bands) come off the module namespace and are tested
// directly; the interactive shell (optgroups, default choice, wiring,
// arithmetic) is mounted through the same path the app uses — the Prices
// view's render — driven through a fake DOM via isolate, like the views
// suites do. renderUnpriced's never-a-silent-$0 banner is asserted here too.
//
// Every expected value is derived BY HAND from the rules in
// src/llm_telemetry/web/js/views.js (the GROUPS order, `used first then by
// name`, wiMoney's bands, `Math.max(1, Math.round(x || 1))`, the per-1M
// in_1m/out_1m rates, the `window.COSTS_DATA` payload shape `{ models:
// [{model, source, in_1m, out_1m, calls}], kwh, watts }`), NOT captured from
// program output. If a case fails, re-read the module, don't copy the number.
// Time is not involved: nothing here may call Date.now().
//
// NOT covered, deliberately:
//   * the sheet's <table> body — check_wide_tables.js owns the sticky-column
//     and fade behaviours.
//   * the price table's sort order — thin glue over a sort, exercised by
//     check_wide_tables.js.
import { isolate } from './lib/isolate.mjs';

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — got ' + JSON.stringify(got) : ''}`); }
};
const eq = (got, want, name) => chk(JSON.stringify(got) === JSON.stringify(want), name, got);

// ---- a DOM with just enough shape for views.js boot + the Prices view -----
const mkEl = () => ({
  querySelector: () => mkEl(), querySelectorAll: () => [],
  value: '', textContent: '', innerHTML: '', dataset: {}, style: {},
  children: [], options: [], label: '', tag: '', hidden: false, id: '',
  appendChild(c) { this.children.push(c); if (this.tag === 'select') this.options.push(c); },
  addEventListener(type, fn) { (this._on ||= {})[type] = fn; },
  remove() {}, setAttribute() {}, classList: { add() {}, toggle() {}, remove() {} },
});
const registry = {};
const el = id => (registry[id] ||= mkEl());
// palette.$ returns null for ids the app owns only when mounted — but the
// calculator needs its four controls to exist, so the stub fabricates them.
const fakeDocument = {
  getElementById: el,
  createElement: tag => { const e = mkEl(); e.tag = tag; return e; },
  documentElement: Object.assign(mkEl(), { dataset: { theme: 'dark' } }),
  querySelectorAll: () => [],
  addEventListener() {}, body: mkEl(), head: mkEl(),
};
globalThis.document = fakeDocument;

// The price sheet payload. Rates are per 1M tokens; names come from
// `m.short || m.model`, usage from `m.calls`. zed is the dearest used metered
// model by out-rate, so the calculator's default lands on index 0.
const CATALOG = [
  { model: 'zed', source: 'metered', in_1m: 3, out_1m: 15, calls: 4 },
  { model: 'alpha', source: 'metered', in_1m: 1, out_1m: 1, calls: 2 },
  { model: 'mid', source: 'metered', in_1m: 2, out_1m: 4, calls: 0 },
  { model: 'zeta', source: 'openrouter', in_1m: 2, out_1m: 4, calls: 0 },
  { model: 'local-big', source: 'local', in_1m: 0, out_1m: 0, calls: 1 },
  { model: 'freebie', source: 'free-tier', in_1m: 0, out_1m: 0, calls: 1 },
  { model: 'mystery', source: 'unpriced', in_1m: 0, out_1m: 0, calls: 3 },
  { model: 'oldprice', source: 'metered', in_1m: 1, out_1m: 1, calls: 0 },
];
const SHEET = {
  schema_version: 1,
  models: CATALOG,
  kwh: 0.15, watts: 500,
  profiles: { p1: { label: 'One', rows: [], hours: [], sessions: [],
    hour_rows: [], alerts: [], heatmap: {}, sessions_tree: {}, context: {},
    concurrency: {}, latency: {}, attribution: {}, delegations: [],
    failures_recent: [], outcomes: {}, tools: {}, live: {},
    terminal_top_fail_commands: [], repo_branch: {}, compression_pressure: {} } },
  resolution: { mode: 'single' },
};

const D = await isolate('views.js', {
  'palette.js': {
    $: id => (registry[id] ||= mkEl()), esc: s => String(s), escA: s => String(s),
    fmt: v => String(v), fmtB: v => String(v), short: v => String(v),
    money: v => '$' + Number(v || 0).toFixed(2),
    costCell: () => '', emptyHTML: () => '', icon: () => '', fade: () => '',
    ic: () => '', colorOf: () => '', ago: () => '', PAL: {}, AC: '#AC', BD: '#BD',
    MU: '#MU', stampFreshness: () => {}, trapFocus: () => {}, trapTab: () => {},
  },
  'charts.js': {
    PROJ_WEIGHT: 0, PROJ_WEIGHT_LABELS: {}, agg: () => ({}), charts: [],
    ctxSpark: () => '', current: 'p1', mk: () => ({}), noLeg: () => ({}),
    olBar: () => '', projDistNormalized: () => ({}), projTrendStacked: () => ({}),
    radialRing: () => '', sparkSvg: () => '', weightValue: () => 1,
  },
  'router.js': {
    HOUR_RANGE: 0, MODEL_FILTER: '', PROJECT_FILTER: '', PROVIDER_FILTER: '',
    POWER: { tariff: { electricity_rate_kwh: 0.15 } },
    clearCrossFilters() {}, hourRowsFor: () => [], pickView() {}, setHash() {},
    setCrossFilter() {}, view: 'Prices',
  },
  'flow.js': { flowControls: {}, renderFlow() {} },
  'live.js': { renderLive() {} },
  'routerview.js': { renderRouterView() {}, routerStat() { return 'RS'; } },
  'quotaview.js': { renderQuotaView() {}, qvStat() { return 'QS'; } },
  'main.js': { DATA: SHEET, LOCAL_HOSTS: ['local'], RANKINGS_DATA: [], SCHEMA_VERSION: 1, css: () => '' },
}, { window: { COSTS_DATA: SHEET }, requestAnimationFrame: fn => fn(), setTimeout: fn => fn() });
// isolate() removes its globals on return; the boot already ran, so put the
// window back for the calculator calls that follow.
globalThis.window = { COSTS_DATA: SHEET };

// ---- pure helpers off the module namespace --------------------------------
eq(D.wiMoney(18), '$18.00', '≥ $1 keeps 2dp');
eq(D.wiMoney(0.02), '$0.020', '$0.01–$1 keeps 3dp');
eq(D.wiMoney(0.002), '$0.00200', 'sub-cent keeps 5dp');
eq(D.wiMoney(0), '$0.00', 'exact zero is $0.00');
eq(D.wiMoney(1e6), '$1000000.00', 'big numbers are not abbreviated');
eq(D.wiMoney(0.01), '$0.010', '≥0.01 is inclusive at 3dp');
eq(D.wiMoney(0.009), '$0.00900', 'just under $0.01 is still 5dp');

eq(D.wiParseTokens('1m'), 1e6, 'the m suffix multiplies by 1e6');
eq(D.wiParseTokens('100k'), 1e5, 'the k suffix multiplies by 1e3');
eq(D.wiParseTokens('1,000,000'), 1e6, 'commas are stripped');
eq(D.wiParseTokens('1_000'), 1000, 'underscores are stripped');
eq(D.wiParseTokens(' 42 '), 42, 'whitespace is trimmed');
eq(D.wiParseTokens('NONSENSE'), 0, 'an unparseable count is zero, not NaN');
eq(D.wiParseTokens('-5'), 0, 'a negative count is rejected');
eq(D.wiParseTokens(''), 0, 'an empty field is zero');
eq(D.wiParseTokens('1M'), 1e6, 'the suffix is case-insensitive');
eq(D.wiParseTokens('m'), 0, 'a bare suffix is not a number');
eq(D.wiParseTokens('1e3'), 1000, 'plain scientific notation still parses');

// ---- mount the Prices view the way the app does --------------------------
// priceWhatIfInstall is mounted by the Prices view's render — drive the same
// entry point production's view switch uses (views.js `if (view === 'Prices')
// renderPrices();`), not a private shortcut.
registry['view-prices-container'] = mkEl();   // the view's own mount node
D.renderPrices();

// ---- the default selection is the dearest used metered model --------------
const sel = registry.cm;
const text = () => registry.ctot.textContent;
const brk = () => registry.cbrk.innerHTML;
const fire = (id, type = 'input') => registry[id]._on[type]();
eq(sel.value, '0', 'the default is the used metered model with the highest out-rate');
eq(text(), '$0.00 billed', 'an empty load costs $0.00 billed');
eq(brk(), 'in $0.00 + out $0.00', 'a single run has no ×N in the breakdown');

// ---- grouping: optgroups in the fixed kind order --------------------------
const groups = sel.children.filter(c => c.tag === 'optgroup');
eq(groups.map(g => g.label),
   ['Local (electricity) · 1', 'Metered (billed per token) · 5',
    'Free tier ($0) · 1', 'Unpriced (no rate) · 1'],
   'optgroups appear in the fixed order: Local, Metered, Free tier, Unpriced');
const metered = groups[1];
eq(metered.children.map(o => o.value), ['1', '0', '2', '7', '3'],
   'metered: used first by name, then the rest by name');
eq(metered.children.map(o => o.textContent),
   ['alpha  • used', 'zed  • used', 'mid', 'oldprice', 'zeta'],
   'only used models carry the marker');
eq(groups[3].children[0].value, '6', 'the unpriced group holds the unpriced model');
chk(metered.label.endsWith('· 5'), 'the group label carries its member count', metered.label);

// ---- arithmetic -----------------------------------------------------------
registry.ci.value = '1m';
registry.co.value = '1m';
fire('ci');
eq(text(), '$18.00 billed', 'the total is in-cost + out-cost at the model rate (zed: 3 + 15)');
eq(brk(), 'in $3.00 + out $15.00', 'the breakdown shows both sides');

registry.cr.value = '2';
fire('cr');
eq(text(), '$36.00 billed', 'runs multiply the total');
eq(brk(), 'in $3.00 + out $15.00 × 2 runs', 'a multi-run breakdown says ×N runs');

registry.cr.value = '2.4';
fire('cr');
eq(text(), '$36.00 billed', 'runs round to the nearest whole run');
registry.cr.value = '0';
fire('cr');
eq(text(), '$18.00 billed', 'a zero run count falls back to one run');
registry.cr.value = '';
fire('cr');
eq(text(), '$18.00 billed', 'an empty run count falls back to one run');

// ---- token parsing drives the same calc ----------------------------------
registry.cm.value = '2';                 // mid: in 2, out 4 (per 1M)
registry.ci.value = '1,000,000';
registry.co.value = '';
fire('ci', 'change');                    // the change listener drives the same calc
eq(text(), '$2.00 billed', 'commas are stripped from token counts');
registry.ci.value = '1_000';
fire('ci');
eq(text(), '$0.00200 billed', 'underscores are stripped and small money keeps 5dp');
registry.ci.value = '10000';
fire('ci');
eq(text(), '$0.020 billed', 'money at $0.01 keeps 3dp');
registry.ci.value = '1';
fire('ci');
eq(text(), '$0.00000 billed', 'a positive sub-cent amount keeps 5dp, never $0');
registry.ci.value = 'nonsense';
fire('ci');
eq(text(), '$0.00 billed', 'an unparseable token count is zero, not NaN');
registry.ci.value = '-5';
fire('ci');
eq(text(), '$0.00 billed', 'a negative token count is rejected');

// ---- local: electricity, not a bill --------------------------------------
registry.cm.value = '4';
registry.ci.value = '1m';
registry.co.value = '1m';
fire('ci');
chk(text().includes('electricity'), 'a local model is costed as electricity', text());
chk(brk().includes('your power cost, not billed by anyone'),
    'the local breakdown says the cost is power, not a bill', brk());

// ---- free tier -----------------------------------------------------------
registry.cm.value = '5';
fire('ci');
chk(text().includes('free'), 'a free-tier model is labelled free', text());
chk(!text().includes('NaN'), 'a free-tier model with no rates does not print NaN', text());

// ---- unpriced: never a silent $0 -----------------------------------------
registry.cm.value = '6';
fire('ci');
eq(text(), 'no rate available', 'an unpriced model says so instead of $0.00');
chk(brk().length > 0 && !text().includes('$0.00 billed'),
    'the unpriced breakdown explains why', brk());

// ---- out-of-range selection ----------------------------------------------
registry.ctot.textContent = 'sentinel';
registry.cm.value = '99';
fire('ci');
eq(text(), 'sentinel', 'an index past the end of the sheet is ignored, not rendered as NaN');

// ---- every control is wired to the same calc -----------------------------
chk(['cm', 'ci', 'co', 'cr'].every(id => registry[id]._on.input && registry[id]._on.change),
    'all four controls listen on input and change');
eq(registry.cm._on.input === registry.cm._on.change, true,
   'one handler serves both events, so keyboard and paste agree');
eq(registry.ci._on.input === registry.ci._on.change, true,
   'input and change share the single calc function');

// ---- renderUnpriced: never a silent $0 ------------------------------------
registry.unpricedbanner = mkEl();
const banner = registry.unpricedbanner;
D.renderUnpriced([{ model: 'mystery', calls: 3 }]);
chk(banner.innerHTML.includes('mystery'), 'an unpriced model is listed by name', banner.innerHTML);
chk(banner.innerHTML.includes('no price'), 'the banner says why the estimate is short', banner.innerHTML);
D.renderUnpriced([{ model: 'zed', calls: 4, priced: true }]);
eq(banner.hidden, true, 'a fully-priced sheet hides the banner');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);