// #120/#125: the Live view's task-queue panel — THREE lanes (queued / running
// / done) built only from real data (Ollama host queue depth, the live
// session list, and the same recent_sessions feed Analytics uses), each
// capped to the 10 most recent workers. A chip that has a real identity in
// both feeds (a session ending: running -> done) TRAVELS as the same DOM node
// via a FLIP transform rather than fading out and faking a new one in.
// Loads the BUILT dashboard from examples/reports/dashboard.html.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'examples', 'reports', 'dashboard.html'), 'utf8');

let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
}

function bootDOM() {
  const backing = new Map();
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://127.0.0.1:8477/dashboard.html',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => null;
      function Stub(ctx, cfg) {
        this.config = cfg; this.data = (cfg && cfg.data) || {}; this.destroy = () => {};
        this.update = () => {}; this.options = (cfg && cfg.options) || {};
        this.scales = {}; this._metasets = []; this.chartArea = {left:0,top:0,right:0,bottom:0};
        this.width = 300; this.height = 150; this.aspectRatio = 2; this.attached = false;
        this.getDatasetMeta = () => ({ data: [], controller: null });
      }
      Stub.register = () => {}; Stub.overrides = {}; Stub.instances = {};
      Stub.getChart = () => null; Stub.registerables = []; Stub.version = 'stub';
      Stub.controllers = {}; Stub.elements = {}; Stub.plugins = {}; Stub.scales = {};
      Stub.defaults = { font: { size: 10, family: '', weight: '' }, color: '' };
      w.Chart = Stub; w.getChart = () => null;
      Object.defineProperty(w, 'localStorage', {
        value: { getItem: k => backing.get(k) ?? null,
                 setItem: (k, v) => backing.set(k, String(v)),
                 removeItem: k => backing.delete(k), clear: () => backing.clear(),
                 key: i => [...backing.keys()][i] ?? null,
                 get length(){ return backing.size; } },
        configurable: true, writable: true });
    },
  });
}

const dom = bootDOM();
setTimeout(() => {
  const w = dom.window, d = w.document;
  const qBox = d.getElementById('qitems-queued');
  const rBox = d.getElementById('qitems-running');
  const dBox = d.getElementById('qitems-done');
  try {
    chk(!!qBox && !!rBox && !!dBox, 'all three queue lanes exist');
    chk(!!d.getElementById('qcard'), 'queue card exists');
    chk(!!d.getElementById('qsub'), 'queue subtitle exists');

    // ---- #120 follow-up: the queue must sit ABOVE the in-progress grid ----
    const qcard = d.getElementById('qcard');
    const liveGrid = d.getElementById('live-grid');
    const FOLLOWING = w.Node.DOCUMENT_POSITION_FOLLOWING;
    chk(!!liveGrid, 'live grid exists');
    chk(!!qcard && !!liveGrid
        && (qcard.compareDocumentPosition(liveGrid) & FOLLOWING) !== 0,
        'task queue renders BEFORE the in-progress grid');
    const inProg = [...d.querySelectorAll('.lbl')].find(el => /In progress now/i.test(el.textContent));
    chk(!!inProg && !!qcard
        && (qcard.compareDocumentPosition(inProg) & FOLLOWING) !== 0,
        'task queue renders before the "In progress now" heading');

    // ---- CSS: the animations really exist and are wired ---------------------
    chk(/@keyframes qin/.test(html), 'entry animation defined');
    chk(/@keyframes qout/.test(html), 'exit animation defined');
    chk(/@keyframes qland/.test(html), 'arrival ("landed") animation defined for travel');
    chk(/@keyframes qshimmer/.test(html), 'idle shimmer for waiting items defined');
    chk(/@keyframes qpulse-ok/.test(html), 'calm empty-state pulse defined');
    chk(/animation:\s*qshimmer/.test(html), 'waiting dots actually use the shimmer');
    chk(/\.qchip\.arrived\{animation:qland/.test(html), 'arrived chips play the land animation');
    // perf requirement: motion is transform/opacity, not layout properties
    chk(/transition:transform .*opacity/.test(html),
        'chips transition on transform/opacity (no per-frame reflow)');
    chk(typeof w.eval('flipMove') === 'function', 'flipMove (FLIP travel helper) is defined');

    // ---- empty states first: reset the sample's own recent_sessions so ----
    // the "done" lane checks are not diluted by 40 real baked-in sessions.
    w.eval(`DATA.profiles[current].recent_sessions = []; renderQueue();`);
    const emptyD0 = dBox.querySelector('.qempty');
    chk(!!emptyD0 && /nothing finished/i.test(emptyD0.textContent),
        'empty done lane shows a calm state', emptyD0 && emptyD0.textContent);

    // ---- drive a REAL queue depth through the real render path ------------
    w.eval(`DATA.ollama = {hosts: [
      {label:'box-a', up:true, queue:3, loaded:[], urls:[]},
      {label:'box-b', up:true, queue:0, loaded:[], urls:[]}
    ]}; renderQueue();`);
    let chips = [...qBox.querySelectorAll('.qchip')];
    chk(chips.length === 3, '3 waiting requests render as 3 chips', String(chips.length));
    chk(chips.every(c => c.dataset.lane === 'queued'), 'all 3 are in the queued lane');
    chk(!qBox.querySelector('.qempty'), 'empty state disappears when the queue is not empty');
    chk(d.getElementById('qcount-queued').textContent === '3',
        'queued count matches the depth', d.getElementById('qcount-queued').textContent);
    chk(/backed up on box-a/.test(d.getElementById('qsub').textContent),
        'subtitle names the backed-up host', d.getElementById('qsub').textContent);

    // idempotent re-render must not replay entry animations (the #114 flicker)
    const firstChip = chips[0];
    w.eval('renderQueue()');
    chips = [...qBox.querySelectorAll('.qchip')];
    chk(chips.length === 3, 're-render with unchanged data keeps 3 chips', String(chips.length));
    chk(chips[0] === firstChip, 'unchanged chips are REUSED, not rebuilt (no flicker)');

    // depth shrinking plays the exit animation, then removes the node
    w.eval(`DATA.ollama.hosts[0].queue = 1; renderQueue();`);
    const leaving = qBox.querySelectorAll('.qchip.leaving');
    chk(leaving.length === 2, 'shrinking depth marks the surplus chips as leaving',
        String(leaving.length));

    // ---- 10-worker cap: 25 waiting slots show only 10 chips + overflow ----
    w.eval(`DATA.ollama.hosts = [{label:'box-c', up:true, queue:25, loaded:[], urls:[]}];
            renderQueue();`);
    const cappedChips = qBox.querySelectorAll('.qchip:not(.leaving)');
    chk(cappedChips.length === 10, 'queued lane caps at 10 chips even with 25 waiting',
        String(cappedChips.length));
    chk(d.getElementById('qcount-queued').textContent === '25',
        'the COUNT still shows the real total (25), capping is display-only',
        d.getElementById('qcount-queued').textContent);
    const moreQ = qBox.querySelector('.qmore');
    chk(!!moreQ && /15 more/.test(moreQ.textContent),
        'an overflow footer states how many are hidden', moreQ && moreQ.textContent);
  } catch (e) {
    chk(false, 'queue checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 4).join('\n'));
  }

  // let the 240ms exit animation finish before asserting lane contents
  setTimeout(() => {
  try {
    // reset to a clean, small queue for the rest of the checks
    w.eval(`DATA.ollama = {hosts: [{label:'box-a', up:true, queue:0, loaded:[], urls:[]}]};
            renderQueue();`);

    // ---- running lane from the real live sessions -------------------------
    w.eval(`DATA.profiles[current].live = [
      {id:'s1', model:'claude-opus-5', profile:'work', idle_s:4},
      {id:'s2', model:'qwen3-coder:30b', profile:'personal', idle_s:12}
    ]; renderQueue();`);
    const rc = [...rBox.querySelectorAll('.qchip:not(.leaving)')];
    chk(rc.length === 2, 'live sessions render in the running lane', String(rc.length));
    chk(rc.every(c => c.dataset.lane === 'running'), 'they are marked as running');
    chk(d.getElementById('qcount-running').textContent === '2',
        'running count matches', d.getElementById('qcount-running').textContent);
    const dot = rc.find(c => c.dataset.key === 's:s1').querySelector('.qdotwrap');
    const m = (dot.getAttribute('style') || '').match(/hsl\((\d+)/);
    chk(!!m && Number(m[1]) === w.eval(`hashHue('work')`),
        'running chip carries its profile colour', m && m[1]);

    // ---- the promote transition: the queue drains while sessions start ----
    w.eval(`DATA.ollama.hosts[0].queue = 1; renderQueue();`); // seed one waiting slot
  } catch (e) {
    chk(false, 'queue checks crashed (running setup)', e.message);
  }

  setTimeout(() => {
  try {
    w.eval(`DATA.ollama.hosts[0].queue = 0;
            DATA.profiles[current].live = [
              {id:'s1', model:'claude-opus-5', profile:'work', idle_s:4},
              {id:'s2', model:'qwen3-coder:30b', profile:'personal', idle_s:12},
              {id:'s-new', model:'qwen3-coder:30b', profile:'work', idle_s:1}
            ]; renderQueue();`);
    const promoted = rBox.querySelector('.qchip[data-key="s:s-new"]');
    chk(!!promoted, 'the newly started session renders in the running lane');
    chk(!!promoted && promoted.classList.contains('promoting'),
        'it plays the promote animation (advancing, not swapped)',
        promoted && promoted.className);

    // An UNRELATED new session while the queue was already clear must NOT be
    // dressed up as a promotion — the budget is zero when nothing left the queue.
    w.eval(`DATA.profiles[current].live = [
      {id:'s1', model:'claude-opus-5', profile:'work', idle_s:4},
      {id:'s2', model:'qwen3-coder:30b', profile:'personal', idle_s:12},
      {id:'s-new', model:'qwen3-coder:30b', profile:'work', idle_s:1},
      {id:'s-unrelated', model:'claude-opus-5', profile:'work', idle_s:0}
    ]; renderQueue();`);
    const unrel = rBox.querySelector('.qchip[data-key="s:s-unrelated"]');
    chk(!!unrel && !unrel.classList.contains('promoting'),
        'an unrelated new session is not dressed up as a promotion',
        unrel && unrel.className);

    // ---- running -> done: the SAME element travels, not a fresh chip ------
    // The ended session shares an id with a session that was just running, so
    // the reconciler must move the ORIGINAL dom node rather than destroy one
    // chip and create another — that identity is the whole point of #125.
    const runningNode = rBox.querySelector('.qchip[data-key="s:s1"]');
    chk(!!runningNode, 'session s1 is running before it ends');
    w.eval(`DATA.profiles[current].live = DATA.profiles[current].live.filter(L => L.id !== 's1');
            DATA.profiles[current].recent_sessions = [
              {id:'s1', model:'claude-opus-5', last_model:'claude-opus-5', last_ts: Date.now()/1000, dur_s: 340}
            ].concat(DATA.profiles[current].recent_sessions || []);
            renderQueue();`);
    const doneNode = dBox.querySelector('.qchip[data-key="s:s1"]');
    chk(!!doneNode, 's1 now appears in the done lane');
    chk(doneNode === runningNode,
        'the DONE chip is the SAME dom node that was running (travel, not recreate)');
    chk(!rBox.querySelector('.qchip[data-key="s:s1"]'),
        's1 no longer sits in the running lane once it is done');
    chk(!!doneNode && doneNode.classList.contains('qchip'),
        'the travelled chip is still a valid chip element');
    chk(d.getElementById('qcount-done').textContent === '1',
        'done count reflects the newly-ended session', d.getElementById('qcount-done').textContent);

    // ---- done lane also honours the 10-worker cap --------------------------
    const many = Array.from({length: 14}, (_, i) => ({
      id: `old${i}`, model: 'qwen3-coder:30b', last_model: 'qwen3-coder:30b',
      last_ts: Date.now()/1000 - i, dur_s: 60,
    }));
    w.eval(`DATA.profiles[current].recent_sessions = ${JSON.stringify(many)}.concat(
      DATA.profiles[current].recent_sessions || []); renderQueue();`);
    const doneChips = dBox.querySelectorAll('.qchip:not(.leaving)');
    chk(doneChips.length === 10, 'done lane caps at 10 chips with 15 ended sessions',
        String(doneChips.length));
    chk(d.getElementById('qcount-done').textContent === '15',
        'done count still shows the real total (15)', d.getElementById('qcount-done').textContent);
    const moreD = dBox.querySelector('.qmore');
    chk(!!moreD && /5 more/.test(moreD.textContent),
        'done lane also gets an overflow footer', moreD && moreD.textContent);

    // ---- idle / empty states -------------------------------------------
    w.eval(`DATA.profiles[current].live = []; renderQueue();`);
    const em = rBox.querySelector('.qempty');
    chk(!!em && /idle/i.test(em.textContent), 'no sessions -> calm idle state', em && em.textContent);
    chk(d.getElementById('qcount-running').textContent === '0', 'running count back to 0',
        d.getElementById('qcount-running').textContent);
  } catch (e) {
    chk(false, 'queue checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 4).join('\n'));
  }
  console.log(`\ncheck_queue_viz.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
  }, 320);
  }, 320);
}, 1500);
