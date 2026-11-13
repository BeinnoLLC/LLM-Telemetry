// LLMTELEMET-271: Hive view render smoke on the built page (jsdom): graph from a snapshot, Hazem centred,
// view switcher persists, in-place updates keep node elements, all nine moods draw, tooltip shows real counts.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS || require('path').join(__dirname, '..', 'examples', 'reports');
const fs = require('fs'), { JSDOM } = require('jsdom');
const html = fs.readFileSync(REPORTS + '/dashboard.html', 'utf8').replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
const W = 1200, H = 800;
const snap = {
  user: { state: 'idle' },
  families: [{ id: 'root', label: 'Beinno',
    assistant: { id: 'a', label: 'Donna', idle: 20, sessions: 1, workers: [], model: 'glm-5', spend: null },
    bots: [{ id: 'ghost', idle: null, sessions: 0, workers: [] }],
    brains: [{ id: 'b1', board: 'b1', label: 'B1', idle: 30, sessions: 1, counts: { running: 1, blocked: 2, todo: 3, ready: 0, done: 7 }, workers: [],
      agents: [{ id: 'ag', idle: 5, tasks: [{ id: 't1', title: 'T', status: 'running' }] }] }] },
  { id: 'acasia', label: 'Acasia', assistant: { id: 'z', label: 'Jarvis', idle: 9000, sessions: 0, workers: [] }, bots: [], brains: [] }],
  unattributed: [],
};
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://127.0.0.1:8477/dashboard.html',
  beforeParse(w) {
    w.Chart = function () { return { destroy() {}, update() {} }; };
    w.Chart.defaults = { color: '', borderColor: '', font: {}, plugins: { legend: { labels: { generateLabels: () => [] } } } };
    w.Chart.overrides = { doughnut: { plugins: { legend: { labels: { generateLabels: () => [] } } } } };
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    Object.defineProperty(w.HTMLElement.prototype, 'offsetHeight', { get() { return 700; } });
    w.HTMLElement.prototype.getBoundingClientRect = function () { return { width: W, height: H, top: 0, left: 0, right: W, bottom: H }; };
  } });
const w = dom.window, d = w.document;
let p = 0, f = 0; const chk = (ok, l, x) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${x ? '  ' + x : ''}`); ok ? p++ : f++; };
setTimeout(() => {
  try {
    w.pickView('Hive');
    w.eval('hvStop()');
    w.eval('hvRender(' + JSON.stringify(snap) + ')');
    const nodes = () => [...d.querySelectorAll('#hive-nodes > g')];
    chk(nodes().length === 6, 'graph renders egg, 2 assistants, 1 bot, 1 brain, 1 agent', String(nodes().length));
    chk(d.querySelector('[data-id=hazem]').getAttribute('transform') === 'translate(0.0,0.0)', 'Hazem sits at the exact centre');
    chk(d.querySelectorAll('#hive-svg circle').length === 0, 'no circles on the stage');
    chk(d.querySelector('[data-id="b:root:ghost"]').classList.contains('nodata'), 'unmapped bot is a data-less face');
    chk(d.querySelector('[data-id="b:root:b1"]').dataset.mood === 'angry', 'blocked brain draws the angry face');
    const keep = d.querySelector('[data-id="b:root:b1"]');
    w.eval('hvRender(' + JSON.stringify(snap) + ')');
    chk(d.querySelector('[data-id="b:root:b1"]') === keep, 'a second snapshot updates nodes in place (same element)');
    for (const m of w.eval('HV_MOODS')) { w.eval(`hvSetMood("a:root","${m}",50)`); if (d.querySelector('[data-id="a:root"]').dataset.mood !== m) chk(false, 'mood ' + m); }
    chk(true, 'all nine moods draw on a live node');
    chk(/1 run · 3 queued · 2 blk/.test(d.querySelector('[data-id="b:root:b1"] .hv-sub').textContent), 'brain label carries the real counts');
    chk(/Beinno/.test(d.getElementById('hive-views').textContent) && d.querySelectorAll('#hive-views .seg-btn').length === 3, 'view switcher: All + one per family');
    d.querySelector('#hive-views [data-hv=acasia]').click();
    chk(w.localStorage.getItem('hiveView') === 'acasia' && nodes().length === 2, 'choosing a family persists and filters', String(nodes().length));
    chk(d.querySelectorAll('#hive-tabs .hv-stat').length === 7, 'seven stat tabs');
  } catch (e) { chk(false, 'render threw', e.stack); }
  console.log(`${p} passed, ${f} failed`); process.exit(f ? 1 : 0);
}, 800);
