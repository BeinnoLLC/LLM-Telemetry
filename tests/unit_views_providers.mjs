// #30: views.js as a unit — the providers / models / panels slice (from the top
// of the file through renderLatency). No built dashboard, no browser: the
// module is loaded through tests/lib/isolate.mjs with its siblings stubbed, and
// the real palette.js formatters are loaded the same way so escaping/formatting
// behaves exactly as on the page.
//
// Every expected value below is derived BY HAND from the rules in
// src/llm_telemetry/web/js/views.js (the provider resolution order in provOf,
// the re-send ratio in resendOf, the median/2x rule in renderBandwidthPanel, the
// unpriced/priced state table, the re-send table's filter and 15-row cap, the
// KPI arithmetic in renderHome, the FLIP sequence in flipMove). Nothing is
// captured from program output: if a case fails, re-read the module.
//
// Time-dependent expectations use Date.now() + an offset so they cannot rot.
//
// NOT covered, deliberately:
//   * render() — the page orchestrator. Under this harness views.js runs as a
//     RAW ES MODULE, so views.js:427 (`charts.forEach(...); charts=[]`) assigns
//     an imported binding and throws "TypeError: Assignment to constant
//     variable" as soon as render() is entered. The shipped page never hits
//     this: webassets.py inlines the modules into one classic script (see
//     web/js/package.json), where `charts` is an ordinary `let`. Repro is three
//     lines (a module importing `charts` from another module and assigning it);
//     `charts.length = 0` would make the module safe standalone. Everything
//     render() delegates to is covered here directly.
//   * the sub-renderers below renderLatency (renderHealth, renderDeleg,
//     renderHeatmap, renderSessionsTree, renderProjects, ...) — outside this
//     slice; the sibling suites own them.
//   * MODEL_PROV's cross-file cache (see renderResolution) and the model
//     colours on Charts — exercised only through their public effect here.
import { isolate } from './lib/isolate.mjs';

let pass = 0, fail = 0;
const ok = (c, name) => { if (c) { pass++; return; } fail++; console.log(`  FAIL ${name}`); };
const eq = (got, want, name) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(g === w, w === g ? name : `${name} — got ${g}, want ${w}`);
};
const has = (s, sub, name) => {
  const t = String(s);
  ok(t.includes(sub), `${name} — missing ${JSON.stringify(sub)} in ${JSON.stringify(t.slice(0, 220))}`);
};
const lacks = (s, sub, name) => {
  const t = String(s);
  ok(!t.includes(sub), `${name} — unexpected ${JSON.stringify(sub)} in ${JSON.stringify(t.slice(0, 220))}`);
};
const count = (s, sub) => String(s).split(sub).length - 1;

// ── fake DOM ────────────────────────────────────────────────────────────────
// `$` is bound once per isolate, so it reads a mutable map; each case resets it
// with only the ids it wants present (an absent id exercises the early return).
function mkEl(id){
  const e = {
    id, innerHTML: '', textContent: '', hidden: false, attrs: {}, style: {}, dataset: {},
    children: [], offsetHeight: 0,
    setAttribute(k, v){ this.attrs[k] = String(v); },
    querySelector(){ return (this.q ||= mkEl('q')); },
    querySelectorAll(){ return (this._qall ||= []); },
    addEventListener(){},
    contains(){ return false; },
    appendChild(c){ this.children.push(c); c.parent = this; return c; },
    getBoundingClientRect(){ return { left: 0, top: 0, width: 0, height: 0 }; },
    classList: {
      _s: new Set(),
      add(...c){ for (const x of c) this._s.add(x); },
      remove(...c){ for (const x of c) this._s.delete(x); },
      contains(c){ return this._s.has(c); },
    },
  };
  return e;
}
let DOM = new Map();
const $ = id => DOM.get(id) || null;
const dom = (...ids) => { DOM = new Map(ids.map(i => [i, mkEl(i)])); return Object.fromEntries(DOM); };

// `document` is read at call time by flash(), showSchemaError(), renderUnpriced()
// and renderResolution(), so a fake lives on globalThis for the whole run.
const created = [], clickHandlers = [];
const fakeDocument = {
  createElement(tag){ const e = mkEl(''); e.tag = tag; return e; },
  getElementById(id){ return DOM.get(id) || null; },
  addEventListener(type, fn){ if (type === 'click') clickHandlers.push(fn); },
  body: { appendChild(el){ created.push(el); if (el.id) DOM.set(el.id, el); } },
  // views.js installs its kind-palette stylesheet at load time.
  head: { appendChild(){} },
};
globalThis.document = fakeDocument;

// ── modules under test ──────────────────────────────────────────────────────
// The real formatters (esc, escA, fmt, fmtB, short, money, costCell) come from
// palette.js with its own siblings stubbed.
const P = await isolate('palette.js', {
  'charts.js': { bounds: () => [0, 1], current: null },
  'views.js': { PROV: {}, provIcon: () => '', render: () => {} },
  'router.js': { presets: () => {} },
  'main.js': { DATA: {}, css: () => {} },
});

let mkCalls = [];
let liveCalls = 0, picks = [], routerCalls = 0, quotaCalls = 0;
// The load-time guards throw on a stale/empty payload, so the stub carries a
// matching schema_version and one profile.
const DATA = { schema_version: 1, profiles: { p1: {} } };
const load = () => isolate('views.js', {
  'palette.js': {
    $, AC: '#AC', BD: '#BD', MU: '#MU', PAL: P.PAL,
    ago: P.ago, esc: P.esc, escA: P.escA, fmt: P.fmt, fmtB: P.fmtB, short: P.short,
    money: P.money, costCell: P.costCell, emptyHTML: P.emptyHTML, icon: P.icon, fade: P.fade,
    ic: sm => 'ic:' + sm,
    colorOf: m => 'col:' + m,
    // A recorder, not the real relative-time formatter: the assertion is about
    // the DELTA views.js computes, which is date-dependent by nature.
    ago: s => 'ago:' + Math.round(s),
  },
  'charts.js': {
    current: 'p1',
    mk: (...a) => { mkCalls.push(a); },
    agg: () => ({}), noLeg: () => ({}), sparkSvg: () => '', radialRing: () => '',
    charts: [], ctxSpark: () => '', olBar: () => '',
  },
  'router.js': {
    HOUR_RANGE: 24, MODEL_FILTER: '', POWER: { tariff: { electricity_rate_kwh: 0.12 } },
    PROJECT_FILTER: '', PROVIDER_FILTER: '',
    clearCrossFilters(){}, hourRowsFor: () => [], pickView(v){ picks.push(v); },
    setCrossFilter(){}, setHash(){}, view: 'home',
  },
  'flow.js': { flowControls: {}, renderFlow(){} },
  'live.js': { renderLive(){ liveCalls++; } },
  'routerview.js': { renderRouterView(){ routerCalls++; }, routerStat(){ return 'RS'; } },
  'quotaview.js': { renderQuotaView(){ quotaCalls++; }, qvStat(){ return 'QS'; } },
  'main.js': { DATA, LOCAL_HOSTS: ['localhost', '192.168.'], SCHEMA_VERSION: 1, css: () => '' },
}, { document: fakeDocument });

const D = await load();

// ═══ schemaProblem ═══════════════════════════════════════════════════════════
{
  const n = 'analytics-data.json';
  eq(D.schemaProblem(null, n), `${n}: not a JSON object`, 'schemaProblem: null -> not an object');
  eq(D.schemaProblem(undefined, n), `${n}: not a JSON object`, 'schemaProblem: undefined -> not an object');
  eq(D.schemaProblem('nope', n), `${n}: not a JSON object`, 'schemaProblem: a string is not an object');
  eq(D.schemaProblem({}, n), `${n} is a stale payload (no schema_version) — re-run \`llm-telemetry dashboard\``,
    'schemaProblem: missing schema_version -> stale payload');
  eq(D.schemaProblem([], n), `${n} is a stale payload (no schema_version) — re-run \`llm-telemetry dashboard\``,
    'schemaProblem: an array is an object without the field -> stale');
  has(D.schemaProblem({ schema_version: 2 }, n), `${n} has schema_version 2, this page expects 1`,
    'schemaProblem: wrong number reported with both versions');
  has(D.schemaProblem({ schema_version: 2 }, n), '— re-run `llm-telemetry dashboard`',
    'schemaProblem: mismatch names the fix');
  has(D.schemaProblem({ schema_version: '1' }, n), 'schema_version "1"',
    'schemaProblem: JSON.stringify keeps a string version quoted');
  eq(D.schemaProblem({ schema_version: 1 }, n), '', 'schemaProblem: matching version -> empty string');
  eq(D.schemaProblem({ schema_version: 1, extra: true }, n), '', 'schemaProblem: extra keys are fine');
}

// ═══ showSchemaError ═════════════════════════════════════════════════════════
{
  dom();
  created.length = 0;
  D.showSchemaError('boom <x>');
  eq(created.length, 1, 'showSchemaError: creates one node when #schemaerr is absent');
  const el = DOM.get('schemaerr');
  ok(!!el, 'showSchemaError: the new node is registered under #schemaerr');
  eq(el.tag, 'div', 'showSchemaError: it is a div');
  eq(el.attrs.role, 'alert', 'showSchemaError: role=alert for screen readers');
  has(el.style.cssText, 'position:fixed', 'showSchemaError: full-viewport overlay css');
  has(el.style.cssText, 'background:var(--bg)', 'showSchemaError: opaque background so charts cannot show through');
  has(el.innerHTML, 'Payload version mismatch', 'showSchemaError: headline');
  has(el.innerHTML, 'The dashboard refused to render rather than show numbers it cannot interpret.',
    'showSchemaError: explains the refusal');
  eq(el.q.textContent, 'boom <x>', 'showSchemaError: message lands in .schemamsg as text, not HTML');

  created.length = 0;
  D.showSchemaError('again');
  eq(created.length, 0, 'showSchemaError: second call reuses the existing node');
  eq(el.q.textContent, 'again', 'showSchemaError: message is replaced');
}

// ═══ flash ══════════════════════════════════════════════════════════════════
{
  dom();
  created.length = 0;
  const timers = [], raf = [];
  const realST = globalThis.setTimeout, realCT = globalThis.clearTimeout, realRAF = globalThis.requestAnimationFrame;
  let cleared = 0;
  globalThis.requestAnimationFrame = fn => { raf.push(fn); };
  globalThis.setTimeout = (fn, ms) => { timers.push([fn, ms]); return timers.length; };
  globalThis.clearTimeout = () => { cleared++; };
  try {
    D.flash('saved');
    const f = DOM.get('flash');
    ok(!!f, 'flash: creates #flash when absent');
    eq(f.attrs.role, 'status', 'flash: role=status (polite live region)');
    eq(f.textContent, 'saved', 'flash: text set immediately');
    eq(f.style.opacity, undefined, 'flash: starts transparent (opacity only set on the next frame)');
    eq(raf.length, 1, 'flash: fades in on the next animation frame');
    raf[0]();
    eq(f.style.opacity, '1', 'flash: the frame makes it visible');
    eq(timers.length, 1, 'flash: schedules exactly one hide timer');
    eq(timers[0][1], 2600, 'flash: hides after 2600 ms');
    timers[0][0]();
    eq(f.style.opacity, '0', 'flash: the timer fades it out again');

    eq(cleared, 1, 'flash: even the first call retires the (absent) previous timer');
    D.flash('second');
    eq(cleared, 2, 'flash: a new message cancels the pending hide');
    eq(timers.length, 2, 'flash: and schedules a fresh one');
    eq(D.flash._t, 2, 'flash: the live timer id is kept on the function');
  } finally {
    globalThis.setTimeout = realST; globalThis.clearTimeout = realCT;
    if (realRAF === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = realRAF;
  }
}

// ═══ renderResolution ═══════════════════════════════════════════════════════
{
  eq(D.renderResolution(), undefined, 'renderResolution: no #resinfo -> no-op');

  const els = dom('resinfo', 'resbtn', 'respop');
  DATA.profiles = { p1: {}, p2: {}, All: {} };
  DATA.resolution = {
    agent_home: '/srv/agent-home', mode: 'discovered', discovered: ['p1'], configured: ['p2'],
    excluded: [{ name: 'old', reason: 'no state.db' }], failed: [],
  };
  clickHandlers.length = 0;
  D.renderResolution();
  has(els.resinfo.innerHTML, '>2 profiles · 1 excluded<', 'renderResolution: counts profiles, skipping the "All" pseudo-profile');
  has(els.resinfo.innerHTML, 'title="How the profile list was built"', 'renderResolution: button explains itself');
  lacks(els.resinfo.innerHTML, 'resbad', 'renderResolution: nothing red when no profile failed');
  lacks(els.resinfo.innerHTML, '&#9888;', 'renderResolution: no warning glyph without failures');
  has(els.resinfo.innerHTML, 'class="resbtn"', 'renderResolution: plain resbtn class when healthy');
  has(els.resinfo.innerHTML, '<code>/srv/agent-home</code>', 'renderResolution: shows the agent home searched');
  has(els.resinfo.innerHTML, '· discovered<', 'renderResolution: shows the resolution mode');
  has(els.resinfo.innerHTML, '<b>Discovered:</b> p1', 'renderResolution: lists discovered profiles');
  has(els.resinfo.innerHTML, '<b>From config:</b> p2', 'renderResolution: lists configured profiles');
  has(els.resinfo.innerHTML, 'Excluded:</b> old <span class="muted">(no state.db)</span>', 'renderResolution: excluded with its reason');
  lacks(els.resinfo.innerHTML, 'Unreadable:', 'renderResolution: no unreadable section in this payload');
  has(els.resinfo.innerHTML, 'id="respop" class="respop card" hidden', 'renderResolution: detail popover starts hidden');
  eq(els.resinfo.contains(), false, 'renderResolution: default fake node does not contain the click target');

  // The local esc in this function escapes & and < but NOT >: distinct from palette.esc.
  DATA.resolution.agent_home = 'a&b<c>d';
  D.renderResolution();
  has(els.resinfo.innerHTML, '<code>a&amp;b&lt;c>d</code>', 'renderResolution: agent home escaped, ">" left alone');

  // Failures flip the button to warn and add the unreadable list.
  DATA.resolution = { agent_home: 'h', excluded: [], discovered: [], configured: [],
    failed: [{ name: 'p9', reason: 'locked' }, { name: 'p8', reason: 'corrupt' }] };
  const els2 = dom('resinfo', 'resbtn', 'respop');
  D.renderResolution();
  has(els2.resinfo.innerHTML, '<span class="resbad">2 unreadable</span>', 'renderResolution: unreadable count is red');
  has(els2.resinfo.innerHTML, 'class="resbtn warn"', 'renderResolution: warn button style');
  has(els2.resinfo.innerHTML, '>&#9888; 2 profiles ·', 'renderResolution: warning glyph precedes the profile count');
  has(els2.resinfo.innerHTML, 'Unreadable:</b><ul', 'renderResolution: unreadable list heading');
  has(els2.resinfo.innerHTML, '<li>p9: locked</li><li>p8: corrupt</li>', 'renderResolution: one item per failed profile');
  lacks(els2.resinfo.innerHTML, 'Excluded:', 'renderResolution: no excluded section when none were excluded');
  lacks(els2.resinfo.innerHTML, 'Discovered:', 'renderResolution: no discovered section when the list is empty');

  // Popover button toggles, and a click outside closes it.
  const stop = { stopped: 0, stopPropagation(){ this.stopped++; } };
  eq(els2.respop.hidden, false, 'renderResolution: a fresh element is visible until the attribute lands');
  els2.respop.hidden = true;                      // the rendered markup carries the `hidden` attribute
  const last = clickHandlers.length - 1;
  els2.resbtn.onclick(stop);
  eq(els2.respop.hidden, false, 'renderResolution: first click opens the popover');
  eq(els2.resbtn.attrs['aria-expanded'], 'true', 'renderResolution: aria-expanded follows');
  eq(stop.stopped, 1, 'renderResolution: the click does not bubble to the outside handler');
  els2.resbtn.onclick(stop);
  eq(els2.respop.hidden, true, 'renderResolution: second click closes it');
  eq(els2.resbtn.attrs['aria-expanded'], 'false', 'renderResolution: aria-expanded resets to false');
  eq(clickHandlers.length, 3, 'renderResolution: one document click listener per call');

  els2.respop.hidden = false;
  els2.resbtn.attrs['aria-expanded'] = 'true';
  clickHandlers[last]({ target: {} });                   // resinfo.contains() -> false
  eq(els2.respop.hidden, true, 'renderResolution: a click outside closes the popover');
  eq(els2.resbtn.attrs['aria-expanded'], 'false', 'renderResolution: and updates aria-expanded');

  const inside = els2.resinfo.contains;
  els2.resinfo.contains = () => true;
  els2.respop.hidden = false;
  clickHandlers[last]({ target: {} });
  eq(els2.respop.hidden, false, 'renderResolution: a click inside leaves it open');
  els2.resinfo.contains = inside;
}

// ═══ PROV / LOCAL_RE / CLOUD_SUFFIX ════════════════════════════════════════
{
  eq(Object.keys(D.PROV).join(','), 'anthropic,opencode-go,fireworks,openai-codex,local,moa,cloud,ollama-cloud,nous',
    'PROV: nine providers in display order');
  eq(D.PROV.anthropic.icon, '✳', 'PROV: anthropic glyph');
  eq(D.PROV['ollama-cloud'].icon, '☁', 'PROV: ollama-cloud is a cloud glyph');
  eq(D.PROV.cloud.icon, '☁', 'PROV: cloud shares the cloud glyph');
  eq(D.PROV.nous.fg, '#eab308', 'PROV: nous gold');
  eq(D.PROV.local.icon, '▣', 'PROV: local is a terminal box, not a cloud');
  lacks(JSON.stringify(D.PROV), 'openrouter', 'PROV: openrouter has no entry (badges fall back)');

  const L = D.LOCAL_RE;
  eq([L.test('qwen3-coder'), L.test('gpt-oss:120b'), L.test('deepseek-r1:8b'), L.test('nemotron-4'),
      L.test('llama3.1'), L.test('mistral-large'), L.test('phi4'), L.test('gemma3')].join(','),
    'true,true,true,true,true,true,true,true', 'LOCAL_RE: every documented local family matches');
  eq([L.test('QWEN3'), L.test('Llama3')].join(','), 'true,true', 'LOCAL_RE: case-insensitive');
  eq([L.test('deepseek-v3'), L.test('xqwen'), L.test('step-3.7-flash'), L.test('claude-opus-4-5')].join(','),
    'false,false,false,false', 'LOCAL_RE: anchored, so no mid-name or non-local match');

  const C = D.CLOUD_SUFFIX;
  eq([C.test('kimi-k3:cloud'), C.test('gpt-oss:120b-cloud'), C.test('x.cloud'), C.test('MODEL:CLOUD')].join(','),
    'true,true,true,true', 'CLOUD_SUFFIX: colon, dash, dot and uppercase markers match');
  eq([C.test('cloud'), C.test('cloudy'), C.test('x:clouds'), C.test('mycloud')].join(','),
    'false,false,false,false', 'CLOUD_SUFFIX: needs a separator and end-of-string');
}

// ═══ provOf ═════════════════════════════════════════════════════════════════
{
  const cases = [
    // 1. the URL the call actually hit wins over everything
    ['https://api.fireworks.ai/v1', 'anything', 'slot', 'fireworks', 'url: fireworks'],
    ['https://opencode.ai/zen/v1', 'anything', 'slot', 'opencode-go', 'url: opencode'],
    ['https://api.anthropic.com/v1/messages', 'anything', 'custom', 'anthropic', 'url: anthropic'],
    ['https://api.openai.com/v1', 'anything', 'x', 'openai-codex', 'url: openai'],
    ['https://chatgpt.com/backend-api', 'anything', 'x', 'openai-codex', 'url: chatgpt counts as openai-codex'],
    ['https://openrouter.ai/api/v1', 'anything', 'x', 'openrouter', 'url: openrouter'],
    ['https://inference-api.nousresearch.com/v1', 'anything', 'x', 'nous', 'url: nousresearch'],
    ['https://ollama.com/v1', 'qwen3-coder', 'x', 'ollama-cloud', 'url: ollama.com is hosted, matched before local'],
    ['http://localhost:11434/v1', 'm', 'x', 'local', 'url: a LOCAL_HOSTS entry is local'],
    ['http://192.168.1.20:1234/v1', 'm', 'x', 'local', 'url: any configured LAN prefix is local'],
    ['https://unknown.host/v1', 'llama3', 'custom', 'local', 'url: unknown host + local-shaped name falls through to the name'],
    // 2. the config slot name, once the URL says nothing
    ['', 'whatever', 'anthropic', 'anthropic', 'slot: used verbatim'],
    ['', 'whatever', 'Fireworks', 'fireworks', 'slot: lower-cased'],
    ['', 'whatever', '  opencode-go  ', 'opencode-go', 'slot: trimmed'],
    ['', 'gpt-5', 'custom', 'openai-codex', 'slot "custom" is ignored, so the name decides'],
    ['', 'unknown-name', 'custom', 'local', 'slot "custom" with no name evidence -> local hardware'],
    ['', 'unknown-name', '', 'cloud', 'no evidence at all -> cloud, never local'],
    // 3. model-name shape, last resort
    ['', 'fireworks/llama-v3-70b', '', 'fireworks', 'name: fireworks slug'],
    ['', 'kimi-k3:cloud', '', 'ollama-cloud', 'name: :cloud tag is authoritative'],
    ['', 'qwen3-coder:480b-cloud', '', 'ollama-cloud', 'name: -cloud tag beats the local hint'],
    ['', 'gpt-oss:120b-cloud', '', 'ollama-cloud', 'name: cloud tag beats gpt-oss'],
    ['', 'qwen3-coder', '', 'local', 'name: local family, no slug'],
    ['', 'gpt-oss:20b', '', 'local', 'name: gpt-oss is local before the gpt- prefix rule'],
    ['', 'openrouter/meta/llama-3.1-70b', '', 'cloud', 'name: a slash means a router slug, so not local'],
    ['', 'acme/claude-3-5-sonnet', '', 'anthropic', 'name: claude inside a slug'],
    ['', 'glm-4.6', '', 'opencode-go', 'name: glm'],
    ['', 'kimi-k2-thinking', '', 'opencode-go', 'name: kimi'],
    ['', 'minimax-m2', '', 'opencode-go', 'name: minimax'],
    ['', 'stepfun/step-3', '', 'nous', 'name: stepfun/ prefix'],
    ['', 'step-3.7-flash', '', 'nous', 'name: bare step- prefix'],
    ['', 'hermes-4-70b', '', 'nous', 'name: hermes- family'],
    ['', 'gpt-5-mini', '', 'openai-codex', 'name: gpt- prefix'],
    ['', 'DeepSeek-R1:8b', '', 'local', 'name: case-insensitive local family'],
  ];
  for (const [url, model, prov, want, label] of cases)
    eq(D.provOf(prov, model, url), want, `provOf ${label}`);
  eq(D.provOf(undefined, undefined, undefined), 'cloud', 'provOf: no inputs at all -> cloud');
  eq(D.provOf(null, null, ''), 'cloud', 'provOf: empty strings -> cloud');
}

// ═══ provBadge ══════════════════════════════════════════════════════════════
{
  const b = D.provBadge('anthropic');
  has(b, 'background:hsl(17 66% 55% / .16)', 'provBadge: provider background');
  has(b, 'color:hsl(17 66% 55%)', 'provBadge: provider foreground');
  has(b, 'border:1px solid hsl(17 66% 55%)33', 'provBadge: border is the fg colour plus 0x33 alpha');
  has(b, '>✳</span>anthropic</span>', 'provBadge: glyph then the key as the label');
  eq(D.provBadge('Anthropic'), b, 'provBadge: key is lower-cased before the lookup');
  eq(D.provBadge('  anthropic  '), b, 'provBadge: key is trimmed');
  has(D.provBadge('openrouter'), 'background:rgba(148,163,184,.14)', 'provBadge: unknown provider uses the grey fallback');
  has(D.provBadge('openrouter'), 'color:#MU', 'provBadge: unknown provider text is the muted colour');
  has(D.provBadge('openrouter'), '>○</span>openrouter</span>', 'provBadge: unknown provider gets the hollow circle');
  has(D.provBadge(undefined), '>○</span></span>', 'provBadge: missing provider renders with an empty label');
  has(D.provBadge('<b>'), '<b></span>', 'provBadge: the key is NOT escaped (internal config values only)');
}

// ═══ MODEL_PROV / buildModelProv / provIcon ════════════════════════════════
{
  eq(D.MODEL_PROV, {}, 'MODEL_PROV: empty after load');

  D.buildModelProv([
    { model: 'acme/x', provider: 'anthropic', base_url: '' },
    { model: 'x', provider: 'local', base_url: '' },
  ]);
  eq(D.MODEL_PROV, { x: 'anthropic' }, 'buildModelProv: keyed by short model, first row wins');
  eq(D.provIcon('x'), '✳', 'provIcon: glyph for the recorded provider');

  D.buildModelProv([
    { model: 'm1', provider: 'custom', base_url: 'https://api.anthropic.com/v1' },
    { model: 'm2', provider: '', base_url: '' },
  ]);
  eq(D.MODEL_PROV, { m1: 'anthropic', m2: 'cloud' },
    'buildModelProv: base_url decides; a silent row is cloud');
  eq(D.provIcon('m1'), '✳', 'provIcon: follows the rebuilt map');
  eq(D.provIcon('m2'), '☁', 'provIcon: cloud glyph');

  D.buildModelProv(undefined);
  eq(D.MODEL_PROV, {}, 'buildModelProv: no rows resets the map');
  eq(D.provIcon('claude-opus-4-5'), '✳', 'provIcon: an unrecorded claude name still resolves to anthropic');
  eq(D.provIcon('qwen3-coder'), '▣', 'provIcon: an unrecorded local name resolves to local');
  eq(D.provIcon('zzz-unknown'), '☁', 'provIcon: unknown resolves to cloud, not local');
  eq(D.provIcon(''), '☁', 'provIcon: empty name -> cloud glyph');
  eq(D.provIcon('m1'), '☁', 'provIcon: the map was reset, so m1 is no longer anthropic');
}

// ═══ resendOf ═══════════════════════════════════════════════════════════════
{
  eq(D.resendOf({ input_tokens: 1000, cache_read_tokens: 9000, cache_write_tokens: 0 }),
    { fresh: 1000, sent: 10000, x: 10 }, 'resendOf: read tokens are not fresh');
  eq(D.resendOf({ input_tokens: 10, cache_write_tokens: 90, cache_read_tokens: 900 }),
    { fresh: 100, sent: 1000, x: 10 }, 'resendOf: cache writes count as fresh text');
  eq(D.resendOf({ input_tokens: 0, cache_read_tokens: 5, cache_write_tokens: 0 }),
    { fresh: 0, sent: 5, x: null }, 'resendOf: no fresh tokens -> null ratio, never Infinity');
  eq(D.resendOf({}), { fresh: 0, sent: 0, x: null }, 'resendOf: empty row -> zeroes');
  eq(D.resendOf({ input_tokens: '5', cache_read_tokens: '5' }),
    { fresh: 5, sent: 10, x: 2 }, 'resendOf: numeric strings coerced');
  eq(Math.round(D.resendOf({ input_tokens: 3, cache_read_tokens: 1 }).x * 1000) / 1000, 1.333,
    'resendOf: ratio 4/3');
  eq(D.resendOf({ input_tokens: -10, cache_write_tokens: 10, cache_read_tokens: 5 }).x, null,
    'resendOf: a cancelled-out fresh count -> null, never Infinity from a zero divisor');
}

// ═══ renderBandwidthPanel ══════════════════════════════════════════════════
const bwRow = (o) => ({
  date: '2026-10-01', up_bytes: 0, down_bytes: 0, lan_up_bytes: 0, lan_down_bytes: 0,
  input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, frozen: false,
  bytes_per_token: 3.5, model: 'm', calls: 0, ...o,
});
{
  mkCalls = [];
  dom();
  D.renderBandwidthPanel({ bandwidth_daily: [bwRow({})] }, () => true);
  eq(mkCalls.length, 0, 'renderBandwidthPanel: no #bwpanel -> no chart, no throw');

  const els = dom('bwpanel');
  D.renderBandwidthPanel({}, () => true);
  eq(els.bwpanel.hidden, true, 'renderBandwidthPanel: no ledger at all hides the card');

  const els2 = dom('bwpanel', 'bwpsub', 'bwpkpi', 'bwresend', 'bwpnote', 'cBwTrend');
  D.renderBandwidthPanel({ bandwidth_daily: [bwRow({ up_bytes: 10 })] }, () => false);
  eq(els2.bwpanel.hidden, false, 'renderBandwidthPanel: rows exist but none in range -> card stays');
  eq(mkCalls.length, 0, 'renderBandwidthPanel: out-of-range days draw no chart');
  has(els2.bwpkpi.innerHTML, 'No bandwidth recorded in this range.', 'renderBandwidthPanel: in-card empty state');
  eq(els2.bwresend.innerHTML, '', 'renderBandwidthPanel: empty state clears the re-send table');
  eq(els2.bwpsub.textContent, '', 'renderBandwidthPanel: empty state clears the subtitle');
  eq(els2.bwpnote.textContent, '', 'renderBandwidthPanel: empty state clears the footnote');
}

// Full payload: three rows over two days.
const BW_ROWS = [
  bwRow({ date: '2026-10-01', up_bytes: 1000, down_bytes: 100, lan_up_bytes: 50, lan_down_bytes: 50,
    input_tokens: 100, cache_read_tokens: 900, frozen: true, model: 'acme/alpha', calls: 5 }),
  bwRow({ date: '2026-10-01', up_bytes: 500, down_bytes: 300, lan_down_bytes: 10,
    model: 'beta', calls: 1 }),
  bwRow({ date: '2026-10-02', up_bytes: 200, down_bytes: 200, input_tokens: 100,
    cache_read_tokens: 100, bytes_per_token: 4, model: 'acme/alpha', calls: 2 }),
];
{
  const els = dom('bwpanel', 'bwpsub', 'bwpkpi', 'bwresend', 'bwpnote', 'cBwTrend');
  mkCalls = [];
  D.renderBandwidthPanel({ bandwidth_daily: BW_ROWS }, () => true);

  eq(els.bwpanel.hidden, false, 'bandwidth: card shown');
  eq(els.bwpsub.textContent, '2 days · estimated, not measured', 'bandwidth: subtitle counts days');
  // upload 1700, download 600 -> 2.83 rounds to 3
  has(els.bwpkpi.innerHTML, '<div class="bwpv">3:1</div><div class="bwpl">upload : download</div>',
    'bandwidth: upload:download ratio rounded');
  has(els.bwpkpi.innerHTML, 'a whole conversation goes up to get a reply back',
    'bandwidth: ratio tile explains itself');
  // (input 200 + cache read 1000 + cache write 0) / (input 200 + cache write 0) = 6
  has(els.bwpkpi.innerHTML, '<div class="bwpv">6.0&times;</div><div class="bwpl">context re-send</div>',
    'bandwidth: context re-send factor');
  has(els.bwpkpi.innerHTML, 'each fresh prompt token is sent this many times', 'bandwidth: re-send tile note');
  has(els.bwpkpi.innerHTML, '&uarr; 1.66 KB', 'bandwidth: upload in binary units (1700 B)');
  has(els.bwpkpi.innerHTML, '&darr; 600 B', 'bandwidth: download under 1 KiB stays bytes');
  has(els.bwpkpi.innerHTML, '<div class="bwpv">110 B</div><div class="bwpl">LAN</div>', 'bandwidth: LAN total');
  has(els.bwpkpi.innerHTML, 'local models · not metered', 'bandwidth: LAN tile note');

  eq(mkCalls.length, 1, 'bandwidth: one trend chart');
  const [id, type, labels, sets, opts] = mkCalls[0];
  eq(id, 'cBwTrend', 'bandwidth: chart id');
  eq(type, 'bar', 'bandwidth: base type is bar');
  eq(labels, ['10-01', '10-02'], 'bandwidth: x labels are month-day');
  eq(sets.map(s => s.label), ['upload', 'download', 'LAN'], 'bandwidth: three series');
  eq(sets[0].data, [1500, 200], 'bandwidth: upload summed per day');
  eq(sets[0].backgroundColor, '#f59e0b', 'bandwidth: upload is amber');
  eq(sets[1].type, 'line', 'bandwidth: download is a line on the second axis');
  eq(sets[1].data, [400, 200], 'bandwidth: download summed per day');
  eq(sets[1].yAxisID, 'y1', 'bandwidth: download uses the right axis');
  eq(sets[2].data, [110, 0], 'bandwidth: LAN is up+down per day (50+50 then 10)');
  eq(sets[2].borderColor, '#MU', 'bandwidth: LAN line is the muted colour');
  eq(opts.scales.y1.ticks.callback(1536), '1.50 KB', 'bandwidth: right axis formats bytes');
  eq(opts.plugins.tooltip.callbacks.title([{ dataIndex: 1 }]), '2026-10-02', 'bandwidth: tooltip title is the full date');
  eq(opts.plugins.tooltip.callbacks.label({ dataset: { label: 'LAN' }, parsed: { y: 2048 } }), 'LAN: 2.00 KB',
    'bandwidth: tooltip label formats bytes');

  // Re-send table: alpha 1200/200 = 6x, beta has no fresh tokens so it is dropped.
  has(els.bwresend.innerHTML, 'data-model="alpha"', 'bandwidth: re-send row keyed by short model');
  has(els.bwresend.innerHTML, 'data-x="6.00"', 'bandwidth: re-send ratio on the row');
  has(els.bwresend.innerHTML, 'style="color:col:alpha"', 'bandwidth: model name coloured by model');
  has(els.bwresend.innerHTML, 'title="1,200 prompt tokens sent · 200 fresh · 7 calls"', 'bandwidth: row tooltip totals');
  has(els.bwresend.innerHTML, 'width:100.0%', 'bandwidth: the only row fills the bar');
  has(els.bwresend.innerHTML, '>6.0&times;</span>', 'bandwidth: ratio shown to one decimal');
  eq(count(els.bwresend.innerHTML, 'class="bwrrow'), 1, 'bandwidth: beta is filtered out (no fresh tokens)');
  lacks(els.bwresend.innerHTML, 'beta', 'bandwidth: dropped model is absent');
  lacks(els.bwresend.innerHTML, '> high<', 'bandwidth: 6x is not 2x the median of 6');
  has(els.bwresend.innerHTML, 'fleet median 6.0&times;', 'bandwidth: fleet median footer');
  lacks(els.bwresend.innerHTML, 'top 12 of', 'bandwidth: no truncation note below the cap');

  eq(els.bwpnote.textContent,
    'Estimated from token counts × 3.50 / 4.00 bytes/token, not measured on the wire. '
    + '1 of 3 rows are frozen history: each keeps the constant it was computed with, so recalibrating '
    + 'never restates past days. Re-send = (input + cache read + cache write) ÷ (input + cache write).',
    'bandwidth: footnote lists both byte constants, frozen count and the formula');
}

// The 2x-median flag and the top-12 cap.
{
  const els = dom('bwpanel', 'bwpsub', 'bwpkpi', 'bwresend', 'bwpnote', 'cBwTrend');
  const rows = [
    bwRow({ model: 'one', input_tokens: 100 }),
    bwRow({ model: 'two', input_tokens: 100 }),
    bwRow({ model: 'hot', input_tokens: 100, cache_read_tokens: 900 }),
  ];
  D.renderBandwidthPanel({ bandwidth_daily: rows }, () => true);
  eq(count(els.bwresend.innerHTML, 'class="bwrrow'), 3, 'bandwidth: three scored rows');
  eq(count(els.bwresend.innerHTML, ' class="bwrrow hot"'), 1, 'bandwidth: only the far-above-median row is hot');
  eq(count(els.bwresend.innerHTML, '&#9650; high'), 1, 'bandwidth: hot row carries the high flag');
  eq(count(els.bwresend.innerHTML, 'class="bwrflag"></span>'), 2, 'bandwidth: other rows get an empty flag slot');
  has(els.bwresend.innerHTML, 'fleet median 1.0&times;', 'bandwidth: median of 1, 1, 10 is 1');
  has(els.bwresend.innerHTML, 'width:10.0%', 'bandwidth: a 1x row is a tenth of the 10x max');

  const many = [...Array(13)].map((_, i) => bwRow({ model: 'm' + i, input_tokens: 100, cache_read_tokens: i * 10 }));
  D.renderBandwidthPanel({ bandwidth_daily: many }, () => true);
  eq(count(els.bwresend.innerHTML, 'class="bwrrow'), 12, 'bandwidth: over-cap rows are sliced before rendering');
  has(els.bwresend.innerHTML, '· top 12 of 13 models', 'bandwidth: footer names the cap');
  eq(count(els.bwresend.innerHTML, 'data-model='), 12, 'bandwidth: only twelve rows rendered');

  D.renderBandwidthPanel({ bandwidth_daily: [bwRow({ model: 'x', input_tokens: 0, cache_read_tokens: 500 })] }, () => true);
  has(els.bwresend.innerHTML, 'No prompt tokens in range.', 'bandwidth: no fresh tokens -> empty-state line');
  lacks(els.bwresend.innerHTML, 'bwrrow', 'bandwidth: empty state draws no rows');
}

// ═══ unpricedModels / renderUnpriced ═══════════════════════════════════════
{
  eq(D.unpricedModels([]), [], 'unpricedModels: nothing in, nothing out');
  eq(D.unpricedModels([{ model: 'a', calls: 3, priced: true }]), [], 'unpricedModels: priced rows are excluded');
  eq(D.unpricedModels([{ model: 'a', calls: 0 }]), [], 'unpricedModels: zero calls is not traffic');
  eq(D.unpricedModels([{ model: 'a' }]), [], 'unpricedModels: missing calls is not traffic');

  const un = D.unpricedModels([
    { model: 'acme/x', calls: 3 },
    { model: 'x', calls: 2 },                     // merges into x
    { model: 'b', calls: 0 },                     // no traffic
    { model: 'c', calls: 1, priced: true },       // priced
    { model: 'd', calls: 5, cost_class: 'local' },
    { model: 'e', calls: 4, cost_class: 'free' },
    { model: 'f', calls: 6, cost_class: 'preset' },
    { model: 'g', calls: 7, cost_class: 'weird' }, // unknown class is still unpriced
  ]);
  eq(un.map(([m]) => m).join(','), 'g,x', 'unpricedModels: worst traffic first, short names');
  eq(un[1][1].calls, 5, 'unpricedModels: provider-prefixed and bare rows merge');
  eq(un[0][1].priced, false, 'unpricedModels: an unknown cost_class does not count as priced');
  eq(D.unpricedModels([{ model: 'p', calls: 1 }, { model: 'p', calls: 1, cost_class: 'free' }]).length, 0,
    'unpricedModels: a free-tier row makes the whole model priced');
  eq(D.unpricedModels([{ model: 'q', calls: -1 }]).length, 0, 'unpricedModels: negative calls dropped');
}

{
  eq(D.renderUnpriced([]), undefined, 'renderUnpriced: no banner element, no throw');
  const els = dom();
  D.renderUnpriced([{ model: 'z', calls: 2 }]);
  lacks(Object.keys(els).join(','), 'unpricedbanner', 'renderUnpriced: nothing created when the id is absent');

  const e = dom('unpricedbanner');
  e.unpricedbanner.hidden = false;
  e.unpricedbanner.innerHTML = 'stale';
  D.renderUnpriced([{ model: 'z', calls: 2, priced: true }]);
  eq(e.unpricedbanner.hidden, true, 'renderUnpriced: all priced -> banner hidden');
  eq(e.unpricedbanner.innerHTML, '', 'renderUnpriced: and cleared');

  const e2 = dom('unpricedbanner');
  D.renderUnpriced([{ model: 'z', calls: 3 }, { model: 'acme/<x>', calls: 2 }]);
  eq(e2.unpricedbanner.hidden, false, 'renderUnpriced: unpriced traffic shows the banner');
  has(e2.unpricedbanner.innerHTML, '<b>2 models with traffic have no price</b>', 'renderUnpriced: headline counts models');
  has(e2.unpricedbanner.innerHTML, '(<span class="mono">z</span>, <span class="mono">&lt;x&gt;</span>; 5 calls).',
    'renderUnpriced: names escaped, worst first, calls summed');
  has(e2.unpricedbanner.innerHTML, 'Est. cost excludes that traffic, so it is understated.',
    'renderUnpriced: warns the estimate is low');
  has(e2.unpricedbanner.innerHTML, '<a href="costs.html">Price sheet</a> shows the fix.',
    'renderUnpriced: links to the fix');

  const e3 = dom('unpricedbanner');
  D.renderUnpriced([{ model: 'solo', calls: 1 }]);
  has(e3.unpricedbanner.innerHTML, '<b>1 model with traffic has no price</b>', 'renderUnpriced: singular model');
  has(e3.unpricedbanner.innerHTML, '1 calls', 'renderUnpriced: the call count is not pluralised');
}

// ═══ renderResend ══════════════════════════════════════════════════════════
{
  eq(D.RESEND_MIN, 10, 'RESEND_MIN: mirrors RESEND_MIN_CALLS in the collector');

  const noTbl = dom('resendmin', 'resendsub');
  const nodesBefore = created.length;
  D.renderResend({ resend: [{ calls: 99 }] }, () => true);
  eq(noTbl.resendmin.textContent, '', 'renderResend: no table -> nothing written, not even the threshold');
  eq(noTbl.resendsub.textContent, '', 'renderResend: no table -> subtitle untouched');
  eq(created.length, nodesBefore, 'renderResend: no table -> no nodes created');

  const e = dom('resendtbl', 'resendmin', 'resendsub');
  D.renderResend({ resend: [{ calls: 3 }] }, () => false);
  eq(e.resendmin.textContent, 10, 'renderResend: the threshold is printed before any early return');
  has(e.resendtbl.innerHTML, '<tr><td class="muted py-2">No session in this range has enough calls to average.</td></tr>',
    'renderResend: filtered to nothing -> empty-state row');
  eq(e.resendsub.textContent, '', 'renderResend: and the subtitle is cleared');

  const rs = (o) => ({ id: 's', calls: 0, last: null, resend_usd: 1, ctx_per_call: 10, cread_pct: 0, ...o });
  const rows = [
    rs({ id: 'r1', calls: 9 }),                    // under the threshold
    rs({ id: 'r2', calls: 10 }),                   // exactly the threshold, no last -> kept
    rs({ id: 'r3', calls: 20, last: 1700000000 }), // calls are enough, but inR rejects the day
    rs({ id: 'r4', calls: 20 }),                   // no last -> in range by default
  ];
  e.resendtbl.innerHTML = 'stale';
  D.renderResend({ resend: rows }, () => false);
  eq(count(e.resendtbl.innerHTML, 'class="resendrow'), 2, 'renderResend: threshold and range filters');
  lacks(e.resendtbl.innerHTML, 'stale', 'renderResend: the table is rewritten, not appended to');
  has(e.resendtbl.innerHTML, 'data-sid="r2"', 'renderResend: a row exactly at the threshold is kept');
  has(e.resendtbl.innerHTML, 'data-sid="r4"', 'renderResend: a row with no last-call stamp is kept');
  lacks(e.resendtbl.innerHTML, 'data-sid="r1"', 'renderResend: a row under the threshold is dropped');
  lacks(e.resendtbl.innerHTML, 'data-sid="r3"', 'renderResend: a row whose day inR rejects is dropped');
}

{
  const e = dom('resendtbl', 'resendmin', 'resendsub');
  const rows = [
    { id: 's<1>', title: 'My "chat"', model: 'acme/opus', calls: 12, last: null,
      resend_usd: 1.5, ctx_per_call: 12345, cread_pct: 87.5, cost_class: 'cloud' },
    { id: 's2', title: '', model: 'qwen3', calls: 15, last: null,
      resend_usd: 0.25, ctx_per_call: 600, cread_pct: 50, cost_class: 'local' },
  ];
  D.renderResend({ resend: rows }, () => true);
  eq(e.resendsub.textContent, '2 sessions · $1.75 of re-sent context', 'renderResend: subtitle totals the range');
  has(e.resendtbl.innerHTML, '<th class="text-left py-1">Session</th>', 'renderResend: header row');
  has(e.resendtbl.innerHTML, 'Re-sent cost</th>', 'renderResend: cost column');
  has(e.resendtbl.innerHTML, 'data-sid="s&lt;1&gt;"', 'renderResend: row keyed by escaped session id');
  has(e.resendtbl.innerHTML, 'resendname" title="s&lt;1&gt;">My "chat"</td>', 'renderResend: title used as the name');
  has(e.resendtbl.innerHTML, '<td class="pr-2 rsx" style="white-space:nowrap">opus</td>',
    'renderResend: provider prefix stripped from the model');
  has(e.resendtbl.innerHTML, '<td class="text-right">12</td>', 'renderResend: call count for the cloud row');
  has(e.resendtbl.innerHTML, '<td class="text-right rsx">12.3K</td>', 'renderResend: average context via fmt');
  has(e.resendtbl.innerHTML, '<td class="text-right">87.5%</td>', 'renderResend: cached share to one decimal');
  has(e.resendtbl.innerHTML, '<td class="text-right font-semibold">$1.50</td>', 'renderResend: billed cost');
  has(e.resendtbl.innerHTML, 'background:var(--accent);width:100%', 'renderResend: the largest cost fills the bar');
  eq(count(e.resendtbl.innerHTML, 'class="resendrow'), 2, 'renderResend: two rows');

  const local = e.resendtbl.innerHTML.slice(e.resendtbl.innerHTML.indexOf('data-sid="s2"'));
  has(local, '>s2</td>', 'renderResend: an empty title falls back to the id');
  has(local, '~$0.250 <span class="elecmark">elec</span>', 'renderResend: a local row shows electricity, not a bill');
  has(local, 'width:16.666', 'renderResend: bar width is proportional');
  has(local, '<td class="text-right">50.0%</td>', 'renderResend: 50 renders as 50.0%');

  // The 15-row cap keeps payload order.
  const many = [...Array(16)].map((_, i) => ({ id: 'id' + i, calls: 10, last: null, resend_usd: 1,
    ctx_per_call: 1, cread_pct: 1 }));
  D.renderResend({ resend: many }, () => true);
  eq(count(e.resendtbl.innerHTML, 'class="resendrow'), 15, 'renderResend: capped at 15 rows');
  has(e.resendtbl.innerHTML, 'data-sid="id14"', 'renderResend: the fifteenth row is kept');
  lacks(e.resendtbl.innerHTML, 'data-sid="id15"', 'renderResend: the sixteenth is dropped');
  eq(e.resendsub.textContent, '16 sessions · $16.00 of re-sent context',
    'renderResend: the subtitle still counts every row before the cap');
}

// ═══ ALERT_ICON / ALERT_COLOR / renderAlerts ═══════════════════════════════
{
  eq(D.ALERT_ICON, { critical: '&#9888;', warning: '&#9679;', info: '&#8505;' },
    'ALERT_ICON: three severities, decorative entities');
  eq(D.ALERT_COLOR, { critical: '#ef4444', warning: '#eab308', info: 'var(--accent)' },
    'ALERT_COLOR: red / amber / theme accent');

  const e = dom('alertscard', 'alertscount', 'alertslist');
  e.alertscard.hidden = false;
  D.renderAlerts([]);
  eq(e.alertscard.hidden, true, 'renderAlerts: no alerts -> card hidden');
  D.renderAlerts(undefined);
  eq(e.alertscard.hidden, true, 'renderAlerts: undefined alerts -> card hidden');

  const a = [
    { severity: 'critical', message: 'Disk <full>', why: 'tmp "x"', target_view: 'health' },
    { severity: 'weird', message: 'm2' },
  ];
  e.alertscard.hidden = true;
  D.renderAlerts(a);
  eq(e.alertscard.hidden, false, 'renderAlerts: alerts show the card');
  eq(e.alertscount.textContent, '2 items need attention', 'renderAlerts: count line');
  eq(count(e.alertslist.innerHTML, 'class="flex items-start gap-2'), 2, 'renderAlerts: one block per alert');
  has(e.alertslist.innerHTML, 'style="color:#ef4444;flex:none" title="critical">&#9888;</span>',
    'renderAlerts: critical colour and glyph');
  has(e.alertslist.innerHTML, 'title="tmp "x"">Disk &lt;full&gt;</span>',
    'renderAlerts: message escaped, why kept in the title attribute (esc does not touch quotes)');
  has(e.alertslist.innerHTML, `onclick="pickView('health')"`, 'renderAlerts: target_view wires the jump button');
  has(e.alertslist.innerHTML, '>health &rarr;</button>', 'renderAlerts: button label names the view');
  eq(count(e.alertslist.innerHTML, 'pickView('), 1, 'renderAlerts: only alerts with a target get a button');
  has(e.alertslist.innerHTML, 'title="weird">&#8226;</span>', 'renderAlerts: unknown severity -> bullet, escaped name');
  has(e.alertslist.innerHTML, 'style="color:var(--fg);flex:none"', 'renderAlerts: unknown severity text colour');

  D.renderAlerts([{ severity: 'info', message: 'i' }]);
  eq(e.alertscount.textContent, '1 item need attention', 'renderAlerts: singular noun, verb unchanged');
  has(e.alertslist.innerHTML, 'style="color:var(--accent);flex:none" title="info">&#8505;</span>',
    'renderAlerts: info uses the accent colour');
  has(e.alertslist.innerHTML, 'title="">i</span>', 'renderAlerts: missing why -> empty title');
  eq(count(e.alertslist.innerHTML, '&rarr;'), 0, 'renderAlerts: no jump button without a target');

  // The card is not guarded the way the other renderers are.
  dom();
  let threw = false;
  try { D.renderAlerts([]); } catch (err) { threw = err instanceof TypeError; }
  eq(threw, true, 'renderAlerts: a missing card throws on the empty path (no `if (!card) return`)');
}


// Second module instance: liveModelsOpen / lmMetric / XF_SEEN are all
// per-instance state, and D's MODEL_PROV was reset by renderResolution above.
const D2 = await load();

// ═══ renderXfer ═══════════════════════════════════════════════════════════
{
  dom();
  D2.renderXfer([{ up_bytes: 1 }]);
  eq(DOM.size, 0, 'renderXfer: no #xfercard -> nothing touched');

  const e = dom('xfercard', 'xfertot', 'xfernote');
  e.xfertot.innerHTML = 'stale';
  D2.renderXfer([], () => true);
  eq(e.xfercard.hidden, true, 'renderXfer: first empty payload hides the card');
  eq(e.xfertot.innerHTML, 'stale', 'renderXfer: hidden card keeps its last numbers');

  D2.renderXfer([{ up_bytes: 1536, down_bytes: 1024, lan_up_bytes: 512, lan_down_bytes: 512 },
                 { up_bytes: '2048', down_bytes: 0 }]);
  eq(e.xfercard.hidden, false, 'renderXfer: real traffic reveals the card');
  has(e.xfertot.innerHTML, 'class="bwarrow bwup">&uarr;</span>', 'renderXfer: an up arrow introduces the up leg');
  has(e.xfertot.innerHTML, 'class="bwarrow bwdown">&darr;</span>', 'renderXfer: a down arrow introduces the down leg');
  has(e.xfertot.innerHTML, 'semibold">3.50 KB</span>', 'renderXfer: string byte counts are coerced into the up total');
  has(e.xfertot.innerHTML, 'semibold">1.00 KB</span>', 'renderXfer: down total');
  has(e.xfertot.innerHTML, '<span class="muted text-[length:var(--fs-xs)]">4:1</span>',
    'renderXfer: the up:down ratio is rounded to whole numbers');
  eq(e.xfernote.textContent, 'LAN 1.00 KB (not metered) \u00B7 2 rows', 'renderXfer: LAN total and row count');

  const seen = e.xfertot.innerHTML;
  D2.renderXfer([], () => false);
  eq(e.xfercard.hidden, false, 'renderXfer: once seen, an empty range does not hide the card');
  eq(e.xfertot.innerHTML, seen, 'renderXfer: and it does not clear the numbers (XF_SEEN)');
  eq(e.xfernote.textContent, 'LAN 1.00 KB (not metered) \u00B7 2 rows', 'renderXfer: note also left alone');

  D2.renderXfer([{ up_bytes: 2048, down_bytes: 0, lan_up_bytes: 0, lan_down_bytes: 0 }]);
  has(e.xfertot.innerHTML, 'semibold">2.00 KB</span>', 'renderXfer: up-only traffic still shows its total');
  has(e.xfertot.innerHTML, 'semibold">0 B</span>', 'renderXfer: a zero down total is printed, not omitted');
  eq(count(e.xfertot.innerHTML, ':1</span>'), 0, 'renderXfer: no ratio when nothing came down');
  eq(e.xfernote.textContent, '1 row', 'renderXfer: singular row, and LAN omitted when zero');

  D2.renderXfer([{ up_bytes: 1024, down_bytes: 1024, lan_up_bytes: 10, lan_down_bytes: 0 }]);
  has(e.xfertot.innerHTML, '<span class="muted text-[length:var(--fs-xs)]">1:1</span>',
    'renderXfer: an even split reports 1:1');
  eq(e.xfernote.textContent, 'LAN 10 B (not metered) \u00B7 1 row', 'renderXfer: LAN-only traffic is still disclosed');
}

// ═══ renderHome ════════════════════════════════════════════════════════════
{
  dom();
  D2.renderHome();
  eq(DOM.size, 0, 'renderHome: no #homecards -> no-op');

  const e = dom('homecards');
  const p1 = { rows: [
    { date: '2026-10-01', model: 'acme/a', market_value_usd: 1, calls: 2, up_bytes: 100, lan_up_bytes: 50,
      down_bytes: 10, lan_down_bytes: 5, project: 'Unattributed', act: 0.5 },
    { date: '2026-10-02', model: 'acme/b', market_value_usd: 3, calls: 3, project: 'proj-A', act: 1.5 },
    { date: '2026-09-01', model: 'acme/c', market_value_usd: 99, calls: 99, project: 'proj-A', act: 50 },
  ], health: [{ ok: 9, fail: 1 }, { ok: 0, fail: 0 }], failures_recent: [{}], live: [] };
  DATA.profiles.p1 = p1;

  const clicks = [];
  const card = mkEl('card');
  card.dataset.gohome = 'Cost';
  card.addEventListener = (ev, fn) => clicks.push([ev, fn]);
  e.homecards.querySelectorAll = () => [card];

  D2.renderHome((d) => d !== '2026-09-01');
  const h = e.homecards.innerHTML;
  eq(count(h, 'data-gohome='), 11, 'renderHome: ten stat cards plus bandwidth are clickable');
  has(h, '<a class="card p-4 homecard" href="#/live" data-gohome="Live">', 'renderHome: cards are real links');
  has(h, '<div class="hc-stat">idle</div>', 'renderHome: no live sessions reads idle');
  has(h, '<span class="muted text-[length:var(--fs-xs)] uppercase tracking-wide">Flow</span>',
    'renderHome: the Flow card is labelled');
  has(h, '<div class="hc-stat">2 models</div>', 'renderHome: distinct short model names of in-range rows');
  has(h, '<div class="hc-stat">5 calls</div>', 'renderHome: calls summed over in-range rows');
  has(h, '<div class="hc-stat">$4.00</div>', 'renderHome: market value to two decimals');
  has(h, '<div class="hc-stat">90.0% \u00B7 1 recent</div>', 'renderHome: success rate plus recent failures');
  has(h, '<div class="hc-stat">2 rows</div>', 'renderHome: detail row count');
  has(h, '<div class="hc-stat">proj-A \u00B7 25% unattributed</div>',
    'renderHome: top project and unattributed share, both derived from the in-range rows');
  has(h, '<div class="hc-stat">$0.12 / kWh</div>', 'renderHome: tariff from POWER');
  has(h, '<div class="hc-stat">RS</div>', 'renderHome: router card delegates to routerStat');
  has(h, '<div class="hc-stat">QS</div>', 'renderHome: quota card delegates to qvStat');
  has(h, '>Bandwidth (est.)</span>', 'renderHome: bandwidth card is explicitly an estimate');
  has(h, 'href="#/usage"', 'renderHome: bandwidth deep-links into usage');
  has(h, 'href="costs.html"', 'renderHome: rates stays a real external link');
  has(h, '<div class="hc-stat">Price sheet</div>', 'renderHome: rates card is not a router destination');
  has(h, '<div class="hc-stat"><span class="bwup">\u2191 150 B</span>',
    'renderHome: up bytes are live+LAN and labelled as estimated');
  has(h, '<span class="bwdown">\u2193 15 B</span>', 'renderHome: down bytes are live+LAN');
  eq(count(h, 'data-gohome='), 11, 'renderHome: every card names its destination view');
  eq(count(h, 'data-gohome="Detail"'), 1, 'renderHome: destination views keep their display capitalisation');

  D2.renderHome((d) => d === '2026-10-01');
  has(e.homecards.innerHTML, '<div class="hc-stat">1 model</div>', 'renderHome: singular model wording');
  has(e.homecards.innerHTML, '<div class="hc-stat">2 calls</div>', 'renderHome: the range predicate changes the totals');
  has(e.homecards.innerHTML, '<div class="hc-stat">$1.00</div>', 'renderHome: and the cost');
  has(e.homecards.innerHTML, '<div class="hc-stat">1 rows</div>', 'renderHome: the row count is not pluralised');

  p1.live = ['s1', 's2'];
  p1.failures_recent = [{}, {}];
  D2.renderHome();
  has(e.homecards.innerHTML, '<div class="hc-stat">2 sessions</div>', 'renderHome: plural live sessions');
  has(e.homecards.innerHTML, '<div class="hc-stat">90.0% \u00B7 2 recent</div>', 'renderHome: plural recent failures');
  has(e.homecards.innerHTML, '<div class="hc-stat">3 rows</div>', 'renderHome: no filter -> every row counted');

  DATA.profiles.p1 = {};
  D2.renderHome();
  has(e.homecards.innerHTML, '<div class="hc-stat">0 models</div>', 'renderHome: missing profile -> zeros, not a crash');
  has(e.homecards.innerHTML, '<div class="hc-stat">0 calls</div>', 'renderHome: zero calls');
  has(e.homecards.innerHTML, '<div class="hc-stat">$0.00</div>', 'renderHome: zero cost');
  has(e.homecards.innerHTML, '<div class="hc-stat">0 rows</div>', 'renderHome: zero rows');
  has(e.homecards.innerHTML, '<div class="hc-stat">\u2014</div>',
    'renderHome: no health samples -> an em dash, never NaN%');
  has(e.homecards.innerHTML, '<div class="hc-stat">No data</div>',
    'renderHome: no spend -> No data instead of a bogus top project');
  has(e.homecards.innerHTML, '<div class="hc-stat"><span class="bwup">\u2191 0 B</span>', 'renderHome: zero bytes');
  DATA.profiles.p1 = p1;

  clicks.length = 0; picks.length = 0;
  let prevented = 0;
  D2.renderHome();
  eq(clicks.length, 1, 'renderHome: wires one listener per card it finds');
  eq(clicks[0][0], 'click', 'renderHome: on click');
  clicks[0][1]({ preventDefault(){ prevented++; } });
  eq(prevented, 1, 'renderHome: the card click suppresses navigation');
  eq(picks, ['Cost'], 'renderHome: and routes to the card destination');
}

// ═══ modelsBadge / liveModelsOpen ══════════════════════════════════════════
// A second module instance: liveModelsOpen and lmMetric are per-instance state.
// (The first instance's MODEL_PROV was reset by renderResolution, tested above.)
const liveClick = clickHandlers[clickHandlers.length - 1];
{
  eq(Array.from(D2.liveModelsOpen), [], 'liveModelsOpen: starts empty');
  eq(D2.modelsOf({ models: [1, 2] }), [1, 2], 'modelsOf: passes an array through');
  eq(D2.modelsOf({}), [], 'modelsOf: missing list -> empty');
  eq(D2.modelsOf({ models: 'nope' }), [], 'modelsOf: a non-array is not a model list');
  eq(D2.modelsOf({ models: null }), [], 'modelsOf: a null list -> empty');
  let noPayload = false;
  try { D2.modelsOf(undefined); } catch (err) { noPayload = err instanceof TypeError; }
  eq(noPayload, true, 'modelsOf: an undefined session throws (callers always pass a session)');

  eq(D2.modelsBadge({}), '', 'modelsBadge: nothing to say about a bare session');
  eq(D2.modelsBadge({ nmodels: 1 }), '', 'modelsBadge: one model is not worth a badge');
  eq(D2.modelsBadge({ nmodels: 3 }),
    '<div class="muted text-[length:var(--fs-xs)]">3 models used</div>',
    'modelsBadge: no per-model list but a count > 1 -> plain count');
  eq(D2.modelsBadge({ models: [{ model: 'a' }], nmodels: 3 }),
    '<div class="muted text-[length:var(--fs-xs)]">3 models used</div>',
    'modelsBadge: one listed model falls back to the count');

  const L = { id: 's1', model: 'acme/main', models: [
    { model: 'acme/main', main: true, tasks: ['chat', 'code'] },
    { model: 'acme/helper', main: false, tasks: ['summarise'] },
  ] };
  const b = D2.modelsBadge(L);
  has(b, 'data-lm="s1"', 'modelsBadge: button carries the session id');
  has(b, 'aria-expanded="false"', 'modelsBadge: collapsed while the session is not in liveModelsOpen');
  has(b, 'title="main (chat, code)\nhelper (summarise)"', 'modelsBadge: tooltip lists every model and its tasks');
  has(b, '>2 models used (1 main, 1 helper) \u25BE</button>', 'modelsBadge: count, main/helper split and a down caret');
  lacks(b, '(2 main', 'modelsBadge: no split when the main count equals the total');

  D2.liveModelsOpen.add('s1');
  const bo = D2.modelsBadge(L);
  has(bo, 'aria-expanded="true"', 'modelsBadge: expanded once the session is in liveModelsOpen');
  has(bo, '>2 models used (1 main, 1 helper) \u25B4</button>', 'modelsBadge: caret flips up when open');

  const allMain = D2.modelsBadge({ id: 's2', model: 'a', models: [
    { model: 'a', main: true, tasks: ['t'] }, { model: 'b', main: true, tasks: ['t'] }] });
  lacks(allMain, 'main,', 'modelsBadge: all-main sessions get no helper split');

  // The delegated listener installed at module scope.
  const before = liveCalls;
  liveClick({ target: { closest: sel => sel === '[data-lmmet]' ? { dataset: { lmmet: 'calls' } } : null } });
  eq(D2.lmMetric, 'calls', 'delegated click: a metric button switches lmMetric');
  eq(liveCalls, before + 1, 'delegated click: switching the metric re-renders the live view');
  liveClick({ target: { closest: sel => sel === '[data-lm]' ? { dataset: { lm: 'zz' } } : null } });
  eq(D2.liveModelsOpen.has('zz'), true, 'delegated click: a session opens');
  liveClick({ target: { closest: sel => sel === '[data-lm]' ? { dataset: { lm: 'zz' } } : null } });
  eq(D2.liveModelsOpen.has('zz'), false, 'delegated click: the same button closes it again');
  const calls2 = liveCalls;
  liveClick({ target: {} });
  eq(liveCalls, calls2, 'delegated click: a click on anything else is ignored');
}

// ═══ LM_METRIC / modelsShare ═══════════════════════════════════════════════
{
  eq(Object.keys(D2.LM_METRIC).join(','), 'tokens,calls', 'LM_METRIC: only the two honest units');
  eq(D2.LM_METRIC.tokens.label, 'tokens', 'LM_METRIC: tokens label');
  eq(D2.LM_METRIC.calls.label, 'calls', 'LM_METRIC: calls label');
  eq(D2.LM_METRIC.tokens.of({ in_tok: 5, out_tok: 3 }), 8, 'LM_METRIC.tokens.of: input plus output');
  eq(D2.LM_METRIC.tokens.of({}), 0, 'LM_METRIC.tokens.of: missing counts -> 0');
  eq(D2.LM_METRIC.tokens.fmt(1500), '1.5K', 'LM_METRIC.tokens.fmt: the shared formatter');
  eq(D2.LM_METRIC.calls.of({ calls: '7' }), 7, 'LM_METRIC.calls.of: numeric strings');

  // lmMetric is a module binding: importers can never assign it, so the only
  // way to change the metric is the button the module itself handles.
  liveClick({ target: { closest: sel => sel === '[data-lmmet]' ? { dataset: { lmmet: 'tokens' } } : null } });
  eq(D2.lmMetric, 'tokens', 'delegated click: switching back to tokens');
  const ms = [
    { model: 'acme/a', in_tok: 300, out_tok: 0 },
    { model: 'b', in_tok: 100, out_tok: 0 },
  ];
  const s = D2.modelsShare(ms, 'a');
  has(s, 'class="lmbar" role="img"', 'modelsShare: the bar is an image for screen readers');
  has(s, 'aria-label="share of tokens per model"', 'modelsShare: the label names the metric');
  has(s, 'width:75.000%;background:col:a"', 'modelsShare: segment width is a three-decimal percentage');
  has(s, 'title="a \u2014 300 tokens (75.0%)"', 'modelsShare: segment tooltip has value and share');
  has(s, 'width:25.000%;background:col:b"', 'modelsShare: second segment');
  has(s, 'class="lmkey cur"', 'modelsShare: the session model is marked current in the legend');
  eq(count(s, 'lmkey cur'), 1, 'modelsShare: only one legend entry is current');
  has(s, 'class="lmdot" style="background:col:a"', 'modelsShare: legend dot matches the bar colour');
  has(s, '<span class="muted"> 75.0%</span>', 'modelsShare: legend share');
  eq(count(s, 'class="lmseg"'), 2, 'modelsShare: one segment per positive share');

  const tiny = D2.modelsShare([{ model: 'a', in_tok: 99995 }, { model: 'b', in_tok: 5 }], 'a');
  has(tiny, '<span class="muted"> <0.1%</span>', 'modelsShare: a sliver is labelled <0.1% in the legend');
  has(tiny, 'width:0.005%;background:col:b', 'modelsShare: but it still gets a (tiny) segment');

  eq(D2.modelsShare([{ model: 'a', in_tok: 0 }, { model: 'b', in_tok: 0 }], 'a'), '',
    'modelsShare: nothing to divide, nothing drawn');
  eq(D2.modelsShare([], 'a'), '', 'modelsShare: empty model list');

  const half = D2.modelsShare([{ model: 'a', in_tok: 10 }, { model: 'b', in_tok: 0 }], 'a');
  eq(count(half, 'class="lmseg"'), 1, 'modelsShare: a zero-share model gets no segment');
  eq(count(half, 'class="lmkey'), 2, 'modelsShare: but it stays in the legend');

  liveClick({ target: { closest: sel => sel === '[data-lmmet]' ? { dataset: { lmmet: 'calls' } } : null } });
  eq(D2.lmMetric, 'calls', 'delegated click: the calls button is handled too');
  const cs = D2.modelsShare([{ model: 'a', calls: 1, in_tok: 1000 }, { model: 'b', calls: 3 }], 'a');
  has(cs, 'aria-label="share of calls per model"', 'modelsShare: honours the selected metric');
  has(cs, 'title="b — 3 calls (75.0%)"', 'modelsShare: counts calls, not tokens, in this mode');
  has(cs, 'width:25.000%', 'modelsShare: call share, not token share');

  // Leave the instance on tokens for the modelsPanel block below.
  liveClick({ target: { closest: sel => sel === '[data-lmmet]' ? { dataset: { lmmet: 'tokens' } } : null } });
  eq(D2.lmMetric, 'tokens', 'delegated click: and back again');
}

// ═══ modelsPanel ═══════════════════════════════════════════════════════════
{
  const now = Date.now() / 1000;
  const L = { id: 's1', model: 'acme/a', models: [
    { model: 'acme/a', main: true, tasks: ['chat'], base_url: 'https://api.anthropic.com/v1',
      calls: 5, in_tok: 300, out_tok: 0, last: null },
    { model: 'acme/<x>', main: false, tasks: ['code'], base_url: '',
      calls: 2, in_tok: 100, out_tok: 100, last: now - 120 },
    { model: 'qwen3-coder', main: false, tasks: ['code'], base_url: '',
      calls: 1, in_tok: 1, out_tok: 0 },
  ] };
  eq(D2.modelsPanel({ id: 'nope', model: 'a', models: L.models }), '',
    'modelsPanel: closed session renders nothing');
  eq(D2.modelsPanel({ id: 's1', model: 'a', models: [L.models[0]] }), '',
    'modelsPanel: a single model is not a panel');

  D2.liveModelsOpen.add('s1');
  const h = D2.modelsPanel(L);
  has(h, '<div class="lmpanel" data-lmp="s1">', 'modelsPanel: wrapper keyed by session');
  has(h, '<span class="muted">share of</span>', 'modelsPanel: head introduces the metric toggle');
  has(h, 'class="lmmet on" data-lmmet="tokens">tokens</button>', 'modelsPanel: the active metric is highlighted');
  has(h, 'class="lmmet" data-lmmet="calls">calls</button>', 'modelsPanel: the other metric is offered');
  has(h, 'aria-label="share of tokens per model"', 'modelsPanel: embeds the share bar');
  has(h, '<th>Model</th><th>Provider</th><th>Used for</th><th>Share</th>', 'modelsPanel: column headers');

  eq(count(h, '<tr><td><span'), 3, 'modelsPanel: one row per model');
  has(h, '<span style="color:col:a">\u25CF</span> a <span class="muted">(now)</span>',
    'modelsPanel: the session model is marked (now)');
  has(h, '<span style="color:col:<x>">\u25CF</span> &lt;x&gt;</td>',
    'modelsPanel: the name is escaped but the colour key is the raw short name');
  has(h, '<td><span class="text-[length:var(--fs-xs)]', 'modelsPanel: provider cell holds a badge');
  has(h, '>\u2733</span>anthropic</span>', 'modelsPanel: base_url decides the provider badge');
  has(h, '>\u2601</span>cloud</span>', 'modelsPanel: a slash means a router slug -> cloud badge');
  has(h, '>\u25A3</span>local</span>', 'modelsPanel: a local-looking name with no base_url gets the local badge');
  has(h, '<td class="muted">chat</td>', 'modelsPanel: tasks listed');
  has(h, '<td class="muted">code</td>', 'modelsPanel: task list for the second row');
  has(h, 'class="lmrowbar" style="width:100.00%;background:col:a"', 'modelsPanel: the heaviest model fills its bar');
  has(h, 'class="lmrowbar" style="width:66.67%;background:col:<x>"',
    'modelsPanel: the lighter model is scaled to the heaviest, not to the total');
  has(h, 'class="lmrowbar" style="width:0.33%;background:col:qwen3-coder"',
    'modelsPanel: the bar is a raw share of the heaviest row (no minimum clamp here)');
  has(h, '<td class="num">5</td>', 'modelsPanel: call count');
  has(h, '<td class="num">300 / 0</td>', 'modelsPanel: tokens in / out');
  has(h, '<td class="num">100 / 100</td>', 'modelsPanel: second row tokens');
  eq(count(h, 'ago:120 ago'), 1, 'modelsPanel: relative last-use from Date.now()');
  eq(count(h, '<td class="num muted"></td>'), 2, 'modelsPanel: no last-use stamp -> empty cells');
  has(h, '<td class="num">1 / 0</td>', 'modelsPanel: third row tokens');
  D2.liveModelsOpen.delete('s1');
}

// ═══ fillChip / qChip ══════════════════════════════════════════════════════
{
  const c = D2.qChip('running', 's:1', 'opus<4>', 'profile1', 210);
  eq(c.className, 'qchip', 'qChip: class for styling');
  eq(c.dataset.key, 's:1', 'qChip: identity key on the node');
  eq(c.dataset.lane, 'running', 'qChip: lane stamped on the node');
  has(c.innerHTML, '<span class="qdotwrap" style="background:hsl(210 62% 45%)"></span>', 'fillChip: hue-only profile dot');
  has(c.innerHTML, '<span class="qmodel">opus&lt;4&gt;</span>', 'fillChip: label escaped');
  has(c.innerHTML, '<span class="qprof">profile1</span>', 'fillChip: meta rendered when present');

  const plain = D2.qChip('queued', 'h:1', 'qwen3', '', null);
  lacks(plain.innerHTML, 'background:hsl', 'fillChip: no colour when the profile has no hue');
  lacks(plain.innerHTML, 'qprof', 'fillChip: no meta span when meta is empty');
  has(plain.innerHTML, '<span class="qdotwrap"></span>', 'fillChip: dot without a style attribute');

  // Reusing a node is what keeps the queue from flashing: identity must survive.
  const lane = { children: [], appendChild(el){ this.children.push(el); return el; } };
  D2.flipMove(plain, lane);
  eq(lane.children[0], plain, 'qChip + flipMove: the same node object is moved, never recreated');
  eq(plain.dataset.key, 'h:1', 'fillChip: the moved node keeps its key');
}

// ═══ flipMove ══════════════════════════════════════════════════════════════
{
  const timers = [];
  const realST = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { timers.push([fn, ms]); return timers.length; };
  try {
    // No layout: every rect is 0x0, so the chip just arrives.
    const flat = mkEl('flat');
    const lane1 = { children: [], appendChild(el){ this.children.push(el); return el; } };
    D2.flipMove(flat, lane1);
    eq(lane1.children.length, 1, 'flipMove: the node is appended');
    eq(flat.classList.contains('travel'), false, 'flipMove: no travel class without a position change');
    eq(flat.classList.contains('arrived'), true, 'flipMove: arrival is always marked');
    eq(timers.length, 1, 'flipMove: schedules the class cleanup');
    eq(timers[0][1], 320, 'flipMove: cleanup after 320 ms (matches the CSS transition)');
    timers[0][0]();
    eq(flat.classList.contains('arrived'), false, 'flipMove: cleanup removes the arrival mark');
    eq(flat.classList.contains('travel'), false, 'flipMove: cleanup removes the travel mark');

    // A real position change: measure, move, invert, clear.
    let moved = false;
    const chip = mkEl('chip');
    chip.getBoundingClientRect = () => moved ? { left: 0, top: 0 } : { left: 10, top: 25 };
    const writes = [];
    chip.style = new Proxy({}, { set(t, k, v){ writes.push(`${k}=${v}`); t[k] = v; return true; } });
    const lane2 = { children: [], appendChild(el){ this.children.push(el); moved = true; return el; } };
    D2.flipMove(chip, lane2);
    has(writes.join(' | '), 'transition=none', 'flipMove: the invert runs without a transition');
    has(writes.join(' | '), 'transform=translate(10px,25px)', 'flipMove: the delta is inverted into a transform');
    eq(chip.style.transform, '', 'flipMove: the transform is cleared so CSS plays it back to zero');
    eq(chip.style.transition, '', 'flipMove: the transition is restored before the animation');
    eq(chip.classList.contains('travel'), true, 'flipMove: a moving chip is marked travelling');
    timers[1][0]();
    eq(chip.classList.contains('travel'), false, 'flipMove: travel mark cleared after the transition');
  } finally { globalThis.setTimeout = realST; }
}

// ═══ renderConcurrency ═════════════════════════════════════════════════════
{
  mkCalls = [];
  dom();
  D2.renderConcurrency([{ hour: '2026-10-01T09:00', top: 1, sub: 0 }], undefined, undefined);
  eq(mkCalls.length, 0, 'renderConcurrency: no #conccard -> no chart, no throw');

  const els = dom('conccard', 'concempty', 'concpeak', 'cConcurrency');
  const rows = [
    { hour: '2026-10-02T10:00', top: 3, sub: 1 },
    { hour: '2026-10-01T09:00', top: 5, sub: 0 },
    { hour: '2026-10-03T00:00', top: 9, sub: 9 },   // outside the range
  ];
  DATA.ollama = { hosts: [{ queue: 2 }, { queue: -5 }, {}] };
  mkCalls = [];
  D2.renderConcurrency(rows, '2026-10-01', '2026-10-02');
  eq(els.concempty.hidden, true, 'renderConcurrency: an in-range payload hides the empty state');
  eq(els.concpeak.innerHTML,
    'Peak: <b>5</b> concurrent sessions (5 top-level, 0 subagent) at <b>2026-10-01T09:00</b>',
    'renderConcurrency: peak is the busiest in-range hour');
  eq(mkCalls.length, 1, 'renderConcurrency: one chart');
  const [id, type, labels, sets, opts] = mkCalls[0];
  eq(id, 'cConcurrency', 'renderConcurrency: chart id');
  eq(type, 'bar', 'renderConcurrency: stacked bars');
  eq(labels, ['10-01T09:00', '10-02T10:00'], 'renderConcurrency: hours sorted, month-day labels');
  eq(sets[0], { label: 'top-level', data: [5, 3], backgroundColor: '#AC', stack: 's' },
    'renderConcurrency: top-level series from r.top');
  eq(sets[1], { label: 'subagent', data: [0, 1], backgroundColor: P.PAL[2], stack: 's' },
    'renderConcurrency: subagent series shares the stack');
  eq(sets[2].label, 'queue depth (now)', 'renderConcurrency: queue is a reference series');
  eq(sets[2].data, [2, 2], 'renderConcurrency: queue depth is the current total, negative clamped to 0');
  eq(sets[2].type, 'line', 'renderConcurrency: drawn as a line');
  eq(sets[2].borderColor, '#ef4444', 'renderConcurrency: dashed red reference');
  eq(sets[2].borderDash, [4, 3], 'renderConcurrency: dash pattern');
  eq(sets[2].fill, false, 'renderConcurrency: no fill under the reference line');
  eq(sets[2].pointRadius, 0, 'renderConcurrency: no points');
  eq(opts.plugins.legend.labels.boxWidth, 8, 'renderConcurrency: compact legend boxes');
  eq(opts.scales.x.grid.color, '#BD', 'renderConcurrency: x grid uses the border colour');
  eq(opts.scales.y.beginAtZero, true, 'renderConcurrency: y starts at zero');

  // Ties keep the earliest hour (strictly-greater comparison).
  D2.renderConcurrency([{ hour: '2026-10-01T01:00', top: 1, sub: 1 },
                        { hour: '2026-10-02T01:00', top: 2, sub: 0 }], undefined, undefined);
  has(els.concpeak.innerHTML, 'at <b>2026-10-01T01:00</b>', 'renderConcurrency: an equal peak keeps the first hour');
  has(els.concpeak.innerHTML, '<b>2</b> concurrent sessions', 'renderConcurrency: plural for a peak above one');

  D2.renderConcurrency([{ hour: '2026-10-01T01:00', top: 1, sub: 0 }], undefined, undefined);
  has(els.concpeak.innerHTML, '<b>1</b> concurrent session (1 top-level, 0 subagent)',
    'renderConcurrency: singular session for a peak of one');

  // The empty path destroys any stale chart before leaving an empty state.
  let destroyed = 0;
  globalThis.Chart = { getChart: () => ({ destroy(){ destroyed++; } }) };
  try {
    els.concempty.hidden = true;
    els.concpeak.textContent = 'stale';
    mkCalls = [];
    D2.renderConcurrency(rows, '2030-01-01', '2030-01-02');
    eq(els.concempty.hidden, false, 'renderConcurrency: no in-range hours -> empty state shown');
    eq(els.concpeak.textContent, '', 'renderConcurrency: peak line cleared');
    eq(destroyed, 1, 'renderConcurrency: the stale chart bound to the canvas is destroyed');
    eq(mkCalls.length, 0, 'renderConcurrency: and no new chart is drawn');
  } finally { delete globalThis.Chart; }

  // Chart is a page global (CDN). views.js reaches for it unguarded when the
  // canvas exists, so the empty path needs it too.
  let refErr = '';
  try { D2.renderConcurrency([], undefined, undefined); } catch (err) { refErr = err.constructor.name; }
  eq(refErr, 'ReferenceError', 'renderConcurrency: empty path requires the Chart global (no typeof guard)');
  globalThis.Chart = { getChart: () => null };
  try {
    D2.renderConcurrency([], undefined, undefined);
    eq(els.concempty.hidden, false, 'renderConcurrency: nothing to draw -> empty state');
    eq(els.concpeak.textContent, '', 'renderConcurrency: with a Chart global but no bound chart, peak is cleared');
  } finally { delete globalThis.Chart; }
}

// ═══ unattrPattern / UNATTR_LABEL ══════════════════════════════════════════
{
  eq(D2.UNATTR_LABEL, 'Unattributed', 'UNATTR_LABEL: the bucket every unlabelled project lands in');

  const realCreate = fakeDocument.createElement;
  try {
    // jsdom has no canvas backend: getContext() is null, so the hatch degrades
    // to a flat muted colour and is deliberately NOT memoised.
    fakeDocument.createElement = (tag) => { const c = mkEl('canvas'); c.tag = tag; c.getContext = () => null; return c; };
    eq(D2.unattrPattern(), 'rgba(148,163,184,0.5)', 'unattrPattern: flat fallback when there is no 2d context');
    eq(D2._unattrPattern, null, 'unattrPattern: the fallback is not cached');

    let drawn = 0, patternCalls = 0;
    fakeDocument.createElement = (tag) => {
      const c = mkEl('canvas'); c.tag = tag;
      c.getContext = () => ({
        fillRect(){ drawn++; }, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){ drawn++; },
        createPattern(){ patternCalls++; return 'PATTERN'; },
      });
      return c;
    };
    eq(D2.unattrPattern(), 'PATTERN', 'unattrPattern: returns the repeat pattern when a context exists');
    eq(patternCalls, 1, 'unattrPattern: creates the pattern once');
    eq(D2._unattrPattern, 'PATTERN', 'unattrPattern: memoised for the rest of the page life');
    eq(D2.unattrPattern(), 'PATTERN', 'unattrPattern: second call returns the cache');
    eq(patternCalls, 1, 'unattrPattern: the cache prevents a second canvas');
    eq(drawn, 2, 'unattrPattern: the 8x8 tile is filled and hatched');
  } finally { fakeDocument.createElement = realCreate; }
}

// ═══ renderLatency ═════════════════════════════════════════════════════════
{
  eq(D2.renderLatency({ by_model: { a: { n: 1, p50: 1, p90: 1, p99: 1 } } }), undefined,
    'renderLatency: no #latcard -> no-op');

  const els = dom('latcard', 'latbymodel', 'latbyendpoint', 'latslowest');
  els.latbymodel.innerHTML = 'stale';
  D2.renderLatency({ by_model: {} });
  eq(els.latcard.hidden, true, 'renderLatency: no models -> card hidden');
  eq(els.latbymodel.innerHTML, 'stale', 'renderLatency: and the stale table is left alone');
  D2.renderLatency({});
  eq(els.latcard.hidden, true, 'renderLatency: empty payload -> card hidden');

  const lat = {
    by_model: {
      slow: { n: 12, p50: 1.2, p90: 9.9, p99: 20.5, tok_s: 12.345 },
      fast: { n: 3, p50: 0.5, p90: 1.1, p99: 2.2, tok_s: null },
    },
    by_endpoint: { '/v1/messages': { n: 5, p50: 2, p90: 4, p99: 6, tok_s: 3 } },
    slowest: [{ session: 's1', model: 'acme/opus', s: 2.5 }, { session: 's2', s: 1 }],
  };
  els.latcard.hidden = false;
  D2.renderLatency(lat);
  eq(els.latcard.hidden, false, 'renderLatency: traffic shows the card');
  const mi = els.latbymodel.innerHTML;
  eq(count(mi, 'class="flex items-center gap-2 text-[length:var(--fs-xs)] py-1"'), 2,
    'renderLatency: one row per model');
  ok(mi.indexOf('slow') < mi.indexOf('fast'), 'renderLatency: models sorted by descending p90');
  has(mi, 'title="sample size">n=12</span>', 'renderLatency: sample size surfaced');
  has(mi, 'title="p50 / p90 / p99 seconds">1.2s / 9.9s / 20.5s</span>',
    'renderLatency: percentile triad, given values verbatim');
  has(mi, '>12.3 tok/s</span>', 'renderLatency: throughput to one decimal');
  has(mi, 'title="sample size">n=3</span>', 'renderLatency: second row sample size');
  has(mi, '>0.5s / 1.1s / 2.2s</span>', 'renderLatency: second row percentiles');
  has(mi, '<span class="muted" style="min-width:5.5rem;text-align:right"></span>',
    'renderLatency: a null tok_s leaves the throughput cell empty rather than showing "0 tok/s"');
  lacks(mi, 'null tok/s', 'renderLatency: no "null" leaks into the markup');
  has(els.latbyendpoint.innerHTML, 'title="/v1/messages">/v1/messages</span>', 'renderLatency: endpoint table');
  has(els.latbyendpoint.innerHTML, '>3.0 tok/s</span>', 'renderLatency: endpoint throughput');

  const sl = els.latslowest.innerHTML;
  has(sl, 'Slowest turns', 'renderLatency: slowest-turn heading');
  eq(count(sl, 'data-tsession='), 2, 'renderLatency: one button per slow turn');
  has(sl, 'data-tsession="s1" data-tprofile="p1"', 'renderLatency: the button names session and profile');
  has(sl, 'class="chip ttitlebtn"', 'renderLatency: chip styling for the session jump');
  has(sl, '>acme/opus</button>', 'renderLatency: model as the button label');
  has(sl, '<span class="muted">2.5s</span>', 'renderLatency: turn duration');
  has(sl, '>(unknown)</button>', 'renderLatency: a turn with no model is labelled (unknown)');

  D2.renderLatency({ by_model: { a: { n: 1, p50: 1, p90: 1, p99: 1 } } });
  eq(els.latslowest.innerHTML, '', 'renderLatency: no slowest turns -> the section is emptied');

  // Sub-elements are not guarded.
  dom('latcard');
  let threw = false;
  try { D2.renderLatency(lat); } catch (err) { threw = err instanceof TypeError; }
  eq(threw, true, 'renderLatency: a card without its tables throws (no guard on the sub-elements)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
