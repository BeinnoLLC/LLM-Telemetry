// Delegation outcomes panel (#90).
//
// The failure this guards against is a panel that renders but lies: rates must
// come from the per-child payload, the measured tool numbers must be labelled
// as measured, and model-authored goal text must never reach innerHTML as
// markup.
const fs = require('fs'), { JSDOM } = require('jsdom');

const REPORTS = process.env.LLM_TELEMETRY_REPORTS || 'examples/reports';
const raw = fs.readFileSync(REPORTS + '/dashboard.html', 'utf8');
const html = raw.replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
const payload = JSON.parse(fs.readFileSync(REPORTS + '/analytics-data.json', 'utf8'));

let failed = 0, total = 0;
function chk(cond, label, extra) {
  total++;
  console.log((cond ? '  OK   ' : '  FAIL ') + label + (extra ? `  (${extra})` : ''));
  if (!cond) failed++;
}

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  // Opaque origins have no localStorage, and this page reads it on boot.
  url: 'http://127.0.0.1:8477/dashboard.html',
  beforeParse(w) {
    w.Chart = function () { return { destroy() {}, update() {}, resize() {} }; };
    w.Chart.defaults = { font: {}, plugins: { legend: {} } };
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.fetch = () => Promise.reject(new Error('no network in tests'));
  },
});

setTimeout(() => {
  const w = dom.window, d = w.document;
  const card = d.getElementById('delegcard');
  // The page defaults to the synthetic "All" tab, whose payload is the merge
  // of every profile — assert against what is actually being rendered, not
  // against one profile's slice.
  const g = JSON.parse(w.eval('JSON.stringify(DATA.profiles[current].delegations)'));
  const prof = Object.values(payload.profiles)[0];

  chk(!!card, 'delegation card exists');
  chk(!!g, 'fixture carries a delegation payload');
  chk(card && !card.hidden, 'card is visible when delegations exist');

  // --- headline numbers must match the payload, not be re-derived in the UI
  const kpi = d.getElementById('delegkpi').textContent;
  chk(kpi.includes(String(g.children)), 'child count rendered', g.children);
  chk(kpi.includes(String(g.rate)), 'completion rate rendered', g.rate + '%');
  chk(kpi.includes(String(g.wasted_hours)), 'wasted hours rendered', g.wasted_hours);

  // The whole point of the ticket: a failing run must be visible as failing.
  chk(g.rate < 100, 'fixture actually contains failures (negative case covered)', g.rate);
  const badKpi = d.querySelectorAll('#delegkpi .dkpi-n.bad').length;
  chk(badKpi >= 1, 'failure numbers are styled as bad, not neutral', badKpi);

  // --- per-model rows: one per model, worst first, rate matches payload
  const rows = d.querySelectorAll('#delegmodels .drow');
  chk(rows.length === g.by_model.length, 'one row per model',
      `${rows.length} vs ${g.by_model.length}`);
  const firstTxt = rows[0] ? rows[0].textContent : '';
  chk(firstTxt.includes(String(g.by_model[0].rate)),
      'first model row shows its real rate', g.by_model[0].rate + '%');
  const weakest = g.by_model.find(m => m.rate < 95);
  chk(!!weakest, 'fixture has an under-performing model');
  const weakRow = [...rows].find(r => r.textContent.includes(String(weakest.rate)));
  chk(!!weakRow && !!weakRow.querySelector('.bad'),
      'under-performing model is flagged bad', weakest.model + ' ' + weakest.rate + '%');

  // Bar widths must track the rate — a bar pinned at 100% would look clean
  // while the number said otherwise.
  const span = weakRow && weakRow.querySelector('.dbar span');
  const wpx = span ? span.style.width : '';
  chk(wpx === weakest.rate + '%', 'bar width equals the rate', wpx);

  // --- failure reasons come from the runtime's own field
  const reasons = d.getElementById('delegreasons').textContent;
  const keys = Object.keys(g.reasons || {});
  chk(keys.length > 0, 'fixture carries failure reasons', keys.join(','));
  chk(keys.every(k => reasons.includes(k)), 'every reason is rendered', keys.join(','));

  // --- measured vs inferred must be distinguishable by a reader
  const toolsLbl = [...d.querySelectorAll('#delegcard .lbl')]
    .map(e => e.textContent).join(' | ');
  chk(/measured/i.test(toolsLbl), 'tool rates are labelled measured', toolsLbl.slice(0, 60));
  chk(g.tools_measured === true, 'payload flags tools as measured');
  const trows = d.querySelectorAll('#delegtools .drow');
  chk(trows.length > 0 && trows.length <= 8, 'tool rows rendered and capped', trows.length);

  // --- recent list: escaped, newest first
  const items = d.querySelectorAll('#deleglist .ditem');
  chk(items.length > 0, 'recent runs rendered', items.length);
  const dots = d.querySelectorAll('#deleglist .ddot.bad').length;
  chk(dots > 0, 'failed runs marked with a bad dot', dots);

  // XSS: a goal containing markup must not become an element.
  // DATA is a module-scoped `let`, not a window property — reach it via eval.
  const evil = '<img src=x onerror=alert(1)>';
  w.eval(`DATA.profiles[current].delegations.recent[0].goal = ${JSON.stringify(evil)}`);
  w.eval('renderDeleg()');
  chk(d.querySelectorAll('#deleglist img').length === 0,
      'goal text is escaped, never parsed as markup');
  chk(d.getElementById('deleglist').textContent.includes('<img'),
      'escaped goal still shows the literal text');

  // --- hides cleanly when a profile has no delegations
  w.eval('DATA.profiles[current].delegations = null');
  w.eval('renderDeleg()');
  chk(d.getElementById('delegcard').hidden === true,
      'card hides when the profile has no delegations');

  // --- merged "All" tab must not average rates (the buildAll bug)
  const merged = w.eval(`JSON.stringify(mergeDelegations([
    {children:2, ok:1, rate:50, wasted_hours:1, cost_usd:0,
     by_model:[{model:'m', n:2, ok:1, rate:50, cost_usd:0, tokens:0, hours:0, wasted_hours:1}],
     tools:[{tool:'t', calls:2, fail:1, rate:50}], reasons:{a:1}, exits:{}, recent:[], tools_measured:true},
    {children:100, ok:99, rate:99, wasted_hours:0, cost_usd:0,
     by_model:[{model:'m', n:100, ok:99, rate:99, cost_usd:0, tokens:0, hours:0, wasted_hours:0}],
     tools:[{tool:'t', calls:100, fail:1, rate:99}], reasons:{a:2}, exits:{}, recent:[], tools_measured:true}
  ]))`);
  const mg = JSON.parse(merged);
  chk(mg.children === 102 && mg.ok === 100, 'merged counters add up',
      `${mg.ok}/${mg.children}`);
  chk(mg.rate === 98.0, 'merged rate is recomputed, not averaged (would be 74.5)', mg.rate);
  chk(mg.by_model[0].rate === 98.0, 'per-model merged rate recomputed', mg.by_model[0].rate);
  chk(mg.reasons.a === 3, 'reason counts summed across profiles', mg.reasons.a);

  const passed = total - failed;
  console.log();
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}, 400);
