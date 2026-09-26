// Context re-send per session panel (P9-03, #80).
const fs = require('fs');
const path = require('path');
const {JSDOM} = require('jsdom');
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || path.join(__dirname, '..', 'examples', 'reports');
let pass = 0, fail = 0;
const chk = (ok, name, extra) => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}${extra !== undefined ? '  (' + extra + ')' : ''}`);
};
const src = fs.readFileSync(path.join(REPORTS, 'dashboard.html'), 'utf8');

function load(mut){
  let html = src;
  if (mut) {
    const i = html.indexOf('let DATA = ');
    const j = html.indexOf(';\n', i);
    const d = JSON.parse(html.slice(i + 11, j));
    mut(d);
    html = html.slice(0, i + 11) + JSON.stringify(d) + html.slice(j);
  }
  const dom = new JSDOM(html, {runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'http://localhost/dashboard.html#/cost',
    beforeParse(w){
      w.fetch = () => Promise.resolve({ok: false, status: 404, json: () => Promise.resolve({})});
      w.Chart = function () { return {destroy() {}, update() {}}; };
      w.Chart.defaults = {color: '', borderColor: '', font: {}};
      w.Chart.getChart = () => null;
      w.Chart.register = () => {};
      w.HTMLCanvasElement.prototype.getContext = () => null;
      w.matchMedia = w.matchMedia || (() => ({matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}}));
    }});
  return dom.window;
}
const settle = () => new Promise(r => setTimeout(r, 400));

(async () => {
  // 1. Real fixture: panel renders, sorted by re-sent cost, figures match payload.
  let w = load();
  await settle();
  const DATA = w.eval('DATA');
  const prof = Object.values(DATA.profiles);
  const all = prof.flatMap(p => p.resend || []);
  chk(all.length > 0, 'fixture carries resend rows', all.length);
  const rows = [...w.document.querySelectorAll('#resendtbl .resendrow')];
  chk(rows.length > 0 && rows.length <= 15, 'panel lists at most 15 sessions', rows.length);
  const cost = r => +r.children[5].textContent.replace(/[^0-9.]/g, '');
  const costs = rows.map(cost);
  chk(costs.every((c, i) => i === 0 || costs[i - 1] >= c), 'sorted worst first', costs.slice(0, 4).join(' >= '));
  const first = rows[0];
  const pr = all.find(r => r.id === first.dataset.sid);
  chk(!!pr, 'row id comes from the payload', first.dataset.sid);
  chk(pr && first.children[4].textContent === pr.cread_pct.toFixed(1) + '%', 'cached share is the payload value',
      first.children[4].textContent);
  chk(pr && first.children[2].textContent === pr.calls.toLocaleString(), 'calls is the payload value');
  const sub = w.document.getElementById('resendsub').textContent;
  chk(/sessions · \$[0-9.]+ of re-sent context/.test(sub), 'subtitle gives count and total', sub);
  chk(w.document.getElementById('resendmin').textContent === '10', 'minimum-calls rule stated on the page');

  // 2. Sessions under the minimum are never shown, even if the payload has them.
  w = load(d => {
    const p = Object.values(d.profiles)[0];
    p.resend = [{id: 'tiny', title: 'tiny', model: 'claude-opus-5', calls: 3, ctx_per_call: 1e6,
                 cread_pct: 99, resend_usd: 9999, cost_class: 'subscription', last: p.resend[0].last}]
               .concat(p.resend);
  });
  await settle();
  chk(!w.document.querySelector('#resendtbl [data-sid="tiny"]'), 'a 3-call session is filtered out');

  // 3. Titles are user text: attribute quoting and markup must be escaped.
  w = load(d => {
    const p = Object.values(d.profiles)[0];
    p.resend[0].title = '<img src=x onerror=alert(1)>"quoted"';
    p.resend[0].id = 'id"><b>x';
  });
  await settle();
  chk(!w.document.querySelector('#resendtbl img'), 'title markup is escaped, not rendered');
  chk(!w.document.querySelector('#resendtbl b'), 'id cannot break out of its attribute');

  // 4. Empty range: panel says so instead of keeping stale rows.
  w = load(d => { Object.values(d.profiles).forEach(p => { p.resend = []; }); });
  await settle();
  chk(/No session in this range/.test(w.document.getElementById('resendtbl').textContent),
      'no qualifying sessions: explicit empty state');

  // 5. Local rows are marked electricity, not billed dollars.
  // Mutate the single most expensive row: that one is ranked first in "All".
  w = load(d => {
    const top = Object.values(d.profiles).flatMap(p => p.resend || [])
      .sort((a, b) => b.resend_usd - a.resend_usd)[0];
    top.cost_class = 'local'; top.id = 'localtop';
  });
  await settle();
  const localRow = w.document.querySelector('#resendtbl [data-sid="localtop"]');
  chk(/elec/.test(localRow.textContent), 'a local session shows electricity, not billed', localRow.children[5].textContent);

  console.log(fail ? `FAILED  (${pass} passed, ${fail} failed)` : `ALL PASS  (${pass} passed, 0 failed)`);
  process.exit(fail ? 1 : 0);
})();
