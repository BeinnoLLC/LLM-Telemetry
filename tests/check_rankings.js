// OpenRouter rankings page (rankings.html, #113). Reads the committed sample
// page built from examples/reports/rankings-data.json ("sample": true), so
// every expected number is reproducible and no network is involved.
const fs = require('fs');
const path = require('path');
const {JSDOM} = require('jsdom');
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || path.join(__dirname, '..', 'examples', 'reports');
const page = path.join(REPORTS, 'rankings.html');
const dataFile = path.join(REPORTS, 'rankings-data.json');
let pass = 0, fail = 0;
const chk = (ok, label, extra) => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${extra !== undefined ? '  (' + extra + ')' : ''}`);
  ok ? pass++ : fail++;
};
if (!fs.existsSync(page) || !fs.existsSync(dataFile)){
  console.log('FAIL rankings.html or rankings-data.json missing: build the sample page first');
  process.exit(1);
}
const html = fs.readFileSync(page, 'utf8');
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const w = new JSDOM(html, {runScripts: 'dangerously', pretendToBeVisual: true}).window;
const d = w.document;

chk(data.status === 'ok' && data.sample === true, 'fixture is an ok sample payload', data.status);
chk(d.querySelector('.wrap').dataset.status === 'ok', 'page status ok');
chk(!/fetch\(/.test(html), 'data is inlined: the page fetches nothing');

// Chooser: three buttons, exactly one pressed, one visible view.
const btns = [...d.querySelectorAll('.chooser .vb')];
chk(btns.map(b => b.dataset.view).join() === 'day,week,month', 'day/week/month chooser', btns.map(b => b.dataset.view).join());
const visible = () => [...d.querySelectorAll('section.view')].filter(s => !s.hidden).map(s => s.dataset.view);
const pressed = () => btns.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.view);
chk(visible().join() === 'week' && pressed().join() === 'week', 'week is the default view', visible().join());

for (const name of ['day', 'week', 'month']){
  const sec = d.querySelector(`section.view[data-view="${name}"]`);
  const view = data.views[name];
  const rows = [...sec.querySelectorAll('tr.rk-row')];
  chk(rows.length === 10 && view.top.length === 10, `${name}: top-10 rows`, rows.length);
  const toks = rows.map(r => Number(r.dataset.tokens));
  chk(toks.every((t, i) => i === 0 || toks[i - 1] >= t), `${name}: rows sorted by tokens desc`);
  chk(rows.every((r, i) => r.querySelector('.rank').textContent === String(i + 1)), `${name}: ranks 1..10`);
  chk(rows[0].querySelector('.model').title === view.top[0].model, `${name}: #1 matches payload`, view.top[0].model);
  const other = sec.querySelectorAll('tr.rk-other');
  chk(other.length === 1 && sec.querySelector('tbody tr:last-child').classList.contains('rk-other'),
    `${name}: one "other" aggregate row, pinned last`);
  chk(Number(other[0].dataset.tokens) === view.other.tokens, `${name}: other tokens match payload`, view.other.tokens);
  const label = sec.querySelector('.vmeta').textContent;
  chk(label.includes(view.end) && new RegExp(`\\b${view.days} day`).test(label), `${name}: window label`, label);
}

// Switching views is pure show/hide.
btns[2].click();
chk(visible().join() === 'month' && pressed().join() === 'month', 'click Month shows only month', visible().join());
btns[0].click();
chk(visible().join() === 'day' && pressed().join() === 'day', 'click Day shows only day', visible().join());

// Attribution (CC BY 4.0) with the required link.
const a = d.querySelector('.attr a');
chk(a && a.textContent.trim() === 'Rankings data by OpenRouter, CC BY 4.0', 'attribution text', a && a.textContent);
chk(a && a.getAttribute('href') === 'https://openrouter.ai/docs' && a.rel === 'noopener', 'attribution link + rel=noopener');
chk(/sample data/.test(d.querySelector('.sub').textContent), 'sample payload is labelled as sample');
chk(!/OPENROUTER_API_KEY=|Bearer /.test(html), 'no credential material in the page');

console.log(fail ? `FAILED  (${pass} passed, ${fail} failed)` : `ALL PASS  (${pass} passed, 0 failed)`);
process.exit(fail ? 1 : 0);
