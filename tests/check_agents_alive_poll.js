// #96/P10-08: agents alive — verifies the REAL pollLive() network path
// merges `agents` from the fetched live-data.json into DATA (not just
// direct-eval seeding, which check_agents_alive.js covers for rendering).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const R = process.env.LLM_TELEMETRY_REPORTS || require('path').join(__dirname, '..', 'examples', 'reports');
const html = fs.readFileSync(path.join(R, 'dashboard.html'), 'utf8');
const live = JSON.parse(fs.readFileSync(path.join(R, 'live-data.json'), 'utf8'));
const analytics = JSON.parse(fs.readFileSync(path.join(R, 'analytics-data.json'), 'utf8'));

let p = 0, f = 0;
const chk = (c, m) => { c ? (p++, console.log('  ok  ' + m)) : (f++, console.log('FAIL ' + m)); };

let currentLive = JSON.parse(JSON.stringify(live));
// The first poll's payload carries NO agents (an older-Hermes shape). The
// fixture does carry agents, so strip them here rather than relying on the
// merged 'All' view dropping them — it used to, which was a bug (#183).
Object.values(currentLive.profiles).forEach(q => { delete q.agents; });

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/dashboard.html',
  beforeParse(w) {
    w.fetch = (u) => {
      if (String(u).includes('live-data.json')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(currentLive) });
      }
      if (String(u).includes('analytics-data.json')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(analytics) });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    };
    w.HTMLCanvasElement.prototype.getContext = () => null;
    w.Chart = function () { return { destroy() {}, update() {}, resize() {}, data: {}, options: {} }; };
    w.Chart.register = () => {};
    w.Chart.getChart = () => null;
    w.Chart.defaults = { font: {}, plugins: { legend: { labels: {} } }, scale: { grid: {} } };
    w.URL.createObjectURL = () => 'blob:stub';
    w.URL.revokeObjectURL = () => {};
    w.matchMedia = q => ({ matches: false, media: q, addEventListener() {},
                           removeEventListener() {}, addListener() {}, removeListener() {} });
    const backing = new Map();
    Object.defineProperty(w, 'localStorage', {
      value: { getItem: k => backing.get(k) ?? null, setItem: (k, v) => backing.set(k, String(v)),
               removeItem: k => backing.delete(k), clear: () => backing.clear(),
               key: i => [...backing.keys()][i] ?? null, get length(){ return backing.size; } },
      configurable: true, writable: true });
  },
});
const w = dom.window, d = w.document;

(async () => {
  await new Promise(r => setTimeout(r, 60));   // let boot + first pollLive settle
  w.eval("current = Object.keys(DATA.profiles)[0]; view = 'Live';");
  const profileName = w.eval('current');

  // LST-258: the standalone Agents alive card is gone from the markup. Keep the
  // data-path assertions below (pollLive still has to merge agents into DATA) and
  // pin the removal so a re-added legacy panel fails this suite.
  chk(d.getElementById('agentscard') === null && d.getElementById('agentslist') === null,
      'legacy agents card/container are absent from the markup (LST-258)');

  // Next poll's fixture DOES carry agents -> pollLive's merge picks them up
  // and renderLive paints them, with zero test-side DOM manipulation.
  const nextLive = JSON.parse(JSON.stringify(live));
  nextLive.profiles[profileName].agents = [
    { backend: 'default@pollhost:777:zz', profile: profileName, host: 'pollhost', pid: 777,
      last_heartbeat: 1790690000.0, age_s: 3.0, state: 'alive', leases: 1, kill_hint: null },
  ];
  currentLive = nextLive;
  await w.pollLive();
  await new Promise(r => setTimeout(r, 10));

  chk(d.getElementById('agentscard') === null,
      'a real pollLive() network response carrying agents does not resurrect the removed card');
  chk(w.eval(`DATA.profiles['${profileName}'].agents.length`) === 1,
      'pollLive() actually merged the agents array into DATA (not just painted the old array)');

  console.log(`\ncheck_agents_alive_poll.js  ${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
