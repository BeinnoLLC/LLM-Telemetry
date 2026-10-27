// Grafana restyle G1: dark is the default theme, the accent is Grafana blue (not
// the old emerald), panels are 4px with 8px gutters, and the queue train shows
// every running car at once. Loads the BUILT page (examples/reports/dashboard.html).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const REPORTS = process.env.LLM_TELEMETRY_REPORTS || path.join(__dirname, '..', 'examples', 'reports');
const html = fs.readFileSync(path.join(REPORTS, 'dashboard.html'), 'utf8')
  .replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
const live = JSON.parse(fs.readFileSync(path.join(REPORTS, 'live-data.json'), 'utf8'));

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? ' — ' + got : ''}`);
  ok ? pass++ : fail++;
};

function boot(theme) {
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'http://127.0.0.1:8477/dashboard.html',
    beforeParse(w) {
      if (theme) w.localStorage.setItem('hermes-dash-theme', theme);
      w.Chart = function () { return { destroy() {}, update() {} }; };
      w.Chart.defaults = { color: '', borderColor: '', font: {} };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => null;
      w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(live) });
    },
  });
}
const rule = (sel, from = 0) => {
  const i = html.indexOf(sel + '{', from);
  return i < 0 ? '' : html.slice(i, html.indexOf('}', i) + 1);
};
const tok = (block, name) => (new RegExp('--' + name + ':\\s*([^;}]+)').exec(block) || [])[1];
const light = boot(null), saved = boot('light'), dark = boot('dark');

setTimeout(() => {
  const theme = d => d.window.document.documentElement.getAttribute('data-theme');
  // (a) default theme
  chk(theme(light) === 'dark', 'no saved theme -> data-theme=dark at load', theme(light));
  chk(theme(dark) === 'dark', 'saved dark -> dark');
  chk(theme(saved) === null, 'saved light -> light (no data-theme)', theme(saved));
  chk(/<script>try\{if\(localStorage\.getItem\('hermes-dash-theme'\)!=='light'\)document\.documentElement\.setAttribute\('data-theme','dark'\)/.test(html)
      && html.indexOf("setAttribute('data-theme','dark')") < html.indexOf('<style>'),
      'a pre-paint script in <head> defaults to dark (no light flash)');
  saved.window.document.getElementById('theme').click();
  chk(theme(saved) === 'dark', 'the toggle still flips light -> dark');

  // (b) accent token is blue, not the emerald
  const darkBlock = html.slice(html.indexOf('[data-theme="dark"]{'));
  const darkAcc = tok(darkBlock, 'accent'), lightAcc = tok(html.slice(html.indexOf(':root,\n[data-theme="light"]{')), 'accent');
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const isBlue = h => /^#[0-9a-f]{6}$/i.test(h || '') && (([r, g, b]) => b > r + 40 && b > g)(hex(h));
  chk(isBlue(darkAcc), 'dark --accent is blue', darkAcc);
  chk(isBlue(lightAcc), 'light --accent is blue', lightAcc);
  chk(!/#(3f8358|5aa276)/i.test(html.slice(html.indexOf('[data-theme="dark"]{'), html.indexOf('[data-theme="dark"]{') + 1200)) && lightAcc !== '#3f8358',
      'the emerald accent values are gone from the theme blocks');

  // (c) 4px panels, 8px gutters
  const card = rule('.card');
  chk(/border-radius:4px/.test(card), 'panel (.card) radius is 4px', card);
  const w = light.window;
  const doc = w.document, el = doc.createElement('div'); el.className = 'card'; doc.body.appendChild(el);
  chk(w.getComputedStyle(el).borderRadius === '4px', 'computed .card border-radius is 4px', w.getComputedStyle(el).borderRadius);
  chk(/:root\{[^}]*--gap:8px/.test(html), 'grid gap token --gap is 8px');
  chk(/\.page\{[^}]*gap:var\(--gap\)/.test(html), 'the page grid uses --gap');
  chk(/\.grid-kpi\{display:grid;gap:8px/.test(html) && /\.lkpis\{display:grid;gap:8px/.test(html), 'KPI grids use an 8px gap');

  // (d) all running cars visible
  const d = w.document, rb = d.getElementById('qt-running');
  const items = Array.from({ length: 8 }, (_, i) => `{id:'r${i}', model:'m${i}', title:'car ${i}', idle_s:${i}}`).join(',');
  w.eval(`DATA.ollama = {hosts: []}; DATA.pi_live = []; DATA.agent_live = []; DATA.profiles[current].live = [${items}]; DATA.profiles[current].recent_sessions = []; renderQueue();`);
  const consist = rb.querySelector('.qt-consist');
  const cars = [...consist.querySelectorAll('.qt-car[data-key]')].filter(c => !c.classList.contains('qt-leaving'));
  chk(cars.length === 8, '8 running cars are rendered', cars.length);
  const cs = w.getComputedStyle(consist);
  chk(cs.position !== 'absolute', 'the consist is in flow (not absolutely slid out of the viewport)', cs.position);
  chk(cs.flexWrap === 'wrap-reverse', 'the consist wraps', cs.flexWrap);
  const moved = [consist, ...cars].filter(e => e.style.transform || e.style.opacity === '0' || /qt-run/.test(w.getComputedStyle(e).animationName || ''));
  chk(moved.length === 0, 'no translate/animation/fade keeps any of the 8 cars off-screen', moved.length);
  chk(!/\.qt-consist\{[^}]*(animation|transform:(?!none))/.test(html) && !/@keyframes qt-run\b/.test(html),
      'no CSS animation or transform moves the consist');
  const line = rule('.qt-line .qt-cars');
  chk(!/overflow:hidden/.test(line) && !/(^|[^-])height:\d+px/.test(line), 'the line viewport does not clip (no fixed height/overflow:hidden)', line);

  console.log(`\ncheck_grafana_theme.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 500);
