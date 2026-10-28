// Home live board: EVERY row (Hermes, pi, Claude, Codex) names its owner with a
// profile/login/agent badge, so rows from different bots can be told apart in
// the merged All view. Hermes rows also show source + short id (full id in title=).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPORTS = process.env.LLM_TELEMETRY_REPORTS || path.join(__dirname, '..', 'examples', 'reports');
const html = fs.readFileSync(path.join(REPORTS, 'dashboard.html'), 'utf8');
const live = JSON.parse(fs.readFileSync(path.join(REPORTS, 'live-data.json'), 'utf8'));
const analytics = JSON.parse(fs.readFileSync(path.join(REPORTS, 'analytics-data.json'), 'utf8'));

let pass = 0, fail = 0;
const chk = (ok, name, got) => { ok ? (pass++, console.log('  ok  ' + name)) : (fail++, console.log('  FAIL ' + name + (got !== undefined ? ' - ' + got : ''))); };

const mk = (id, profile, source, title) => ({ id, title, profile, source, model: 'openai/gpt-5', category: 'Coding', idle_s: 20,
  uptime_s: 300, phase: 'editing', tools: ['terminal'], models: [{ model: 'openai/gpt-5', in_tok: 900, out_tok: 100, calls: 3 }] });
const HERMES = [
  mk('20261028_101500_a1b2c3', 'beinno-github', 'Bot Chat', 'Fix CI'),
  mk('20261028_101600_d4e5f6', 'beinno-plane', 'Bot Chat', 'Close tickets'),
  mk('20261028_101700_0a9b8c', 'llm-telemetry-brain', 'TUI', 'Plan the sprint'),
  mk('20261028_101800_77aa88', 'beinno-github', 'Kanban', 'Review PR'),
];
const PI = [{ session_id: 'pi-session-123456', agent: 'agent-sp', title: 'Pi task', model: 'glm-5', idle_s: 45, uptime_s: 600, phase: 'reading' }];
const AGENTS = [
  { engine: 'claude', session_id: 'claude-aaa111', login: 'beinno', title: 'alpha', model: 'claude-opus-4-5', idle_s: 12, uptime_s: 2400, phase: 'running Bash' },
  { engine: 'codex', session_id: 'codex-bbb222', login: '', title: 'beta', model: 'gpt-5-codex', idle_s: 30, uptime_s: 300, phase: 'thinking' },
];

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://127.0.0.1:8477/dashboard.html',
  beforeParse(w) {
    w.Chart = function () { return { destroy() {}, update() {} }; };
    w.Chart.defaults = { color: '', borderColor: '', font: {} };
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.fetch = u => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(String(u).includes('live-data') ? live : analytics) });
  },
});

setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    const paint = (h, p, a) => {
      w.eval(`DATA.profiles[current].live = ${JSON.stringify(h)}; DATA.pi_live = ${JSON.stringify(p)}; DATA.agent_live = ${JSON.stringify(a)}; renderLive();`);
      return [...d.querySelectorAll('#livelist > .liverow')];
    };
    const owner = r => r.querySelector('.lvowner');
    const rows = paint(HERMES, PI, AGENTS);
    chk(rows.length === 7, 'seven rows rendered (4 Hermes + pi + claude + codex)', rows.length);
    const missing = rows.filter(r => !owner(r)).length;
    chk(missing === 0, 'every row has a profile/owner badge', missing + ' without');

    const names = rows.filter(r => !r.dataset.pisession && !r.dataset.agentsession).map(r => owner(r) && owner(r).textContent);
    chk(['beinno-github', 'beinno-plane', 'llm-telemetry-brain', 'beinno-github'].every(n => names.includes(n)), 'Hermes badges show the profile names', names.join());
    const gh = rows.find(r => owner(r) && owner(r).textContent === 'beinno-github');
    chk(/hsl\(\d+ 62% 30%\)/.test(gh.querySelector('.lvowner').getAttribute('style'))
      && gh.querySelector('.lvowner').getAttribute('style').includes(`hsl(${w.eval("profileHue('beinno-github')")} `), 'badge is coloured with profileHue()');
    const hr = rows.find(r => r.querySelector('.lvowner').textContent === 'llm-telemetry-brain');
    chk(hr.querySelector('.lvsrc').textContent === 'TUI', 'source tag shown (TUI)');
    const sid = hr.querySelector('.lvsid');
    chk(sid && sid.textContent === '0a9b8c' && sid.title.startsWith('20261028_101700_0a9b8c'), 'short id = last 6 chars, full id in title=', sid && sid.textContent);
    chk(sid.dataset.tsession === '20261028_101700_0a9b8c' && sid.dataset.tprofile === 'llm-telemetry-brain' && sid.classList.contains('ttitlebtn'), 'short id opens the transcript like the title');
    chk(!!hr.querySelector('.lntimelinebtn'), 'Timeline chip still present');
    chk(owner(rows.find(r => r.dataset.pisession)).textContent === 'agent-sp', 'pi row badge = agent name');
    chk(owner(rows.find(r => r.dataset.engine === 'claude')).textContent === 'beinno', 'claude row badge = agent-worker login');
    chk(owner(rows.find(r => r.dataset.engine === 'codex')).textContent === 'codex', 'login-less codex row falls back to the agent name');

    // Hostile strings in profile / login / source / session id must be escaped, never parsed as markup.
    const EVIL = '<img src=x onerror=window.__pwn=1>"\'';
    const hostile = [{ ...HERMES[0], id: EVIL + 'ab12', profile: EVIL, source: EVIL, title: 'Evil' }];
    const hAgents = [{ ...AGENTS[0], login: EVIL, session_id: 'c-' + EVIL }];
    const hrows = paint(hostile, [], hAgents);
    chk(hrows.length === 2, 'hostile rows still render', hrows.length);
    chk(!d.querySelector('#livelist img') && !w.__pwn, 'no <img> element or handler injected via profile/login/source/id');
    chk(hrows.every(r => r.querySelector('.lvowner').textContent === EVIL), 'owner badges show the hostile text literally');
    const hsrc = hrows[0].querySelector('.lvsrc');
    chk(!!hsrc && hsrc.textContent.includes('<img') && !hsrc.querySelector('img'), 'source tag rendered as text, not markup');
    chk(![...d.querySelectorAll('#livelist *')].some(e => e.hasAttribute('onerror')), 'no element in the table carries an injected onerror attribute');
    chk(hrows[0].querySelector('.lvowner').getAttribute('title') === 'Profile: ' + EVIL && hrows[0].querySelector('.lvsid').title.startsWith(EVIL.slice(0, 20)),
      'attribute values (title=) round-trip the hostile text, i.e. were escaped, not parsed');
    // negative control: the same fixture with plain values yields no stray text escaping artefacts
    const calm = paint([HERMES[0]], [], []);
    chk(calm[0].querySelector('.lvowner').textContent === 'beinno-github' && !d.querySelector('#livelist img'), 'negative control: plain values render normally');

    // Hermes row WITHOUT a profile field (older payload): owner resolved from the profile that holds it
    const bare = HERMES.map(x => { const c = { ...x }; delete c.profile; return c; });
    w.eval(`DATA.profiles.work.live = ${JSON.stringify(bare)};`);
    const rows2 = paint(bare, [], []);
    chk(rows2.length === 4 && rows2.every(r => owner(r) && owner(r).textContent === 'work'),
      'profile-less Hermes rows still get a badge (owner looked up from the profile that holds the session)',
      rows2.map(r => owner(r) && owner(r).textContent).join());

    // negative control: strip the badge from rendered rows -> the same detector must flag them
    const copies = rows.map(r => r.cloneNode(true));
    copies.forEach(r => { const o = r.querySelector('.lvowner'); if (o) o.remove(); });
    chk(copies.filter(r => !owner(r)).length === rows.length, 'negative control: rows with the badge removed are all detected as missing');
    chk(w.eval('ownerBadge("")') === '', 'negative control: an empty profile renders no badge (so a data gap is caught, not hidden)');
  } catch (e) { fail++; console.log('  FAIL exception ' + (e.stack || e)); }
  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'}  (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
}, 600);
