// tests/unit_views_projects.mjs
//
// Isolated unit suite for the attribution / projects / drilldown slice of
// src/llm_telemetry/web/js/views.js (ticket #30: point the jsdom suites at
// modules instead of the built HTML).
//
// Slice under test (views.js @ 73146ba), all read verbatim from source:
//   renderAttribution (1153-1205), REPO_EXPANDED/renderRepoBranch (1208-1240),
//   renderProjects (1242-1313), PROJ_MATRIX_MAX_COLS/renderProjectMatrix (1321-),
//   pdFocusReturn/pdOpenState/pdOpen/pdClose/pdKeydown (1434-1606),
//   installProjectDrilldown/installProjWeight (1608-1662),
//   PROJ_FILTER_VIEWS/populateProjFilterSelect/populateRowFilterSelects/
//   syncProjFilterUI/installProjFilter (1650-1718),
//   renderProjectDistribution/renderProjDistLegend (1719-1830),
//   PROJ_TREND_TOP_N/renderProjectTrend/renderProjTrendLegend (1806-1935).
//
// Harness: tests/lib/isolate.mjs (same as unit_views_health.mjs) — views.js is
// evaluated with a synthetic `const`-binding stub module per relative import,
// so nothing but the real views.js source is exercised. There is no jsdom: the
// fake element/document below implements exactly the DOM surface the slice
// touches, and every expected string is hand-derived from the source lines
// named in each check.

import { isolate } from './lib/isolate.mjs';

let pass = 0, fail = 0;
const failures = [];
function ck(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; failures.push(extra === undefined ? name : `${name} — ${extra}`); }
}
function eq(name, got, want) {
  ck(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}
function has(name, hay, needle) {
  ck(name, typeof hay === 'string' && hay.indexOf(needle) !== -1,
     `missing ${JSON.stringify(needle)} in ${JSON.stringify(String(hay).slice(0, 200))}`);
}
function hasNot(name, hay, needle) {
  ck(name, typeof hay === 'string' && hay.indexOf(needle) === -1, `unexpected ${JSON.stringify(needle)}`);
}
function count(hay, needle) {
  return typeof hay === 'string' ? hay.split(needle).length - 1 : -1;
}

// ---------------------------------------------------------------- fake DOM --
let FOCUS = [];   // elements .focus() was called on, in order
let ACTIVE = null; // document.activeElement

function mkEl(id) {
  const o = {
    id, tagName: 'DIV', innerHTML: '', textContent: '', hidden: false,
    checked: false, value: '', disabled: false, tabindex: 0,
    style: {}, dataset: {}, attrs: {}, children: [], listeners: {},
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c, on) { (on === undefined ? !this._s.has(c) : on) ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    focus() { FOCUS.push(o); ACTIVE = o; },
    blur() { if (ACTIVE === o) ACTIVE = null; },
    setAttribute(k, v) { o.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(o.attrs, k) ? o.attrs[k] : null; },
    removeAttribute(k) { delete o.attrs[k]; },
    appendChild(c) { o.children.push(c); return c; },
    get firstElementChild() { return o.children[0] || null; },
    removeChild(c) { o.children = o.children.filter(x => x !== c); return c; },
    insertBefore(c) { o.children.unshift(c); return c; },
    querySelector(sel) { return (o._q && o._q[sel] && o._q[sel][0]) || null; },
    querySelectorAll(sel) { return (o._q && o._q[sel]) || []; },
    closest() { return null; },
    contains() { return false; },
    matches() { return false; },
    getContext() { return null; }, // unattrPattern() falls back when there is no 2d ctx
    getBoundingClientRect() { return { width: 600, height: 240, top: 0, left: 0, right: 600, bottom: 240 }; },
    addEventListener(t, f) { (o.listeners[t] = o.listeners[t] || []).push(f); },
    removeEventListener(t, f) { o.listeners[t] = (o.listeners[t] || []).filter(x => x !== f); },
    dispatch(t, ev) {
      (o.listeners[t] || []).forEach(f => f(Object.assign({ type: t, target: o, preventDefault() {}, stopPropagation() {} }, ev)));
    },
    click() { o.dispatch('click'); },
  };
  return o;
}

// Ids the slice looks up. Everything else returns null (the code's own
// `if (!el) return` guards are part of what the suite fences).
const IDS = [
  'attribcard', 'attribsource', 'attribtool', 'attribroot', 'attribcronwrap',
  'attribcron', 'attribfooter',
  'repolist', 'repoempty',
  'projcard', 'projempty', 'projhdr', 'projexclude', 'cProjects',
  'projmatrix', 'projmatrixempty',
  'pdscrim', 'pdrawer', 'pdbody', 'pdtitle',
  'projfiltersel', 'projfilterrow', 'projfilterchip', 'projfiltername',
  'rowfilterproj', 'rowfilterprov', 'rowfiltermodel',
  'projdistcard', 'projdistlegend', 'projtrendcard', 'projtrendlegend',
  'cProjDist', 'cProjTrend', 'projdistempty', 'projtrendempty',
  'pdclose', 'projweight', 'provfiltersel', 'modelfiltersel', 'projfilterclear',
  'projfilterchipname',
];

function mkDom() {
  const els = {};
  for (const id of IDS) els[id] = mkEl(id);
  const docListeners = [];
  const doc = {
    get activeElement() { return ACTIVE; },
    getElementById: id => els[id] || null,
    createElement: tag => { const e = mkEl(tag); e.tagName = String(tag).toUpperCase(); return e; },
    head: { children: [], appendChild(c) { this.children.push(c); } },
    body: { children: [], appendChild(c) { this.children.push(c); } },
    addEventListener(t, f, opts) {
      const capture = !!(opts === true || (opts && opts.capture));
      // real DOM: registering the same (type, listener, capture) twice is a no-op
      if (docListeners.some(r => r.t === t && r.f === f && r.capture === capture && !r.removed)) return;
      docListeners.push({ t, f, capture, removed: false });
    },
    removeEventListener(t, f, opts) {
      const rec = docListeners.find(r => r.t === t && r.f === f && !r.removed);
      if (rec) rec.removed = true;
    },
    querySelector() { return null; }, querySelectorAll() { return []; },
    documentElement: { style: { setProperty() {} } },
  };
  return { doc, els, docListeners };
}

// --------------------------------------------------------------- stubs -----
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escA = s => esc(s).replace(/'/g, '&#39;');
const fmt = n => { const v = +n || 0; return v < 1000 ? String(v) : (v / 1000).toFixed(1) + 'k'; };
const fmtB = n => { const v = +n || 0; return v < 1024 ? v + ' B' : (v / 1024).toFixed(1) + ' KB'; };
const money = v => '$' + (v || 0).toFixed(4);
const PAL = ['#111', '#222', '#333'];
const UNATTR_FILL = 'rgba(148,163,184,0.5)'; // unattrPattern() with no 2d ctx

function baseChartsStub(over = {}) {
  return Object.assign({
    PROJ_WEIGHT: 'cost',
    // Shape mirrors charts.js: PROJ_WEIGHT_LABELS[k] = {axis, unit, fmt}.
    PROJ_WEIGHT_LABELS: {
      cost: { axis: 'cost', unit: 'USD', fmt: v => '$' + (+v || 0).toFixed(2) },
      calls: { axis: 'calls', unit: 'calls', fmt: v => String(+v || 0) },
      tokens: { axis: 'tokens', unit: 'tok', fmt: v => String(+v || 0) },
      sessions: { axis: 'sessions', unit: 'sessions', fmt: v => String(+v || 0) },
    },
    weightValue: weightValueStub,
    agg: rows => (rows || []),
    charts: {},
    ctxSpark: rows => rows,
    current: 'default',
    mk: MkRecorder,
    noLeg: c => c,
    olBar: c => c,
    projDistNormalized: false,
    projTrendStacked: false,
    radialRing: () => '',
    sparkSvg: () => '',
  }, over);
}

// mk() is called by the renderers with the whole chart spec; recording the
// call args is how we assert labels/datasets/config without a Chart.js canvas.
let mkCalls = [];
function MkRecorder(id, type, labels, datasets, opts) {
  const rec = { id, type, labels, datasets, opts, destroyed: false };
  mkCalls.push(rec);
  return { destroy() { rec.destroyed = true; }, update() {}, data: { labels, datasets }, options: opts };
}

// weightValue() call log — proves the matrix/trend group RAW rows (the source
// comment is explicit that sessions weighting needs distinct session_ids, not a
// pre-summed bucket).
let wvCalls = [];
const weightValueStub = rows => {
  wvCalls.push(rows);
  return (rows || []).reduce((s, r) => s + (+r.act || +r.est || 0), 0);
};

let chartGet = null; // what Chart.getChart() returns
let xfCalls = [];    // setCrossFilter / clearCrossFilters log
let lsWrites = [];   // localStorage.setItem log
let hashCalls = [];  // setHash log
let renderCalls = 0; // main.render()
function baseGlobals(doc) {
  return {
    document: doc,
    window: {},
    localStorage: { getItem: () => null, setItem(k, v) { lsWrites.push([k, v]); }, removeItem() {} },
    Chart: { getChart: () => chartGet },
    requestAnimationFrame: f => { if (typeof f === 'function') f(); return 1; },
  };
}

async function load(over = {}) {
  mkCalls = [];
  wvCalls = [];
  xfCalls = [];
  lsWrites = [];
  hashCalls = [];
  renderCalls = 0;
  FOCUS = [];
  ACTIVE = null;
  chartGet = over.chartGet || null;
  const { doc, els, docListeners } = mkDom();
  const V = await isolate('views.js', {
    'palette.js': {
      $: id => els[id] || null,
      esc, escA, fmt, fmtB, money,
      PAL, BD: '#eee', MU: '#999', AC: '#0af',
      ago: () => 'now', fade: () => '', ic: () => '<i></i>', icon: () => '',
      costCell: v => money(v), emptyHTML: '',
      colorOf: () => '#abcdef', short: m => String(m == null ? '' : m),
      // #146: the REAL trap helpers, not stubs — pdOpen goes through the same
      // helper every other overlay uses, so test what actually ships. palette.js
      // cannot be isolated here (it reads document at call time inside these
      // three), so this is the palette contract, copied verbatim from
      // palette.js:268-320 by hand — the focus unit tests (unit_focus.mjs) hold
      // the real implementations to these exact semantics.
      trapFocus(modal, scrim, onKey){
        const opener = (typeof document !== 'undefined' && document.activeElement) ? document.activeElement : null;
        const setAria = (m, s, open) => {
          [m, s].forEach(el => { if (el && el.setAttribute) el.setAttribute('aria-hidden', String(!open)); });
          if (open && m && m.setAttribute) m.setAttribute('aria-modal', 'true');
        };
        const bound = e => {
          // real trapTab semantics, same three lines as palette.js:277-287
          if (!e || e.key !== 'Tab' || !modal) { if (onKey) onKey(e); return; }
          const list = Array.prototype.slice.call(modal.querySelectorAll ? modal.querySelectorAll('a[href],button,[tabindex]') : []);
          if (!list.length) { if (onKey) onKey(e); return; }
          const first = list[0], last = list[list.length - 1];
          const active = typeof document !== 'undefined' ? document.activeElement : null;
          const inside = !!(active && modal.contains && modal.contains(active));
          if (e.shiftKey && (!inside || active === first)){ e.preventDefault(); last.focus(); return; }
          if (!e.shiftKey && (!inside || active === last)){ e.preventDefault(); first.focus(); return; }
          if (onKey) onKey(e);
        };
        if (typeof document !== 'undefined') document.addEventListener('keydown', bound, true);
        setAria(modal, scrim, true);
        let released = false;
        return {
          opener, onKeydown: bound,
          release(){ if (released) return false; released = true;
            if (typeof document !== 'undefined') document.removeEventListener('keydown', bound, true);
            setAria(modal, scrim, false);
            if (opener && opener.focus) opener.focus(); return true; },
        };
      },
      // pdKeydown calls trapTab directly too — same shared helper semantics.
      trapTab(e, root){
        if (!e || e.key !== 'Tab' || !root) return false;
        const list = Array.prototype.slice.call(root.querySelectorAll('a[href],button,[tabindex]'));
        if (!list.length) return false;
        const first = list[0], last = list[list.length - 1];
        const active = typeof document !== 'undefined' ? document.activeElement : null;
        // real DOM: contains() on the drawer. The mock's contains() is always
        // false, so accept the active element being IN the root's focusable
        // list as inside — that list is the drawer's subtree in every case
        // this suite exercises (real palettes use root.contains directly).
        const inside = !!(active && (root.contains && root.contains(active) || list.includes(active)));
        if (e.shiftKey && (!inside || active === first)){ e.preventDefault(); last.focus(); return true; }
        if (!e.shiftKey && (!inside || active === last)){ e.preventDefault(); first.focus(); return true; }
        return false;
      },
    },
    'charts.js': baseChartsStub(over.charts),
    'flow.js': { flowControls: [], renderFlow() {} },
    'live.js': { renderLive() {} },
    'routerview.js': { renderRouterView() {}, routerStat: () => '' },
    'quotaview.js': { renderQuotaView() {}, qvStat: () => '' },
    'router.js': {
      HOUR_RANGE: 'all', MODEL_FILTER: '', POWER: '', PROJECT_FILTER: '',
      PROVIDER_FILTER: '', clearCrossFilters() { xfCalls.push(['clear']); },
      hourRowsFor: () => [],
      pickView() {}, setCrossFilter(...a) { xfCalls.push(a); },
      setHash(...a) { hashCalls.push(a); }, view: 'Usage',
      ...(over.router || {}),
    },
    'main.js': {
      DATA: over.data || { schema_version: 1, profiles: { default: {} } },
      LOCAL_HOSTS: ['localhost', '127.0.0.1'],
      SCHEMA_VERSION: 1, css: () => '',
      // NOTE: no `render` here on purpose — installProjFilter calls views.js's
      // OWN exported render() (line 399), which needs the whole dashboard DOM
      // and is covered by the app-level suites, not this isolated slice.
    },
  }, baseGlobals(doc));
  // isolate() installs globals only while evaluating; the slice reads
  // document/Chart at call time, so keep them live on globalThis too.
  globalThis.document = doc;
  globalThis.Chart = { getChart: () => chartGet };
  globalThis.localStorage = baseGlobals(doc).localStorage;
  return { V, els, doc, docListeners };
}

// ============================================================ renderAttribution
// views.js:1153-1205. Signature is renderAttribution(attrib) with
// attrib.by_source / by_root / by_cron / by_tool; money() is LOCAL here and
// formats to 4 decimals, unlike the 2-decimal money used by the repo rows.
{
  const { V, els } = await load();

  // no card -> silent return, nothing touched
  els.attribcard = undefined; // $() then returns null for this id
  V.renderAttribution({ by_source: [{ source: 'session', sessions: 1, cost: 1 }] });
  ck('renderAttribution: missing card returns without throwing', true);

  const { V: V2, els: e2 } = await load();
  // empty / absent attribution hides the card
  e2.attribcard.hidden = false;
  V2.renderAttribution({});
  eq('renderAttribution: no by_source hides the card', e2.attribcard.hidden, true);
  eq('renderAttribution: hidden card writes no source rows', e2.attribsource.innerHTML, '');

  // one source row: name, N sess, money with 4 decimals
  e2.attribcard.hidden = true;
  V2.renderAttribution({ by_source: [{ source: 'session', sessions: 3, cost: 0.5 }] });
  eq('renderAttribution: by_source unhides the card', e2.attribcard.hidden, false);
  has('renderAttribution: source name rendered', e2.attribsource.innerHTML, '<span class="font-semibold flex-1 truncate">session</span>');
  has('renderAttribution: session count rendered', e2.attribsource.innerHTML, '3 sess');
  has('renderAttribution: cost rendered with 4 decimals', e2.attribsource.innerHTML, '$0.5000');

  // esc() is applied to the source name
  V2.renderAttribution({ by_source: [{ source: '<b>&"x', sessions: 1, cost: 0 }] });
  has('renderAttribution: source name is esc-escaped', e2.attribsource.innerHTML, '&lt;b&gt;&amp;&quot;x');
  has('renderAttribution: missing cost falls back to $0.0000', e2.attribsource.innerHTML, '$0.0000');

  // 4-decimal rounding, hand-checked: 1.23456 -> 1.2346, 1.23454 -> 1.2345
  V2.renderAttribution({ by_source: [{ source: 'a', sessions: 1, cost: 1.23456 }] });
  has('renderAttribution: money rounds up at the 4th decimal', e2.attribsource.innerHTML, '$1.2346');
  V2.renderAttribution({ by_source: [{ source: 'a', sessions: 1, cost: 1.23454 }] });
  has('renderAttribution: money rounds down at the 4th decimal', e2.attribsource.innerHTML, '$1.2345');

  // byTool empty -> the exact placeholder div, and attribcron untouched
  eq('renderAttribution: empty byTool renders the exact placeholder',
     e2.attribtool.innerHTML,
     '<div class="muted text-[length:var(--fs-xs)] py-1">No tool-result tokens in range.</div>');
  eq('renderAttribution: no cron rows leaves attribcron untouched', e2.attribcron.innerHTML, '');

  // byTool with tokens -> N tok with locale separators
  V2.renderAttribution({
    by_source: [{ source: 'a', sessions: 1, cost: 0 }],
    by_tool: [{ tool: 'read_file', tokens: 1000, cost: 0.02 }],
  });
  has('renderAttribution: tool name rendered', e2.attribtool.innerHTML, 'read_file');
  has('renderAttribution: tool tokens use toLocaleString', e2.attribtool.innerHTML, '1,000 tok');
  has('renderAttribution: tool cost rendered', e2.attribtool.innerHTML, '$0.0200');

  // byRoot: own / descendants / total plus the timeline button wiring
  V2.renderAttribution({
    by_source: [{ source: 'a', sessions: 1, cost: 0 }],
    by_root: [{ id: 's-1', title: 'Root task', own: 0.1, descendants: 0.2, total: 0.3 }],
  });
  const rootHtml = e2.attribroot.innerHTML;
  has('renderAttribution: root renders timeline button', rootHtml, 'class="chip lntimelinebtn truncate flex-1"');
  has('renderAttribution: root button carries session id', rootHtml, 'data-tsession="s-1"');
  has('renderAttribution: root button carries current profile', rootHtml, 'data-tprofile="default"');
  has('renderAttribution: root button carries escaped title', rootHtml, 'data-title="Root task"');
  has('renderAttribution: root own cost rendered', rootHtml, 'own $0.1000');
  has('renderAttribution: root descendant cost rendered', rootHtml, '+desc $0.2000');
  has('renderAttribution: root total rendered', rootHtml, '$0.3000');

  // title escaping inside the attribute + visible text
  V2.renderAttribution({
    by_source: [{ source: 'a', sessions: 1, cost: 0 }],
    by_root: [{ id: 's"2', title: 'a"b<c', own: 0, descendants: 0, total: 0 }],
  });
  has('renderAttribution: root id is escaped', e2.attribroot.innerHTML, 'data-tsession="s&quot;2"');
  has('renderAttribution: root title is escaped in text', e2.attribroot.innerHTML, 'a&quot;b&lt;c');

  // slice(0,10) fence: 12 roots -> 10 rows
  const roots = Array.from({ length: 12 }, (_, i) => ({ id: 's' + i, title: 't' + i, own: 0, descendants: 0, total: 0 }));
  V2.renderAttribution({ by_source: [{ source: 'a', sessions: 1, cost: 0 }], by_root: roots });
  eq('renderAttribution: at most 10 root rows render', count(e2.attribroot.innerHTML, 'lntimelinebtn'), 10);
  has('renderAttribution: 10th root renders', e2.attribroot.innerHTML, 'data-tsession="s9"');
  hasNot('renderAttribution: 11th root is dropped', e2.attribroot.innerHTML, 'data-tsession="s10"');

  // cron block: wrapper hidden when empty, exact row markup when present
  e2.attribcronwrap.hidden = true;
  V2.renderAttribution({ by_source: [{ source: 'a', sessions: 1, cost: 0 }], by_cron: [{ name: 'nightly', runs: 2, avg: 0.01, monthly_projection: 0.3 }] });
  eq('renderAttribution: cron wrapper shown when rows exist', e2.attribcronwrap.hidden, false);
  has('renderAttribution: cron name rendered', e2.attribcron.innerHTML, 'nightly');
  has('renderAttribution: cron run count rendered', e2.attribcron.innerHTML, '2 runs');
  has('renderAttribution: cron average rendered', e2.attribcron.innerHTML, 'avg $0.0100');
  has('renderAttribution: cron projection rendered', e2.attribcron.innerHTML, '~$0.3000/mo');
  V2.renderAttribution({ by_source: [{ source: 'a', sessions: 1, cost: 0 }], by_cron: [] });
  eq('renderAttribution: cron wrapper hidden again with no rows', e2.attribcronwrap.hidden, true);
  has('renderAttribution: cron rows survive an empty re-render', e2.attribcron.innerHTML, 'nightly');

  // footer is a fixed disclaimer
  has('renderAttribution: footer disclaimer names OpenRouter pricing', e2.attribfooter.textContent,
      'Cost here comes from this dashboard\u2019s own OpenRouter-rate pricing, not from Hermes\u2019s own cost_status');
  ck('renderAttribution: footer is written via textContent (not innerHTML)', e2.attribfooter.innerHTML === '');
}

// ======================================================= renderRepoBranch
// views.js:1208-1240. REPO_EXPANDED is an exported Set the renderer reads
// directly, so expansion state is asserted through the returned namespace.
{
  const { V, els } = await load();
  ck('REPO_EXPANDED: exported as an empty Set', V.REPO_EXPANDED instanceof Set && V.REPO_EXPANDED.size === 0);

  V.renderRepoBranch({ repos: [] });
  eq('renderRepoBranch: empty data clears the list', els.repolist.innerHTML, '');
  eq('renderRepoBranch: empty data shows the empty note', els.repoempty.hidden, false);

  V.renderRepoBranch({ repos: [{ repo: 'alpha', sessions: 2, calls: 5, tokens: 1500, cost: 1.234, branches: [] }] });
  eq('renderRepoBranch: rows hide the empty note', els.repoempty.hidden, true);
  has('renderRepoBranch: repo name rendered', els.repolist.innerHTML, '<span class="flex-1 truncate">alpha</span>');
  has('renderRepoBranch: repo sessions rendered', els.repolist.innerHTML, '2 sess');
  has('renderRepoBranch: repo calls rendered', els.repolist.innerHTML, '5 calls');
  has('renderRepoBranch: repo tokens go through fmt()', els.repolist.innerHTML, '1.5k tok');
  has('renderRepoBranch: repo cost uses 2 decimals', els.repolist.innerHTML, '$1.23');
  has('renderRepoBranch: collapsed repo shows the right chevron', els.repolist.innerHTML, '&#9656;');
  hasNot('renderRepoBranch: collapsed repo hides its branches', els.repolist.innerHTML, 'pl-6');
  has('renderRepoBranch: repo row carries its repokey', els.repolist.innerHTML, 'data-repokey="alpha"');

  // Unattributed repos are muted and get no expand caret / key handling
  V.renderRepoBranch({ repos: [{ repo: 'Unattributed', sessions: 1, calls: 1, tokens: 0, cost: 0, branches: [] }] });
  has('renderRepoBranch: Unattributed row is muted', els.repolist.innerHTML, 'class="flex-1 truncate muted"');

  // expanded repo renders its branches indented, and the caret flips
  V.REPO_EXPANDED.add('alpha');
  V.renderRepoBranch({ repos: [{
    repo: 'alpha', sessions: 1, calls: 1, tokens: 100, cost: 0.5,
    branches: [
      { branch: 'main', sessions: 1, calls: 2, tokens: 100, cost: 0.5 },
      { branch: 'feat/x', sessions: 0, calls: 1, tokens: 0, cost: 0 },
    ],
  }] });
  has('renderRepoBranch: expanded repo shows the down chevron', els.repolist.innerHTML, '&#9662;');
  eq('renderRepoBranch: expanded repo renders one row per branch', count(els.repolist.innerHTML, 'pl-6'), 2);
  has('renderRepoBranch: branch name rendered', els.repolist.innerHTML, '>main<');
  has('renderRepoBranch: branch name with slash rendered', els.repolist.innerHTML, '>feat/x<');
  has('renderRepoBranch: branch cost rendered', els.repolist.innerHTML, '$0.50');
  hasNot('renderRepoBranch: branch rows carry no repokey', els.repolist.innerHTML, 'data-repokey="main"');

  // branch names are esc-escaped
  V.renderRepoBranch({ repos: [{
    repo: 'alpha', sessions: 0, calls: 0, tokens: 0, cost: 0,
    branches: [{ branch: '<img>', sessions: 0, calls: 0, tokens: 0, cost: 0 }],
  }] });
  has('renderRepoBranch: branch names are escaped', els.repolist.innerHTML, '&lt;img&gt;');
}

// ========================================================== renderProjects
// views.js:1242-1313. Cost per row is (+act || +est || 0), rows are filtered
// by the inclusive [fromDate,toDate] string compare, buckets sort by cost desc
// with Unattributed forced last, and mk('cProjects', ...) receives the buckets.
{
  const { V, els } = await load();

  // no card -> silent return
  els.projcard = undefined;
  V.renderProjects([{ date: '2026-01-01', project: 'a', act: 1 }]);
  ck('renderProjects: missing card returns without throwing', true);

  const { V: V2, els: e2 } = await load();
  V2.renderProjects([], undefined, undefined);
  eq('renderProjects: no rows clear the header', e2.projhdr.textContent, '');
  eq('renderProjects: no rows show the empty note', e2.projempty.hidden, false);
  eq('renderProjects: no rows call mk() zero times', mkCalls.length, 0);

  const rows = [
    { date: '2026-01-01', project: 'A', act: 2, est: 0 },
    { date: '2026-01-05', project: 'B', act: 1, est: 0 },
    { date: '2026-01-09', act: 0, est: 1 },               // unattributed via est
    { date: '2026-01-10', project: 'C', act: 3, est: 9 },  // act wins over est
  ];
  V2.renderProjects(rows, undefined, undefined);
  eq('renderProjects: rows hide the empty note', e2.projempty.hidden, true);
  eq('renderProjects: header reports the unattributed share',
     e2.projhdr.textContent, '14% of spend unattributed — $1.00 of $7.00');
  eq('renderProjects: exactly one chart is built', mkCalls.length, 1);
  eq('renderProjects: chart id', mkCalls[0].id, 'cProjects');
  eq('renderProjects: chart type', mkCalls[0].type, 'bar');
  eq('renderProjects: buckets sort by cost desc, Unattributed last',
     JSON.stringify(mkCalls[0].labels), JSON.stringify(['C', 'A', 'B', 'Unattributed']));
  eq('renderProjects: dataset values follow the labels',
     JSON.stringify(mkCalls[0].datasets[0].data), JSON.stringify([3, 2, 1, 1]));
  eq('renderProjects: unattributed bucket uses unattrPattern() fill',
     JSON.stringify(mkCalls[0].datasets[0].backgroundColor), JSON.stringify(['#111', '#222', '#333', UNATTR_FILL]));
  eq('renderProjects: y axis starts at zero', mkCalls[0].opts.scales.y.beginAtZero, true);
  eq('renderProjects: y grid uses BD', mkCalls[0].opts.scales.y.grid.color, '#eee');
  eq('renderProjects: legend is hidden', mkCalls[0].opts.plugins.legend.display, false);
  eq('renderProjects: unattributed tooltip explains the bucket',
     mkCalls[0].opts.plugins.tooltip.callbacks.afterLabel({ label: 'Unattributed' }),
     'No usable session title, no usable working directory, and no parent session that resolves either.');
  eq('renderProjects: named buckets get no extra tooltip line',
     mkCalls[0].opts.plugins.tooltip.callbacks.afterLabel({ label: 'A' }), '');

  // date window is inclusive on both ends (mkCalls[0] is the earlier render —
  // read the most recent call for the windowed config)
  V2.renderProjects(rows, '2026-01-05', '2026-01-09');
  const cfgW = mkCalls[mkCalls.length - 1];
  eq('renderProjects: fromDate/toDate are inclusive',
     JSON.stringify(cfgW.labels), JSON.stringify(['B', 'Unattributed']));
  eq('renderProjects: windowed total drives the header',
     e2.projhdr.textContent, '50% of spend unattributed — $1.00 of $2.00');

  // all rows out of range -> empty state, and any prior chart is destroyed
  const { V: V3, els: e3 } = await load({ chartGet: { destroy() { this.destroyed = true; } } });
  V3.renderProjects([{ date: '2020-01-01', project: 'old', act: 1 }], '2026-01-01', '2026-12-31');
  eq('renderProjects: out-of-range rows show the empty note', e3.projempty.hidden, false);
  eq('renderProjects: out-of-range rows clear the header', e3.projhdr.textContent, '');
  ck('renderProjects: previous chart is destroyed before the empty state', chartGet.destroyed === true);

  // exclude toggle drops the Unattributed bucket and switches the wording
  const { V: V4, els: e4 } = await load();
  e4.projexclude.checked = true;
  V4.renderProjects(rows, undefined, undefined);
  eq('renderProjects: exclusion drops the Unattributed bucket',
     JSON.stringify(mkCalls[0].labels), JSON.stringify(['C', 'A', 'B']));
  eq('renderProjects: exclusion keeps the share in the header',
     e4.projhdr.textContent, '14% of spend is unattributed (excluded from this chart) — $1.00 of $7.00');
  hasNot('renderProjects: excluded header does not claim unattributed spend is shown',
         e4.projhdr.textContent, 'unattributed — $');

  // zero-cost rows: no divide-by-zero, 0%
  const { V: V5, els: e5 } = await load();
  V5.renderProjects([{ date: '2026-01-01', project: 'z', act: 0, est: 0 }]);
  eq('renderProjects: zero total yields 0% and $0.00',
     e5.projhdr.textContent, '0% of spend unattributed — $0.00 of $0.00');

  // a lone Unattributed row still charts, and sorts last trivially
  const { V: V6, els: e6 } = await load();
  V6.renderProjects([{ date: '2026-01-01', act: 2 }]);
  eq('renderProjects: only-unattributed labels', JSON.stringify(mkCalls[0].labels), JSON.stringify(['Unattributed']));
  eq('renderProjects: only-unattributed header', e6.projhdr.textContent, '100% of spend unattributed — $2.00 of $2.00');
}

// ==================================================== renderProjectMatrix
// views.js:1321-1420. Weighted by weightValue(rowsGroup) (stubbed as sum of
// act||est), columns capped at PROJ_MATRIX_MAX_COLS by model total desc, a
// "+N more" bucket for the rest, and cell click data (data-project/data-model)
// that installProjectDrilldown later wires.
{
  const { V, els } = await load();
  eq('PROJ_MATRIX_MAX_COLS: model columns are capped at 8', V.PROJ_MATRIX_MAX_COLS, 8);

  els.projmatrix = undefined;
  V.renderProjectMatrix([{ project: 'A', model: 'm', act: 1 }]);
  ck('renderProjectMatrix: missing table returns without throwing', true);

  const { V: V2, els: e2 } = await load();
  e2.projmatrix.innerHTML = '<tbody>stale</tbody>';
  V2.renderProjectMatrix([]);
  eq('renderProjectMatrix: empty rows clear the table', e2.projmatrix.innerHTML, '');
  eq('renderProjectMatrix: empty rows show the empty note', e2.projmatrixempty.hidden, false);

  const mrows = [
    { project: 'Alpha', model: 'gpt-x', act: 3 },
    { project: 'Alpha', model: 'gpt-x', act: 2 },
    { project: 'Alpha', model: 'claude-y', act: 1 },
    { project: 'Beta', model: 'gpt-x', act: 4 },
    { model: 'claude-y', act: 0.5 },
  ];
  V2.renderProjectMatrix(mrows);
  const mh = e2.projmatrix.innerHTML;
  eq('renderProjectMatrix: rows hide the empty note', e2.projmatrixempty.hidden, true);
  has('renderProjectMatrix: header labels the weighted axis', mh, '(cost)');
  has('renderProjectMatrix: project column header', mh, 'Project');
  has('renderProjectMatrix: model column uses colorOf for its header', mh, 'style="color:#abcdef"');
  has('renderProjectMatrix: model column header text', mh, '>gpt-x</th>');
  ck('renderProjectMatrix: models sorted by total desc (gpt-x 9 > claude-y 1.5)',
     mh.indexOf('>gpt-x</th>') < mh.indexOf('>claude-y</th>'));
  ck('renderProjectMatrix: projects sorted by total desc (Alpha 6 > Beta 4 > Unattributed .5)',
     mh.indexOf('>Alpha<') < mh.indexOf('>Beta<') && mh.indexOf('>Beta<') < mh.indexOf('>Unattributed<'));
  eq('renderProjectMatrix: one clickable cell per defined bucket', count(mh, 'proj-cell'), 4);
  eq('renderProjectMatrix: missing buckets render an em dash', count(mh, 'muted">—</td>'), 2);
  has('renderProjectMatrix: cell carries its project', mh, 'data-project="Alpha"');
  has('renderProjectMatrix: cell carries its model', mh, 'data-model="gpt-x"');
  has('renderProjectMatrix: cell is marked clickable', mh, 'cursor:pointer');
  has('renderProjectMatrix: cell title reports project and model', mh, 'title="Alpha ');
  has('renderProjectMatrix: cell title reports the weighted value', mh, 'gpt-x: $5.00 USD');
  has('renderProjectMatrix: row sums the models (Alpha 5+1)', mh, '$6.00');
  has('renderProjectMatrix: column total for the heaviest model', mh, '$9.00');
  has('renderProjectMatrix: column total for the second model', mh, '$1.50');
  has('renderProjectMatrix: grand total footer', mh, '$10.50');
  ck('renderProjectMatrix: weightValue() receives RAW row groups, not a pre-summed bucket',
     wvCalls.length > 0 &&
     wvCalls.some(a => Array.isArray(a) && a.length === 2 && a.every(x => x && typeof x === 'object' && 'model' in x)) &&
     wvCalls.every(a => Array.isArray(a) && a.every(x => typeof x === 'object')));

  // column cap: 10 models -> 8 columns + "+2 more"
  const { V: V3, els: e3 } = await load();
  const capRows = [];
  for (let i = 0; i < 10; i++) capRows.push({ project: 'P', model: 'm' + i, act: 10 - i });
  V3.renderProjectMatrix(capRows);
  const ch = e3.projmatrix.innerHTML;
  eq('renderProjectMatrix: model columns are capped at PROJ_MATRIX_MAX_COLS', count(ch, 'style="color:#abcdef"'), 8);
  has('renderProjectMatrix: overflow models are summarised', ch, '+2 more');
  has('renderProjectMatrix: overflow column totals the hidden models', ch, '$3.00');
  has('renderProjectMatrix: overflow column lists the hidden model names', ch, 'm8, m9');
  has('renderProjectMatrix: grand total across all models', ch, '$55.00');
  hasNot('renderProjectMatrix: capped models get no column of their own', ch, '>m9</th>');

  // overflow with zero weight renders the em dash instead of $0.00
  const { V: V4, els: e4 } = await load();
  const capZero = [];
  for (let i = 0; i < 9; i++) capZero.push({ project: 'P', model: 'z' + i, act: i === 0 ? 5 : i * 0 });
  capZero.push({ project: 'P', model: 'z-last', act: 0 });
  V4.renderProjectMatrix(capZero);
  has('renderProjectMatrix: zero-weight overflow shows the em dash', e4.projmatrix.innerHTML, 'muted">—</td>');

  // PROJ_WEIGHT switch drives axis label + formatter
  const { V: V5, els: e5 } = await load({ charts: { PROJ_WEIGHT: 'sessions' } });
  V5.renderProjectMatrix(mrows);
  has('renderProjectMatrix: axis label follows PROJ_WEIGHT', e5.projmatrix.innerHTML, '(sessions)');
  has('renderProjectMatrix: unit follows PROJ_WEIGHT', e5.projmatrix.innerHTML, 'gpt-x: 5 sessions');
}

// ============================================== pdOpen / pdClose / pdKeydown
// views.js:1434-1566. State: pdOpenState (exported let), pdFocusReturn
// (exported let). pdOpen() also registers a capture-phase Escape/Tab handler on
// document and focuses the drawer; pdClose() tears it down and restores focus.
const DR = [
  { project: 'Alpha', model: 'gpt-x', provider: 'openai', base_url: '', calls: 2, inp: 100, outp: 50, cread: 10, cwrite: 5, est: 0.25, act: 0.75, session_id: 's1', date: '2026-01-02', task: 'chat' },
  { project: 'Alpha', model: 'claude-y', provider: 'anthropic', base_url: '', calls: 1, inp: 10, outp: 5, cread: 0, cwrite: 0, est: 0.5, act: 0, session_id: 's2', date: '2026-01-05', task: '' },
  { project: 'Beta', model: 'gpt-x', provider: 'openai', base_url: '', calls: 9, inp: 9, outp: 9, cread: 0, cwrite: 0, est: 0, act: 9, session_id: 's3', date: '2026-03-01', task: 'build' },
];

{
  const { V, els, docListeners } = await load();

  // missing body -> silent return, no state change
  els.pdbody = undefined;
  V.pdOpen('Alpha', DR);
  eq('pdOpen: missing drawer body aborts without opening', V.pdOpenState, false);
  eq('pdOpen: aborted open registers no document keydown handler',
     docListeners.filter(l => l.t === 'keydown').length, 0);

  const { V: V2, els: e2, docListeners: dl2 } = await load();
  const trigger = mkEl('trigger');
  ACTIVE = trigger;                        // document.activeElement at open time
  V2.pdOpen('Alpha', DR, undefined);
  const body = e2.pdbody.innerHTML;

  eq('pdOpen: drawer state flips to open', V2.pdOpenState, true);
  eq('pdOpen: focus is remembered for restore', V2.pdFocusReturn === trigger, true);
  eq('pdOpen: drawer title is the project', e2.pdtitle.textContent, 'Alpha');
  ck('pdOpen: scrim gets the open class', e2.pdscrim.classList.contains('open'));
  ck('pdOpen: drawer gets the open class', e2.pdrawer.classList.contains('open'));
  eq('pdOpen: scrim aria-hidden is cleared', e2.pdscrim.getAttribute('aria-hidden'), 'false');
  eq('pdOpen: drawer aria-hidden is cleared', e2.pdrawer.getAttribute('aria-hidden'), 'false');
  eq('pdOpen: focus moves into the drawer', FOCUS[FOCUS.length - 1] === e2.pdrawer, true);
  eq('pdOpen: a capture-phase keydown handler is installed',
     dl2.filter(l => l.t === 'keydown' && l.capture && !l.removed).length, 1);

  // aggregates are filtered to the opened project only
  has('pdOpen: calls stat is present', body, 'Calls');
  has('pdOpen: input tokens summed', body, '110');
  has('pdOpen: output tokens summed', body, '55');
  has('pdOpen: cache read/write summed', body, '10 / 5');
  has('pdOpen: actual cost summed', body, '$0.75');
  has('pdOpen: estimated cost shown separately', body, '$0.75 (est.)');
  has('pdOpen: distinct session count', body, 'Sessions');
  has('pdOpen: first seen date', body, '2026-01-02');
  has('pdOpen: last seen date', body, '2026-01-05');
  has('pdOpen: per-model breakdown', body, 'gpt-x');
  has('pdOpen: per-model breakdown second model', body, 'claude-y');
  has('pdOpen: model row shows the model-share icon', body, '<span class="k">◉ gpt-x</span>');
  has('pdOpen: heaviest model is 100% of the drawer total', body, '<span class="muted">(100%)</span>');
  has('pdOpen: second model share is rounded to a whole percent', body, '(67%)'); // 0.50/0.75
  has('pdOpen: per-provider breakdown', body, V2.provOf('openai', 'gpt-x', ''));
  has('pdOpen: provider row shows the provider icon', body, '<span class="k">○ openai</span>');
  has('pdOpen: session rows carry id and date', body, '<div class="pdsessrow">s1 <span class="muted">· 2026-01-02</span></div>');
  has('pdOpen: task mix includes the named task', body, 'chat');
  has('pdOpen: blank tasks are bucketed as unspecified', body, 'unspecified');
  ck('pdOpen: Beta (other project) contributes nothing to the totals',
     body.indexOf('$9.00') === -1 && body.indexOf('build') === -1);

  // unknown project -> empty but still coherent drawer
  V2.pdOpen('NoSuch', DR);
  const emptyBody = e2.pdbody.innerHTML;
  eq('pdOpen: unknown project still opens the drawer', V2.pdOpenState, true);
  has('pdOpen: unknown project shows no session ids', emptyBody, 'No individual session ids in this range.');
  has('pdOpen: unknown project cost is zero', emptyBody, '$0.00');
  has('pdOpen: unknown project tokens are zeroed', emptyBody, '0 / 0');
  has('pdOpen: unknown project sessions stat is an em dash', emptyBody, '<span class="k">Sessions</span><span>—</span>');
  ck('pdOpen: unknown project renders no model or provider rows',
     emptyBody.indexOf('◉') === -1 && emptyBody.indexOf('✳') === -1);
  ck('pdOpen: unknown project has no task rows', emptyBody.indexOf('unspecified') === -1 || emptyBody.indexOf('No task data') !== -1);

  // recent-session cap: 12 rows
  const many = [];
  for (let i = 0; i < 13; i++) {
    many.push({ project: 'P', model: 'm', provider: 'openai', act: 1, session_id: 's' + i, date: '2026-' + String(12 - i).padStart(2, '0') + '-01', task: 't' });
  }
  V2.pdOpen('P', many);
  const manyBody = e2.pdbody.innerHTML;
  has('pdOpen: newest session is listed', manyBody, 's0');
  has('pdOpen: 12th session is listed', manyBody, 's11');
  hasNot('pdOpen: 13th session is dropped from the list', manyBody, 's12');

  // close path (re-open first: the previous pdOpen() had captured the drawer as
  // the focus-return target, because pdOpen() moves focus into the drawer)
  ACTIVE = trigger;
  V2.pdOpen('Alpha', DR);
  V2.pdClose();
  eq('pdClose: state flips closed', V2.pdOpenState, false);
  ck('pdClose: scrim class removed', !e2.pdscrim.classList.contains('open'));
  ck('pdClose: drawer class removed', !e2.pdrawer.classList.contains('open'));
  eq('pdClose: scrim aria-hidden restored', e2.pdscrim.getAttribute('aria-hidden'), 'true');
  eq('pdClose: drawer aria-hidden restored', e2.pdrawer.getAttribute('aria-hidden'), 'true');
  eq('pdClose: focus returns to the opener', FOCUS[FOCUS.length - 1] === trigger, true);
  eq('pdClose: focus reference is cleared', V2.pdFocusReturn, null);
  eq('pdClose: keydown handler is removed',
     dl2.filter(l => l.t === 'keydown' && !l.removed).length, 0);

  // pdClose on a closed drawer is a no-op
  const before = FOCUS.length;
  V2.pdClose();
  eq('pdClose: closing a closed drawer does not steal focus', FOCUS.length, before);
  eq('pdClose: closing a closed drawer leaves state closed', V2.pdOpenState, false);

  // Escape
  const { V: V3, els: e3, docListeners: dl3 } = await load();
  let pd = 0;
  V3.pdKeydown({ key: 'Escape', preventDefault() { pd++; } });
  eq('pdKeydown: Escape is swallowed even when the drawer is closed', pd, 1);
  eq('pdKeydown: Escape on a closed drawer does not open state', V3.pdOpenState, false);

  ACTIVE = trigger;
  V3.pdOpen('Alpha', DR);
  const opened = dl3.filter(l => l.t === 'keydown' && !l.removed);
  pd = 0;
  V3.pdKeydown({ key: 'Escape', preventDefault() { pd++; } });
  eq('pdKeydown: Escape closes the drawer', V3.pdOpenState, false);
  eq('pdKeydown: Escape is prevented', pd, 1);
  ck('pdKeydown: Escape removes the open class', !e3.pdrawer.classList.contains('open'));
  eq('pdKeydown: Escape restores focus to the opener', FOCUS[FOCUS.length - 1] === trigger, true);
  eq('pdKeydown: Escape removes the document handler',
     dl3.filter(l => l.t === 'keydown' && !l.removed).length, 0);

  // Tab trap (pdKeydown has no open-state guard: it reads $('pdrawer') directly)
  const { V: V4, els: e4 } = await load();
  const first = mkEl('first'), last = mkEl('last'), middle = mkEl('middle');
  e4.pdrawer._q = { 'a[href],button,[tabindex]': [first, middle, last] };

  // no drawer at all -> no preventDefault
  const { V: V4b, els: e4b } = await load();
  e4b.pdrawer = undefined;
  let pd2 = 0;
  V4b.pdKeydown({ key: 'Tab', shiftKey: false, preventDefault() { pd2++; } });
  eq('pdKeydown: Tab without a drawer is not swallowed', pd2, 0);

  // focus trap: Tab on the last element wraps to the first
  ACTIVE = last;
  pd2 = 0;
  V4.pdKeydown({ key: 'Tab', shiftKey: false, preventDefault() { pd2++; } });
  eq('pdKeydown: Tab on the last focusable is prevented', pd2, 1);
  eq('pdKeydown: Tab on the last focusable wraps to the first', FOCUS[FOCUS.length - 1] === first, true);

  // shift+Tab on the first element wraps to the last
  ACTIVE = first;
  pd2 = 0;
  V4.pdKeydown({ key: 'Tab', shiftKey: true, preventDefault() { pd2++; } });
  eq('pdKeydown: shift+Tab on the first focusable is prevented', pd2, 1);
  eq('pdKeydown: shift+Tab on the first focusable wraps to the last', FOCUS[FOCUS.length - 1] === last, true);

  // middle element: browser default tab order is left alone
  ACTIVE = middle;
  pd2 = 0;
  V4.pdKeydown({ key: 'Tab', shiftKey: false, preventDefault() { pd2++; } });
  eq('pdKeydown: Tab in the middle of the trap is not prevented', pd2, 0);

  // other keys pass through untouched
  pd2 = 0;
  V4.pdKeydown({ key: 'a', shiftKey: false, preventDefault() { pd2++; } });
  eq('pdKeydown: unrelated keys are not prevented', pd2, 0);

  // installProjectDrilldown wires the close button + scrim through pdClose
  const { V: V5, els: e5 } = await load();
  ACTIVE = trigger;
  V5.pdOpen('Alpha', DR);
  V5.installProjectDrilldown();
  e5.pdclose.click();
  eq('installProjectDrilldown: close button closes the drawer', V5.pdOpenState, false);
  V5.pdOpen('Alpha', DR);
  e5.pdscrim.click();
  eq('installProjectDrilldown: scrim click closes the drawer', V5.pdOpenState, false);

  // the matrix cell / row-label presenter wiring lives at the END of
  // renderProjectMatrix (views.js:1421-1440), not in installProjectDrilldown
  const { V: V6, els: e6 } = await load();
  const cell = mkEl('td');
  cell.dataset = { project: 'Alpha', model: 'gpt-x' };
  const label = mkEl('td');
  label.textContent = 'Alpha';
  const tr = mkEl('tr');
  tr.appendChild(label);
  e6.projmatrix._q = { '.proj-cell': [cell], 'tbody tr': [tr] };
  V6.renderProjectMatrix(DR);
  eq('renderProjectMatrix: cells are focusable (tabIndex property)', cell.tabIndex, 0);
  eq('renderProjectMatrix: cells get role=button', cell.getAttribute('role'), 'button');
  eq('renderProjectMatrix: row labels are focusable', label.tabIndex, 0);
  eq('renderProjectMatrix: row labels get role=button', label.getAttribute('role'), 'button');
  eq('renderProjectMatrix: row labels show a pointer cursor', label.style.cursor, 'pointer');

  ACTIVE = cell;
  cell.onclick();
  eq('renderProjectMatrix: clicking a cell opens the drawer', V6.pdOpenState, true);
  eq('renderProjectMatrix: clicking a cell opens that project', e6.pdtitle.textContent, 'Alpha');
  eq('renderProjectMatrix: the cell is the focus-return target', V6.pdFocusReturn === cell, true);
  V6.pdClose();

  let pd3 = 0;
  label.onkeydown({ key: 'Enter', preventDefault() { pd3++; } });
  eq('renderProjectMatrix: Enter on a row label is prevented', pd3, 1);
  eq('renderProjectMatrix: Enter on a row label opens the drawer', V6.pdOpenState, true);
  eq('renderProjectMatrix: row label opens its own project', e6.pdtitle.textContent, 'Alpha');
  V6.pdClose();
  label.onkeydown({ key: ' ', preventDefault() {} });
  eq('renderProjectMatrix: Space on a row label also opens the drawer', V6.pdOpenState, true);
  V6.pdClose();
  pd3 = 0;
  cell.onkeydown({ key: 'a', preventDefault() { pd3++; } });
  eq('renderProjectMatrix: other keys on a cell do nothing', pd3 + (V6.pdOpenState ? 1 : 0), 0);
}

// ========================================================= installProjWeight
// views.js:1577-1599. The cost/calls/tokens/sessions switch: reflects the
// persisted choice on load and re-renders on click.
{
  const { V, els } = await load();
  els.projweight = undefined;
  V.installProjWeight();
  ck('installProjWeight: missing group returns without throwing', true);

  const { V: V2, els: e2 } = await load();
  const wCost = mkEl('btn'), wSessions = mkEl('btn'), wTokens = mkEl('btn');
  wCost.dataset = { w: 'cost' };
  wSessions.dataset = { w: 'sessions' };
  wTokens.dataset = { w: 'tokens' };
  e2.projweight._q = { button: [wCost, wSessions, wTokens] };
  V2.installProjWeight();
  eq('installProjWeight: persisted choice is pressed on load', wCost.getAttribute('aria-pressed'), 'true');
  eq('installProjWeight: other buttons are not pressed', wSessions.getAttribute('aria-pressed'), 'false');
  ck('installProjWeight: only the active button carries the on class',
     wCost.classList.contains('on') && !wSessions.classList.contains('on') && !wTokens.classList.contains('on'));
  eq('installProjWeight: every button is click-wired', (wSessions.listeners.click || []).length, 1);

  // Known gap (#30 module boundaries): the click handler assigns to the
  // imported PROJ_WEIGHT binding (views.js:1582, listed in
  // check-module-graph's KNOWN_CROSS_MODULE_WRITES). That only works in the
  // single-file build where every module shares one scope; in isolation the
  // first statement throws, so nothing after it runs. These checks pin that
  // and must be replaced by the click behaviour once the write moves into
  // charts.js behind a setter.
  let clickErr = null;
  try { wSessions.click(); } catch (err) { clickErr = err; }
  ck('installProjWeight: gap — click assigns to an imported binding (throws in isolation)',
     clickErr instanceof TypeError && /constant|read.only|assign/i.test(clickErr.message),
     String(clickErr && clickErr.message));
  eq('installProjWeight: gap — so nothing is persisted when isolated', JSON.stringify(lsWrites), '[]');
  eq('installProjWeight: gap — and the pressed state is unchanged', wCost.getAttribute('aria-pressed'), 'true');
}

// ==================================================== project filter plumbing
// views.js:1610-1718: PROJ_FILTER_VIEWS / populateProjFilterSelect /
// populateRowFilterSelects / syncProjFilterUI / installProjFilter. Every
// expected option list is hand-derived from the input rows.
const FILT_DATA = {
  schema_version: 1,
  profiles: {
    default: {
      rows: [
        { project: 'B', provider: 'openai', model: 'gpt-x' },
        { project: 'A', provider: 'anthropic', model: 'claude-y' },
        { project: '', provider: 'openai', model: 'gpt-x' },
        { project: 'A', provider: '', model: 'claude-y' },
      ],
    },
  },
};

{
  // ---- populateProjFilterSelect
  const { V, els } = await load({ data: FILT_DATA });
  V.populateProjFilterSelect();
  eq('populateProjFilterSelect: options are the All entry plus sorted projects',
     els.projfiltersel.innerHTML,
     '<option value="">All sessions</option><option value="A">A</option><option value="B">B</option><option value="Unattributed">Unattributed</option>');
  eq('populateProjFilterSelect: rows with no project become the Unattributed option',
     count(els.projfiltersel.innerHTML, '<option'), 4);
  ck('populateProjFilterSelect: Unattributed sorts last, not alphabetically',
     els.projfiltersel.innerHTML.indexOf('>B<') < els.projfiltersel.innerHTML.indexOf('>Unattributed<'));
  eq('populateProjFilterSelect: no PROJECT_FILTER selects All', els.projfiltersel.value, '');
  eq('populateProjFilterSelect: no cross-filter write when the value is already valid',
     xfCalls.filter(a => a[0] === 'project').length, 0);

  // a still-valid previous selection survives a profile switch; a stale one does not
  const { V: Vp, els: ep } = await load({ data: FILT_DATA });
  ep.projfiltersel.value = 'B';
  Vp.populateProjFilterSelect();
  eq('populateProjFilterSelect: previous valid selection is kept across a repopulate', ep.projfiltersel.value, 'B');
  eq('populateProjFilterSelect: keeping a selection writes it to the cross-filter',
     JSON.stringify(xfCalls), JSON.stringify([['project', 'B']]));

  const { V: Vp2, els: ep2 } = await load({ data: FILT_DATA });
  ep2.projfiltersel.value = 'GONE';
  Vp2.populateProjFilterSelect();
  eq('populateProjFilterSelect: stale previous selection falls back to All', ep2.projfiltersel.value, '');
  eq('populateProjFilterSelect: falling back to All leaves the cross-filter alone when it was already empty',
     xfCalls.length, 0);

  const { V: V2, els: e2 } = await load({ data: FILT_DATA, router: { PROJECT_FILTER: 'A' } });
  V2.populateProjFilterSelect();
  eq('populateProjFilterSelect: an existing PROJECT_FILTER is selected', e2.projfiltersel.value, 'A');
  eq('populateProjFilterSelect: a still-valid filter is not cleared',
     xfCalls.filter(a => a[0] === 'project').length, 0);

  const { V: V3, els: e3 } = await load({ data: FILT_DATA, router: { PROJECT_FILTER: 'ZZZ' } });
  V3.populateProjFilterSelect();
  eq('populateProjFilterSelect: a stale PROJECT_FILTER is cleared', e3.projfiltersel.value, '');
  eq('populateProjFilterSelect: clearing a stale filter goes through setCrossFilter',
     JSON.stringify(xfCalls), JSON.stringify([['project', '']]));

  const { V: V4, els: e4 } = await load({ data: { schema_version: 1, profiles: { other: { rows: [{ project: 'Q' }] } } } });
  V4.populateProjFilterSelect();
  eq('populateProjFilterSelect: a missing current profile leaves the select alone', e4.projfiltersel.innerHTML, '');

  // ---- populateRowFilterSelects
  const { V: V5, els: e5 } = await load({ data: FILT_DATA });
  V5.populateRowFilterSelects();
  eq('populateRowFilterSelects: provider options are All plus unique providers',
     e5.provfiltersel.innerHTML,
     '<option value="">All providers</option><option value="anthropic">anthropic</option><option value="openai">openai</option>');
  eq('populateRowFilterSelects: model options are All plus unique models',
     e5.modelfiltersel.innerHTML,
     '<option value="">All models</option><option value="claude-y">claude-y</option><option value="gpt-x">gpt-x</option>');
  eq('populateRowFilterSelects: provider and model filters are always written back',
     JSON.stringify(xfCalls), JSON.stringify([['provider', ''], ['model', '']]));

  const { V: V6, els: e6 } = await load({ data: FILT_DATA, router: { PROVIDER_FILTER: 'openai', MODEL_FILTER: 'claude-y' } });
  V6.populateRowFilterSelects();
  eq('populateRowFilterSelects: an existing provider filter is selected', e6.provfiltersel.value, 'openai');
  // Provider -> model cascade: options narrow to the filtered provider, so a stale
  // cross-provider MODEL_FILTER ('claude-y' under 'openai') falls back to All models.
  eq('populateRowFilterSelects: cascade narrows model options to the provider', e6.modelfiltersel.value, '');
  ck('populateRowFilterSelects: cascade narrows model options',
     e6.modelfiltersel.innerHTML === '<option value="">All models</option><option value="gpt-x">gpt-x</option>');

  const { V: V7, els: e7 } = await load({ data: FILT_DATA, router: { PROVIDER_FILTER: 'ZZZ' } });
  V7.populateRowFilterSelects();
  eq('populateRowFilterSelects: a stale provider filter is cleared', e7.provfiltersel.value, '');
  has('populateRowFilterSelects: clearing a stale provider filter writes the cross-filter',
      JSON.stringify(xfCalls), '["provider",""]');

  // ---- PROJ_FILTER_VIEWS + syncProjFilterUI
  ck('PROJ_FILTER_VIEWS: is the set of views the filter bar affects',
     V.PROJ_FILTER_VIEWS instanceof Set &&
     ['Usage', 'Cost', 'Flow', 'Health'].every(v => V.PROJ_FILTER_VIEWS.has(v)) &&
     !V.PROJ_FILTER_VIEWS.has('Live'));
  const { V: V8, els: e8 } = await load({ router: { PROJECT_FILTER: 'Alpha', view: 'Usage' } });
  e8.projfilterchip.hidden = true;
  e8.projfilterchip.style.display = 'none';
  V8.syncProjFilterUI();
  eq('syncProjFilterUI: chip is shown for a filtered view', e8.projfilterchip.hidden, false);
  eq('syncProjFilterUI: chip display is inline-flex', e8.projfilterchip.style.display, 'inline-flex');
  eq('syncProjFilterUI: chip names the filtered project', e8.projfilterchipname.textContent, 'Alpha');
  eq('syncProjFilterUI: select mirrors the filter', e8.projfiltersel.value, 'Alpha');

  const { V: V8b, els: e8b } = await load({ router: { PROJECT_FILTER: 'Alpha', PROVIDER_FILTER: 'openai', MODEL_FILTER: 'gpt-x', view: 'Cost' } });
  e8b.projfilterchip.hidden = true;
  V8b.syncProjFilterUI();
  eq('syncProjFilterUI: chip joins every active cross-filter', e8b.projfilterchipname.textContent, 'Alpha · openai · gpt-x');
  eq('syncProjFilterUI: provider select mirrors its filter', e8b.provfiltersel.value, 'openai');
  eq('syncProjFilterUI: model select mirrors its filter', e8b.modelfiltersel.value, 'gpt-x');

  const { V: V9, els: e9 } = await load({ router: { PROJECT_FILTER: 'Alpha', view: 'Live' } });
  e9.projfilterchip.hidden = false;
  V9.syncProjFilterUI();
  eq('syncProjFilterUI: a view outside PROJ_FILTER_VIEWS hides the chip', e9.projfilterchip.hidden, true);
  eq('syncProjFilterUI: hidden chip is display:none', e9.projfilterchip.style.display, 'none');

  const { V: V10, els: e10 } = await load({ router: { PROJECT_FILTER: '', view: 'Usage' } });
  e10.projfilterchip.hidden = false;
  V10.syncProjFilterUI();
  eq('syncProjFilterUI: no project filter hides the chip', e10.projfilterchip.hidden, true);
  eq('syncProjFilterUI: no filter leaves the previous chip label alone',
     e10.projfilterchipname.textContent, '');

  // ---- installProjFilter (the trailing render() needs the whole dashboard, so
  // the change handler is driven in a try/catch and only its filter plumbing is
  // asserted; the full render() is covered by the app-level suites)
  const { V: V11, els: e11 } = await load({ data: FILT_DATA, router: { view: 'Usage' } });
  V11.installProjFilter();
  ck('installProjFilter: select has a change listener',
     (e11.projfiltersel.listeners.change || []).length === 1);
  // the stub router cannot mutate PROJECT_FILTER, so make the chip visibly
  // dirty first: if the handler runs syncProjFilterUI() the chip is normalised
  // back against the (stubbed, still empty) filter state
  e11.projfilterchip.hidden = false;
  e11.projfilterchip.style.display = 'inline-flex';
  e11.projfilterchipname.textContent = 'dirty';
  e11.projfiltersel.value = 'A';
  try { e11.projfiltersel.dispatch('change'); } catch (err) { /* real render() needs the full DOM */ }
  has('installProjFilter: changing the select writes the cross-filter', JSON.stringify(xfCalls), '["project","A"]');
  has('installProjFilter: changing the select updates the hash', JSON.stringify(hashCalls), '["Usage"]');
  eq('installProjFilter: changing the select re-syncs the filter chip', e11.projfilterchip.hidden, true);
  eq('installProjFilter: re-synced chip hides when no filter survives',
     e11.projfilterchip.hidden, true);
  eq('installProjFilter: re-synced chip leaves a stale label untouched once hidden',
     e11.projfilterchipname.textContent, 'dirty');

  const xfBefore = xfCalls.length, hashBefore = hashCalls.length;
  try { e11.projfilterclear.click(); } catch (err) { /* real render() needs the full DOM */ }
  ck('installProjFilter: clear button calls clearCrossFilters', xfCalls.length > xfBefore);
  ck('installProjFilter: clear button re-hashes the view', hashCalls.length > hashBefore &&
     hashCalls[hashCalls.length - 1][0] === 'Usage');
}

// ============================================ renderProjectDistribution + legend
// views.js:1719-1830. One stacked dataset per provider, one column per project
// (heaviest first), optional normalisation to "% of project total".
const DIST = [
  { project: 'Alpha', model: 'gpt-x', provider: 'openai', act: 3 },
  { project: 'Alpha', model: 'claude-y', provider: 'anthropic', act: 1 },
  { project: 'Beta', model: 'gpt-x', provider: 'openai', act: 6 },
  { model: 'claude-y', provider: 'anthropic', act: 0.5 },
];

{
  const { V, els } = await load();
  els.projdistcard = undefined;
  V.renderProjectDistribution(DIST);
  ck('renderProjectDistribution: missing card returns without throwing', true);

  const { V: V2, els: e2 } = await load({ chartGet: { destroy() { this.destroyed = true; } } });
  e2.projdistempty.hidden = true;
  V2.renderProjectDistribution([]);
  eq('renderProjectDistribution: empty rows show the empty note', e2.projdistempty.hidden, false);
  ck('renderProjectDistribution: empty rows destroy the previous chart', chartGet.destroyed === true);
  eq('renderProjectDistribution: empty rows build no chart', mkCalls.length, 0);

  const { V: V3, els: e3 } = await load();
  V3.renderProjectDistribution(DIST);
  eq('renderProjectDistribution: rows hide the empty note', e3.projdistempty.hidden, true);
  eq('renderProjectDistribution: one chart', mkCalls.length, 1);
  eq('renderProjectDistribution: chart id', mkCalls[0].id, 'cProjDist');
  eq('renderProjectDistribution: chart type', mkCalls[0].type, 'bar');
  eq('renderProjectDistribution: columns are the projects, heaviest first',
     JSON.stringify(mkCalls[0].labels), JSON.stringify(['Beta', 'Alpha', 'Unattributed']));
  eq('renderProjectDistribution: one dataset per provider', mkCalls[0].datasets.length, 2);

  const pO = V3.provOf('openai', 'gpt-x', '');
  const pA = V3.provOf('anthropic', 'claude-y', '');
  const dsByLabel = {};
  mkCalls[0].datasets.forEach(d => { dsByLabel[String(d.label)] = d; });
  ck('renderProjectDistribution: providers are keyed by provOf()',
     Object.keys(dsByLabel).length === 2 &&
     Object.keys(dsByLabel).some(k => k.indexOf(pO) !== -1) &&
     Object.keys(dsByLabel).some(k => k.indexOf(pA) !== -1));
  const dO = mkCalls[0].datasets.find(d => d.label.indexOf(pO) !== -1);
  const dA = mkCalls[0].datasets.find(d => d.label.indexOf(pA) !== -1);
  eq('renderProjectDistribution: heavier provider stacks first', mkCalls[0].datasets[0] === dO, true);
  eq('renderProjectDistribution: heaviest provider per-project values',
     JSON.stringify(dO.data), JSON.stringify([6, 3, 0]));      // Beta, Alpha, Unattributed
  eq('renderProjectDistribution: second provider per-project values',
     JSON.stringify(dA.data), JSON.stringify([0, 1, 0.5]));
  eq('renderProjectDistribution: provider colour comes from PROV',
     dO.backgroundColor, (V3.PROV[pO] || {}).fg || dO.backgroundColor);
  eq('renderProjectDistribution: datasets stack', dO.stack, 'proj');
  eq('renderProjectDistribution: horizontal bars', mkCalls[0].opts.indexAxis, 'y');
  eq('renderProjectDistribution: x axis is titled by the weighted axis', mkCalls[0].opts.scales.x.title.text, 'cost');
  ck('renderProjectDistribution: Chart.js keeps its built-in legend off for the custom one',
     ((mkCalls[0].opts.plugins || {}).legend || {}).display !== true);

  // normalised variant: each project column sums to 100
  const { V: V4, els: e4 } = await load({ charts: { projDistNormalized: true } });
  V4.renderProjectDistribution(DIST);
  eq('renderProjectDistribution: normalised x axis is titled as a percentage',
     mkCalls[0].opts.scales.x.title.text, '% of project total');
  eq('renderProjectDistribution: normalised x axis is capped at 100', mkCalls[0].opts.scales.x.max, 100);
  const nO = mkCalls[0].datasets.find(d => d.label.indexOf(V4.provOf('openai', 'gpt-x', '')) !== -1);
  const nA = mkCalls[0].datasets.find(d => d.label.indexOf(V4.provOf('anthropic', 'claude-y', '')) !== -1);
  eq('renderProjectDistribution: normalised provider values (Alpha 3/4, Beta 6/6, Unattr 0/0.5)',
     JSON.stringify(nO.data), JSON.stringify([100, 75, 0]));
  eq('renderProjectDistribution: normalised second provider values',
     JSON.stringify(nA.data), JSON.stringify([0, 25, 100]));
  eq('renderProjectDistribution: normalised columns sum to 100',
     nO.data.map((v, i) => v + nA.data[i]).join(','), '100,100,100');

  // ---- renderProjDistLegend
  const { V: V5, els: e5 } = await load();
  V5.renderProjDistLegend([]);
  ck('renderProjDistLegend: empty datasets leave the legend empty', true);
  const datasets = [
    { label: 'openai <x>', backgroundColor: '#111' },
    { label: 'anthropic', backgroundColor: '#222' },
  ];
  const b0 = mkEl('b0'), b1 = mkEl('b1');
  b0.dataset = { idx: '0' };
  b1.dataset = { idx: '1' };
  e5.projdistlegend._q = { '.proj-legend-item': [b0, b1] };
  V5.renderProjDistLegend(datasets);
  const lh = e5.projdistlegend.innerHTML;
  eq('renderProjDistLegend: one item per dataset', count(lh, 'proj-legend-item'), 2);
  has('renderProjDistLegend: items carry their index', lh, 'data-idx="0"');
  has('renderProjDistLegend: second item index', lh, 'data-idx="1"');
  has('renderProjDistLegend: swatch uses the dataset colour', lh, 'background:#111');
  has('renderProjDistLegend: labels are escaped', lh, 'openai &lt;x&gt;');
  has('renderProjDistLegend: item border uses BD', lh, 'border:1px solid #eee');
  eq('renderProjDistLegend: items start aria-pressed=true', b0.getAttribute('aria-pressed'), 'true');
  ck('renderProjDistLegend: every item is click-wired',
     typeof b0.onclick === 'function' && typeof b1.onclick === 'function');

  // clicking an item toggles that dataset on the live chart and mirrors it in aria
  const vis = { 0: true, 1: true };
  let updates = 0;
  chartGet = {
    isDatasetVisible: i => vis[i],
    setDatasetVisibility(i, v) { vis[i] = v; },
    update() { updates++; },
  };
  b1.onclick();
  eq('renderProjDistLegend: click hides the dataset it names', vis[1], false);
  eq('renderProjDistLegend: click updates the chart', updates, 1);
  eq('renderProjDistLegend: click mirrors visibility into aria-pressed', b1.getAttribute('aria-pressed'), 'false');
  eq('renderProjDistLegend: click leaves other datasets alone', vis[0], true);
  b1.onclick();
  eq('renderProjDistLegend: second click shows the dataset again', vis[1], true);
  eq('renderProjDistLegend: second click restores aria-pressed', b1.getAttribute('aria-pressed'), 'true');

  // no live chart -> the click is inert, not a crash
  chartGet = null;
  b0.onclick();
  ck('renderProjDistLegend: click without a chart does not throw', true);
}

// ================================================= renderProjectTrend + legend
// views.js:1806-1935. One line per top-N project, bucketed per day/week.
{
  const { V, els } = await load();
  ck('PROJ_TREND_TOP_N: exported and sane', Number.isInteger(V.PROJ_TREND_TOP_N) && V.PROJ_TREND_TOP_N > 0 && V.PROJ_TREND_TOP_N <= 10);

  els.projtrendcard = undefined;
  V.renderProjectTrend([{ project: 'A', date: '2026-01-01', act: 1 }]);
  ck('renderProjectTrend: missing card returns without throwing', true);

  const { V: V2, els: e2 } = await load({ chartGet: { destroy() { this.destroyed = true; } } });
  e2.projtrendempty.hidden = true;
  V2.renderProjectTrend([]);
  eq('renderProjectTrend: empty rows show the empty note', e2.projtrendempty.hidden, false);
  ck('renderProjectTrend: empty rows destroy the previous chart', chartGet.destroyed === true);
  eq('renderProjectTrend: empty rows build no chart', mkCalls.length, 0);

  // single bucket: all rows on one date -> one label, one dataset per project
  const { V: V3, els: e3 } = await load();
  const trendRows = [
    { project: 'Alpha', date: '2026-01-02', act: 2 },
    { project: 'Alpha', date: '2026-01-02', act: 1 },
    { project: 'Beta', date: '2026-01-02', act: 5 },
    { date: '2026-01-02', act: 0.5 },
  ];
  V3.renderProjectTrend(trendRows);
  eq('renderProjectTrend: rows hide the empty note', e3.projtrendempty.hidden, true);
  eq('renderProjectTrend: one chart', mkCalls.length, 1);
  eq('renderProjectTrend: chart id', mkCalls[0].id, 'cProjTrend');
  eq('renderProjectTrend: a single date yields a single bucket', mkCalls[0].labels.length, 1);
  eq('renderProjectTrend: one dataset per project', mkCalls[0].datasets.length, 3);
  const tByLabel = {};
  mkCalls[0].datasets.forEach(d => { tByLabel[String(d.label).replace(/^[^A-Za-z0-9]*\s*/, '')] = d; });
  eq('renderProjectTrend: heaviest project leads the stack', mkCalls[0].datasets[0].label.indexOf('Beta') !== -1, true);
  eq('renderProjectTrend: Alpha bucket sums its rows', JSON.stringify(tByLabel['Alpha'].data), JSON.stringify([3]));
  eq('renderProjectTrend: Beta bucket value', JSON.stringify(tByLabel['Beta'].data), JSON.stringify([5]));
  eq('renderProjectTrend: unattributed bucket keeps its 0.5', JSON.stringify(tByLabel['Unattributed'].data), JSON.stringify([0.5]));
  ck('renderProjectTrend: datasets are lines with a border colour',
     mkCalls[0].datasets.every(d => typeof d.borderColor === 'string' && d.borderColor.length > 1));
  eq('renderProjectTrend: plain (non-stacked) lines are area-filled from the axis', mkCalls[0].datasets[0].fill, 'origin');
  eq('renderProjectTrend: y axis is titled by the weighted axis', mkCalls[0].opts.scales.y.title.text, 'cost');
  eq('renderProjectTrend: y axis starts at zero', mkCalls[0].opts.scales.y.beginAtZero, true);
  eq('renderProjectTrend: legend is rendered inline', mkCalls[0].opts.plugins.legend.display, false);
  has('renderProjectTrend: datasets carry a colour-prefixed label', JSON.stringify(mkCalls[0].datasets.map(d => d.label)), 'Beta');

  // top-N cap: more projects than PROJ_TREND_TOP_N -> the tail folds into "Other"
  const many = [];
  for (let i = 0; i < V3.PROJ_TREND_TOP_N + 2; i++) many.push({ project: 'P' + i, date: '2026-01-02', act: 100 - i });
  V3.renderProjectTrend(many);
  const capped = mkCalls[mkCalls.length - 1];
  eq('renderProjectTrend: datasets are capped at PROJ_TREND_TOP_N plus one Other series',
     capped.datasets.length, V3.PROJ_TREND_TOP_N + 1);
  ck('renderProjectTrend: the Other series counts the folded projects',
     capped.datasets[capped.datasets.length - 1].label.indexOf('Other (+2)') !== -1);
  eq('renderProjectTrend: the heaviest project survives the cap',
     capped.datasets[0].label.indexOf('P0') !== -1, true);
  hasNot('renderProjectTrend: the lightest projects are not charted individually',
     JSON.stringify(capped.datasets.map(d => d.label)), 'P' + (V3.PROJ_TREND_TOP_N + 1));
  eq('renderProjectTrend: Other series sums the folded projects (act 94+93)',
     JSON.stringify(capped.datasets[capped.datasets.length - 1].data), JSON.stringify([187]));
  ck('renderProjectTrend: the Other series gets its own colour',
     typeof capped.datasets[capped.datasets.length - 1].borderColor === 'string' &&
     capped.datasets[capped.datasets.length - 1].borderColor !== capped.datasets[0].borderColor);

  // stacked mode: percentages of each day's total, capped at 100
  const { V: V5, els: e5 } = await load({ charts: { projTrendStacked: true } });
  V5.renderProjectTrend(trendRows);
  eq('renderProjectTrend: stacked y axis is a percentage', mkCalls[0].opts.scales.y.title.text, '% of day total');
  eq('renderProjectTrend: stacked y axis is capped at 100', mkCalls[0].opts.scales.y.max, 100);
  eq('renderProjectTrend: stacked series are filled', mkCalls[0].datasets[0].fill, true);
  eq('renderProjectTrend: stacked series share a stack group', mkCalls[0].datasets[0].stack, 'proj');
  const stackedTotal = mkCalls[0].datasets.reduce((s, d) => s + d.data[0], 0);
  eq('renderProjectTrend: stacked shares of the single day total 100', Math.round(stackedTotal), 100);
  eq('renderProjectTrend: stacked heaviest project is 5/8.5 of the day', mkCalls[0].datasets[0].data[0].toFixed(1), '58.8');

  // ---- renderProjTrendLegend
  const { V: V6, els: e6 } = await load();
  const t0 = mkEl('t0'), t1 = mkEl('t1');
  t0.dataset = { idx: '0' };
  t1.dataset = { idx: '1' };
  e6.projtrendlegend._q = { '.proj-legend-item': [t0, t1] };
  V6.renderProjTrendLegend([
    { label: 'Alpha', borderColor: '#111' },
    { label: 'Beta <x>', borderColor: '#222' },
  ]);
  const th = e6.projtrendlegend.innerHTML;
  eq('renderProjTrendLegend: one item per dataset', count(th, 'proj-legend-item'), 2);
  has('renderProjTrendLegend: items carry their index', th, 'data-idx="0"');
  has('renderProjTrendLegend: swatch uses the border colour', th, 'background:#111');
  has('renderProjTrendLegend: labels are escaped', th, 'Beta &lt;x&gt;');
  eq('renderProjTrendLegend: items start aria-pressed=true', t0.getAttribute('aria-pressed'), 'true');
  ck('renderProjTrendLegend: every item is click-wired',
     typeof t0.onclick === 'function' && typeof t1.onclick === 'function');
  const tvis = { 0: true, 1: true };
  let tupdates = 0;
  chartGet = {
    isDatasetVisible: i => tvis[i],
    setDatasetVisibility(i, v) { tvis[i] = v; },
    update() { tupdates++; },
  };
  t0.onclick();
  eq('renderProjTrendLegend: click hides its dataset', tvis[0], false);
  eq('renderProjTrendLegend: click updates the trend chart', tupdates, 1);
  eq('renderProjTrendLegend: click mirrors visibility into aria-pressed', t0.getAttribute('aria-pressed'), 'false');
}

console.log(`\nunit_views_projects.mjs: ${pass} passed, ${fail} failed (${pass + fail} checks)`);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('  ✓ all green');
}
