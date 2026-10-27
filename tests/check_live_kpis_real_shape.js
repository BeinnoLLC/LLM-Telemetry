// LST-181 follow-up: the Home scorecards against a feed shaped like the REAL
// live-data.json (names anonymised): most profiles carry `agents: []`, the one
// gateway profile carries a long tail of dead/stale heartbeat rows, sessions
// carry several `models` entries with cumulative calls/tokens, and agent_live /
// pi_live are empty lists.
//   - Agents alive: no heartbeat rows is "unknown", never "all heartbeating"
//   - Calls · tokens: shows non-zero after 2+ polls whose counters grow, and
//     the "measuring…" label ends once the window holds data
//   - a session that first appears after the baseline does not dump its whole
//     cumulative history into the 5-minute window
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

const models = (tick, base) => [
  { model: 'model-a', tasks: ['main'], calls: base + 40 * tick, in_tok: 80000000 + 90000 * tick, out_tok: 700000 + 2000 * tick,
    last: 1790000000, base_url: 'https://api.example.test', main: true },
  { model: 'model-b', tasks: ['compression'], calls: 2500, in_tok: 5000000, out_tok: 90000, last: 1789000000,
    base_url: 'https://api.example.test', main: false }];
const session = (id, tick, base) => ({ id, title: 'Bot Chat', init_model: 'model-a', phase: 'receiving stream response',
  idle_s: 22, parent: '', tools: ['terminal'], model: 'model-a', nmodels: 2, base_url: 'https://api.example.test',
  category: 'Generating', kind: 'top-level', switched: true, up_bytes: 1000, down_bytes: 100, models: models(tick, base) });
const heartbeat = (i, state) => ({ backend: `gw@host:${100 + i}:abcd${i}`, profile: 'gateway-bot', host: 'host', pid: 100 + i,
  last_heartbeat: 1790000000 - i, age_s: state === 'alive' ? 3 : 90000, state, leases: 0, kill_hint: `kill ${100 + i}` });
const slice = (live, agents) => ({ active: live.length, live, tools_recent: [], logs: [], recent_ended: [],
  recent_delegations: [], agents });

let tick = 0, extraSession = false, withAgents = true;
function liveFeed() {
  tick++;
  const live = [session('sess-1', tick, 1000), session('sess-2', tick, 300)];
  const bots = { 'bot-one': slice([live[0]], []), 'bot-two': slice([live[1]], []),
    'bot-idle': slice(extraSession ? [session('sess-new', tick, 9000)] : [], []) };
  const agents = withAgents
    ? [heartbeat(1, 'alive'), heartbeat(2, 'alive'), heartbeat(3, 'stale'), heartbeat(4, 'dead')] : [];
  bots['gateway-bot'] = slice([], agents);
  return { generated: '2026-10-28T01:45:24', bytes_per_token: 4.68, schema_version: analytics.schema_version,
    profiles: bots, errors: [], ollama: null, pi_live: [], agent_live: [] };
}

const registry = new Map();
function Chart(el, cfg) {
  this.canvas = el; this.config = cfg; this.data = cfg.data; registry.set(el, this);
  this.destroy = () => registry.delete(el); this.update = () => {};
}
Chart.getChart = el => registry.get(el);
Chart.register = () => {}; Chart.registerables = []; Chart.overrides = {};
Chart.defaults = { color: '', borderColor: '', font: {}, plugins: { legend: { labels: {} } } };

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://127.0.0.1:8477/dashboard.html',
  beforeParse(w) {
    w.Chart = Chart;
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.HTMLCanvasElement.prototype.getContext = () => null;
    w.fetch = (u) => Promise.resolve({ ok: true, status: 200,
      json: () => Promise.resolve(String(u).includes('live-data') ? liveFeed() : analytics) });
  },
});

setTimeout(async () => {
  const w = dom.window, d = w.document;
  try {
    const card = k => d.querySelector(`#livekpis [data-kpi="${k}"]`);
    const text = k => card(k).textContent.replace(/\s+/g, ' ');
    const num = k => card(k).querySelector('.lkpi-num').textContent.replace(/\s/g, '');
    const render = (cur, profiles) => {
      w.__PR = profiles;
      w.eval(`current = ${JSON.stringify(cur)}; renderLiveKpis(__PR[current] || {}, current, undefined, __PR, [], [])`);
    };

    // ---- agents: no heartbeat rows ------------------------------------------
    const feed0 = liveFeed();
    render('bot-one', feed0.profiles);
    chk(num('agents') === '—', 'a profile with no heartbeat rows shows a dash, not 0/0', num('agents'));
    chk(/no agent heartbeats reported/.test(text('agents')), 'and says no agent heartbeats were reported', text('agents'));
    chk(!/all heartbeating/.test(text('agents')), 'and never claims "all heartbeating" for zero known agents', text('agents'));
    render('All', feed0.profiles);
    chk(num('agents') === '2/4' && /2 not heartbeating/.test(text('agents')),
      'the merged view counts the real heartbeat rows (2 of 4)', text('agents'));
    withAgents = false;
    render('All', liveFeed().profiles);
    chk(num('agents') === '—' && !/all heartbeating/.test(text('agents')),
      'a feed with no heartbeat rows at all stays honest in the merged view', text('agents'));
    withAgents = true;

    // ---- throughput: the real polling path ----------------------------------
    w.eval('tputPrev = null; tputRing = [];');
    render('All', feed0.profiles);
    chk(/measuring/.test(text('throughput')), 'before any poll the window reads "measuring…"', text('throughput'));
    await w.eval('pollLive()');
    await w.eval('pollLive()');
    await w.eval('pollLive()');
    w.eval('current = "All"; renderLive()');
    const t3 = text('throughput');
    chk(num('throughput') !== '0·0', 'counters that grew across polls show non-zero calls/tokens', t3);
    chk(/^[1-9][\d,]*\u00b7[1-9][\d.]*[KM]?$/.test(num('throughput')), 'calls and tokens are both non-zero', num('throughput'));
    chk(!/measuring/.test(t3), 'the measuring label ends once the window has data', t3);
    chk(/last \d+s/.test(t3), 'the window states how much history it holds', t3);
    w.eval('current = "bot-one"; renderLive()');
    chk(num('throughput') !== '0·0', 'a single profile view shows its own activity', text('throughput'));
    w.eval('current = "bot-idle"; renderLive()');
    chk(num('throughput') === '0·0', 'a profile with no session shows 0 (not another profile\'s)', text('throughput'));

    // ---- a session first seen mid-window must not dump its history ----------
    w.eval('current = "All"; renderLive()');
    const before = w.eval('throughputFor("All").calls');
    extraSession = true;
    await w.eval('pollLive()');
    const after = w.eval('throughputFor("All").calls');
    chk(after - before < 500, 'a new session (9,000 historic calls) adds only its later growth, not its history',
      `${before} -> ${after}`);
    await w.eval('pollLive()');
    chk(w.eval('throughputFor("All").calls') > after, 'and its growth counts from the next poll on');
  } catch (e) { fail++; console.log('  FAIL threw ' + e.stack); }
  console.log(`\ncheck_live_kpis_real_shape.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
