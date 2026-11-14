// LLMTELEMET-274 (H-7): Hive comms, events, replay, firing mode. Outcome regexes, VOCAB picking, resolve()/project() mapping,
// the 2-bubble cap, pending chip, replay stagger, the ?since polling fallback, and real-data-only (nothing animates without a frame).
const { JSDOM } = require('jsdom');
let p = 0, f = 0; const chk = (ok, l, x) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${!ok && x !== undefined ? ' — ' + JSON.stringify(x) : ''}`); ok ? p++ : f++; };

const dom = new JSDOM('<body><div id="hive-stage"><svg id="hive-svg"><g id="hive-edges"></g><g id="hive-nodes"></g></svg></div><div id="hive-clist"></div><span id="hive-ccount"></span><div id="hive-feed"><p id="hive-feedempty"></p></div><span id="hive-lastreal"></span><span id="hive-fresh"></span><span id="hive-pill"></span></body>', { pretendToBeVisual: true, url: 'http://127.0.0.1:8477/' });
const w = dom.window; Object.assign(globalThis, { document: w.document, window: w, getComputedStyle: () => ({ getPropertyValue: () => '#112233' }), localStorage: w.localStorage });
w.HTMLElement.prototype.getBoundingClientRect = function () { return { width: 1200, height: 800, top: 0, left: 0, right: 1200, bottom: 800 }; };
const fetched = []; let reply = null;
globalThis.fetch = async u => { fetched.push(String(u)); const r = reply(String(u)); return { ok: true, status: 200, json: async () => r }; };
const timers = []; const realST = globalThis.setTimeout; globalThis.setTimeout = (fn, ms) => { timers.push(ms); return realST(fn, ms); };

const mkCtx = () => { const n = () => ({ connect() {}, start() {}, stop() {}, gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, Q: {} });
  const c = { state: 'running', currentTime: 0, sampleRate: 8000, destination: {}, osc: 0, createGain: n, createBiquadFilter: n, createDynamicsCompressor: n, createBufferSource: n, createBuffer: (a, l) => ({ getChannelData: () => new Float32Array(l) }) }; c.createOscillator = () => { c.osc++; return n(); }; return c; };

const snap = { at: 1000, seq: 5, user: { state: 'idle' }, comms: [],
  families: [{ id: 'root', label: 'Beinno', assistant: { id: 'donna', label: 'Donna', idle: 5, sessions: 1, workers: [] }, bots: [{ id: 'beinno-github', idle: 5, sessions: 0, workers: [] }],
    brains: [{ id: 'llm-telemetry-brain', board: 'llm-telemetry', label: 'LLM Telemetry', idle: 9, sessions: 1, counts: { running: 1, blocked: 0, todo: 1, ready: 0, done: 3 }, workers: [], agents: [{ id: 'coder', idle: 4, tasks: [{ id: 't', title: 'T', status: 'running' }] }] }] },
  { id: 'acasia', label: 'Acasia', assistant: { id: 'jarvis', label: 'Jarvis', idle: 9000, sessions: 0, workers: [] }, bots: [], brains: [] }], unattributed: [] };

(async () => {
  const { isolate } = await import('./lib/isolate.mjs');
  const ctx = mkCtx();
  const H = await isolate('hive.js', {
    'palette.js': { $: id => document.getElementById(id), esc: s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]), ago: s => s < 90 ? 'just now' : Math.round(s / 60) + 'm' },
    'views.js': { provOf: () => 'cloud', provLogoSvg: () => '<svg class="x"></svg>' },
    'zoom.js': { attachZoom: () => ({}) },
    'live.js': { ensureAudioCtx: () => ctx },
  });
  const C = H.hvC, S = H.hvSnd;
  const RealDate = Date; globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [2026, 10, 14, 12, 0, 0])); } static now() { return RealDate.now(); } };   // never inside quiet hours

  // ---- outcome regexes (F32, F34-F37) ----
  const O = (kind, text, event) => H.hvOutcome({ kind, text, event });
  chk(O('reply', 'Merged and all green') === 'happy' && O('comment', 'build failed on CI') === 'angry', 'GOOD/BAD regexes classify reply + comment text');
  chk(O('reply', "can't reach it, timed out") === 'angry' && O('reply', 'working on it') === null && O('ask', 'it failed?') === null, 'BAD wins over GOOD; neutral and asks have no outcome');
  chk(['done', 'unblocked', 'blocked', 'gave_up', 'crashed', 'timed_out', 'spawned'].map(e => O('event', '', e)).join() === 'happy,happy,angry,angry,dizzy,dizzy,', 'event kinds map to happy/angry/dizzy/neutral');

  // ---- VOCAB picking (F32) ----
  const first = () => 0, last = () => .999;
  chk(H.hvCommLine({ kind: 'ask' }, first) === 'On it?' && H.hvCommLine({ kind: 'comment' }, last) === 'Checkpoint.', 'ask/comment lines come from their VOCAB lists');
  chk(H.HV_VOCAB.replyBad.includes(H.hvCommLine({ kind: 'reply', text: 'it failed' }, first)) && H.HV_VOCAB.replyGood.includes(H.hvCommLine({ kind: 'reply', text: 'merged' }, first)) && H.HV_VOCAB.reply.includes(H.hvCommLine({ kind: 'reply', text: 'ok' }, first)), 'reply picks replyBad / replyGood / reply by outcome');
  chk(H.HV_VOCAB.crashed.includes(H.hvCommLine({ kind: 'event', event: 'crashed' }, first)) && H.HV_VOCAB.comment.includes(H.hvCommLine({ kind: 'event', event: 'weird' }, first)), 'event lines by event name, unknown falls back to comment');

  // ---- resolve() / project() / who() (F43) ----
  const has = id => ['hazem', 'a:root', 'a:acasia', 'b:root:llm-telemetry-brain', 'b:root:beinno-github', 'g:root:llm-telemetry-brain:coder'].includes(id);
  chk(H.hvResolve('donna', null, snap, has) === 'a:root' && H.hvResolve('llm-telemetry-brain', null, snap, has) === 'b:root:llm-telemetry-brain' && H.hvResolve('beinno-github', null, snap, has) === 'b:root:beinno-github', 'profiles resolve to assistant / brain / bot nodes');
  chk(H.hvResolve('coder', 'llm-telemetry', snap, has) === 'g:root:llm-telemetry-brain:coder', 'an agent resolves through its board to the agent node');
  chk(H.hvResolve('acasia-foo', null, snap, has) === 'a:acasia' && H.hvResolve('pv-x', null, snap, has) === 'hazem' && H.hvResolve('stranger', null, snap, id => id === 'hazem') === 'hazem' && H.hvResolve('', null, snap, has) === null, 'family heuristics, then Hazem, then null');
  chk(H.hvResolve('cron', null, snap, has) === 'hazem', 'cron/system/hazem map to Hazem');
  chk(H.hvProject({ board: 'llm-telemetry' }, snap) === 'LLM Telemetry' && H.hvProject({ to: 'llm-telemetry-brain' }, snap) === 'LLM Telemetry' && H.hvProject({ board: 'my-new-board' }, snap) === 'My New Board' && H.hvProject({ from: 'x-brain' }, null) === 'X' && H.hvProject({ from: 'a' }, snap) === '', 'project() names the board/brain, else empty');
  const pm = H.hvPmap(snap);
  chk(H.hvWho('hazem', pm) === 'Hazem' && H.hvWho('cron', pm) === 'Cron' && H.hvWho('board', pm) === 'card' && H.hvWho('donna', pm, id => id === 'a:root' ? 'Donna' : '') === 'Donna' && H.hvWho('beinno-zed', pm) === 'zed', 'who() display names');

  // ---- render a real graph so bubbles / packets have nodes ----
  S.show = true; S.on = true; S.ctx = ctx; S.m = ctx.createGain(); H.hvState.view = 'all';
  H.hvRender(snap);
  const ids = Object.keys(H.hvState.nodes);
  chk(ids.includes('a:root') && !!document.getElementById('hive-bubbles') && !!document.getElementById('hive-pk'), 'render adds the bubble and packet layers');

  // ---- bubble cap (F31) ----
  for (let i = 0; i < 5; i++) H.hvBubble('a:root', 'message number ' + i + ' with a fairly long body that must wrap across lines nicely', 'via ' + i, 'root');
  const box = document.getElementById('hive-bubbles');
  chk(box.children.length === 2, 'never more than 2 bubbles; the 3rd evicts the oldest', box.children.length);
  chk(/via 4/.test(box.lastChild.textContent) && /via 3/.test(box.firstChild.textContent), 'the two newest remain');
  chk(H.hvBubble('nope', 'x', 'v', 'root') === null && H.hvBubble('a:root', '', 'v', 'root') === null, 'no node / no text: no bubble');
  chk(H.hvWrap('aaa bbb ccc ddd eee fff ggg hhh', 8, 2).length === 2 && /…$/.test(H.hvWrap('aaa bbb ccc ddd eee fff ggg hhh', 8, 2)[1]), 'wrap() caps lines and ellipsises');
  chk(timers.includes(5200), 'bubbles live 5.2 s');

  // ---- LLMTELEMET-275: bubble via cap + stage clamp, timer cleanup ----
  const longVia = 'replay · 10m ago · LLM TELEMETRY · Donna → llm-telemetry-brain · kanban · LST-123456789 ' + 'x'.repeat(200);
  box.innerHTML = ''; const bx = H.hvState.L.bounds;
  for (const [nid, px] of [['a:root', bx.x1 - 5], ['a:root', bx.x0 + 2]]) {
    const nn = H.hvState.nodes[nid], keep = nn.x; nn.x = px;
    const g = H.hvBubble(nid, 'hello there', longVia, 'root'), r = g.querySelector('rect'), x = +r.getAttribute('x'), wd = +r.getAttribute('width');
    chk(x >= bx.x0 - 1e-6 && x + wd <= bx.x1 + 1e-6, `bubble at node x=${px.toFixed(0)} stays inside the stage [${bx.x0.toFixed(0)}, ${bx.x1.toFixed(0)}]`, [x, wd]);
    chk(wd < 48 * 7.8 + 30 && [...g.querySelectorAll('text')].some(t => /…$/.test(t.textContent) && t.textContent.length <= 48), 'a very long via line is cut to ~48 chars with an ellipsis', wd);
    nn.x = keep; g.remove();
  }
  chk(H.hvClip('short', 48) === 'short' && H.hvClip('y'.repeat(60), 48).length === 48, 'hvClip leaves short text and caps long text at 48');
  {
    const was = C.bt.size; H.hvBubble('a:root', 'tmp', 'v', 'root'); const ft = C.ft;
    chk(C.bt.size === was + 1, 'a bubble registers its removal timer');
    C.fire = true; H.hvPlayComm({ id: 'ft1', at: 995, from: 'donna', to: 'llm-telemetry-brain', kind: 'ask', via: 'line', text: 'any update?' });
    chk(C.ft && C.ft !== ft, 'firing mode registers the 280 ms delay timer');
   
    H.hvStop(); S.show = true;
    chk(C.bt.size === 0, 'hvStop cancels bubble removal timers');
    // the cancelled delay never blasts: no bolt packet appears afterwards
    S.last = {}; await new Promise(r => realST(r, 350));
    chk(!('blast' in S.last), 'hvStop cancels the 280 ms firing delay (no blast afterwards)', Object.keys(S.last));
    C.fire = false; box.innerHTML = ''; document.getElementById('hive-pk').innerHTML = '';
  }

  // ---- every comm kind renders (F38) + pending chip ----
  const mk = (id, o) => ({ id, at: 1000 - 5, from: 'donna', to: 'llm-telemetry-brain', kind: 'ask', via: 'line', text: 'hello', ...o });
  const kinds = [mk('1'), mk('2', { kind: 'reply', text: 'merged it', from: 'llm-telemetry-brain', to: 'donna' }), mk('3', { kind: 'comment', to: 'board', board: 'llm-telemetry', via: 'kanban', task: 'LST-1', text: 'checkpoint' }),
    mk('4', { kind: 'event', event: 'blocked', to: 'llm-telemetry-brain', from: 'coder', board: 'llm-telemetry', via: 'kanban', text: 'stuck' }), mk('5', { pending: true, text: 'any news?' })];
  C.shown.clear(); C.log.length = 0; C.first = false;
  kinds.forEach(c => H.hvAddComm(c, false));
  const rows = [...document.querySelectorAll('#hive-clist > div')];
  chk(rows.length === 5, 'ask/reply/comment/event/pending all render a row', rows.length);
  chk(rows.some(r => r.classList.contains('pending') && /waiting reply/.test(r.textContent)) && rows.filter(r => /waiting reply/.test(r.textContent)).length === 1, 'pending comm shows the "waiting reply" chip, others do not');
  chk(rows.find(r => /merged it/.test(r.textContent)).classList.contains('good') && rows.find(r => /stuck/.test(r.textContent)).classList.contains('bad'), 'good/bad left border by outcome');
  chk(/LLM Telemetry/.test(rows[0].textContent) && /Donna/.test(rows[4].textContent) && /→/.test(rows[0].textContent) && /card/.test(rows.find(r => /checkpoint/.test(r.textContent)).textContent), 'from → to with project, via and kind tags; board target reads "card"');
  chk(document.getElementById('hive-ccount').textContent === '5 in 12 h', 'N in 12 h counter', document.getElementById('hive-ccount').textContent);
  chk(!H.hvAddComm(kinds[0], true) && C.log.length === 5, 'a comm id is never shown twice');
  for (let i = 0; i < 90; i++) H.hvAddComm(mk('x' + i), false);
  chk(document.querySelectorAll('#hive-clist > div').length === 80, 'the panel keeps an 80-row window');
  H.hvState.view = 'acasia'; C.pk = ''; H.hvPaintComms();
  chk(document.querySelectorAll('#hive-clist > div').length === 0, 'per-family view filtering hides other families');
  H.hvState.view = 'all'; C.pk = ''; H.hvPaintComms();

  // ---- each comm animates: bubble + mood + sound per outcome (F34-F37) ----
  const moodOf = id => H.hvState.nodes[id].temp, played = [];
  const lastN = () => Object.entries(S.last).filter(([, t]) => t >= t0).map(([n]) => n); let t0 = 0;
  H.hvState.a = 0; C.fire = false;
  const run = async (c, want) => { document.getElementById('hive-bubbles').innerHTML = ''; S.last = {}; t0 = Date.now() - 1; ids.forEach(i => { H.hvState.nodes[i].temp = null; }); const ok = H.hvPlayComm(c); for (let i = 0; i < 60 && !want(); i++) await new Promise(r => realST(r, 50)); return ok; };
    chk(await run(mk('h1', { kind: 'event', event: 'done', to: 'donna', from: 'llm-telemetry-brain', text: 'shipped' }), () => moodOf('a:root')) && moodOf('a:root') === 'happy' && 'done' in S.last, 'happy outcome: happy mood + done fanfare');
  chk(await run(mk('a1', { kind: 'event', event: 'blocked', from: 'coder', to: 'llm-telemetry-brain', board: 'llm-telemetry', text: 'x' }), () => /angry|fire/.test(moodOf('b:root:llm-telemetry-brain') || '')) && /angry|fire/.test(moodOf('b:root:llm-telemetry-brain') || '') && 'rage' in S.last, 'angry outcome: angry/fire mood + rage sound');
  chk(await run(mk('d1', { kind: 'event', event: 'crashed', from: 'coder', to: 'llm-telemetry-brain', board: 'llm-telemetry', text: 'x' }), () => moodOf('b:root:llm-telemetry-brain') === 'dizzy') && moodOf('b:root:llm-telemetry-brain') === 'dizzy' && 'dizzy' in S.last, 'dizzy outcome: dizzy mood + dizzy sound');
  chk(await run(mk('n1', { text: 'any update?' }), () => moodOf('b:root:llm-telemetry-brain') === 'wow') && moodOf('b:root:llm-telemetry-brain') === 'wow' && 'arrive' in S.last, 'neutral outcome (firing off): wow mood + arrive sound');
  C.fire = true; S.last = {};
  H.hvPlayComm(mk('n2', { text: 'any update?' }));
  chk(moodOf('a:root') === 'fire' && 'charge' in S.last, 'firing mode: sender charges (fire mood + charge sound) before the blast');
  C.fire = false;
  chk(H.hvPlayComm({ id: 'z', from: '', to: '', kind: 'ask', via: 'line', text: 'x', at: 1 }) === false, 'an unresolvable sender plays nothing');
  const via = H.hvVia(mk('v', { task: 'LST-9', via: 'kanban' }), { replay: true, now: 1000 + 600 - 5, project: 'LLM Telemetry', pm, lbl: id => id === 'a:root' ? 'Donna' : '' });
  chk(/^replay · 10m ago · LLM TELEMETRY · Donna → /.test(via) && /kanban · LST-9$/.test(via), 'via line: replay age, project, from → to, channel, task', via);

  // ---- task diffs: Hazem -> assistant -> brain -> agent (F40) ----
  const ev = { type: 'event', kind: 'status', family: 'root', brain: 'llm-telemetry-brain', agent: 'coder', board: 'LLM Telemetry', from: 'running', status: 'done', title: 'Port it', at: 1000 };
  chk(JSON.stringify(H.hvHops(ev, has).hops) === JSON.stringify([['hazem', 'a:root'], ['a:root', 'b:root:llm-telemetry-brain'], ['b:root:llm-telemetry-brain', 'g:root:llm-telemetry-brain:coder']]), 'task diff hops Hazem → assistant → brain → agent');
  chk(JSON.stringify(H.hvHops({ ...ev, brain: 'donna', agent: 'w1' }, has).hops) === JSON.stringify([['hazem', 'a:root']]), 'an assistant-owned worker collapses to Hazem → assistant');
  H.hvFeed(ev); H.hvFeed({ ...ev, kind: 'new', status: 'todo', worker: false });
  const fr = [...document.querySelectorAll('#hive-feed > div')];
  chk(fr.length === 2 && !document.getElementById('hive-feedempty') && /Donna/.test(fr[0].textContent) && /Port it/.test(fr[0].textContent) && /new task for/.test(fr[0].textContent) && /running → done/.test(fr[1].textContent), 'feed panel: per-family row, diff arrow, empty state removed');
  chk(H.hvPlayEvent(ev) === true && H.hvPlayEvent({ ...ev, family: 'ghost' }) === false, 'event choreography plays only for nodes on screen');

  // ---- replay: last 8, 1.5 s stagger, (F41) ----
  C.log.length = 0; for (let i = 0; i < 12; i++) C.log.push(mk('r' + i, { at: 900 + i }));
  timers.length = 0; const delays = H.hvReplay();
  chk(delays.length === 8 && delays.join() === [0, 1500, 3000, 4500, 6000, 7500, 9000, 10500].join(), 'replay re-plays the last 8 conversations 1.5 s apart', delays);
  C.log.length = 0;
  chk(H.hvReplay().length === 0, 'no history: nothing to replay');

  // ---- honest heartbeat (F42) ----
  chk(H.hvBeat([], 0, 2000).last === 'no messages yet' && H.hvBeat([], 0, 2000).fresh === '', 'heartbeat: no messages and no snapshot says so');
  const b = H.hvBeat([{ at: 1000 }, { at: 700 }], 1990, 2000);
  chk(b.fresh === 'checked 10s ago' && b.last === 'last real message: 17m ago', 'heartbeat: snapshot age + newest real message age', b);

  // ---- real data only (F45): snapshots animate only the comms that are new; the first one is a silent baseline ----
  C.shown.clear(); C.log.length = 0; C.first = true; C.seq = null; C.lastSnap = 0; document.getElementById('hive-bubbles').innerHTML = '';
  const old = mk('old1', { at: 100 }), fresh = mk('new1', { at: 1500, text: 'fresh news' });
  H.hvSnapshot({ ...snap, at: 1000, seq: 5, comms: [old] });
  chk(document.getElementById('hive-bubbles').children.length === 0 && C.first === false && C.seq === 5 && C.log.length === 1, 'first snapshot: baseline only, nothing animates, seq captured');
  H.hvSnapshot({ ...snap, at: 1003, comms: [old] });
  chk(document.getElementById('hive-bubbles').children.length === 0, 'a quiet snapshot invents no events (no phantom activity)');
  H.hvSnapshot({ ...snap, at: 1500, comms: [old, fresh] });
  chk(C.log.length === 2 && C.shown.has('new1'), 'a comm that arrives inside a later snapshot is logged and played');

  const rows0 = document.querySelectorAll('#hive-feed > div').length;
  chk(H.hvApply({ seq: 4, type: 'event', ...ev }) === false && document.querySelectorAll('#hive-feed > div').length === rows0, 'a frame with an already-seen seq is ignored');
  chk(H.hvApply({ seq: 6, type: 'event', ...ev }) === true && document.querySelectorAll('#hive-feed > div').length === rows0 + 1 && C.seq === 6, 'a new event frame feeds the panel and advances seq');
  chk(H.hvApply({ seq: 7, type: 'user', user: {} }) === true && H.hvApply({ seq: 8, type: 'comm', ...mk('frame1', { at: 1501 }) }) === true && C.shown.has('frame1'), 'user frames advance seq, comm frames log the comm');

  // ---- ?since polling fallback (no EventSource) ----
  H.hvState.es = null; C.seq = 8; fetched.length = 0;
  reply = u => /since=/.test(u) ? { type: 'delta', from: 8, to: 10, events: [{ seq: 9, type: 'event', ...ev, title: 'missed one' }, { seq: 10, type: 'comm', ...mk('poll1', { at: 1502 }) }] } : snap;
  await H.hvPoll();
  chk(fetched[0] === '/api/hive?since=8' && fetched[1] === '/api/hive', 'polling fallback asks /api/hive?since=<last seq> then the snapshot', fetched);
  chk(C.seq === 10 && C.shown.has('poll1') && /missed one/.test(document.getElementById('hive-feed').textContent), 'the missed frames are replayed exactly once');
  fetched.length = 0; reply = u => /since=/.test(u) ? { type: 'reset', snapshot: { ...snap, seq: 40, comms: [] } } : snap;
  await H.hvPoll();
  chk(C.seq === 40 && fetched.length === 2, 'a reset answer renders the fresh snapshot and re-bases seq', [C.seq, fetched]);
  fetched.length = 0; H.hvState.es = {}; await H.hvPoll();
  chk(fetched.length === 1 && fetched[0] === '/api/hive', 'with a live stream the poll is a plain snapshot refresh');

  // ---- stream delta poll debounce (one per second, first immediate) and 5 s retry ----
  {
    class ES { constructor(u) { ES.all.push(this); this.l = {}; this.u = u; } addEventListener(n, f) { this.l[n] = f; } close() { this.closed = true; } }
    ES.all = []; globalThis.EventSource = ES;
    H.hvState.es = null; H.hvState.timer = 1; C.pollAt = 0; C.seq = 100; fetched.length = 0; reply = u => snap;
    H.hvState.timer = null;
    H.hvConnect(); const es = ES.all[0]; clearInterval(H.hvState.timer);
    const n0 = () => fetched.filter(u => u === '/api/hive').length, base = n0();
    const d = seq => es.l.delta({ data: JSON.stringify({ seq, type: 'user', user: {} }) });
    d(101); chk(n0() === base + 1, 'the first stream delta polls the snapshot immediately', [n0(), base]);
    d(102); d(103); chk(n0() === base + 1, 'further deltas inside one second do not poll again', [n0(), base]);
    C.pollAt = Date.now() - 1100; d(104); chk(n0() === base + 2, 'after a second the next delta polls again');
    const t5 = timers.length; es.onerror();
    chk(es.closed === true && H.hvState.es === null && timers.slice(t5).includes(5000) && C.retry, 'a stream error closes it and schedules a 5 s retry', timers.slice(t5));
    H.hvStop(); const before = ES.all.length; await new Promise(r => realST(r, 50));
    chk(ES.all.length === before, 'hvStop cancels the pending 5 s retry (no new EventSource)');
    H.hvState.es = null; H.hvState.timer = null; delete globalThis.EventSource; S.show = true;
  }

  // ---- review fixes: confetti colour, event guard, replay timers, poll debounce ----
  document.getElementById('hive-pk').innerHTML = '';
  const conf = [], mo = new w.MutationObserver(rs => rs.forEach(r => r.addedNodes.forEach(n => { if (n.classList && n.classList.contains('hv-p') && n.classList.contains('conf')) conf.push(n); })));
  mo.observe(document.getElementById('hive-pk'), { childList: true });
  H.hvPlayEvent({ ...ev, status: 'done' });
  await new Promise(r => realST(r, 100)); mo.disconnect();
  chk(conf.length > 0 && conf.every(e => /^(#|hsl)/.test(e.style.getPropertyValue('--c'))), 'done confetti carry the conf class and a family colour in --c', conf.length);
  let threw = null; try { H.hvPlayComm({ id: 'g1', from: 'coder', to: 'llm-telemetry-brain', board: 'llm-telemetry', kind: 'event', via: 'line', at: 999 }); } catch (e) { threw = e; }
  chk(!threw && !/undefined/.test(document.getElementById('hive-bubbles').textContent), 'an event comm with no event or text neither throws nor shows undefined', threw && threw.message);
  C.log.length = 0; for (let i = 0; i < 12; i++) C.log.push(mk('q' + i, { at: 900 + i }));
  H.hvReplay(); const rt1 = C.rt.slice(); H.hvReplay();
  chk(rt1.length === 8 && C.rt.length === 8 && C.rt.every(t => !rt1.includes(t)), 'a new replay cancels the previous one and keeps 8 timer ids');
  H.hvState.es = null; H.hvStop(); S.show = true;
  chk(C.rt.length === 0, 'hvStop clears the pending replay timers');
  C.log.length = 0;

  // ---- firing toggle persists (F33, F44) ----
  w.localStorage.setItem('hiveFire', '0'); C.bound = false; w.document.body.insertAdjacentHTML('beforeend', '<button id="hive-fire"></button><button id="hive-replay"></button>');
  H.hvCommInit(); clearInterval(C.hb); C.hb = 0;
  chk(C.fire === false, 'firing mode reads localStorage.hiveFire');
  document.getElementById('hive-fire').click();
  chk(C.fire === true && w.localStorage.getItem('hiveFire') === '1' && document.getElementById('hive-fire').getAttribute('aria-pressed') === 'true', 'the toggle flips, persists and updates aria-pressed');
  chk(S.last.charge > 0, 'enabling firing mode plays the charge cue');

  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src/llm_telemetry/web/js/hive.js'), 'utf8');
  const h7 = src.slice(src.indexOf('Comms, events, replay, firing mode'));
  chk(!/#[0-9a-fA-F]{3,8}\b/.test(src) && !/HV_COL/.test(src), 'hive.js has no hex colour literals; family colours come from --hv-fam-* tokens');
  chk(!/#[0-9a-fA-F]{3,6}\b/.test(h7) && !/setInterval\([^)]*(playComm|hvPlayComm|hvPlayEvent|hvFeed|hvAddComm)/.test(h7), 'H-7 code has no raw colours and no timer-driven comms');
  chk(!/<circle|createElementNS\([^)]*circle/.test(h7) && !/a_aah|\.mp3/.test(h7), 'polygons only, no scream clip');
  console.log(`${p} passed, ${f} failed`); process.exit(f ? 1 : 0);
})().catch(e => { console.log('FAIL threw', e.stack); process.exit(1); });
