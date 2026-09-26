// The Activity heatmap belongs to the Detail tab, not to every tab.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(require('os').homedir(), '.local/share/llm-telemetry/reports');
const fs = require('fs'), { JSDOM } = require('jsdom');
const raw = fs.readFileSync(REPORTS + '/dashboard.html', 'utf8');
const html = raw.replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
const live = JSON.parse(fs.readFileSync(REPORTS + '/live-data.json', 'utf8'));
const analytics = JSON.parse(fs.readFileSync(REPORTS + '/analytics-data.json', 'utf8'));

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://127.0.0.1:8477/dashboard.html',
  beforeParse(w) {
    w.Chart = function () { return { destroy() {}, update() {} }; };
    w.Chart.defaults = { color: '', borderColor: '', font: {} };
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.fetch = (u) => Promise.resolve({ ok: true, status: 200,
      json: () => Promise.resolve(String(u).includes('live-data') ? live : analytics) });
  }
});
const w = dom.window, d = w.document;
let p = 0, f = 0;
const chk = (ok, l, x) => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${l}${x ? '  ' + x : ''}`); ok ? p++ : f++; };

setTimeout(() => {
  const card = d.getElementById('heatcard');
  chk(!!card, 'heatmap card exists');

  // It must live INSIDE the Detail view, so tab switching controls it.
  const view = card && card.closest('.view');
  chk(!!view, 'heatmap is inside a view container');
  chk(view && view.getAttribute('data-view') === 'Detail',
      'heatmap is inside the Detail view', view ? `(${view.getAttribute('data-view')})` : '');

  // Not a global band any more: no heatcard outside a .view.
  const strays = [...d.querySelectorAll('#heatmap')].filter(el => !el.closest('.view'));
  chk(strays.length === 0, 'no heatmap rendered outside a view', `(${strays.length} stray)`);

  // It must still actually render content, not just exist.
  const cells = d.querySelectorAll('#heatmap *').length;
  chk(cells > 10, 'heatmap renders cells from the payload', `(${cells} nodes)`);
  const sub = d.getElementById('heatsub');
  chk(sub && sub.textContent.trim().length > 0, 'heatmap subtitle populated',
      sub ? `(${sub.textContent.trim().slice(0, 40)})` : '');

  // The per-model table must still be in Detail alongside it.
  const tbl = d.getElementById('tbl');
  chk(tbl && tbl.closest('.view') && tbl.closest('.view').getAttribute('data-view') === 'Detail',
      'per-model table still in the Detail view');

  console.log(`\n${f === 0 ? 'ALL PASS' : 'FAILED'}  (${p} passed, ${f} failed)`);
  process.exit(f === 0 ? 0 : 1);
}, 1400);