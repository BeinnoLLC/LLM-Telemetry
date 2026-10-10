/**
 * unit_flow.mjs — #30: isolated unit tests for src/llm_telemetry/web/js/flow.js.
 *
 * flow.js is loaded ON ITS OWN through tests/lib/isolate.mjs, so every sibling
 * import ($ / ago / esc / short / colorOf / hashHue, DATA / css, provOf /
 * render / PROV, current, profileHue) is a stub and only
 * flow.js's own code runs. That is what lets the aggregation, the formatting
 * and the queue reconciliation be checked directly, with hand-built inputs and
 * exact expected values, instead of through the built dashboard page.
 *
 * The stubs in `harness()` are faithful copies of palette.js's helpers (lines
 * 160-163 and 239) — this suite exercises how flow.js USES them, so they have
 * to behave like the real thing. DOM is a hand-rolled fake element: enough
 * surface for the modules (className, classList, dataset, createElement,
 * querySelector, addEventListener) and nothing more.
 *
 * Negative controls: set FLOW_UNIT_FILE to the ABSOLUTE path of a mutated copy
 * of flow.js and the whole suite runs against that copy instead. Every check
 * below must then fail on the deliberate bug it covers.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { isolate, JS_DIR } from './lib/isolate.mjs';

const TARGET = process.env.FLOW_UNIT_FILE
  ? (path.isAbsolute(process.env.FLOW_UNIT_FILE)
    ? path.relative(JS_DIR, process.env.FLOW_UNIT_FILE)
    : process.env.FLOW_UNIT_FILE)
  : 'flow.js';

let pass = 0, fail = 0;
function show(v){
  try { return JSON.stringify(v, (k, x) => (k === 'parentNode' ? undefined : x)); }
  catch { return String(v); }
}
function eq(actual, expected, msg){
  try { assert.deepEqual(actual, expected); pass++; }
  catch {
    fail++;
    console.error(`FAIL ${msg}\n  expected: ${show(expected)}\n  actual:   ${show(actual)}`);
  }
}
const ok = (cond, msg) => eq(!!cond, true, msg);
function throws(fn, msg){
  try { fn(); eq('no throw', 'throw', msg); } catch { pass++; }
}

// ── faithful copies of palette.js's helpers (not under test here) ───────────
const short = m => m == null ? '' : String(m).split('/').pop();
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// attribute names of every tag, parsed with quoted values skipped — an
// injected handler shows up as a real attribute name, encoded text does not.
const attrNames = html => [...String(html).matchAll(/<[a-z][^\s>]*((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*\/?>/gi)]
  .flatMap(m => [...m[1].matchAll(/\s+([^\s=>]+)(?:="[^"]*")?/g)].map(a => a[1].toLowerCase()));
const noHandler = html => !attrNames(html).some(n => n.startsWith('on'));
const escA = s => esc(s).replace(/"/g, '&quot;');
const ago = s => s < 60 ? s + 's' : s < 3600 ? Math.round(s / 60) + 'm' : Math.round(s / 3600) + 'h';

// ── a fake element with just enough DOM surface ─────────────────────────────
function matches(c, sel){
  const m = /^([a-zA-Z]*)(\.[\w-]+)?(?:\[([\w-]+)\])?$/.exec(sel);
  if (!m) return false;
  const [, tag, cls, attr] = m;
  if (tag && c.tagName !== tag) return false;
  if (cls && !String(c.className).split(/\s+/).includes(cls.slice(1))) return false;
  if (attr){
    const key = attr.replace(/^data-/, '').replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    if (c.dataset[key] === undefined) return false;
  }
  return true;
}
function fakeEl(tag = 'div'){
  const el = {
    tagName: tag, children: [], parentNode: null, isConnected: true,
    textContent: '', innerHTML: '', className: '', dataset: {}, attrs: {},
    _ls: {}, _rect: null,
    get firstChild(){ return el.children[0] || null; },
    appendChild(c){ c.parentNode = el; c.isConnected = true; el.children.push(c); return c; },
    insertBefore(c, ref){
      c.parentNode = el; c.isConnected = true;
      const i = ref ? el.children.indexOf(ref) : -1;
      if (i < 0) el.children.unshift(c); else el.children.splice(i, 0, c);
      return c;
    },
    remove(){
      const p = el.parentNode;
      if (p){ const i = p.children.indexOf(el); if (i >= 0) p.children.splice(i, 1); }
      el.parentNode = null; el.isConnected = false;
    },
    setAttribute(k, v){ el.attrs[k] = String(v); },
    getAttribute(k){ return k in el.attrs ? el.attrs[k] : null; },
    addEventListener(t, f){ (el._ls[t] ||= []).push(f); },
    fire(t, ev){ (el._ls[t] || []).slice().forEach(f => f(ev || {})); },
    getBoundingClientRect(){ return el._rect || { left: 0, top: 0, width: 0, height: 0 }; },
    setPointerCapture(){}, releasePointerCapture(){},
    querySelector(sel){ return el.children.find(c => matches(c, sel)) || null; },
    querySelectorAll(sel){ return el.children.filter(c => matches(c, sel)); },
  };
  el.style = { setProperty(k, v){ el.style[k] = v; } };
  const cls = new Set();
  el.classList = {
    add: (...c) => { c.forEach(x => cls.add(x)); },
    remove: (...c) => { c.forEach(x => cls.delete(x)); },
    contains: c => cls.has(c),
    toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : !!f; if (on) cls.add(c); else cls.delete(c); return on; },
  };
  return el;
}
globalThis.document = {
  createElement: t => fakeEl(t),
  createElementNS: (_ns, t) => fakeEl(t),
  getElementById: () => null,
};

// ── stubs + recorders, one set per isolate() ───────────────────────────────
function harness(els = {}){
  const ids = new Map(Object.entries(els));
  const rec = { render: 0 };
  const DATA = { profiles: {}, ollama: { hosts: [] } };
  const stubs = {
    'palette.js': {
      $: id => ids.get(id) || null,
      ago, esc, escA, short,
      colorOf: m => 'col:' + m,
      hashHue: m => 'mh:' + m,
    },
    'charts.js': { current: 'p1' },
    'views.js': {
      PROV: { fireworks: { fg: '#ff8a3d' }, nous: { fg: '#7c9cff' } },
      provOf: (p, _m, u) => String(u || '').includes('fireworks') ? 'fireworks' : (p || 'local'),
      render: () => { rec.render++; },
    },
    'router.js': { profileHue: p => 'hue:' + p },
    'main.js': { DATA, css: v => `var(${v})` },
  };
  return { ids, rec, DATA, stubs };
}

// Canonical traffic: 3 providers, 3 models, 5 tasks, 2410 calls, $15.26.
const ROWS = () => ([
  { provider: 'fireworks', model: 'accounts/fireworks/models/kimi-k3-very-long-names', base_url: 'https://api.fireworks.ai/v1', task: 'main', calls: 2000, market_value_usd: 12 },
  { provider: 'fireworks', model: 'accounts/fireworks/models/kimi-k3-very-long-names', base_url: 'https://api.fireworks.ai/v1', task: 'patch', calls: 100, market_value_usd: 0.25 },
  { provider: 'anthropic', model: 'claude-sonnet-5', base_url: 'https://api.anthropic.com', task: 'main', calls: 300, market_value_usd: 3 },
  { provider: 'anthropic', model: 'claude-sonnet-5', base_url: 'https://api.anthropic.com', task: 'idle', calls: 0, market_value_usd: 0 },
  { provider: 'tiny', model: 'tiny-model', base_url: '', calls: 10, market_value_usd: 0.01 },
]);

// ═══ flowData — aggregation, grouping, cost ════════════════════════════════
{
  const h = harness();
  const D = await isolate(TARGET, h.stubs);
  const root = D.flowData(ROWS());

  eq(D.flowDepth, 3, 'flowData: default depth is provider>model>task');
  eq([root.id, root.kind, root.name], ['root', 'root', 'all traffic'], 'flowData: root identity');
  eq(root.calls, 2410, 'flowData: calls summed across every row');
  eq(root.cost.toFixed(2), '15.26', 'flowData: cost summed from market_value_usd');
  eq(root.kids.map(p => p.name), ['fireworks', 'anthropic', 'tiny'], 'flowData: providers biggest-first');

  const fw = root.kids[0];
  eq([fw.id, fw.kind], ['p:fireworks', 'prov'], 'flowData: provider id/kind');
  eq([fw.calls, fw.cost], [2100, 12.25], 'flowData: provider calls/cost');
  eq(root.kids[1].calls, 300, 'flowData: second provider calls');
  eq(root.kids[2].calls, 10, 'flowData: smallest provider last');

  const mk = fw.kids[0];
  eq([mk.id, mk.kind, mk.name], ['p:fireworks|m:kimi-k3-very-long-names', 'model', 'kimi-k3-very-long-names'],
    'flowData: model node keyed on the SHORT model name');
  eq([mk.calls, mk.cost], [2100, 12.25], 'flowData: model calls/cost rolled up');
  eq(mk.kids?.map(t => t.name), ['main', 'patch'], 'flowData: tasks biggest-first');
  eq(mk.kids?.map(t => t.calls), [2000, 100], 'flowData: task calls');
  eq(mk.kids?.[0]?.id, 'p:fireworks|m:kimi-k3-very-long-names|t:main', 'flowData: task id');
  eq(mk.kids?.[0]?.cost, 12, 'flowData: task cost');
  eq(mk.kids?.[1]?.cost, 0.25, 'flowData: fractional task cost survives');

  // A row with no task lands in the synthetic "main" bucket (r.task || 'main').
  eq(root.kids[2]?.kids[0]?.kids.map(t => t.name), ['main'], 'flowData: missing task defaults to main');
  // A zero-call task is kept, not dropped.
  eq(root.kids[1]?.kids[0]?.kids.map(t => t.name), ['main', 'idle'], 'flowData: zero-call task kept');
  eq(root.kids[1]?.kids[0]?.kids?.[1]?.calls, 0, 'flowData: zero-call task calls');

  // Rows sharing provider+model+task merge into ONE node.
  const merged = D.flowData([
    { provider: 'p', model: 'm', task: 't', calls: 2, market_value_usd: 1 },
    { provider: 'p', model: 'm', task: 't', calls: 3, market_value_usd: 2 },
  ]);
  eq(merged.kids.length, 1, 'flowData: one provider node per provider');
  eq(merged.kids[0].kids.length, 1, 'flowData: one model node per model');
  eq(merged.kids[0]?.kids[0]?.kids?.length, 1, 'flowData: equal tasks merge into one node');
  eq(merged.kids[0].kids[0].kids[0].calls, 5, 'flowData: merged task calls added');

  // Equal calls keep insertion order (stable sort) — the layout must not shuffle.
  const tie = D.flowData([
    { provider: 'b', model: 'm', task: 'x', calls: 1, market_value_usd: 0 },
    { provider: 'a', model: 'm', task: 'x', calls: 1, market_value_usd: 0 },
  ]);
  eq(tie.kids.map(p => p.name), ['b', 'a'], 'flowData: equal-size providers keep first-seen order');

  // Cost comes from market_value_usd only.
  const noPrice = D.flowData([{ provider: 'p', model: 'm', calls: 5, cost: 99 }]);
  eq(noPrice.cost, 0, 'flowData: cost ignores a legacy "cost" field');
  eq(noPrice.calls, 5, 'flowData: calls without a price still counted');

  // Documented edges: missing calls poisons the sum; null rows throw.
  const noCalls = D.flowData([{ provider: 'p', model: 'm', task: 't', market_value_usd: 1 }]);
  ok(Number.isNaN(noCalls.calls), 'flowData: a row with no "calls" yields NaN (no coercion)');
  eq(D.flowData([]).kids.length, 0, 'flowData: empty rows -> root with no kids');
  eq(D.flowData([]).calls, 0, 'flowData: empty rows -> zero calls');
  throws(() => D.flowData(null), 'flowData: null rows throws (renderFlow guards it)');

  // Very large numbers do not overflow or get stringified.
  const big = D.flowData([{ provider: 'p', model: 'm', task: 't', calls: 1e9, market_value_usd: 1e9 }]);
  eq(big.calls, 1e9, 'flowData: 1e9 calls');
  eq(big.cost, 1e9, 'flowData: 1e9 cost');
  eq(typeof big.calls, 'number', 'flowData: calls stays numeric');
}

// ═══ flowFlatten — nodes/links, depths, parents ════════════════════════════
{
  const h = harness();
  const D = await isolate(TARGET, h.stubs);
  const root = D.flowData(ROWS());
  const { nodes, links } = D.flowFlatten(root);

  eq(nodes.length, 12, 'flatten: 1 root + 3 providers + 3 models + 5 tasks');
  eq(links.length, 11, 'flatten: one link per non-root node');
  eq(nodes[0], root, 'flatten: root is visited first');
  eq(nodes.map(n => n.depth), [0, 1, 2, 3, 3, 1, 2, 3, 3, 1, 2, 3], 'flatten: depth per level');
  eq(nodes.map(n => n.name), [
    'all traffic', 'fireworks', 'kimi-k3-very-long-names', 'main', 'patch',
    'anthropic', 'claude-sonnet-5', 'main', 'idle', 'tiny', 'tiny-model', 'main',
  ], 'flatten: depth-first walk order');
  eq(links[0]?.s, root, 'flatten: first link starts at the root');
  eq(links[0]?.t, root.kids[0], 'flatten: first link ends at the biggest provider');
  eq(links[1]?.t, root.kids[0]?.kids[0], 'flatten: model link ends at its model node');
  eq(links[2]?.s?.name, 'kimi-k3-very-long-names', 'flatten: task link starts at the model node');
  ok(links.every(l => l.t.depth === l.s.depth + 1), 'flatten: every link spans exactly one level');
  ok(nodes.every(n => Number.isInteger(n.depth)), 'flatten: depths are integers');

  const lonely = { id: 'root', name: 'all traffic', kind: 'root', calls: 0, cost: 0 };
  eq(D.flowFlatten(lonely), { nodes: [lonely], links: [] }, 'flatten: a node with no kids yields one node');

  const wide = { id: 'r', name: 'r', kind: 'root', calls: 7, kids: [] };
  for (let i = 0; i < 200; i++) wide.kids.push({ id: 'p' + i, name: 'p' + i, kind: 'prov', calls: i, kids: [] });
  const w = D.flowFlatten(wide);
  eq(w.nodes.length, 201, 'flatten: 200 children -> 201 nodes');
  eq(w.links.length, 200, 'flatten: 200 children -> 200 links');
  eq(w.nodes[200]?.depth, 1, 'flatten: last child is at depth 1');
}

// ═══ flowSessions — the full-model-id lookup ═══════════════════════════════
{
  const h = harness();
  const D = await isolate(TARGET, h.stubs);
  const NS = {
    'fm1\tmain': [{ id: 's1', title: 'Alpha', calls: 3 }, { id: 's2', title: 'Beta', calls: 5 }],
    'fm1\tpatch': [{ id: 's2', title: 'Beta', calls: 2 }, { id: 's3', title: 'Gamma', calls: 9 }],
    'fm2\tmain': [{ id: 's1', title: 'ALPHA-DUP', calls: 4 }],
    'fm2\tpatch': [{ id: 's4', title: 'Delta', calls: 1 }, { id: 's5', title: 'Eps', calls: 1 }, { id: 's6', title: 'Zeta', calls: 1 }],
  };
  h.DATA.profiles.p1 = { node_sessions: NS };
  const snapshot = JSON.stringify(NS);

  const task = D.flowSessions({ kind: 'task', name: 'main', fullModels: ['fm1'] });
  eq(task.map(c => c.id), ['s2', 's1'], 'sessions: task chats sorted by calls desc');
  eq(task.map(c => c.calls), [5, 3], 'sessions: task chat calls');
  eq(task[0]?.title, 'Beta', 'sessions: chat title carried through');

  // Two full ids collapsing to one short name (the case the comment promises).
  const union = D.flowSessions({ kind: 'task', name: 'main', fullModels: ['fm1', 'fm2'] });
  eq(union.map(c => c.id), ['s1', 's2'], 'sessions: union across short-name collisions');
  eq(union[0]?.calls, 7, 'sessions: same chat id summed across full model ids (3+4)');
  eq(union[0]?.title, 'Alpha', 'sessions: title comes from the first key seen');

  const model = D.flowSessions({ kind: 'model', fullModels: ['fm1', 'fm2'], kids: [{ name: 'main' }, { name: 'patch' }] });
  eq(model.length, 4, 'sessions: model node capped at 4 chats');
  eq(model.map(c => c.id), ['s3', 's1', 's2', 's4'], 'sessions: model chats merged and sorted');
  eq(model[0]?.calls, 9, 'sessions: biggest chat first');

  eq(D.flowSessions({ kind: 'root', name: 'all traffic' }), [], 'sessions: root has no chats');
  eq(D.flowSessions({ kind: 'prov', name: 'fireworks' }), [], 'sessions: provider has no chats');
  eq(D.flowSessions({ kind: 'task', name: 'main' }), [], 'sessions: task without fullModels -> none');
  eq(D.flowSessions({ kind: 'model', fullModels: ['fm1'], kids: [{ name: 'nope' }] }), [], 'sessions: unknown key -> none');
  eq(D.flowSessions({ kind: 'task', name: 'main', fullModels: ['absent'] }), [], 'sessions: only unknown full ids -> none');
  eq(D.flowSessions({ kind: 'task', name: 'main', fullModels: ['fm1', 'absent'] }).map(c => c.id), ['s2', 's1'],
    'sessions: an unknown full id next to a known one contributes nothing');
  eq(JSON.stringify(NS), snapshot, 'sessions: node_sessions is not mutated');

  const h2 = harness();
  const D2 = await isolate(TARGET, h2.stubs);
  eq(D2.flowSessions({ kind: 'task', name: 'main', fullModels: ['fm1'] }), [], 'sessions: profile with no node_sessions -> none');
}

// ═══ flowColor — root / provider / model / task ════════════════════════════
{
  const h = harness();
  const D = await isolate(TARGET, h.stubs);
  eq(D.flowColor({ kind: 'root', name: 'all traffic' }), 'var(--accent)', 'color: root uses the accent');
  eq(D.flowColor({ kind: 'prov', name: 'fireworks' }), '#ff8a3d', 'color: provider uses PROV fg');
  eq(D.flowColor({ kind: 'prov', name: 'nous' }), '#7c9cff', 'color: second provider fg');
  eq(D.flowColor({ kind: 'prov', name: 'unknown' }), 'var(--accent)', 'color: unknown provider falls back');
  eq(D.flowColor({ kind: 'model', name: 'kimi-k3' }), 'col:kimi-k3', 'color: model uses colorOf');
  eq(D.flowColor({ kind: 'task', name: 'patch', parentModel: 'kimi-k3' }), 'col:kimi-k3', 'color: task inherits the model hue');
  eq(D.flowColor({ kind: 'task', name: 'patch' }), 'col:patch', 'color: task without a model uses its own name');
}

// ═══ renderQueue / paintTrain — the railway (the only queue view since the
// queued/running/done lanes were removed) ═══════════════════════════════════
const railEls = () => ({
  qtrain: fakeEl(), 'qt-queued': fakeEl(), 'qt-running': fakeEl(), 'qt-done': fakeEl(),
  'qt-signal': fakeEl(), qsub: fakeEl(), 'qt-n-queued': fakeEl(), 'qt-n-running': fakeEl(), 'qt-n-done': fakeEl(),
});
const cars = box => box.children.filter(c => c.dataset && c.dataset.key && !c.classList.contains('qt-leaving'));
const allCars = box => box.children.filter(c => c.dataset && c.dataset.key);
const consistOf = h => h.ids.get('qt-running').querySelector('.qt-consist');
const lblOf = c => c.querySelector('.qt-lbl').textContent;
{
  const h = harness();
  const D = await isolate(TARGET, h.stubs);
  D.renderQueue();
  eq(h.ids.size, 0, 'queue: returns quietly when the railway is not on the page');
}
{
  const h = harness(railEls());
  const D = await isolate(TARGET, h.stubs);
  h.DATA.profiles.p1 = { live: [], recent_sessions: [] };
  h.DATA.ollama.hosts = [{ label: 'gpu-a', queue: 3 }, { label: 'gpu-b', queue: 0 }];
  D.renderQueue();
  const qb = h.ids.get('qt-queued');
  eq(cars(qb).map(c => c.dataset.key), ['q:gpu-a:0', 'q:gpu-a:1', 'q:gpu-a:2'], 'depot: one car per waiting slot, keyed by host and index');
  eq(cars(qb).map(lblOf), ['gpu-a', 'gpu-a', 'gpu-a'], 'depot: car label is the host');
  eq(cars(qb).map(c => c.style['--i']), [0, 1, 2], 'depot: cars carry a stagger index');
  eq(h.ids.get('qt-n-queued').textContent, '3', 'depot: count shows the real depth');
  eq(h.ids.get('qsub').textContent, 'backed up on gpu-a', 'depot: subtitle names the busy host');
  ok(h.ids.get('qtrain').classList.contains('backed'), 'depot: the train is flagged backed up');
  eq(h.ids.get('qt-signal').title, '3 waiting', 'depot: the signal says how many wait');
  eq(D.carTip(cars(qb)[1]._qt), '<div class="ft-h">Waiting on gpu-a</div><div class="ft-r"><span>position</span><b>2 of 3</b></div><div class="ft-r"><span>state</span><b>queued at the Ollama host</b></div>',
    'depot: hover card gives host and position');
  ok(h.ids.get('qt-running').querySelector('.qt-patrol'), 'line: an empty line gets one patrol car');

  h.DATA.ollama.hosts = [{ label: 'h', queue: '2' }];
  D.renderQueue();
  eq(cars(qb).length, 2, 'depot: numeric string depth');
  h.DATA.ollama.hosts = [{ label: 'h', queue: '-2' }, { label: 'j', queue: 'abc' }, { label: 'k' }];
  D.renderQueue();
  eq(cars(qb).filter(c => !c.classList.contains('qt-leaving')).length, 0, 'depot: negative/garbage/missing depths clamp to zero');
  eq(h.ids.get('qt-n-queued').textContent, '0', 'depot: clamped count is zero');
  ok(!h.ids.get('qtrain').classList.contains('backed'), 'depot: no longer backed up');

  // Cap: display is capped (QT_CAP.q), the count is not.
  h.DATA.ollama.hosts = [{ label: 'big', queue: D.QT_CAP.q + 4 }];
  D.renderQueue();
  eq(cars(qb).filter(c => !c.classList.contains('qt-leaving')).length, D.QT_CAP.q, 'depot: cars capped at QT_CAP.q');
  eq(h.ids.get('qt-n-queued').textContent, String(D.QT_CAP.q + 4), 'depot: count ignores the cap');
  eq(qb.querySelector('.qt-more')?.textContent, '+4', 'depot: "+N" badge past the cap');
  D.renderQueue();
  eq(qb.querySelectorAll('.qt-more').length, 1, 'depot: the badge is not duplicated on the next poll');
  ok(D.QT_CAP.r >= 30 && D.QT_CAP.d >= 30, 'caps are generous enough for "as many trains as you want"');

  h.DATA.ollama.hosts = [{ label: 'a', queue: 0 }, { label: 'b', queue: 0 }];
  D.renderQueue();
  eq(h.ids.get('qsub').textContent, 'fleet clear · 2 hosts', 'subtitle: clear fleet, plural');
  h.DATA.ollama.hosts = [{ label: 'a', queue: 0 }];
  D.renderQueue();
  eq(h.ids.get('qsub').textContent, 'fleet clear · 1 host', 'subtitle: clear fleet, singular');
  h.DATA.ollama.hosts = [];
  D.renderQueue();
  eq(h.ids.get('qsub').textContent, '', 'subtitle: no hosts -> none');
  ok(h.ids.get('qtrain').classList.contains('clear'), 'nothing waiting or running -> clear');
  h.DATA.ollama.hosts = [{ label: 'a', queue: 1 }, { label: 'b', queue: 2 }];
  D.renderQueue();
  eq(h.ids.get('qsub').textContent, 'backed up on a, b', 'subtitle: every busy host is named');
}

// ═══ the line (running) and the yard (done) ═════════════════════════════════
{
  const h = harness(railEls());
  const D = await isolate(TARGET, h.stubs);
  h.DATA.profiles.p1 = {
    live: [
      { id: 'a', title: '(untitled)', model: 'accounts/fireworks/models/kimi-k3', idle_s: 30, profile: 'work',
        phase: 'receiving stream response', tools: ['t1', 't2'], nmodels: 3 },
      { id: 'b', title: 'Fix parser', model: 'm2', idle_s: 1 },
      { id: 'a', title: 'duplicate', model: 'other', idle_s: 0 },
    ],
    recent_sessions: [
      { id: 'd1', title: 'Old run', model: 'm', last_ts: 100, dur_s: 125, tokens: 1530, api_calls: 7 },
      { id: 'd2', title: '(untitled)', last_model: 'accounts/nous/x/y', last_ts: 300, dur_s: null },
      { id: 'd3', title: 'No duration', model: 'z', last_ts: 200, dur_s: -5 },
    ],
  };
  D.renderQueue();
  const run = cars(consistOf(h));
  eq(run.map(c => c.dataset.key), ['s:b', 's:a'], 'line: most recently active first, duplicate ids dropped');
  eq(run.map(lblOf), ['Fix parser', 'kimi-k3'], 'line: title as-is; (untitled) falls back to the short model');
  ok(run[0].classList.contains('qt-loco') && !run[1].classList.contains('qt-loco'), 'line: exactly the lead car is the locomotive');
  eq(run[1].style['--h'], 'hue:work', 'line: car hue comes from the profile');
  eq(run[0].attrs['aria-label'], 'running: Fix parser · m2', 'line: car has an accessible label');
  eq(h.ids.get('qt-n-running').textContent, '2', 'line: count');
  ok(h.ids.get('qtrain').classList.contains('moving'), 'line: the train is moving');
  eq(h.ids.get('qt-running').querySelector('.qt-patrol'), null, 'line: no patrol car once real cars run');
  eq(D.carTip(run[1]._qt),
    '<div class="ft-h">kimi-k3</div><div class="ft-r"><span>model</span><b>kimi-k3</b></div>'
    + '<div class="ft-r"><span>profile</span><b>work</b></div><div class="ft-r"><span>doing</span><b>receiving stream response</b></div>'
    + '<div class="ft-r"><span>last activity</span><b>30s ago</b></div><div class="ft-r"><span>tools used</span><b>2</b></div>'
    + '<div class="ft-r"><span>models seen</span><b>3</b></div>', 'line: hover card for a running session');

  const yard = cars(h.ids.get('qt-done'));
  eq(yard.map(c => c.dataset.key), ['s:d2', 's:d3', 's:d1'], 'yard: newest first');
  eq(yard.map(lblOf), ['y', 'No duration', 'Old run'], 'yard: (untitled) falls back to the short last_model');
  ok(yard[0].classList.contains('qt-newest') && !yard[1].classList.contains('qt-newest'), 'yard: only the newest arrival is highlighted');
  eq(h.ids.get('qt-n-done').textContent, '3', 'yard: count');
  ok(D.carTip(yard[2]._qt).includes('<span>ran for</span><b>2m</b>'), 'yard: hover card has the duration');
  ok(D.carTip(yard[2]._qt).includes('<span>tokens</span><b>1.5k</b>'), 'yard: hover card has tokens');
  ok(D.carTip(yard[2]._qt).includes('<span>API calls</span><b>7</b>'), 'yard: hover card has API calls');
  ok(!D.carTip(yard[0]._qt).includes('ran for'), 'yard: no duration -> no "ran for" row');
  ok(D.carTip(yard[1]._qt).includes('<span>ran for</span><b>0s</b>'), 'yard: negative duration clamps to zero');

  // No model at all: 'session', never "undefined" (#138).
  h.DATA.profiles.p1 = { live: [{ id: 'n', title: '(untitled)', idle_s: 0 }], recent_sessions: [] };
  D.renderQueue();
  const lone = cars(consistOf(h)).filter(c => !c.classList.contains('qt-leaving'));
  eq(lone.map(lblOf), ['session'], "line: no model at all falls back to 'session' (#138)");
  ok(!D.carTip(lone[0]._qt).includes('undefined'), 'line: and the hover card never says "undefined" (#138)');

  // Titles are escaped in the hover card.
  ok(!D.carTip({ kind: 'd', label: '<img src=x onerror=alert(1)>' }).includes('<img'), 'tip: titles are HTML-escaped');
}

// ═══ reuse across polls, departures, line -> yard ═══════════════════════════
{
  const h = harness(railEls());
  const D = await isolate(TARGET, h.stubs);
  h.DATA.profiles.p1 = { live: [], recent_sessions: [] };
  h.DATA.ollama.hosts = [{ label: 'g', queue: 3 }];
  D.renderQueue();
  const qb = h.ids.get('qt-queued');
  const first = cars(qb);
  eq(first.length, 3, 'reconcile: three depot cars on the first render');

  h.DATA.ollama.hosts = [{ label: 'g', queue: 1 }];
  h.DATA.profiles.p1 = { live: [{ id: 's1', title: 'Started', model: 'm', idle_s: 0 }], recent_sessions: [] };
  D.renderQueue();
  eq(cars(qb)[0], first[0], 'reconcile: the surviving depot car keeps its element identity');
  ok(first[1].classList.contains('qt-leaving') && first[2].classList.contains('qt-leaving'), 'reconcile: cars that vanished play the departure');
  ok(allCars(qb).includes(first[1]), 'reconcile: a departing car stays in the DOM until its animation ends');
  const runCar = cars(consistOf(h))[0];
  eq(runCar.dataset.key, 's:s1', 'reconcile: the started session is on the line');

  // An identical poll creates nothing and keeps every element.
  D.renderQueue();
  eq(cars(consistOf(h))[0], runCar, 'poll: an identical poll keeps the running car');
  eq(cars(qb)[0], first[0], 'poll: and the depot car');

  // Session ends: it leaves the line and parks in the yard under the same key.
  h.DATA.profiles.p1 = { live: [], recent_sessions: [{ id: 's1', title: 'Started', model: 'm', last_ts: 5, dur_s: 9 }] };
  D.renderQueue();
  ok(runCar.classList.contains('qt-leaving'), 'line -> yard: the running car departs the line');
  const parked = cars(h.ids.get('qt-done'));
  eq(parked.map(c => c.dataset.key), ['s:s1'], 'line -> yard: the same session is parked in the yard');
  eq(h.ids.get('qt-n-running').textContent, '0', 'line -> yard: running count drops to zero');
  const parkedEl = parked[0];
  D.renderQueue();
  eq(cars(h.ids.get('qt-done'))[0], parkedEl, 'poll: the parked car survives an identical poll');

  // Order changes re-sequence existing cars instead of recreating them.
  h.DATA.profiles.p1 = { live: [], recent_sessions: [
    { id: 'n2', title: 'Newer', model: 'm', last_ts: 9, dur_s: 1 },
    { id: 's1', title: 'Started', model: 'm', last_ts: 5, dur_s: 9 }] };
  D.renderQueue();
  eq(cars(h.ids.get('qt-done')).map(c => c.dataset.key), ['s:n2', 's:s1'], 'yard: a newer arrival parks in front');
  eq(cars(h.ids.get('qt-done'))[1], parkedEl, 'yard: the older car is moved, not recreated');
}
{
  // qtFly is a no-op without the Web Animations API / layout (and never throws).
  const h = harness(railEls());
  const D = await isolate(TARGET, h.stubs);
  eq(D.qtFly(null, null, null, 'x'), false, 'fly: nothing to fly -> false');
  eq(D.qtFly(fakeEl(), { left: 0, top: 0, width: 10, height: 10 }, fakeEl(), 'x'), false, 'fly: no element.animate -> false');
}

// ═══ renderAgents — escaping of collector-supplied strings ═════════════════
{
  const h = harness();
  const D = await isolate(TARGET, h.stubs);
  D.renderAgents([{ state: 'alive', backend: 'llama.cpp', host: 'gpu-a', pid: 1, profile: 'w', age_s: 1, leases: 1 }]);
  eq(h.ids.size, 0, 'agents: returns silently when the card is absent');
}
{
  const card = fakeEl('div'), list = fakeEl('div');
  const h = harness({ agentscard: card, agentslist: list });
  const D = await isolate(TARGET, h.stubs);

  card.hidden = false;
  D.renderAgents([]);
  eq(card.hidden, true, 'agents: an empty fleet hides the card');
  eq(list.innerHTML, '', 'agents: an empty fleet paints nothing');

  card.hidden = true;
  D.renderAgents([{ state: 'alive', backend: 'llama.cpp', host: 'gpu-a', pid: 4242, profile: 'work', age_s: 3600, leases: 2, kill_hint: 'pkill -f llama' }]);
  let html = list.innerHTML;
  eq(card.hidden, false, 'agents: a live fleet shows the card');
  ok(html.includes('background:#5f9e6e'), 'agents: alive dot colour');
  ok(html.includes('>alive<'), 'agents: state text');
  ok(html.includes('gpu-a · pid 4242 · work'), 'agents: host, pid and profile line');
  ok(html.includes('>1h ago<'), 'agents: age formatted by ago()');
  ok(html.includes('>2 leases<'), 'agents: lease count plural');
  ok(html.includes('<code') && html.includes('pkill -f llama'), 'agents: kill hint rendered when present');

  D.renderAgents([{ state: 'stale', backend: 'b', host: 'h', pid: 2, profile: 'p', age_s: 61, leases: 1 }]);
  html = list.innerHTML;
  ok(html.includes('background:#c4a06e'), 'agents: stale dot colour');
  ok(html.includes('>1 lease<'), 'agents: singular lease');
  ok(!html.includes('1 leases'), 'agents: no double plural');
  ok(html.includes('1m ago'), 'agents: 61s rounds to 1m');
  ok(!html.includes('<code'), 'agents: no kill hint element when there is none');

  D.renderAgents([{ state: 'dead', backend: 'b', host: 'h', pid: 3, profile: 'p', age_s: 5, leases: 0 }]);
  html = list.innerHTML;
  ok(html.includes('background:#c66a6a'), 'agents: dead dot colour');
  D.renderAgents([{ state: 'zombie', backend: 'b', host: 'h', pid: 4, profile: 'p', age_s: 5, leases: 0 }]);
  ok(list.innerHTML.includes('background:#64748b'), 'agents: an unknown state gets the neutral colour');

  // Host / backend / profile / kill_hint are escaped.
  D.renderAgents([{
    state: '<st>', backend: '<img src=x onerror=alert(1)>', host: '<b>h</b>',
    pid: 5, profile: '</span>', age_s: 1, leases: 1, kill_hint: '<script>',
  }]);
  html = list.innerHTML;
  ok(!html.includes('<img'), 'agents: a scripty backend cannot become a tag');
  ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'agents: backend HTML-escaped');
  ok(html.includes('&lt;b&gt;h&lt;/b&gt;'), 'agents: host HTML-escaped');
  ok(html.includes('&lt;/span&gt;'), 'agents: profile HTML-escaped');
  ok(html.includes('&lt;script&gt;'), 'agents: kill hint HTML-escaped');
  ok(html.includes('&lt;st&gt;'), 'agents: state HTML-escaped');

  // The backend goes into a title="..." attribute, so it is escaped with
  // escA: a quote in the data cannot break out of the attribute (#137).
  D.renderAgents([{ state: 'alive', backend: 'x" onmouseover="alert(1)', host: 'h', pid: 6, profile: 'p', age_s: 1, leases: 0 }]);
  ok(noHandler(list.innerHTML), 'agents: a quote in the backend cannot inject an attribute (#137)');
  ok(list.innerHTML.includes('x&quot; onmouseover=&quot;alert(1)'), 'agents: the quote in the backend is encoded as &quot; (#137)');

  const noList = harness({ agentscard: fakeEl('div') });
  const D2 = await isolate(TARGET, noList.stubs);
  throws(() => D2.renderAgents([{ state: 'alive', backend: 'b', host: 'h', pid: 7, profile: 'p', age_s: 1, leases: 0 }]),
    'agents: a missing agentslist throws (no guard)');
}

// ═══ renderFlow — layout, labels, tooltip, zoom ════════════════════════════
{
  const h = harness();
  const D = await isolate(TARGET, h.stubs);
  eq(D.renderFlow([{ provider: 'p', model: 'm', calls: 1, market_value_usd: 0 }]), undefined,
    'flow: returns silently when the svg is absent');
  eq(D.FLOWROWS, null, 'flow: FLOWROWS starts null');
}
{
  const svg = fakeEl('svg'); svg._rect = { left: 0, top: 0, width: 1100, height: 560 };
  const wrap = fakeEl('div'); wrap.clientWidth = 1100; wrap.clientHeight = 560;
  wrap._rect = { left: 0, top: 0, width: 1100, height: 560 };
  const sub = fakeEl('div'), tip = fakeEl('div');
  const h = harness({ flow: svg, flowwrap: wrap, flowsub: sub, flowtip: tip });
  const D = await isolate(TARGET, h.stubs);

  svg.innerHTML = 'stale';
  D.renderFlow([]);
  eq(svg.innerHTML, '', 'flow: no rows clears the svg');
  eq(sub.textContent, 'no data in this range', 'flow: no rows sets the empty subtitle');
  eq(D.FLOWROWS, null, 'flow: an empty render does not remember rows');
  D.renderFlow(null);
  eq(sub.textContent, 'no data in this range', 'flow: null rows is treated as empty');

  const rows = ROWS();
  svg.innerHTML = ''; svg.children.length = 0;
  D.renderFlow(rows);
  eq(D.FLOWROWS, rows, 'flow: the rows are remembered for a resize re-render');
  eq(svg.getAttribute('viewBox'), '0 0 1100 560', 'flow: viewBox sized from the wrapper');
  eq(svg.children.length, 2, 'flow: link layer and node layer');
  eq(svg.children.map(g => g.tagName), ['g', 'g'], 'flow: both layers are <g>');
  const gl = svg.children[0] || fakeEl('g'), gn = svg.children[1] || fakeEl('g');
  eq(gl.children.length, 11, 'flow: one path per link');
  eq(gn.children.length, 12, 'flow: one group per node');
  eq(gl.children[0]?.getAttribute('class'), 'lnk', 'flow: link class');
  eq(gl.children[0]?.getAttribute('stroke-width'), '4.67', 'flow: link width scales with the target size');
  eq(gl.children[8]?.getAttribute('stroke-width'), '0.60', 'flow: link width floors at 0.6');
  ok(gl.children[0]?.getAttribute('d')?.startsWith('M'), 'flow: link path data');

  const rootG = gn.children[0] || fakeEl('g'), fwG = gn.children[1] || fakeEl('g'), modelG = gn.children[2] || fakeEl('g'),
    mainG = gn.children[3] || fakeEl('g'), patchG = gn.children[4] || fakeEl('g');
  const circle = g => g.children[0] || fakeEl('circle');
  const labels = g => g.children.filter(c => c.tagName === 'text');
  const hits = g => g.children.find(c => c.tagName === 'circle' && c !== g.children[0]);

  eq(circle(rootG).getAttribute('r'), '26.0', 'flow: root radius is fixed');
  eq(circle(rootG).getAttribute('fill'), 'var(--accent)', 'flow: root fill');
  eq(circle(rootG).getAttribute('fill-opacity'), '.9', 'flow: root opacity');
  eq(rootG.style['--heat'], '1.000', 'flow: the biggest node is at full heat');
  eq(fwG.style['--glow'], '#ff8a3d', 'flow: the glow colour is the node colour');
  eq(circle(fwG).getAttribute('r'), '28.0', 'flow: provider radius scales by sqrt(calls)');
  eq(circle(fwG).getAttribute('fill'), '#ff8a3d', 'flow: provider fill from PROV');
  eq(circle(modelG).getAttribute('r'), '20.5', 'flow: model radius scale');
  ok(/^translate\(-?[\d.]+,-?[\d.]+\)$/.test(modelG.getAttribute('transform')), 'flow: nodes are translated, not absolutely positioned');
  eq(labels(modelG).map(t => t.textContent), ['kimi-k3-very-long-nam…'], 'flow: long names truncate at 21 chars + ellipsis');
  eq(circle(modelG).getAttribute('fill'), 'col:kimi-k3-very-long-names', 'flow: model fill from colorOf');
  eq(labels(mainG).map(t => t.textContent), ['main'], 'flow: task with a big enough radius keeps its label');
  eq(circle(mainG).getAttribute('fill-opacity'), '.55', 'flow: task nodes are dimmer');
  eq(circle(mainG).getAttribute('fill'), 'col:kimi-k3-very-long-names', 'flow: task inherits the model hue');
  eq(labels(patchG).length, 0, 'flow: a tiny task node stays bare');
  eq(circle(patchG).getAttribute('r'), '4.0', 'flow: task radius floors at 4');
  eq(hits(patchG)?.getAttribute('r'), '12.0', 'flow: hit area floors at 12 regardless of radius');
  eq(patchG.style['--heat'], '0.204', 'flow: heat is sqrt of the share, 3dp');
  eq(gn.children[8]?.style['--heat'], '0.000', 'flow: a zero-call node has zero heat');
  eq(sub.textContent, `3 providers · 3 models · 12 nodes · ${(2410).toLocaleString()} calls`, 'flow: subtitle counts');
  eq(typeof svg._flowZoom, 'function', 'flow: the svg exposes its zoom control');
  eq(typeof svg._flowFit, 'function', 'flow: the svg exposes its fit control');

  // Tooltip content: exact markup, derived from the node's own numbers.
  patchG.fire('mouseenter');
  eq(tip.innerHTML,
    '<div class="ft-h" style="color:col:kimi-k3-very-long-names">patch</div>' +
    '<div class="ft-r"><span>calls</span><b>100 (4.1%)</b></div>' +
    '<div class="ft-r"><span>est. cost</span><b>$0.25</b></div>',
    'flow: tooltip rows for a task node');
  ok(tip.classList.contains('on'), 'flow: the tooltip is shown on hover');
  ok(!tip.innerHTML.includes('ft-s'), 'flow: no chats section (fullModels is never set — see notes)');
  ok(/^-?[\d.]+px$/.test(tip.style.left) && /^-?[\d.]+px$/.test(tip.style.top), 'flow: tooltip is positioned in pixels');

  rootG.fire('mouseenter');
  ok(tip.innerHTML.includes(`<b>${(2410).toLocaleString()} (100.0%)</b>`), 'flow: root shows 100% of all calls');
  ok(tip.innerHTML.includes('<span>tasks</span><b>3</b>'), 'flow: the root counts its providers as "tasks"');
  fwG.fire('mouseenter');
  ok(tip.innerHTML.includes('<span>models</span><b>1</b>'), 'flow: a provider node counts its models');
  ok(tip.innerHTML.includes('<span>calls</span>'), 'flow: a provider tooltip keeps the calls row');
  ok(fwG.classList.contains('on'), 'flow: focusing a node marks it');
  fwG.fire('mouseleave');
  eq(tip.classList.contains('on'), false, 'flow: the tooltip hides on leave');
  eq(fwG.classList.contains('on'), false, 'flow: unfocusing clears the marks');

  // Zoom / fit maths.
  svg._flowZoom(1.4);
  eq(svg.getAttribute('viewBox'), '157.1 80.0 785.7 400.0', 'flow: zoom in around the centre');
  svg._flowFit();
  eq(svg.getAttribute('viewBox'), '0.0 0.0 1100.0 560.0', 'flow: fit restores the full canvas');
  for (let i = 0; i < 4; i++) svg._flowZoom(1 / 1.4);
  eq(svg.getAttribute('viewBox').split(' ').slice(2), ['3300.0', '1680.0'], 'flow: zoom out is clamped to 3x the canvas');
  ok(svg.classList.contains('zoomedout'), 'flow: zooming out past the canvas marks the svg');

  // A hostile model name is escaped in the tooltip header (#137) — n.name
  // comes from collector data.
  const nasty = 'x<img src=x onerror=alert(1)>';
  svg.children.length = 0;
  D.renderFlow([{ provider: 'p', model: nasty, base_url: '', task: 'main', calls: 5, market_value_usd: 1 }]);
  const gn2 = svg.children[1];
  const bad = gn2.children.find(g => g.children[0]?.getAttribute('fill') === 'col:' + nasty);
  ok(!!bad, 'flow: the hostile model name reaches the graph');
  if (bad) bad.fire('mouseenter');
  ok(!tip.innerHTML.includes('>' + nasty + '</div>'), 'flow: tooltip header escapes the model name (#137)');   // (the style colour is the colorOf stub echoing its input)
  ok(tip.innerHTML.includes('>' + esc(nasty) + '</div>'), 'flow: tooltip header shows the escaped model name (#137)');
  eq(labels(bad || fakeEl('g')).map(t => t.textContent)[0]?.endsWith('…'), true, 'flow: the hostile label is still truncated');
}

// ═══ flowControls — depth buttons, zoom, fit ═══════════════════════════════
{
  const h = harness();
  const D = await isolate(TARGET, h.stubs);
  D.flowControls();
  eq(h.rec.render, 0, 'controls: returns silently when the control box is absent');
}
{
  const svg = fakeEl('svg');
  const zoomed = [], fitted = [];
  svg._flowZoom = f => zoomed.push(f);
  svg._flowFit = () => fitted.push(1);
  const ctl = fakeEl('div');
  const fd2 = fakeEl('button'), fd3 = fakeEl('button');
  fd2.dataset.fd = '2'; fd3.dataset.fd = '3';
  const zout = fakeEl('button'), zin = fakeEl('button'), fit = fakeEl('button');
  zout.dataset.flowzoom = 'out'; zin.dataset.flowzoom = 'in'; fit.dataset.flowfit = '';
  ctl.children.push(fd2, fd3, zout, zin, fit);

  const h = harness({ flowctl: ctl, flow: svg });
  const D = await isolate(TARGET, h.stubs);
  D.flowControls();

  ok(ctl.innerHTML.includes('data-fd="2"') && ctl.innerHTML.includes('provider → model'), 'controls: depth 2 button');
  ok(ctl.innerHTML.includes('data-fd="3"') && ctl.innerHTML.includes('+ task'), 'controls: depth 3 button');
  ok(ctl.innerHTML.includes('data-flowzoom="out"'), 'controls: zoom out button');
  ok(ctl.innerHTML.includes('data-flowzoom="in"'), 'controls: zoom in button');
  ok(ctl.innerHTML.includes('data-flowfit'), 'controls: fit button');
  eq(ctl.dataset.wired, '1', 'controls: the box is marked wired');
  eq([fd2.classList.contains('on'), fd3.classList.contains('on')], [false, true], 'controls: the current depth is highlighted');

  fd2.fire('click');
  eq(D.flowDepth, 2, 'controls: clicking a depth button changes the module depth');
  eq([fd2.classList.contains('on'), fd3.classList.contains('on')], [true, false], 'controls: highlight follows the click');
  eq(h.rec.render, 1, 'controls: a depth change re-renders');
  const at2 = D.flowData(ROWS());
  eq(at2.kids[0]?.kids[0]?.kids?.length, 0, 'controls: depth 2 stops the tree at provider>model');
  eq(at2.calls, 2410, 'controls: depth 2 keeps the totals');
  fd3.fire('click');
  eq(D.flowDepth, 3, 'controls: switching back to depth 3');
  eq(D.flowData(ROWS()).kids[0]?.kids[0]?.kids?.length, 2, 'controls: depth 3 folds tasks back in');
  eq(h.rec.render, 2, 'controls: each depth click re-renders once');

  fit.fire('click');
  eq(fitted.length, 1, 'controls: fit calls the svg\u2019s fit control');
  zin.fire('click');
  zout.fire('click');
  eq(zoomed, [1.4, 1 / 1.4], 'controls: zoom buttons pass the right factors');

  // The buttons read $('flow') afresh on every click, so the control box keeps
  // working after renderFlow rebuilds the svg.
  const svg2 = fakeEl('svg');
  const zoomed2 = [];
  svg2._flowZoom = f => zoomed2.push(f);
  h.ids.set('flow', svg2);
  zin.fire('click');
  eq(zoomed2, [1.4], 'controls: zoom follows the svg that is current at click time');
  h.ids.delete('flow');
  zin.fire('click');
  eq(zoomed2, [1.4], 'controls: zoom with no svg on the page is a no-op');

  ctl.innerHTML = 'SENTINEL';
  D.flowControls();
  eq(ctl.innerHTML, 'SENTINEL', 'controls: wiring happens only once per box');
}

console.log(`unit_flow: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
