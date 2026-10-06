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

  // First poll's fixture carries NO agents (matches today's live-data.json
  // shape before this ticket, and any older-Hermes payload) -> card hidden.
  chk(d.getElementById('agentscard').hidden !== false || d.getElementById('agentslist').innerHTML === '',
      'before any agents-bearing payload, the card is not showing stale content');

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

  chk(d.getElementById('agentscard').hidden === false,
      'a real pollLive() network response carrying agents shows the card, no manual eval needed');
  chk(d.getElementById('agentslist').textContent.includes('pollhost'),
      'the real fetched host name renders after a live poll');
  chk(w.eval(`DATA.profiles['${profileName}'].agents.length`) === 1,
      'pollLive() actually merged the agents array into DATA (not just painted the old array)');

  console.log(`\ncheck_agents_alive_poll.js  ${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
