// #120/#125 + #140: the Live view's task queue, drawn as a railway. Since the
// #140 follow-up it is the ONLY queue view (the queued/running/done lanes were
// removed). Built only from real data: Ollama host queue depth (depot), the
// live session list (the line), and the recent_sessions feed Analytics uses
// (the yard). Cars are keyed and reused across polls; every car has a hover
// card. Loads the BUILT dashboard from examples/reports/dashboard.html.
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
  const tr = d.getElementById('qtrain');
  const qb = d.getElementById('qt-queued'), rb = d.getElementById('qt-running'), db = d.getElementById('qt-done');
  const cars = box => [...box.querySelectorAll('.qt-car[data-key]')].filter(c => !c.classList.contains('qt-leaving'));
  const lbl = c => c.querySelector('.qt-lbl').textContent;
  const n = id => d.getElementById(id).textContent;
  try {
    chk(!!tr && !!qb && !!rb && !!db, 'jars: depot, line and yard exist');
    chk(!!d.getElementById('qcard'), 'queue card exists');
    chk(!!d.getElementById('qsub'), 'queue subtitle exists');
    chk(!!d.getElementById('qtip'), 'shared car tooltip exists');

    // ---- the redundant lanes are gone -------------------------------------
    chk(!d.getElementById('qlanes'), 'the queued/running/done lanes were removed');
    chk(!d.getElementById('qitems-queued') && !d.getElementById('qcount-done'), 'no lane containers or lane counts remain');
    chk(!/\.qchip\{/.test(html) && !/@keyframes qin\b/.test(html), 'the lane chip CSS was removed with them');

    // ---- #181: the queue now sits BELOW the live board (scorecards, then the
    // session table + agents panel), so those stay above the fold. It still sits
    // ABOVE the 6h series and the Explore strip, i.e. directly under the board.
    const qcard = d.getElementById('qcard');
    const liveGrid = d.getElementById('live-grid');
    const FOLLOWING = w.Node.DOCUMENT_POSITION_FOLLOWING;
    chk(!!liveGrid && (qcard.compareDocumentPosition(liveGrid) & FOLLOWING) !== 0,
        'task queue renders BEFORE the in-progress grid (Home feedback: queue always on top)');
    chk(!!liveGrid && (liveGrid.compareDocumentPosition(qcard) & FOLLOWING) === 0,
        'negative control: queue does not follow the in-progress grid');
    const inProg = [...d.querySelectorAll('.lbl')].find(el => /In progress now/i.test(el.textContent));
    chk(!!inProg && (qcard.compareDocumentPosition(inProg) & FOLLOWING) !== 0,
        'task queue renders before the "In progress now" heading');
    const series = d.getElementById('homeseries');
    chk(!!series && (qcard.compareDocumentPosition(series) & FOLLOWING) !== 0,
        'task queue renders before the 6h series panel');

    // ---- CSS: the motion really exists and is wired -----------------------
    for (const k of ['qt-arrive', 'qt-park', 'qt-depart', 'qt-land'])
      chk(new RegExp('@keyframes ' + k + '\\b').test(html), `@keyframes ${k} defined`);
    chk(!/@keyframes qt-run\b/.test(html), 'no sliding train animation');
    chk(/\.qt-cars\{[^}]*grid-template-columns:repeat\(auto-fill[^}]*overflow-y:auto/.test(html), 'each jar wraps its tiles and scrolls inside');
    chk(d.querySelectorAll('.qt-jar').length === 3, 'three jars: depot, line, yard');
    chk(/prefers-reduced-motion: reduce\)\{\s*\.qtrain \*/.test(html), 'reduced-motion users get still jars');
    chk(/\.qt-cars:not\(:has\(\.qt-car\)\)::after\{content:attr\(data-empty\)/.test(html) && !!d.getElementById('qt-done').dataset.empty, 'an empty section says so instead of drawing nothing');
    chk(!d.querySelector('.qt-shunter, .qt-rail, .qt-signal'), 'the train furniture (shunter, rail, signal) is gone');

    // ---- empty line --------------------------------
    w.eval(`DATA.ollama = {hosts: [{label:'box-a', up:true, queue:0, loaded:[], urls:[]}]};
            DATA.profiles[current].live = []; DATA.profiles[current].recent_sessions = []; renderQueue();`);
    chk(tr.classList.contains('clear'), 'empty line: flagged clear');
    chk(d.getElementById('qsub').textContent === 'fleet clear · 1 host', 'subtitle: fleet clear');

    // ---- depot: one car per real waiting slot -----------------------------
    w.eval(`DATA.ollama = {hosts: [
      {label:'box-a', up:true, queue:2, loaded:[], urls:[]},
      {label:'box-b', up:true, queue:1, loaded:[], urls:[]}]}; renderQueue();`);
    chk(cars(qb).length === 3, 'depot: 2 + 1 waiting -> 3 cars', cars(qb).length);
    chk(n('qt-n-queued') === '3', 'depot: count badge', n('qt-n-queued'));
    chk(tr.classList.contains('backed'), 'depot: signal goes red (backed)');
    chk(/backed up on box-a, box-b/.test(d.getElementById('qsub').textContent), 'subtitle names both busy hosts');
    const depotKeep = cars(qb)[0];
    w.eval('renderQueue()');
    chk(cars(qb)[0] === depotKeep, 'depot: an identical poll keeps the same car element');

    // ---- hover card on a real car -----------------------------------------
    const tip = d.getElementById('qtip');
    depotKeep.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    chk(tip.classList.contains('on'), 'hover: the tooltip opens');
    chk(/Waiting on box-a/.test(tip.textContent) && /1 of 2/.test(tip.textContent), 'hover: depot card names host and position', tip.textContent);
    depotKeep.dispatchEvent(new w.MouseEvent('mouseout', { bubbles: true, relatedTarget: d.body }));
    chk(!tip.classList.contains('on'), 'hover: leaving the car closes it');
    depotKeep.dispatchEvent(new w.FocusEvent('focusin', { bubbles: true }));
    chk(tip.classList.contains('on'), 'keyboard: focusing a car opens the card too');
    chk(depotKeep.tabIndex === 0, 'keyboard: cars are focusable');
    depotKeep.dispatchEvent(new w.FocusEvent('focusout', { bubbles: true }));

    // ---- the line: one coupled train, loco first --------------------------
    w.eval(`DATA.ollama.hosts.forEach(h => h.queue = 0);
      DATA.profiles[current].live = [
        {id:'t1', model:'qwen3-coder:30b', title:'one', idle_s:1, profile:'work', phase:'receiving stream response'},
        {id:'t2', model:'claude-opus-5', title:'two', idle_s:2},
        {id:'t3', model:'gpt-5', title:'(untitled)', idle_s:3}]; renderQueue();`);
    const run = cars(rb);
    chk(run.map(lbl).join('|') === 'one|two|gpt-5', 'line: titles lead, untitled falls back to the model', run.map(lbl).join('|'));
    chk(run.every(c => c.dataset.state === 'running') && run.some(c => c.dataset.state), 'line: tiles carry a live state');
    chk(n('qt-n-running') === '3', 'line: count badge');
    chk(Number(run[0].style.getPropertyValue('--h')) === w.eval(`hashHue('qwen3-coder:30b')`), 'line: stripe colour comes from the model hue');
    run[0].dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    chk(/qwen3-coder/.test(tip.textContent) && /receiving stream response/.test(tip.textContent), 'hover: running card shows model and phase', tip.textContent);
    chk(/\.qt-lbl\{[^}]*-webkit-line-clamp:3/.test(html) && /\.qt-car\{[^}]*min-height:64px/.test(html), 'tiles wrap titles to three lines');
    chk(!!run[0].querySelector('.qt-meta') && run[0].querySelector('.qt-meta').textContent.length > 0, 'a car carries a meta line (age, owner, short id)', run[0].querySelector('.qt-meta') && run[0].querySelector('.qt-meta').textContent);
    chk(w.eval(`carMeta({kind:'q',host:'box-a',pos:2,depth:5})`) === 'box-a \u00b7 2 of 5', 'depot car meta: host and position');
    chk(w.eval(`carMeta({kind:'r',profile:'p1',idle_s:90,sid:'abcdef123456'})`) === '2m ago \u00b7 p1 \u00b7 #123456', 'line car meta: age, profile and short id tell duplicate titles apart');

    // ---- line -> yard: the session parks under the same key ---------------
    const t1 = run[0];
    w.eval(`DATA.profiles[current].live = DATA.profiles[current].live.slice(1);
      DATA.profiles[current].recent_sessions = [{id:'t1', title:'one', model:'qwen3-coder:30b', last_ts: Date.now()/1000, dur_s: 42, tokens: 2048, api_calls: 3}];
      renderQueue();`);
    chk(t1.classList.contains('qt-leaving'), 'line -> yard: the car departs the line');
    const parked = cars(db);
    chk(parked.length === 1 && parked[0].dataset.key === 's:t1', 'line -> yard: it is parked in the yard');
    chk(parked[0].classList.contains('qt-newest'), 'yard: the newest arrival is highlighted');
    parked[0].dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    chk(/ran for/.test(tip.textContent) && /2\.0k/.test(tip.textContent), 'hover: yard card has duration and tokens', tip.textContent);

    // ---- no caps: every task is a tile, the jar scrolls ---------------------
    w.eval(`DATA.ollama.hosts[0].queue = 60; renderQueue();`);
    chk(cars(qb).length === 60 && n('qt-n-queued') === '60', 'depot: all 60 waiting tasks drawn', cars(qb).length);
    const many = Array.from({ length: 150 }, (_, i) => ({ id: 'm' + i, title: 'job ' + i, model: 'm', last_ts: 1000 - i, dur_s: 1 }));
    w.eval(`DATA.profiles[current].recent_sessions = ${JSON.stringify(many)}; renderQueue();`);
    chk(cars(db).length === 150 && n('qt-n-done') === '150', 'yard: all 150 done tasks drawn', cars(db).length);
    chk(!d.querySelector('.qt-more'), 'no "+N" badge anywhere');
    chk(cars(db).every(c => c.tabIndex === 0), 'yard: every tile is focusable');
    cars(db)[3].dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    chk(tip.classList.contains('on') && tip.textContent.includes(cars(db)[3]._qt.label), 'yard: tooltip carries the full title');
    cars(db)[3].dispatchEvent(new w.MouseEvent('mouseout', { bubbles: true, relatedTarget: d.body }));
  } catch (e) {
    chk(false, 'queue checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 4).join('\n'));
  }
  console.log(`\ncheck_queue_viz.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
