// Claude Code / Codex (agent-worker) sessions on the Live tab: badged with
// their own glyph, merged into #livelist keyed '<engine>:<id>', and counted by
// the live KPIs. Same real-page pattern as check_pi_live.js; agent_live is
// injected into DATA since the committed fixture carries none.
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
  { engine: 'claude', session_id: 'c-1', cwd: '/w/alpha', title: 'alpha', model: 'claude-opus-4-5', idle_s: 12, phase: 'running Bash' },
  { engine: 'codex', session_id: 'x-1', cwd: '/w/beta', title: 'beta', model: null, idle_s: 30, phase: 'thinking' },
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
    const kpi = k => d.querySelector(`#livekpis [data-kpi="${k}"] .lkpi-num`);
    w.eval('DATA.agent_live = []; renderLive();');
    const base = {
      sessions: Number(kpi('sessions').textContent),
      alive: parseInt(kpi('agents').textContent, 10),
      agentsText: kpi('agents').parentElement.textContent,
    };
    chk(d.querySelectorAll('#livelist [data-agentsession]').length === 0, 'no agent rows when agent_live is empty');

    w.eval(`DATA.agent_live = ${JSON.stringify(AGENTS)}; renderLive();`);
    const rows = [...d.querySelectorAll('#livelist [data-agentsession]')];
    chk(rows.length === 2, 'one row per Claude/Codex session in #livelist', rows.length);
    const c = rows.find(r => r.dataset.agentsession === 'c-1');
    const x = rows.find(r => r.dataset.agentsession === 'x-1');
    chk(c && c.querySelector('[data-kindbadge="claude"]'), 'claude row carries the claude badge');
    chk(x && x.querySelector('[data-kindbadge="codex"]'), 'codex row carries the codex badge');
    const glyph = r => r.querySelector('[data-kindbadge]').textContent;
    chk(glyph(c) !== glyph(x), 'claude and codex glyphs differ');
    chk(c && ['pi', 'hermes'].every(k => glyph(c) !== w.eval(`kindBadge('${k}')`).replace(/<[^>]+>/g, '')),
        'claude glyph differs from pi/hermes');
    chk(c && c.textContent.includes('alpha') && c.textContent.includes('running Bash'), 'row shows title and phase');
    chk(x && x.textContent.includes('—') && !/null|undefined/.test(x.textContent), 'unknown model renders as a dash');

    chk(Number(kpi('sessions').textContent) === base.sessions + 2, 'Sessions in flight counts agent sessions',
        `${base.sessions} -> ${kpi('sessions').textContent}`);
    chk(parseInt(kpi('agents').textContent, 10) === base.alive, 'Agents alive ignores agent sessions',
        `${base.alive} -> ${kpi('agents').textContent}`);
    chk(kpi('agents').parentElement.textContent === base.agentsText, 'Agents alive denominator unchanged',
        `${base.agentsText} -> ${kpi('agents').parentElement.textContent}`);

    // idle sessions are not "in flight"; duplicates collapse to one row/count
    w.eval(`DATA.agent_live = ${JSON.stringify([...AGENTS, { engine: 'codex', session_id: 'x-2', title: 'done', idle_s: 5, phase: 'idle' }])}; renderLive();`);
    chk(Number(kpi('sessions').textContent) === base.sessions + 2, 'idle agent session not counted in flight',
        kpi('sessions').textContent);
    chk(d.querySelectorAll('#livelist [data-agentsession]').length === 3, 'idle session still listed');
    w.eval(`DATA.agent_live = ${JSON.stringify([AGENTS[0], { ...AGENTS[0], idle_s: 1, title: 'fresh' }])}; renderLive();`);
    const dup = [...d.querySelectorAll('#livelist [data-agentsession]')];
    chk(dup.length === 1 && dup[0].textContent.includes('fresh'), 'duplicate engine:session_id deduped, freshest kept', dup.length);
    chk(Number(kpi('sessions').textContent) === base.sessions + 1, 'duplicate counted once in flight');

    // cwd never reaches the DOM
    w.eval(`DATA.agent_live = ${JSON.stringify(AGENTS)}; renderLive();`);
    chk(!d.querySelector('#livelist').innerHTML.includes('/w/alpha'), 'absolute cwd absent from rendered rows');

    // XSS: markup/quotes in title, phase, model must stay inert text
    const XSS = '<img src=x onerror="window.__pwn=1">"\'><script>window.__pwn=1</script>';
    w.eval(`DATA.agent_live = ${JSON.stringify([{ engine: 'claude', session_id: 'xss-1', title: XSS, model: XSS, idle_s: 1, phase: XSS },
      { engine: 'codex', session_id: 'x"y', title: 't', idle_s: 1, phase: 'p' }])}; renderLive();`);
    const list = d.querySelector('#livelist');
    chk(!list.querySelector('img, script'), 'XSS: no injected elements from title/phase/model');
    chk(!w.__pwn, 'XSS: payload never executed');
    chk(![...list.querySelectorAll('*')].some(e => [...e.attributes].some(a => /^on/i.test(a.name))),
        'XSS: no on* attributes injected');
    chk(list.textContent.includes('<img'), 'XSS: payload shown as literal text');

    w.eval('DATA.agent_live = []; renderLive();');
    chk(d.querySelectorAll('#livelist [data-agentsession]').length === 0, 'rows disappear when sessions end');
  } catch (e) { fail++; console.log('  FAIL threw ' + e.stack); }
  console.log(`\ncheck_agent_live.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 800);
