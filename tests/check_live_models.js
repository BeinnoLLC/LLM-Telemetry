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

  // --- the visualisation (#108) -------------------------------------------
  d.querySelector(`[data-lm="${L.id}"]`).dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  const pan = () => d.querySelector(`[data-lmp="${L.id}"]`);
  const bar = () => pan() && pan().querySelector('.lmbar');
  chk(!!bar(), 'the panel draws a proportional share bar');
  const segs = () => [...pan().querySelectorAll('.lmseg')];
  const used = L.models.filter(m => (+m.in_tok||0) + (+m.out_tok||0) > 0);
  chk(segs().length === used.length,
      `one segment per model with usage (${segs().length} of ${L.models.length})`);
  const pctOf = el => parseFloat((el.getAttribute('style').match(/width:([\d.]+)%/)||[])[1]);
  const sum = segs().reduce((a, e) => a + pctOf(e), 0);
  chk(Math.abs(sum - 100) < 0.5, 'segment widths sum to 100%', `(${sum.toFixed(2)}%)`);
  // Widths must track the DATA, not just exist.
  const tot = used.reduce((a,m)=>a+(+m.in_tok||0)+(+m.out_tok||0), 0);
  const want = used.map(m => ((+m.in_tok||0)+(+m.out_tok||0))/tot*100);
  chk(segs().every((e,i) => Math.abs(pctOf(e) - want[i]) < 0.05),
      'each width matches that model\u2019s token share');
  chk(segs().every(e => (e.getAttribute('title')||'').includes('%')),
      'every segment names its model and share on hover');
  const legend = [...pan().querySelectorAll('.lmkey')];
  chk(legend.length === L.models.length, 'legend lists every model');
  chk(legend.some(k => (k.className||'').includes('cur')), 'legend marks the current model');
  chk(pan().querySelectorAll('.lmrowbar').length === L.models.length,
      'each table row carries its own share bar');

  // Metric toggle: calls and tokens disagree, so the picture must change.
  const btnFor = k => pan().querySelector(`[data-lmmet="${k}"]`);
  chk(!!btnFor('calls') && !!btnFor('tokens'), 'metric toggle offers calls and tokens');
  chk(btnFor('tokens').className.includes('on'), 'tokens is the default metric');
  const before = segs().map(pctOf);
  btnFor('calls').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  const after = segs().map(pctOf);
  chk(btnFor('calls').className.includes('on'), 'clicking switches the active metric');
  chk(JSON.stringify(before) !== JSON.stringify(after),
      'switching to calls redraws the bar with different proportions');
  const ctot = L.models.reduce((a,m)=>a+(+m.calls||0),0);
  const cwant = L.models.filter(m=>(+m.calls||0)>0).map(m => (+m.calls||0)/ctot*100);
  chk(after.every((v,i) => Math.abs(v - cwant[i]) < 0.05), 'call-share widths match the data');
  btnFor('tokens').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  chk(pan().querySelector('[data-lmmet="tokens"]').className.includes('on'), 'toggle switches back');

  console.log(`\n${f === 0 ? 'ALL PASS' : 'FAILED'}  (${p} passed, ${f} failed)`);
  process.exit(f === 0 ? 0 : 1);
}, 1400);
