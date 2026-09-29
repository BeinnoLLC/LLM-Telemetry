// #96/P10-08: agents alive — gateway backends + mid-turn leases (Live view).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'examples', 'reports', 'dashboard.html'), 'utf8');

let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
}

function bootDOM() {
  const backing = new Map();
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://127.0.0.1:8477/dashboard.html',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => null;
      function Stub(ctx, cfg) { this.config = cfg; this.destroy = () => {}; this.update = () => {}; this.canvas = ctx; }
      Stub.register = () => {}; Stub.overrides = {}; Stub.instances = {}; Stub.getChart = () => null;
      Stub.registerables = []; Stub.version = 'stub'; Stub.controllers = {}; Stub.elements = {}; Stub.plugins = {}; Stub.scales = {};
      Stub.defaults = { font: { size: 10, family: '', weight: '' }, color: '' };
      w.Chart = Stub;
      Object.defineProperty(w, 'localStorage', {
        value: { getItem: k => backing.get(k) ?? null, setItem: (k, v) => backing.set(k, String(v)),
                 removeItem: k => backing.delete(k), clear: () => backing.clear(),
                 key: i => [...backing.keys()][i] ?? null, get length(){ return backing.size; } },
        configurable: true, writable: true });
    },
  });
}

const dom = bootDOM();
setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    chk(!!d.getElementById('agentscard'), 'the agents card markup exists');
    chk(!!d.getElementById('agentslist'), 'the agents list container exists');

    w.eval("current = 'work'; view = 'Live';" +
      "DATA.profiles.work.agents = [" +
      "{backend:'default@workbox:6049:a1b2',profile:'work',host:'workbox',pid:6049,last_heartbeat:1790690000.0,age_s:8.0,state:'alive',leases:2,kill_hint:null}," +
      "{backend:'default@buildbox:19342:c3d4',profile:'work',host:'buildbox',pid:19342,last_heartbeat:1790430000.0,age_s:259200.0,state:'dead',leases:0,kill_hint:'kill 19342'}" +
      "]; render();");
    chk(d.getElementById('agentscard').hidden === false,
        'the card is shown for the sample "work" profile (has 2 agents)');

    const text = d.getElementById('agentslist').textContent;
    chk(text.includes('alive') && text.includes('dead'), 'both alive and dead states render');
    chk(text.includes('workbox') && text.includes('6049'), 'the alive backend shows real host and pid');
    chk(text.includes('kill 19342'), 'the dead backend shows a real kill hint');
    chk(!text.includes('kill') || text.match(/kill \d+/g).length === 1,
        'only the dead backend gets a kill hint, not the alive one');
    chk(text.includes('2 leases'), 'the alive backend shows its real lease count');

    // Switch to "personal" (1 stale agent, no kill hint — age-only, unconfirmed).
    w.eval("current = 'personal';" +
      "DATA.profiles.personal.agents = [" +
      "{backend:'default@laptop:842:e5f6',profile:'personal',host:'laptop',pid:842,last_heartbeat:1790689900.0,age_s:140.0,state:'stale',leases:0,kill_hint:null}" +
      "]; render();");
    chk(d.getElementById('agentscard').hidden === false,
        'the card stays shown for personal (1 stale agent)');
    const personalText = d.getElementById('agentslist').textContent;
    chk(personalText.includes('stale'), 'the stale backend renders its real state');
    chk(!personalText.includes('kill'), 'a stale (unconfirmed) backend never gets a kill hint');

    // Negative control: an empty agents array hides the card entirely.
    w.eval("DATA.profiles.personal.agents = []; render();");
    chk(d.getElementById('agentscard').hidden === true,
        'an empty agents list hides the card entirely (negative control)');

    // Negative control: agents === undefined (older payload) also hides cleanly.
    w.eval("delete DATA.profiles.personal.agents; render();");
    chk(d.getElementById('agentscard').hidden === true,
        'a missing agents key (older payload shape) hides the card without crashing');

    console.log(`\ncheck_agents_alive.js  ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 10).join('\n'));
    console.log(`\ncheck_agents_alive.js  ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
}, 1500);
