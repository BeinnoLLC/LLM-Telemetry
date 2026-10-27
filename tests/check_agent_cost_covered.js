// Claude Code / Codex live sessions: the Cost cell shows the API-price
// equivalent with a "sub" (covered by subscription) treatment, and that value
// never reaches the Est. cost KPI. Same real-page pattern as check_agent_live.js.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || path.join(__dirname, '..', 'examples', 'reports');
const html = fs.readFileSync(path.join(REPORTS, 'dashboard.html'), 'utf8');
const live = JSON.parse(fs.readFileSync(path.join(REPORTS, 'live-data.json'), 'utf8'));
const analytics = JSON.parse(fs.readFileSync(path.join(REPORTS, 'analytics-data.json'), 'utf8'));

let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
}

const AGENTS = [
  { engine: 'claude', session_id: 'c-1', title: 'alpha', model: 'claude-opus-4-5', idle_s: 12, phase: 'running Bash',
    in_tok: 1500, out_tok: 2100, cost_usd: 123.4567, cost_class: 'subscription' },
  { engine: 'codex', session_id: 'x-1', title: 'beta', model: 'gpt-5.3-codex', idle_s: 30, phase: 'thinking',
    in_tok: 6000, out_tok: 500, cost_usd: 0.0182, cost_class: 'subscription' },
  { engine: 'claude', session_id: 'c-2', title: 'nocost', model: 'mystery', idle_s: 5, phase: 'thinking',
    in_tok: 70, out_tok: 30, cost_usd: null, cost_class: 'subscription' },
];

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://127.0.0.1:8477/dashboard.html',
  beforeParse(w) {
    w.Chart = function () { return { destroy() {}, update() {} }; };
    w.Chart.defaults = { color: '', borderColor: '', font: {} };
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.fetch = (u) => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve(String(u).includes('live-data') ? live : analytics),
    });
  },
});

setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    const estCost = () => {
      const card = [...d.querySelectorAll('#kpis .kpi-card')]
        .find(c => (c.querySelector('.kpi-name') || {}).textContent === 'Est. cost');
      return card ? card.querySelector('.kpi-big').textContent : null;
    };
    w.eval('DATA.agent_live = []; render();');
    const before = estCost();
    chk(before && /\$\d/.test(before), 'Est. cost KPI renders a dollar total', before);

    w.eval(`DATA.agent_live = ${JSON.stringify(AGENTS)}; render();`);
    const row = id => d.querySelector(`#livelist [data-agentsession="${id}"]`);
    const cell = (id, n = 2) => row(id).querySelectorAll('.lvnum')[n];
    const c = cell('c-1'), x = cell('x-1');
    chk(c.querySelector('.lvcov') && c.textContent.includes('$123.46'), 'claude cost cell shows the API-equivalent value', c.textContent);
    chk(c.querySelector('.lvsubb') && c.querySelector('.lvsubb').textContent === 'sub', 'claude cost cell carries the "sub" badge');
    chk(/covered by your Claude subscription/.test(c.title) && /API-price equivalent/.test(c.title), 'claude cell title explains it', c.title);
    chk(/covered by your ChatGPT subscription/.test(x.title), 'codex cell title names the ChatGPT subscription', x.title);
    chk(/\$0\.018/.test(x.textContent) && x.querySelector('.lvsubb'), 'codex cell shows value + badge', x.textContent);
    const lbl = c.querySelector('.lvcov').getAttribute('aria-label');
    chk(/\$123\.46, API-price equivalent, covered by your Claude subscription/.test(lbl), 'aria-label reads value and coverage', lbl);
    chk(cell('c-2').textContent.trim() === '—' && !cell('c-2').querySelector('.lvsubb'), 'unpriced session shows a dash, no badge');
    chk(cell('c-1', 1).textContent === '3.6K', 'tokens cell shows in+out (1500+2100)', cell('c-1', 1).textContent);

    chk(estCost() === before, 'Est. cost KPI unchanged by subscription-covered sessions', `${before} -> ${estCost()}`);
    chk(!d.getElementById('kpis').textContent.includes('123.46'), 'covered value absent from the KPI row');

    // a non-subscription row (PI, metered) keeps the plain cost cell
    w.eval(`DATA.agent_live = []; DATA.pi_live = [{session_id:'p-1',agent:'a',title:'t',model:'m',idle_s:1,phase:'x',cost_usd:2,in_tok:1,out_tok:1}]; renderLive();`);
    const pc = d.querySelector('#livelist [data-pisession="p-1"]');
    chk(pc && !pc.querySelector('.lvsubb') && pc.textContent.includes('$2.0000'), 'pi row cost stays plain, no badge', pc && pc.textContent);
  } catch (e) { fail++; console.log('  FAIL threw ' + e.stack); }
  console.log(`\ncheck_agent_cost_covered.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 800);
