// Live row: "N models used" must name the models (#107).
const REPORTS = process.env.LLM_TELEMETRY_REPORTS || 'examples/reports';
const fs = require('fs'), { JSDOM } = require('jsdom');
const html = fs.readFileSync(REPORTS + '/dashboard.html', 'utf8')
  .replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
const live = JSON.parse(fs.readFileSync(REPORTS + '/live-data.json', 'utf8'));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://127.0.0.1:8477/dashboard.html#/live',
  beforeParse(w) {
    w.Chart = function () { return { destroy() {}, update() {}, resize() {} }; };
    w.Chart.getChart = () => null;
    w.Chart.defaults = { color: '', borderColor: '', font: {}, plugins: { legend: { labels: { generateLabels: () => [] } } } };
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(live) });
  } });
const w = dom.window, d = w.document;
let p = 0, f = 0;
const chk = (ok, l, x) => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${l}${x ? '  ' + x : ''}`); ok ? p++ : f++; };
const L = Object.values(live.profiles).flatMap(q => q.live || []).find(x => (x.models || []).length > 1);

setTimeout(() => {
  chk(!!L, 'fixture has a multi-model live session (precondition)');
  const btn = d.querySelector(`#livelist [data-lm="${L.id}"]`);
  chk(!!btn, 'the models badge is a button');
  chk(btn && btn.textContent.includes(`${L.models.length} models used`),
      'count covers every model, helpers included', `(${btn && btn.textContent.trim()})`);
  const helpers = L.models.filter(m => !m.main).length;
  chk(btn && btn.textContent.includes(`${helpers} helper`), 'main vs helper split is shown');
  chk(btn && L.models.every(m => btn.title.includes(m.model.split('/').pop())),
      'tooltip names every model');
  chk(!d.querySelector(`[data-lmp="${L.id}"]`), 'panel closed by default');
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const panel = () => d.querySelector(`[data-lmp="${L.id}"]`);
  chk(!!panel(), 'clicking opens the per-model panel');
  const rows = panel() ? [...panel().querySelectorAll('tbody tr')] : [];
  chk(rows.length === L.models.length, `one row per model (${rows.length})`);
  chk(L.models.every((m, i) => rows[i] && rows[i].textContent.includes(m.model.split('/').pop())),
      'rows name each model, in payload order (main first)');
  chk(L.models.every((m, i) => rows[i] && m.tasks.every(t => rows[i].textContent.includes(t))),
      'each row lists what the model was used for');
  chk(rows.some(r => /\(now\)/.test(r.textContent)), 'the current model is marked');
  chk(d.querySelector(`[data-lm="${L.id}"]`).getAttribute('aria-expanded') === 'true', 'aria-expanded reflects state');
  // Survives the 5 s poll re-render.
  w.eval('renderLive()');
  chk(!!panel(), 'panel stays open across a live re-render');
  d.querySelector(`[data-lm="${L.id}"]`).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  chk(!panel(), 'clicking again closes it');
  console.log(`\n${f === 0 ? 'ALL PASS' : 'FAILED'}  (${p} passed, ${f} failed)`);
  process.exit(f === 0 ? 0 : 1);
}, 1400);
