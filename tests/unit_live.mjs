// Unit tests for live.js — the live session list, the live fan-out strip, the
// All-profile delegation merge, the completion sound and the 5s live poll.
// Expected values derived by hand from the source, not captured from output.
import { isolate } from './lib/isolate.mjs';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const eq = (actual, expected, msg) => {
  try { assert.deepEqual(actual, expected); pass++; }
  catch { fail++; console.error(`FAIL: ${msg}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`); }
};
const ok = (cond, msg) => eq(!!cond, true, msg);
const has = (hay, needle, msg) => ok(String(hay).includes(needle), `${msg} — contains ${JSON.stringify(needle)}`);
// attribute names of every tag, parsed with quoted values skipped — an
// injected handler shows up as a real attribute name, encoded text does not.
const attrNames = html => [...String(html).matchAll(/<[a-z][^\s>]*((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*\/?>/gi)]
  .flatMap(m => [...m[1].matchAll(/\s+([^\s=>]+)(?:="[^"]*")?/g)].map(a => a[1].toLowerCase()));
const noHandler = html => !attrNames(html).some(n => n.startsWith('on'));
const lacks = (hay, needle, msg) => ok(!String(hay).includes(needle), `${msg} — does not contain ${JSON.stringify(needle)}`);
const times = (hay, needle, n, msg) => eq(String(hay).split(needle).length - 1, n, msg);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── harness ───────────────────────────────────────────────────────────────────
// live.js paints into #livelist/#livefanout/#livebw, reads the clock through
// Date.now() and keeps its poll timers on the globals, so every block gets a
// fresh module copy, a fresh DOM stub and a recording setTimeout.
//
// live.js also assigns to imported bindings at runtime (`bwPrev`/`bwPrevAt` in
// renderLive, `DATA`/`COLORS`/`TOOLCOLORS`/`PV_ALL` in doRefresh and pollLive).
// A binding imported from an ES module is read-only to the importer, so those
// assignments throw TypeError here even though the shipped page concatenates
// every module into one script (webassets.py strips the `export` keywords).
// Checks below therefore assert on the DOM/state the function produced BEFORE
// it stopped, and pin that stop so an unexpected one cannot hide.
const PAL = await isolate('palette.js', {});   // the real esc/short/fmtB/ago/catOf live.js calls

const EL_IDS = ['refresh','livelist','livefanout','livebw','livestamp','repolist','from','to','meta','soundtoggle'];

function el(id){
  return {
    id, innerHTML:'', textContent:'', hidden:false, value:'', onclick:null,
    style:{}, dataset:{}, _attrs:{}, _on:{},
    classList:{ s:new Set(),
      add(c){ this.s.add(c); }, remove(c){ this.s.delete(c); },
      toggle(c, f){ const on = f === undefined ? !this.s.has(c) : !!f; if (on) this.s.add(c); else this.s.delete(c); return on; },
      contains(c){ return this.s.has(c); } },
    setAttribute(k, v){ this._attrs[k] = v; },
    addEventListener(t, fn){ (this._on[t] = this._on[t] || []).push(fn); },
    fire(t, ev){ (this._on[t] || []).forEach(fn => fn(ev)); },
    querySelector(){ return null; },
    getBoundingClientRect(){ return { width:0, height:0, top:0, left:0 }; },
  };
}

// Install globals around one call. isolate() only lends them for module
// evaluation, but pollLive/doRefresh/playTone read them at call time.
function withGlobals(g, fn){
  const saved = Object.keys(g).map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  const restore = () => saved.forEach(([k, d]) => { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; });
  Object.keys(g).forEach(k => Object.defineProperty(globalThis, k, { value: g[k], writable:true, configurable:true }));
  let out;
  try { out = fn(); }
  catch (e) { restore(); throw e; }
  if (out && typeof out.then === 'function') return out.then(v => { restore(); return v; }, e => { restore(); throw e; });
  restore();
  return out;
}

async function boot(opt = {}){
  const els = {};
  EL_IDS.forEach(i => { if (!(opt.missing || []).includes(i)) els[i] = el(i); });
  const $ = id => els[id] || null;

  const timers = [];
  let tick = 0;
  const setTimeoutStub = (fn, ms) => { timers.push({ fn, ms, id: ++tick }); return tick; };

  const audio = { ctxs: [], notes: [], gains: [] };
  const logs = {
    fetch: [], deferred: [], mk: [], renderOllama: [], renderQueue: [], renderAgents: [],
    render: [], renderResolution: [], tabs: 0, pvFilter: 0, pick: [], navSync: 0,
    drawerSync: 0, showSchemaError: [], schemaProblem: [], provOf: [], provBadge: [],
    modelsBadge: [], modelsPanel: [], loeIcon: [], bwRow: [], colorOf: [], profileHue: [],
    installs: [], storage: [], emptyHTML: null, repoBranch: [], visibility: [], querySelector: [],
  };

  const doc = {
    hidden: opt.hidden === undefined ? true : opt.hidden,
    addEventListener(t, fn){ logs.visibility.push(fn); },
    querySelector(sel){ logs.querySelector.push(sel); return opt.kpi || null; },
  };

  const mkCtx = () => ({
    state: opt.ctxState || 'running', currentTime: opt.ctxNow || 0, destination: {}, resumes: 0,
    resume(){ this.resumes++; this.state = 'running'; return Promise.resolve(); },
    createOscillator(){
      const o = { type:'', frequency:{ value:-1 }, started:[], stopped:[],
        connect(){}, start(t){ this.started.push(t); }, stop(t){ this.stopped.push(t); } };
      audio.notes.push(o);
      return o;
    },
    createGain(){
      const g = { gain:{ value:-1, set:[], lin:[], exp:[],
        setValueAtTime(v, t){ this.set.push([v, t]); },
        linearRampToValueAtTime(v, t){ this.lin.push([v, t]); },
        exponentialRampToValueAtTime(v, t){ this.exp.push([v, t]); } },
      connect(){} };
      audio.gains.push(g);
      return g;
    },
  });
  const win = { AudioContext: function(){ const c = mkCtx(); audio.ctxs.push(c); return c; } };

  const store = {
    _m: Object.assign({}, opt.storage),
    getItem(k){ return k in this._m ? this._m[k] : null; },
    setItem(k, v){ this._m[k] = String(v); logs.storage.push([k, String(v)]); },
  };

  const responses = opt.responses || {};
  const fetchStub = (url, opts) => {
    const name = String(url).split('?')[0];
    logs.fetch.push({ url:String(url), name, opts });
    const r = responses[name];
    if (r === 'hang') return new Promise(() => {});
    if (r === 'defer') { const d = {}; d.promise = new Promise(res => { d.res = res; }); logs.deferred.push(d); return d.promise; }
    if (r === 'throw') return Promise.reject(new Error('network down'));
    if (r && r.http) return Promise.resolve({ ok:false, status:r.http, json: async () => (r.body || {}) });
    return Promise.resolve({ ok:true, status:200, json: async () => ((r && r.body) || {}) });
  };

  const stubs = {
    'palette.js': {
      $, BD:'#20242e', MU:'#8b93a7', COLORS:{}, TOOLCOLORS:{},
      ago: PAL.ago, allModelNames: () => ['a/x','a/y'], allToolNames: () => ['patch','read'],
      buildColors: () => ({}), buildToolColors: () => ({}), bwPrev:{}, bwPrevAt:0,
      catOf: PAL.catOf,
      colorOf: m => { logs.colorOf.push(m); return '#abc123'; },
      emptyHTML: (icon, msg, hint) => { logs.emptyHTML = [icon, msg, hint]; return `<empty>${icon}|${msg}|${hint}</empty>`; },
      esc: PAL.esc, escA: PAL.escA, fmtB: PAL.fmtB, short: PAL.short, pick: n => { logs.pick.push(n); return {}; },
      toolColor: () => '#0a0',
    },
    'charts.js': {
      agg: rows => [[String(rows.length), rows.length]],
      bwRow: L => { logs.bwRow.push(L.id); return `<bwrow>${L.id}</bwrow>`; },
      current: opt.current || 'p1',
      loeIcon: (L, o) => { logs.loeIcon.push([L.id, o]); return '<loe>'; },   // must NOT echo L.title: it is untrusted and unescaped
      mk: (...a) => { logs.mk.push(a); },
      noLeg: {},
    },
    'views.js': {
      REPO_EXPANDED: opt.expanded || new Set(),
      installProjFilter(){ logs.installs.push('installProjFilter'); },
      installProjWeight(){ logs.installs.push('installProjWeight'); },
      installProjectDrilldown(){ logs.installs.push('installProjectDrilldown'); },
      installSesstree(){ logs.installs.push('installSesstree'); },
      modelsBadge: L => { logs.modelsBadge.push(L.id); return `<mbadge>${L.id}</mbadge>`; },
      modelsPanel: L => { logs.modelsPanel.push(L.id); return `<mpanel>${L.id}</mpanel>`; },
      provBadge: p => { logs.provBadge.push(p); return '<pbadge>'; },
      provOf: (kind, model, base) => { logs.provOf.push([kind, model, base]); return { label:'prov' }; },
      render(){ logs.render.push(1); },
      renderOllama(o){ logs.renderOllama.push(o); },
      renderRepoBranch(b){ logs.repoBranch.push(b); },
      renderResolution(){ logs.renderResolution.push(1); },
      schemaProblem: (p, f) => { logs.schemaProblem.push(f); return opt.schemaBad || null; },
      showSchemaError: m => { logs.showSchemaError.push(m); },
    },
    'flow.js': {
      renderAgents(a){ logs.renderAgents.push(a); },
      renderQueue(){ logs.renderQueue.push(1); },
    },
    'drawer.js': {
      drawerSync(){ logs.drawerSync++; },
      installDrawer(){ logs.installs.push('installDrawer'); },
      installSessionFinder(){ logs.installs.push('installSessionFinder'); },
      installTimelineModal(){ logs.installs.push('installTimelineModal'); },
      installTranscriptModal(){ logs.installs.push('installTranscriptModal'); },
    },
    'router.js': {
      POWER: opt.power || { intervals: {} },
      PV_ALL: {},
      intervalsInstall(){ logs.installs.push('intervalsInstall'); },
      navSync(){ logs.navSync++; },
      profileHue: n => { logs.profileHue.push(n); return 42; },
      pvFilter: () => { logs.pvFilter++; return opt.afterFilter || {}; },
      settingsInstall(){ logs.installs.push('settingsInstall'); },
      tabs(){ logs.tabs++; },
    },
    'routerview.js': {
      installHelp(){ logs.installs.push('installHelp'); },
    },
    'main.js': { DATA: opt.data || { profiles: {} }, SCHEMA_VERSION: 3 },
  };

  const G = { window: win, document: doc, localStorage: store, setTimeout: setTimeoutStub, fetch: fetchStub };
  const M = await isolate('live.js', stubs, G);
  return {
    M, els, timers, logs, win, doc, store, audio, responses,
    data: stubs['main.js'].DATA, power: stubs['router.js'].POWER, expanded: stubs['views.js'].REPO_EXPANDED,
    G, run: fn => withGlobals(G, fn),
  };
}

const IMPORT_ASSIGN = /Assignment to constant variable/;
const benignStop = e => e === null || (e instanceof TypeError && IMPORT_ASSIGN.test(e.message));
const renderErr = M => { try { M.renderLive(); return null; } catch (e) { return e; } };
const catches = fn => { try { fn(); return false; } catch { return true; } };

// ── cadence ──────────────────────────────────────────────────────────────────
{
  const h = await boot({ power: { intervals: { live_poll_interval_s: 12, analytics_rebuild_interval_s: 90 } } });
  eq(h.M.LIVE_MS, 12000, 'LIVE_MS: follows POWER.intervals.live_poll_interval_s');
  eq(h.M.REBUILD_MS, 90000, 'REBUILD_MS: follows POWER.intervals.analytics_rebuild_interval_s');
  eq(h.timers.map(t => t.ms), [12000, 90000], 'load: arms the live timer then the rebuild timer, at the configured cadences');

  const d = await boot({ power: { intervals: {} } });
  eq([d.M.LIVE_MS, d.M.REBUILD_MS, d.M.LIVE_MS_DEFAULT], [5000, 60000, 5000], 'defaults: 5s poll, 60s rebuild, LIVE_MS_DEFAULT 5000');

  const n = await boot({ power: {} });
  eq(n.M.LIVE_MS, 5000, 'LIVE_MS: a POWER with no intervals falls back rather than throwing');
}

// ── mergeDelegations ─────────────────────────────────────────────────────────
{
  const { M } = await boot();
  const md = M.mergeDelegations;

  eq(md([]), null, 'merge: an empty list is null');
  eq(md(), null, 'merge: no argument is null');
  eq(md([null, undefined, 0, false, '']), null, 'merge: all-falsy parts are null');
  const only = { children: 2, ok: 1 };
  ok(md([only]) === only, 'merge: a single part is returned by identity, not copied');
  ok(md([null, only]) === only, 'merge: falsy parts are dropped before the single-part path');

  const g1 = {
    children: 3, ok: 2, wasted_hours: 0.5, cost_usd: 0.25,
    by_model: [ { model: 'opus-4', n: 2, ok: 1, cost_usd: 0.2, tokens: 100, hours: 1, wasted_hours: 0.1 },
                { model: 'sonnet-4', n: 1, ok: 1, cost_usd: 0.05, tokens: 50, hours: 0.5, wasted_hours: 0 } ],
    tools: [ { tool: 'patch', calls: 4, fail: 1 } ],
    reasons: { timeout: 2, context: 1 },
    exits: { ok: 2 },
    recent: [ { id: 'r1', at: 10 } ],
    tools_measured: true,
  };
  const g2 = {
    children: 1, ok: 1, wasted_hours: 0.25, cost_usd: 0.1,
    by_model: [ { model: 'opus-4', n: 1, ok: 1, cost_usd: 0.05, tokens: 20, hours: 0.25, wasted_hours: 0.05 } ],
    tools: [ { tool: 'patch', calls: 1, fail: 0 }, { tool: 'read', calls: 3, fail: 0 } ],
    reasons: { timeout: 1, quota: 5 },
    exits: { error: 1 },
    recent: [ { id: 'r2', at: 20 }, { id: 'r3', at: 5 } ],
    tools_measured: true,
  };
  const m = md([g1, g2]);
  eq([m.children, m.ok, m.failed, m.rate], [4, 3, 1, 75], 'merge: children/ok summed, failed derived, rate one-decimal percent');
  eq([m.wasted_hours, m.cost_usd], [0.75, 0.35], 'merge: wasted_hours rounded to 2dp and cost_usd to 4dp');
  eq(m.by_model.map(x => x.model), ['opus-4', 'sonnet-4'], 'merge: by_model sorted by n desc');
  eq(m.by_model[0], { model:'opus-4', n:3, ok:2, cost_usd:0.25, tokens:120, hours:1.25, wasted_hours:0.15, rate:66.7 },
     'merge: the busiest model is aggregated across parts');
  eq(m.by_model[1], { model:'sonnet-4', n:1, ok:1, cost_usd:0.05, tokens:50, hours:0.5, wasted_hours:0, rate:100 },
     'merge: a single-contributor model passes through');
  eq(m.tools.map(t => t.tool), ['patch', 'read'], 'merge: tools sorted by calls desc');
  eq(m.tools[0], { tool:'patch', calls:5, fail:1, rate:80 }, 'merge: tool calls/fail summed and the rate derived from calls-fail');
  eq(m.tools[1], { tool:'read', calls:3, fail:0, rate:100 }, 'merge: a tool that never failed rates 100');
  eq(m.reasons, { quota:5, timeout:3, context:1 }, 'merge: reasons summed');
  eq(Object.keys(m.reasons), ['quota','timeout','context'], 'merge: reasons ordered by count desc');
  eq(Object.keys(m.exits), ['ok','error'], 'merge: exits ordered by count desc');
  eq(m.recent.map(r => r.id), ['r2','r1','r3'], 'merge: recent ordered newest first');
  eq(m.tools_measured, true, 'merge: tools_measured survives when every part measured');

  const zero = md([{}, {}]);
  eq(zero, { children:0, ok:0, failed:0, rate:0, wasted_hours:0, cost_usd:0, by_model:[],
             reasons:{}, exits:{}, tools:[], tools_measured:false, recent:[] },
     'merge: two empty groups produce the full zeroed shape');
  const unmeasured = md([{ tools_measured: true }, { children: 1 }]);
  eq(unmeasured.tools_measured, false, 'merge: tools_measured is false unless every part measured');

  const neg = md([{ children: 0, ok: 5 }, { children: 0, ok: 1 }]);
  eq([neg.children, neg.failed, neg.rate], [0, -6, 0], 'merge: no children means rate 0, and ok above children drives failed negative');

  const n0 = md([{ by_model: [{ model:'x', n:0, ok:0 }] }, { children: 1, ok: 1 }]);
  eq(n0.by_model[0].rate, 0, 'merge: a by_model entry with n=0 rates 0 rather than NaN');
  const noOk = md([{ by_model: [{ model:'x', n:1 }] }, { children: 1, ok: 1 }]);
  eq([noOk.by_model[0].ok, noOk.by_model[0].rate], [0, 0], 'merge: a by_model entry without ok counts as 0 ok, never NaN (#138)');

  const tie = md([{ by_model: [{ model:'zeta', n:1, ok:1 }] }, { by_model: [{ model:'alpha', n:1, ok:1 }] }]);
  eq(tie.by_model.map(x => x.model), ['alpha','zeta'], 'merge: equal-n models tie-break by name');
  const desc = md([{ by_model: [{ model:'beta', n:3, ok:3 }] }, { by_model: [{ model:'alpha', n:3, ok:3 }] }]);
  eq(desc.by_model.map(x => x.model), ['alpha','beta'], 'merge: the ordering is by n, not by arrival');

  const badRate = md([{ tools: [{ tool:'t', calls:1, fail:3 }] }, { children: 1, ok: 1 }]);
  eq(badRate.tools[0].rate, 0, 'merge: a tool rate is clamped at 0 when fail exceeds calls (#138)');

  const many = md([{ recent: Array.from({ length: 45 }, (_, i) => ({ id:'r'+i, at:i+1 })) }, { children: 0 }]);
  eq([many.recent.length, many.recent[0].at, many.recent[39].at], [40, 45, 6], 'merge: recent is capped at the 40 newest');
}

// ── renderLive: rows and collaborators ───────────────────────────────────────
{
  const ROWS = [
    { id:'s1', title:'Fix the parser', model:'openai/opus-4', profile:'p1', category:'Coding',
      phase:'editing', idle_s:30, tools:['patch','read'],
      up_bytes:1024, down_bytes:2048, base_url:'http://localhost:11434' },
    { id:'s2', title:'Tidy docs', model:'openai/sonnet-4', category:'Writing', tools:['read'],
      up_bytes:4096, lan_up_bytes:512, down_bytes:1024, lan_down_bytes:1024 },
  ];
  const h = await boot({ data: { profiles: { p1: { live: ROWS, agents: [{ id:'a1' }],
                                                  recent_sessions: [{ id:'p9', title:'Parent run' }] } },
                                ollama: { ok:true } } });
  const err = renderErr(h.M);
  ok(benignStop(err), `renderLive: stops only at the imported-binding assignment (got ${err && err.message})`);
  const html = h.els.livelist.innerHTML;

  times(html, 'class="liverow', 2, 'renderLive: one row per live session');
  has(html, 'data-tsession="s1"', 'renderLive: row carries its session id for the drawer');
  has(html, 'data-tprofile="p1"', 'renderLive: row carries the profile it came from');
  has(html, 'title="Fix the parser — open transcript"', 'renderLive: transcript button tooltip');
  has(html, '>Fix the parser</button>', 'renderLive: the title is the button label');
  has(html, 'title="Fix the parser — view timeline"', 'renderLive: timeline button tooltip');
  has(html, 'data-title="Fix the parser"', 'renderLive: timeline button carries the title');
  has(html, 'title="Coding"', 'renderLive: the category tooltip is escaped');
  has(html, 'color:#22c55e', 'renderLive: category colour comes from catOf');
  has(html, '>Coding</span>', 'renderLive: the category label is rendered');
  has(html, 'title="opus-4"', 'renderLive: the model badge shows the SHORT model name');
  has(html, 'style="color:#abc123"', 'renderLive: the model badge colour comes from colorOf');
  eq(h.logs.colorOf, ['opus-4','sonnet-4'], 'renderLive: colorOf is fed exactly the short model name');
  has(html, '>editing</div>', 'renderLive: the phase line is rendered');
  has(html, '30s ago', 'renderLive: idle age rendered through ago()');
  has(html, '>patch</span>', 'renderLive: tool chips rendered');
  has(html, '>read</span>', 'renderLive: every tool chip rendered');
  has(html, 'hsl(42 62% 30%)', 'renderLive: the profile badge is tinted with profileHue');
  eq(h.logs.profileHue, ['p1','p1','p1'], 'renderLive: profileHue is asked once per colour slot it fills');
  eq(h.logs.loeIcon.map(x => x[1].label), ['Fix the parser','Tidy docs'], 'renderLive: loeIcon gets a stable per-session label');
  eq([h.logs.bwRow, h.logs.modelsBadge, h.logs.modelsPanel], [['s1','s2'],['s1','s2'],['s1','s2']],
     'renderLive: bwRow/modelsBadge/modelsPanel are called for every row');
  eq(h.logs.provOf, [['', 'openai/opus-4', 'http://localhost:11434'], ['', 'openai/sonnet-4', undefined]],
     'renderLive: the provider badge is decided from the model and base_url');
  eq([h.logs.renderOllama.length, h.logs.renderQueue.length, h.logs.renderAgents.length], [1,1,1],
     'renderLive: the Ollama, queue and agents cards are each refreshed once');
  eq(h.logs.renderAgents[0], [{ id:'a1' }], 'renderLive: the agents panel receives the live agents');

  // rows with no phase / untitled / a fallback model / more tools than fit
  const h2 = await boot({ data: { profiles: { p1: { live: [
    { id:'x', title:'(untitled)', model:'m', switched:true, init_model:'openai/glm' },
    { id:'y', model:'m', kind:'subagent', tools:['a','b','c','d','e','f','g'] },
  ] } } } });
  ok(benignStop(renderErr(h2.M)), 'renderLive: the fallback rows also stop only at the import assignment');
  const h2h = h2.els.livelist.innerHTML;
  has(h2h, '>—</div>', 'renderLive: a missing phase renders as an em dash');
  has(h2h, '↳ subagent', 'renderLive: a subagent row is marked as one');
  has(h2h, '↯ from glm', 'renderLive: a switched session names the SHORT model it fell back from');
  has(h2h, 'title="router fell back from glm"', 'renderLive: the fallback tooltip uses the short name');
  eq(h2.logs.loeIcon.map(x => x[1].label), ['session load','session load'], 'renderLive: absent/untitled titles fall back to "session load"');
  times(h2h, 'rounded" style="background:#20242e;color:#8b93a7"', 5, 'renderLive: at most five tool chips are drawn');
  has(h2h, '>e</span>', 'renderLive: ...keeping the first five');
  lacks(h2h, '>f</span>', 'renderLive: ...and dropping the rest');
  lacks(h2h, 'NaN', 'renderLive: a session with no idle_s never renders NaN (#138)');
  has(h2h, 'muted text-[length:var(--fs-xs)]">—</div>', 'renderLive: ...it shows an em dash instead (#138)');

  // dedupe
  const hd = await boot({ data: { profiles: { p1: { live: [ { id:'dup', title:'first' }, { id:'dup', title:'second' } ] } } } });
  renderErr(hd.M);
  times(hd.els.livelist.innerHTML, 'class="liverow', 1, 'renderLive: duplicate session ids collapse to one row');
  has(hd.els.livelist.innerHTML, 'first', 'renderLive: the first occurrence wins');
  const hn = await boot({ data: { profiles: { p1: { live: [ { title:'a' }, { title:'b' } ] } } } });
  renderErr(hn.M);
  times(hn.els.livelist.innerHTML, 'class="liverow', 1, 'renderLive: rows without an id dedupe on the undefined key too');

  // empty states
  const he = await boot({ data: { profiles: { p1: { live: [] } } } });
  renderErr(he.M);
  eq(he.logs.emptyHTML, ['○', 'Nothing running right now.', 'Start an agent run and it will appear here within a few seconds.'],
     'renderLive: the empty state copy');
  has(he.els.livelist.innerHTML, '<empty>○|Nothing running right now.', 'renderLive: the empty state is what gets painted');
  const hp = await boot({ data: { profiles: {} } });
  renderErr(hp.M);
  has(hp.els.livelist.innerHTML, 'Nothing running right now.', 'renderLive: an unknown current profile renders the empty state');
  eq(hp.logs.renderAgents, [undefined], 'renderLive: ...with no agents to show');

  // without #livelist it must bow out before the fan-out strip and the snapshot
  const hm = await boot({ missing: ['livelist'], data: { profiles: { p1: { live: [ { id:'a', parent:'p' } ] } } } });
  eq(renderErr(hm.M), null, 'renderLive: without #livelist it returns cleanly');
  eq(hm.els.livebw.innerHTML, '', 'renderLive: ...and paints nothing into the bandwidth heading');
  eq([hm.logs.renderOllama.length, hm.logs.renderQueue.length], [1,1], 'renderLive: ...but still refreshes the Ollama and queue cards');
}

// ── renderLive: fan-out strip ────────────────────────────────────────────────
{
  const h = await boot({ data: { profiles: { p1: { live: [ { id:'a', parent:'p9' }, { id:'b', parent:'p9' }, { id:'c', parent:'p9' } ],
                                                recent_sessions: [{ id:'p9', title:'Parent run' }] } } } });
  renderErr(h.M);
  has(h.els.livefanout.innerHTML, 'Parent run → 3 running', 'fanout: the chip names the parent and how many children are running');
  has(h.els.livefanout.innerHTML, 'data-tsession="p9"', 'fanout: the chip links to the parent session');
  has(h.els.livefanout.innerHTML, 'data-tprofile="p1"', 'fanout: the chip carries the profile');
  eq(h.els.livefanout.hidden, false, 'fanout: the strip is shown when a parent has 2+ children');

  const one = await boot({ data: { profiles: { p1: { live: [ { id:'a', parent:'p9' } ] } } } });
  renderErr(one.M);
  eq([one.els.livefanout.innerHTML, one.els.livefanout.hidden], ['', true], 'fanout: a lone child is not a fan-out and the strip stays hidden');

  const inl = await boot({ data: { profiles: { p1: { live: [ { id:'p9', title:'In-list parent' }, { id:'a', parent:'p9' }, { id:'b', parent:'p9' } ] } } } });
  renderErr(inl.M);
  has(inl.els.livefanout.innerHTML, 'In-list parent → 2 running', 'fanout: the parent title is taken from the live list when the parent is itself running');

  const gone = await boot({ data: { profiles: { p1: { live: [ { id:'a', parent:'gone' }, { id:'b', parent:'gone' } ] } } } });
  renderErr(gone.M);
  has(gone.els.livefanout.innerHTML, 'gone → 2 running', 'fanout: an unknown parent falls back to its session id');
}

// ── renderLive: bandwidth heading ────────────────────────────────────────────
{
  const h = await boot({ data: { profiles: { p1: { live: [
    { id:'s1', up_bytes:1024, down_bytes:2048 },
    { id:'s2', up_bytes:4096, lan_up_bytes:512, down_bytes:1024, lan_down_bytes:1024 },
  ] } } } });
  renderErr(h.M);
  has(h.els.livebw.innerHTML, '&uarr;</span> 5.50 KB', 'bandwidth: the heading sums up_bytes + lan_up_bytes across live rows');
  has(h.els.livebw.innerHTML, '&darr;</span> 4.00 KB', 'bandwidth: ...and down_bytes + lan_down_bytes');

  const z = await boot({ data: { profiles: { p1: { live: [ { id:'s1' } ] } } } });
  renderErr(z.M);
  eq(z.els.livebw.innerHTML, '', 'bandwidth: zero traffic renders nothing rather than "0 B"');

  const s = await boot({ data: { profiles: { p1: { live: [ { id:'s1', up_bytes:'2048', lan_up_bytes:'x' } ] } } } });
  renderErr(s.M);
  has(s.els.livebw.innerHTML, '&uarr;</span> 2.00 KB', 'bandwidth: byte fields are coerced with +, and a non-numeric field falls back to 0');
}

// ── renderLive: escaping of user text (titles are untrusted DB text) ─────────
{
  const dirty = '<img src=x onerror=alert(1)> & "quoted"';
  const h = await boot({ data: { profiles: { p1: { live: [
    { id:'e1', title: dirty, category:'<b>cat</b>', tools:['<i>tool</i>'], model:'vendor/<script>' },
  ] } } } });
  renderErr(h.M);
  const html = h.els.livelist.innerHTML;
  has(html, PAL.esc(dirty), 'escaping: the session title is rendered HTML-escaped');
  lacks(html, '<img src=x', 'escaping: no raw tag from the title survives');
  has(html, PAL.esc('<b>cat</b>'), 'escaping: the category tooltip is escaped');
  // #137: every field is escaped — text with esc, attributes with escA.
  lacks(html, '<b>cat</b>', 'escaping: the category label is escaped (#137)');
  lacks(html, '<i>tool</i>', 'escaping: tool chip labels are escaped (#137)');
  has(html, '&lt;script&gt;', 'escaping: the model name is escaped (#137)');
  lacks(html, 'title="<script>"', 'escaping: markup in a model id never lands raw in a title attribute (#137)');

  // A double quote in a title, id or model must not close the attribute.
  const q = await boot({ data: { profiles: { p1: { live: [ { id:'q1', title:'x" onmouseover="alert(1)' } ] } } } });
  renderErr(q.M);
  ok(noHandler(q.els.livelist.innerHTML),
      'escaping: a quote in the session title cannot inject an attribute (#137)');
  has(q.els.livelist.innerHTML, 'x&quot; onmouseover=&quot;alert(1) — open transcript"',
      'escaping: the quote in the title tooltip is encoded as &quot; (#137)');
  const qi = await boot({ data: { profiles: { p1: { live: [ { id:'z" onclick="alert(1)', title:'t' } ] } } } });
  renderErr(qi.M);
  ok(noHandler(qi.els.livelist.innerHTML), 'escaping: a quote in the session id cannot inject an attribute (#137)');
  const mq = await boot({ data: { profiles: { p1: { live: [ { id:'m1', model:'vendor/x" onmouseover="alert(1)' } ] } } } });
  renderErr(mq.M);
  ok(noHandler(mq.els.livelist.innerHTML),
      'escaping: a quote in the model id cannot inject an attribute (#137)');
}

// ── checkCompletions ─────────────────────────────────────────────────────────
// It takes the PROFILES map (pollLive passes `fresh.profiles`), not the payload,
// and it schedules through the ambient setTimeout — so every call runs with the
// harness globals installed, otherwise the real Node timer is used.
{
  const ended = (id, reason) => ({ p1: { recent_ended: [{ id, end_reason: reason }] } });
  const cc = (h, payload) => h.run(() => h.M.checkCompletions(payload));
  const h = await boot();
  h.timers.length = 0;
  eq(await cc(h, ended('e1','clean')), false, 'checkCompletions: the first poll after load is a silent baseline');
  eq([...h.M.seenEnded], ['e1'], 'checkCompletions: ...but the baseline still records what it saw');
  eq([h.timers.length, h.M.soundBaseline], [0, true], 'checkCompletions: the baseline plays nothing and is cleared by pollLive, not here');

  h.win.soundBaseline = false;
  eq(await cc(h, ended('e2','clean')), true, 'checkCompletions: a new completion is reported');
  eq([h.timers.length, h.M.pendingKind], [1, 'success'], 'checkCompletions: ...and queues exactly one success tone');
  eq(await cc(h, ended('e2','clean')), false, 'checkCompletions: the same session never sounds twice');
  eq(h.timers.length, 1, 'checkCompletions: ...and does not re-queue');
  await cc(h, ended('e3','orphan_reap'));
  eq(h.M.pendingKind, 'fail', 'checkCompletions: an orphan_reap end escalates the tone to failure');
  await cc(h, ended('e4','ERROR: boom'));
  eq(h.M.pendingKind, 'fail', 'checkCompletions: the failure match is case-insensitive');
  eq([await cc(h, ended('e1','clean')), h.M.seenEnded.size], [false, 4],
     'checkCompletions: ids from the baseline poll are still known afterwards');

  const d = await boot();
  d.win.soundBaseline = false;
  const deleg = (id, s) => ({ p1: { recent_delegations: [{ id, state:s }] } });
  d.timers.length = 0;
  eq(await cc(d, deleg('d1','done')), true, 'checkCompletions: a finished delegation is a completion');
  eq([d.M.pendingKind, d.timers.length], ['success', 1], 'checkCompletions: a delegation that finished is one success tone');
  await d.run(() => d.timers[0].fn());
  eq(await cc(d, deleg('d2','error')), true, 'checkCompletions: an errored delegation is a completion');
  eq([d.M.pendingKind, d.timers.length], ['fail', 2], 'checkCompletions: ...and escalates to failure');
  eq([...d.M.seenDeleg], ['d1','d2'], 'checkCompletions: delegations are remembered by id');
  await d.run(() => d.timers[1].fn());
  eq(await cc(d, deleg('d2','error')), false, 'checkCompletions: an already-seen delegation is not reported again');
  eq(d.timers.length, 2, 'checkCompletions: ...and queues nothing');

  const st = await boot();
  st.win.soundBaseline = false;
  st.timers.length = 0;
  await cc(st, { p1: { recent_delegations: [{ id:'r1', state:'running' }] } });
  eq(st.M.pendingKind, null, 'checkCompletions: a delegation still running is not announced (#138)');
  eq(st.M.seenDeleg.has('r1'), false, 'checkCompletions: ...nor remembered, so its real completion still chimes (#138)');
  const ni = await boot();
  ni.win.soundBaseline = false;
  eq([await cc(ni, { p1: { recent_delegations: [{ state:'done' }, { state:'done' }] } }), ni.M.seenDeleg.size],
     [true, 2], 'checkCompletions: id-less delegations get distinct keys, so neither is dropped (#138)');

  const off = await boot();
  off.win.soundBaseline = false;
  eq([await cc(off, ended('x','clean')), off.M.soundOn], [true, false],
     'checkCompletions: completions are reported even with the sound switched off');
  ok(catches(() => off.M.checkCompletions()), 'checkCompletions: a missing argument throws (it is not defensive)');
}

// ── playTone / ensureAudioCtx ────────────────────────────────────────────────
{
  const h = await boot();
  await h.run(() => h.M.playTone('success'));
  eq([h.audio.ctxs.length, h.audio.notes.length], [0, 0], 'playTone: silent while sound is off');

  h.win.soundOn = true;
  await h.run(() => h.M.playTone('success'));
  eq(h.audio.notes.map(n => n.frequency.value), [880, 1174.66], 'playTone: success is a rising two-note chime');
  eq(h.audio.notes.map(n => n.type), ['sine','sine'], 'playTone: sine oscillators');
  eq(h.audio.notes.map(n => n.started), [[0],[0.09]], 'playTone: the second note starts 90ms after the first');
  eq(h.audio.notes.map(n => n.stopped), [[0.16],[0.25]], 'playTone: each note lasts 160ms');
  eq(h.audio.gains[0].gain.set, [[0,0]], 'playTone: the gain starts at 0 (no click)');
  eq(h.audio.gains[0].gain.lin, [[0.06,0.015]], 'playTone: ...ramps to 0.06 in 15ms');
  eq(h.audio.gains[0].gain.exp, [[0.0001,0.14]], 'playTone: ...then decays exponentially by 140ms');

  await h.run(() => h.M.playTone('fail'));
  eq(h.audio.notes.slice(2).map(n => n.frequency.value), [220], 'playTone: failure is a single low note');
  await h.run(() => h.M.ensureAudioCtx());
  await h.run(() => h.M.ensureAudioCtx());
  eq(h.audio.ctxs.length, 1, 'ensureAudioCtx: the context is created once and reused');

  const sus = await boot({ ctxState:'suspended' });
  sus.win.soundOn = true;
  await sus.run(() => sus.M.playTone('success'));
  eq(sus.audio.ctxs[0].resumes, 1, 'ensureAudioCtx: a suspended context is resumed on use');
}

// ── scheduleTone: debounce and escalation ────────────────────────────────────
{
  const h = await boot();
  h.win.soundOn = true;
  h.timers.length = 0;
  await h.run(() => h.M.scheduleTone('success'));
  eq([h.timers.length, h.timers[0].ms], [1, 0], 'scheduleTone: the first tone is queued with no wait');
  await h.run(() => h.M.scheduleTone('fail'));
  eq(h.timers.length, 1, 'scheduleTone: a second call inside the window does not queue a second timer');
  eq(h.M.pendingKind, 'fail', 'scheduleTone: a failure escalates the already-queued kind');
  await h.run(() => h.timers[0].fn());
  eq(h.audio.notes.map(n => n.frequency.value), [220], 'scheduleTone: the queued play uses the escalated kind');
  eq([h.M.pendingKind, h.M.soundTimerPending], [null, false], 'scheduleTone: the queue is reset after playing');
  ok(h.M.soundDebounceUntil > Date.now() - 1000, 'scheduleTone: playing stamps the debounce window');

  h.timers.length = 0;
  await h.run(() => h.M.scheduleTone('success'));
  eq(h.timers.length, 1, 'scheduleTone: a later completion is queued again');
  ok(h.timers[0].ms > 0 && h.timers[0].ms <= 2000, `scheduleTone: ...but not before the 2s window elapses (${h.timers[0].ms}ms)`);
  eq(h.M.pendingKind, 'success', 'scheduleTone: ...with the new kind');
}

// ── soundToggleInstall ───────────────────────────────────────────────────────
{
  const on = await boot({ storage: { 'lt-sound': '1' } });
  eq([on.M.soundOn, on.els.soundtoggle._attrs['aria-pressed'], on.els.soundtoggle.innerHTML, on.els.soundtoggle.classList.contains('on')],
     [true, 'true', '&#128266;', true], 'soundToggleInstall: a remembered choice paints the button as on');

  const d = await boot({});
  eq([d.M.soundOn, d.els.soundtoggle._attrs['aria-pressed'], d.els.soundtoggle.innerHTML, d.els.soundtoggle.classList.contains('on')],
     [false, 'false', '&#128263;', false], 'soundToggleInstall: sound is off by default');

  const s = await boot({});
  s.win.soundBaseline = false;
  eq(s.M.soundBaseline, false, 'window.soundBaseline: the accessor writes through to the module binding');
  await s.run(() => s.els.soundtoggle.fire('click'));
  eq([s.M.soundOn, s.store._m['lt-sound'], s.els.soundtoggle._attrs['aria-pressed'], s.audio.notes.length],
     [true, '1', 'true', 2], 'soundToggleInstall: clicking turns sound on, remembers it, repaints and chimes');
  await s.run(() => s.els.soundtoggle.fire('click'));
  eq([s.M.soundOn, s.store._m['lt-sound'], s.els.soundtoggle._attrs['aria-pressed'], s.audio.notes.length],
     [false, '0', 'false', 2], 'soundToggleInstall: clicking again turns it off, remembers it and stays silent');

  const n = await boot({ missing: ['soundtoggle'] });
  eq(typeof n.win.soundOn, 'undefined', 'soundToggleInstall: with no button it does not touch window at all');
}

// ── scheduleLivePoll / scheduleRebuild ───────────────────────────────────────
{
  const h = await boot({ responses: { 'live-data.json': { body: { profiles: {} } } } });
  h.timers.length = 0;
  await h.run(() => h.M.scheduleLivePoll());
  eq([h.timers.length, h.timers[0].ms], [1, 5000], 'scheduleLivePoll: arms one timer at LIVE_MS');
  eq(h.M.liveTimer, h.timers[0].id, 'scheduleLivePoll: publishes the handle as liveTimer');
  h.doc.hidden = true;
  await h.run(() => h.timers[0].fn());
  eq([h.logs.fetch.length, h.timers.length, h.timers[1].ms], [0, 2, 5000],
     'scheduleLivePoll: a hidden document does not poll, but the next tick is still armed');
  h.doc.hidden = false;
  h.logs.fetch.length = 0;
  h.timers.length = 0;
  await h.run(() => h.M.scheduleLivePoll());
  await h.run(() => h.timers[0].fn());
  eq(h.logs.fetch.map(f => f.name), ['live-data.json'], 'scheduleLivePoll: a visible document polls live data');

  const r = await boot({ responses: { 'analytics-data.json': { body: {} } } });
  r.timers.length = 0;
  await r.run(() => r.M.scheduleRebuild());
  eq([r.timers.length, r.timers[0].ms], [1, 60000], 'scheduleRebuild: arms one timer at REBUILD_MS');
  eq(r.M.rebuildTimer, r.timers[0].id, 'scheduleRebuild: publishes the handle as rebuildTimer');
  r.doc.hidden = true;
  await r.run(() => r.timers[0].fn());
  eq(r.logs.fetch.length, 0, 'scheduleRebuild: skipped while the document is hidden');
  r.doc.hidden = false;
  r.timers.length = 0;
  await r.run(() => r.M.scheduleRebuild());
  await r.run(() => r.timers[0].fn());
  await sleep(0);
  eq(r.logs.fetch.map(f => f.name), ['analytics-data.json'], 'scheduleRebuild: a visible document refreshes analytics');
  eq(r.els.refresh.style.opacity, '', 'scheduleRebuild: the silent refresh never dims the refresh button');
}

// ── pollLive ─────────────────────────────────────────────────────────────────
{
  const LIVE = [ { id:'s1', title:'t' } ];
  const p1 = { live: LIVE, active: 1, tools_recent: ['patch'], logs: [{ id:'l1' }], agents: [{ id:'a2' }], recent_ended: [] };
  const body = { profiles: { p1 }, errors: [{ e:1 }], ollama: { ok:false } };

  const hid = await boot({ data: { profiles: { p1: { live: 'old' } } }, responses: { 'live-data.json': { body } } });
  await hid.run(() => hid.M.pollLive());
  eq(hid.logs.fetch.length, 0, 'pollLive: a hidden document does not poll');

  const h = await boot({ data: { profiles: { p1: { live: 'old' } } }, responses: { 'live-data.json': { body } } });
  h.doc.hidden = false;
  await h.run(() => h.M.pollLive());
  ok(h.data.profiles.p1.live === LIVE, 'pollLive: the live array is swapped in by reference');
  eq([h.data.profiles.p1.active, h.data.profiles.p1.agents, h.data.profiles.p1.logs],
     [1, [{ id:'a2' }], [{ id:'l1' }]], 'pollLive: the rest of the profile payload is swapped too');
  eq([h.data.errors, h.data.ollama], [[{ e:1 }], { ok:false }], 'pollLive: errors and the Ollama card are replaced');
  eq([h.logs.fetch[0].url.startsWith('live-data.json?t='), h.logs.fetch[0].opts.cache], [true, 'no-store'],
     'pollLive: the url is cache-busted and the request is uncached');
  eq([h.M.liveBusy, h.els.livestamp.textContent], [false, ''], 'pollLive: the busy flag is released and no stall is stamped');

  const un = await boot({ data: { profiles: { p1: { live: [] } } }, responses: { 'live-data.json': { body: { profiles: { p2: { live: [{ id:'x' }] } } } } } });
  un.doc.hidden = false;
  await un.run(() => un.M.pollLive());
  eq(Object.keys(un.data.profiles), ['p1'], 'pollLive: a profile the page has never seen is ignored');

  const sb = await boot({ data: { profiles: { p1: { live: 'old' } } }, schemaBad: 'schema 2 != 3',
                         responses: { 'live-data.json': { body } } });
  sb.doc.hidden = false;
  await sb.run(() => sb.M.pollLive());
  eq(sb.els.livestamp.textContent, 'live feed stalled — schema 2 != 3', 'pollLive: a schema problem stalls the feed on the FIRST bad poll');
  eq([sb.data.profiles.p1.live, sb.logs.schemaProblem], ['old', ['live-data.json']],
     'pollLive: ...and nothing is merged in; the check is told which payload it looked at');

  const hf = await boot({ data: { profiles: { p1: { live: [] } } }, responses: { 'live-data.json': { http: 500 } } });
  hf.doc.hidden = false;
  await hf.run(() => hf.M.pollLive());
  eq(hf.els.livestamp.textContent, '', 'pollLive: one failed poll is tolerated silently');
  await hf.run(() => hf.M.pollLive());
  eq(hf.els.livestamp.textContent, '', 'pollLive: two failed polls is still quiet');
  await hf.run(() => hf.M.pollLive());
  eq(hf.els.livestamp.textContent, 'live feed stalled — HTTP 500', 'pollLive: the third consecutive failure stalls the feed');

  const he = await boot({ data: { profiles: { p1: { live: [] } } }, responses: {} });
  he.doc.hidden = false;
  await he.run(() => he.M.pollLive());
  eq(he.els.livestamp.textContent, '', 'pollLive: a payload with no profiles is one quiet failure, not a stall');

  const hc = await boot({ data: { profiles: { p1: { live: [] } } }, responses: { 'live-data.json': 'defer' } });
  hc.doc.hidden = false;
  const inflight = hc.run(() => hc.M.pollLive());
  await hc.run(() => hc.M.pollLive());
  eq([hc.logs.fetch.length, hc.M.liveBusy], [1, true], 'pollLive: a second poll while one is in flight is dropped');
  hc.logs.deferred[0].res({ ok:true, status:200, json: async () => ({ profiles: {} }) });
  await inflight;
  eq(hc.M.liveBusy, false, 'pollLive: the busy flag is released when the in-flight poll settles');

  const ht = await boot({ data: { profiles: { p1: { live: [] } } },
                          responses: { 'live-data.json': { body: { profiles: { p1: { live: [], recent_ended: [{ id:'c1', end_reason:'clean' }] } } } } } });
  ht.doc.hidden = false;
  await ht.run(() => ht.M.pollLive());
  eq([ht.M.soundBaseline, [...ht.M.seenEnded]], [false, ['c1']], 'pollLive: the first successful poll records the baseline and clears it');
  ht.timers.length = 0;
  ht.responses['live-data.json'] = { body: { profiles: { p1: { live: [], recent_ended: [{ id:'c2', end_reason:'error' }] } } } };
  await ht.run(() => ht.M.pollLive());
  eq([ht.M.pendingKind, ht.timers.length], ['fail', 1], 'pollLive: a completion arriving after the first poll sounds once');
}

// ── doRefresh ────────────────────────────────────────────────────────────────
{
  const busy = await boot({ responses: { 'analytics-data.json': { body: { profiles: { p1: {} } } } } });
  busy.els.refresh.dataset.busy = '1';
  await busy.run(() => busy.M.doRefresh(false));
  eq([busy.logs.fetch.length, busy.els.refresh.dataset.busy], [0, '1'],
     'doRefresh: a refresh already running is not started twice, and its own busy flag is left alone');

  const idle = await boot({ responses: { 'analytics-data.json': 'defer' } });
  const running = idle.run(() => idle.M.doRefresh(false));
  eq([idle.els.refresh.dataset.busy, idle.els.refresh.style.opacity], ['1', '.5'], 'doRefresh: a foreground refresh marks the button busy and dims it');
  idle.logs.deferred[0].res({ ok:true, status:200, json: async () => ({ profiles: {} }) });
  await running;
  eq([idle.els.refresh.dataset.busy, idle.els.refresh.style.opacity], ['', ''], 'doRefresh: ...and releases both in finally');

  const silent = await boot({ responses: { 'analytics-data.json': 'defer' } });
  const srun = silent.run(() => silent.M.doRefresh(true));
  eq([silent.els.refresh.dataset.busy, silent.els.refresh.style.opacity], ['1', undefined],
     'doRefresh: a silent refresh marks the button busy but never dims it');
  silent.logs.deferred[0].res({ ok:false, status:500, json: async () => ({}) });
  await srun;
  eq(silent.els.meta.textContent, 'refresh failed: HTTP 500 — showing last good data', 'doRefresh: an HTTP failure is reported in the meta line');

  const net = await boot({ responses: { 'analytics-data.json': 'throw' } });
  await net.run(() => net.M.doRefresh(false));
  eq(net.els.meta.textContent, 'refresh failed: network down — showing last good data', 'doRefresh: a thrown fetch is reported the same way');

  const sch = await boot({ schemaBad: 'schema 2 != 3', responses: { 'analytics-data.json': { body: { profiles: { p1: {} } } } } });
  await sch.run(() => sch.M.doRefresh(false));
  eq([sch.logs.showSchemaError, sch.els.meta.textContent],
     [['schema 2 != 3'], 'refresh failed: schema 2 != 3 — showing last good data'],
     'doRefresh: a schema problem is handed to showSchemaError and reported');

  const emp = await boot({ responses: {} });
  await emp.run(() => emp.M.doRefresh(false));
  eq([emp.els.meta.textContent, emp.logs.fetch[0].name, emp.els.refresh.dataset.busy],
     ['refresh failed: empty payload — showing last good data', 'analytics-data.json', ''],
     'doRefresh: an empty payload is reported and the button is released');

  const nf = await boot({ missing: ['from'], responses: { 'analytics-data.json': { body: { profiles: { p1: {} } } } } });
  await nf.run(() => nf.M.doRefresh(false));
  has(nf.els.meta.textContent, 'refresh failed: Cannot read properties of null', 'doRefresh: the date-input reads are unguarded, so a missing #from fails the refresh');

  const okPath = await boot({ responses: { 'analytics-data.json': { body: { profiles: { p1: {} } } } } });
  await okPath.run(() => okPath.M.doRefresh(false));
  eq(okPath.els.meta.textContent, 'refresh failed: Assignment to constant variable. — showing last good data',
     'doRefresh: a good payload still stops at the imported-binding assignment (see the harness note)');
}

// ── load-time wiring ─────────────────────────────────────────────────────────
{
  const h = await boot({ data: { profiles: { p1: { repo_branch: { name:'main' } } } },
                         responses: { 'live-data.json': { body: { profiles: {} } }, 'analytics-data.json': { body: {} } } });
  eq(h.logs.installs, ['installDrawer','installTranscriptModal','installSessionFinder','installTimelineModal',
                       'installProjectDrilldown','installHelp','installProjWeight','installProjFilter','installSesstree',
                       'settingsInstall','intervalsInstall'],
     'load: every installer runs once, in the declared order');
  eq([typeof h.els.refresh.onclick, h.logs.visibility.length, h.M.liveTimer, h.M.rebuildTimer],
     ['function', 2, 1, 2], 'load: the refresh button is wired, both visibility listeners are attached, and both timers are held');

  await h.run(() => h.els.refresh.onclick());
  await sleep(0);
  eq([h.logs.fetch.length, h.logs.fetch[0].name], [1, 'analytics-data.json'], 'load: clicking refresh triggers a foreground refresh');

  h.logs.fetch.length = 0;
  h.doc.hidden = false;
  await h.run(() => h.logs.visibility[0]());
  eq(h.logs.fetch.map(f => f.name), ['live-data.json'], 'load: becoming visible polls live data');
  await h.run(() => h.logs.visibility[1]());
  eq(h.logs.fetch.map(f => f.name), ['live-data.json','analytics-data.json'], 'load: ...and kicks off an analytics refresh');

  const hit = { target: { closest: sel => sel === '[data-repokey]' ? { dataset: { repokey:'feat/x' } } : null } };
  eq(h.expanded.size, 0, 'load: repo rows start collapsed');
  h.els.repolist.fire('click', hit);
  eq([...h.expanded], ['feat/x'], 'load: clicking a repo row expands it');
  eq(h.logs.repoBranch.length, 1, 'load: ...and repaints the branch list');
  h.els.repolist.fire('click', hit);
  eq([...h.expanded, h.logs.repoBranch.length], [2], 'load: clicking again collapses it and repaints once more');
  h.els.repolist.fire('click', { target: { closest: () => null } });
  eq(h.logs.repoBranch.length, 2, 'load: a click that hits no repo row does nothing');
}

console.log(`unit_live: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
