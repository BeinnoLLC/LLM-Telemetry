// LST-181/182/183/184: Home's above-the-fold live board.
//   182  four scorecards: sessions in flight, agents alive, calls/tokens (5 min), alerts
//   183  the agents panel rides in the table's right column (reflows under it < 1024px)
//   184  the throughput sparkline is a Chart.js canvas built ONCE through mk()
//        (the Chart.getChart guard) and fed in place on every poll
// Same real-page pattern as check_agent_live.js; the Chart stub registers a
// chart per canvas and throws on a second `new Chart` for a canvas that still
// has one, exactly like Chart.js ("Canvas is already in use").
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || path.join(__dirname, '..', 'examples', 'reports');
const html = fs.readFileSync(path.join(REPORTS, 'dashboard.html'), 'utf8');
const analytics = JSON.parse(fs.readFileSync(path.join(REPORTS, 'analytics-data.json'), 'utf8'));

let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
}

// ---- CSS / markup contract (no layout engine needed) -----------------------
const css = (re, name) => chk(re.test(html), name);
css(/@media\(max-width:1023px\)\{\s*\n\s*\.livegrid\{grid-template-columns:minmax\(0,1fr\)\}/,
  'agents panel column stacks under the table below 1024px');
css(/\.livegrid\{[^}]*grid-template-columns:minmax\(0,1fr\)\}/,
  'table takes the full width; the agents panel stacks under it (category/tool charts removed)');
css(/\.page\[data-pageview="Home"\] > \.view\[data-view="Home"\] > #qcard\{order:-25\}/,
  'on Home the task queue sits between the scorecards and the table (order -25)');
chk(!/<canvas id="cLiveCat"/.test(html) && !/<canvas id="cTools"/.test(html),
  'the By category donut and Tool calls chart canvases are gone');
chk(!/By category/.test(html) && !/Tool calls · last hour/.test(html), 'their panel titles are gone');
chk(/<canvas id="cHome6h"/.test(html), 'negative control: other Home charts (6h series) are still present');
css(/\.page\[data-pageview="Home"\] > \.view\[data-view="Home"\] > \.lkpis\{order:-30\}/,
  'on Home the scorecards lead (order -30)');
css(/\.page\[data-pageview="Home"\] > \.view\[data-view="Home"\] > \.livegrid\{order:-20\}/,
  'on Home the table + agents grid follows the scorecards (order -20)');
css(/\.lkpis\{display:grid;gap:8px;align-items:start;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}/,
  'scorecards are four tracks wide on desktop');

// Live feed: cumulative per-session counters that grow on every poll.
let tick = 0;
function session(id, profileTick) {
  return { id, title: id, phase: 'working', idle_s: 3, models: [
    { model: 'm', calls: 100 + 10 * profileTick, in_tok: 5000 * profileTick, out_tok: 500 * profileTick }] };
}
function liveFeed() {
  tick++;
  return {
    generated: 1790690000, schema_version: analytics.schema_version, errors: [], ollama: null,
    pi_live: [{ session_id: 'p-1', title: 'pi one', agent: 'a', phase: 'running', idle_s: 2, uptime_s: 60 }],
    agent_live: [
      { engine: 'claude', session_id: 'c-1', title: 'c1', phase: 'running Bash', idle_s: 3, uptime_s: 30 },
      { engine: 'codex', session_id: 'x-1', title: 'x1', phase: 'idle', idle_s: 400, uptime_s: 30 }],
    profiles: { work: { active: 2, live: [session('s-1', tick), session('s-2', tick)], tools_recent: [], logs: [],
      recent_ended: [], recent_delegations: [], agents: [
        { backend: 'b1', profile: 'work', host: 'h', pid: 1, age_s: 5, state: 'alive', leases: 1, last_heartbeat: 1 },
        { backend: 'b2', profile: 'work', host: 'h', pid: 2, age_s: 9999, state: 'dead', leases: 0, last_heartbeat: 1 }] } },
  };
}

const registry = new Map();      // canvas -> live chart
const built = {};                // canvas id -> times `new Chart` ran on it
function Chart(el, cfg) {
  if (registry.has(el)) throw new Error('Canvas is already in use');
  this.canvas = el; this.config = cfg; this.data = cfg.data;
  registry.set(el, this);
  built[el.id] = (built[el.id] || 0) + 1;
  this.destroy = () => { registry.delete(el); };
  this.update = () => {};
}
Chart.getChart = el => registry.get(el);
Chart.register = () => {}; Chart.registerables = []; Chart.overrides = {};
Chart.defaults = { color: '', borderColor: '', font: {}, plugins: { legend: { labels: {} } } };

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://127.0.0.1:8477/dashboard.html',
  beforeParse(w) {
    w.Chart = Chart;
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.HTMLCanvasElement.prototype.getContext = () => null;
    w.fetch = (u) => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve(String(u).includes('live-data') ? liveFeed() : analytics),
    });
  },
});

setTimeout(async () => {
  const w = dom.window, d = w.document;
  try {
    const cards = () => [...d.querySelectorAll('#livekpis > .lkpi')];
    const body = k => d.querySelector(`#livekpis [data-kpi="${k}"]`);
    const num = k => d.querySelector(`#livekpis [data-kpi="${k}"] .lkpi-num`).textContent;
    const FOLLOWING = w.Node.DOCUMENT_POSITION_FOLLOWING;
    const after = (a, b) => !!(a.compareDocumentPosition(b) & FOLLOWING);

    // ---- layout order: scorecards, then table + agents panel ---------------
    const kpis = d.getElementById('livekpis'), grid = d.getElementById('live-grid');
    chk(cards().length === 4, 'four scorecards', cards().length);
    chk(cards().map(c => c.dataset.kpi).join() === 'sessions,agents,throughput,alerts',
      'scorecards are sessions, agents, throughput, alerts in that order');
    chk(after(kpis, grid), 'scorecards come before the table + agents grid');
    chk(grid.contains(d.getElementById('livelist')) && grid.contains(d.getElementById('agentscard')),
      'the grid holds the session table and the agents panel');
    chk(after(d.getElementById('livelist'), d.getElementById('agentscard')),
      'agents panel follows the table (right column, stacks below at <1024px)');
    const qc = d.getElementById('qcard');
    chk(after(kpis, qc) && after(qc, grid), 'task queue sits directly under the scorecards, above In progress now');
    chk(!after(qc, kpis) && !after(grid, qc), 'negative control: queue is neither before the scorecards nor after the table');
    const between = (a, b) => { const out = []; for (let n = a.nextElementSibling; n && n !== b; n = n.nextElementSibling) out.push(n); return out; };
    const gap = between(qc, grid);
    chk(qc.parentElement === grid.parentElement && gap.length === 1 && gap[0].id === 'livetiles',
      'nothing but the hidden tiles sits between queue and table', gap.map(n => n.id || n.tagName).join());
    const stray = d.createElement('div'); stray.id = 'stray'; grid.parentElement.insertBefore(stray, grid);
    const gap2 = between(qc, grid);
    chk(!(gap2.length === 1 && gap2[0].id === 'livetiles'), 'negative control: an extra element between queue and table is detected');
    stray.remove();
    chk(d.querySelector('.page').dataset.pageview === 'Home', 'page carries data-pageview=Home so the Home ordering applies');

    // ---- values from fixture data ------------------------------------------
    w.eval('tputPrev = null; tputRing = [];');
    w.eval(`sampleThroughput({ work: { live: [{ id: 's1', models: [{ calls: 10, in_tok: 1000, out_tok: 100 }] },
      { id: 's2', models: [{ calls: 5, in_tok: 200, out_tok: 0 }] }] } }, 1000);`);
    w.eval(`sampleThroughput({ work: { live: [{ id: 's1', models: [{ calls: 40, in_tok: 3000, out_tok: 600 }] },
      { id: 's2', models: [{ calls: 5, in_tok: 200, out_tok: 0 }] }] } }, 1005);`);
    const P = {
      live: [{ id: 's1', idle_s: 1 }, { id: 's2', idle_s: 1 }],
      agents: [{ state: 'alive' }, { state: 'alive' }, { state: 'dead' }],
      alerts: [],
    };
    w.__P = P;
    w.eval(`renderLiveKpis(__P, 'work', 1005, { work: __P }, [{ engine: 'claude', session_id: 'c-1', phase: 'running', idle_s: 1 },
      { engine: 'codex', session_id: 'x-1', phase: 'idle', idle_s: 400 }], [{ session_id: 'p-1', phase: 'running' }]);`);
    chk(num('sessions') === '4', 'Sessions in flight = 2 hermes + 1 pi + 1 claude (idle codex excluded)', num('sessions'));
    chk(num('agents').replace(/\s/g, '') === '2/3', 'Agents alive = 2 of 3 heartbeating', num('agents'));
    chk(/1 not heartbeating/.test(body('agents').textContent), 'agents card says how many are not heartbeating');
    // calls: 40-10 + 5-5 = 30; tokens: (3600-1100) + 0 = 2,500 over the polls
    chk(num('throughput').replace(/\s/g, '') === '30·2.5K', 'calls/tokens in the window come from the poll-to-poll diff', num('throughput'));
    chk(/last/.test(body('throughput').textContent), 'throughput card states the window it covers');

    // ---- alerts: zero -> quiet pill; N -> count + list ---------------------
    const alertsBody = () => body('alerts');
    chk(!!alertsBody().querySelector('.lkpi-clear') && /All clear/.test(alertsBody().textContent),
      'zero alerts renders the "All clear" pill');
    chk(!alertsBody().querySelector('.lkpi-alist') && !alertsBody().querySelector('.lkpi-alerts'),
      'zero alerts renders no empty list / count');
    P.alerts = [
      { rule: 'a', severity: 'warning', message: 'Warn one', why: 'because' },
      { rule: 'b', severity: 'critical', message: 'Crit one' },
      { rule: 'c', severity: 'info', message: 'Info one' },
      { rule: 'd', severity: 'info', message: 'Info two' }];
    w.eval(`renderLiveKpis(__P, 'work', 1005, { work: __P }, [], []);`);
    chk(num('alerts') === '4', 'N alerts show a count', num('alerts'));
    const items = [...alertsBody().querySelectorAll('.lkpi-alist li:not(.amore)')];
    chk(items.length === 2 && /Crit one/.test(items[0].textContent) && items[0].classList.contains('crit'),
      'the list shows the most severe alerts first (critical leads)', items.map(i => i.textContent).join('|'));
    chk(/\+2 more/.test(alertsBody().querySelector('.amore').textContent), 'the rest are summarised as "+N more"');
    chk(!alertsBody().querySelector('.lkpi-clear'), 'no "All clear" pill while alerts are tripped');
    chk(/1 critical/.test(alertsBody().textContent), 'critical count shown under the number');
    chk(alertsBody().querySelector('a.lkpi-alerts').getAttribute('href') === '#/health', 'count links to Health');
    P.alerts = [];
    w.eval(`renderLiveKpis(__P, 'work', 1005, { work: __P }, [], []);`);
    chk(!!alertsBody().querySelector('.lkpi-clear'), 'alerts clearing returns to the "All clear" pill');

    // ---- sparkline: guarded path, one canvas, no leak across polls ---------
    const spark = () => d.querySelectorAll('#livekpis canvas');
    chk(spark().length === 1 && spark()[0].id === 'cLkpiSpark' && d.querySelector('[data-kpi="throughput"] #cLkpiSpark'),
      'one sparkline canvas, inside the throughput card');
    const canvas0 = spark()[0];
    const builtBefore = built.cLkpiSpark;   // page boot runs several full render()s first
    for (let i = 0; i < 3; i++) { await w.pollLive(); }
    chk(spark().length === 1, 'canvas count stays at 1 after 3 polls', spark().length);
    chk(spark()[0] === canvas0, 'the same canvas node survives the polls (not rebuilt by innerHTML)');
    chk(built.cLkpiSpark === builtBefore, 'no poll re-creates the sparkline Chart (built once, then updated in place)',
      `${builtBefore} -> ${built.cLkpiSpark}`);
    const ch = registry.get(canvas0);
    chk(!!ch && ch.config.type === 'line', 'the registered chart is a Chart.js line chart');
    chk(ch.data.datasets[0].data.length >= 2, 'the chart is fed from the live rolling window', ch.data.datasets[0].data.length);
    // a full render() destroys charts[]; the next paint rebuilds through the guard, never double-binds
    w.eval('render()');
    chk(spark().length === 1 && registry.get(canvas0) && built.cLkpiSpark === builtBefore + 1,
      'after a full render the chart is rebuilt once via the guard (no "already in use")', built.cLkpiSpark);
  } catch (e) { fail++; console.log('  FAIL threw ' + e.stack); }
  console.log(`\ncheck_home_above_fold.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1200);
