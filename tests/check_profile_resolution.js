// Profile resolution in the UI (P5-04, #53): counts in the header, detail on
// demand, an unreadable profile is a visible warning, and zero profiles is an
// actionable empty state naming the agent home that was searched.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');
const {JSDOM} = require('jsdom');
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || path.join(os.homedir(), '.local/share/llm-telemetry/reports');
const ROOT = path.join(__dirname, '..');
const PY = process.env.PYTHON
  || (fs.existsSync(path.join(ROOT, '.venv/bin/python')) ? path.join(ROOT, '.venv/bin/python') : 'python3');

let p = 0, f = 0;
const chk = (ok, l, x) => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${l}${x ? '  ' + x : ''}`); ok ? p++ : f++; };

// Build a variant dashboard from a mutated copy of the fixture payload.
function variant(mutate){
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'res-'));
  for (const fn of fs.readdirSync(REPORTS)) if (fn.endsWith('.json')) fs.copyFileSync(path.join(REPORTS, fn), path.join(dir, fn));
  const a = JSON.parse(fs.readFileSync(path.join(dir, 'analytics-data.json'), 'utf8'));
  mutate(a);
  fs.writeFileSync(path.join(dir, 'analytics-data.json'), JSON.stringify(a));
  const cfg = path.join(dir, 'cfg.json');
  fs.writeFileSync(cfg, JSON.stringify({reports_dir: dir, profiles: []}));
  execFileSync(PY, ['-m', 'llm_telemetry.build_dashboard', path.join(dir, 'dashboard.html')],
    {cwd: ROOT, env: {...process.env, LLM_TELEMETRY_NO_COLLECT: '1', LLM_TELEMETRY_CONFIG: cfg}, stdio: 'pipe'});
  return path.join(dir, 'dashboard.html');
}

function open(file){
  const html = fs.readFileSync(file, 'utf8').replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
  const live = JSON.parse(fs.readFileSync(path.join(REPORTS, 'live-data.json'), 'utf8'));
  return new JSDOM(html, {runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'http://127.0.0.1:8477/dashboard.html',
    beforeParse(w){
      w.Chart = function(){ return {destroy(){}, update(){}}; };
      w.Chart.defaults = {color: '', borderColor: '', font: {}};
      w.Chart.getChart = () => null;
      w.matchMedia = () => ({matches: false, addListener(){}, removeListener(){}});
      w.fetch = () => Promise.resolve({ok: true, status: 200, json: () => Promise.resolve(live)});
      w.console.error = () => {};
    }});
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // ---- payload carries the report ---------------------------------------
  const a = JSON.parse(fs.readFileSync(path.join(REPORTS, 'analytics-data.json'), 'utf8'));
  const r = a.resolution || {};
  chk(!!a.resolution, 'payload carries the resolution report');
  chk(['discovered', 'configured', 'excluded', 'failed'].every(k => Array.isArray(r[k])),
    'report has discovered / configured / excluded / failed lists');
  chk(!/\/home\/|\/Users\//.test(JSON.stringify(r)), 'report carries no absolute home path');

  // ---- healthy fixture: counts, no warning, popover on demand -----------
  {
    const dom = open(path.join(REPORTS, 'dashboard.html')); await wait(400);
    const d = dom.window.document;
    const btn = d.getElementById('resbtn');
    const n = Object.keys(a.profiles).length;
    chk(!!btn, 'header shows a profile summary');
    chk(btn && btn.textContent.includes(`${n} profile`), 'summary counts the profiles', btn && `"${btn.textContent.trim()}"`);
    chk(btn && !btn.classList.contains('warn'), 'no warning when everything opened');
    const pop = d.getElementById('respop');
    chk(pop && pop.hidden, 'detail is hidden until asked for');
    btn.dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true}));
    chk(pop && !pop.hidden, 'clicking the summary opens the detail');
    chk(pop && /Discovered:|From config:/.test(pop.textContent), 'detail lists where the profiles came from');
    dom.window.close();
  }

  // ---- unreadable + excluded profile ------------------------------------
  {
    const file = variant(x => {
      x.resolution = {...(x.resolution || {}), excluded: [{name: 'scratch', reason: 'listed in config exclude'}],
        failed: [{name: 'broken', path: '~/.hermes/profiles/broken/state.db', reason: 'DatabaseError: file is not a database'}]};
    });
    const dom = open(file); await wait(400);
    const d = dom.window.document;
    const btn = d.getElementById('resbtn');
    chk(btn && btn.classList.contains('warn'), 'an unreadable profile turns the summary into a warning');
    chk(btn && /1 unreadable/.test(btn.textContent), 'warning counts the unreadable profile', btn && `"${btn.textContent.trim()}"`);
    chk(btn && /1 excluded/.test(btn.textContent), 'summary counts the excluded profile');
    const pop = d.getElementById('respop');
    chk(pop && /broken/.test(pop.textContent) && /not a database/.test(pop.textContent),
      'detail names the unreadable profile and why');
    chk(pop && /scratch/.test(pop.textContent) && /exclude/.test(pop.textContent),
      'detail names the excluded profile and why');
    chk(!!d.getElementById('kpis') && d.getElementById('kpis').children.length > 0,
      'the readable profiles still render');
    dom.window.close();
  }

  // ---- zero profiles: actionable empty state -----------------------------
  {
    const file = variant(x => { x.profiles = {}; x.resolution = {agent_home: '~/nowhere', mode: 'discovered',
      discovered: [], configured: [], excluded: [], failed: []}; });
    const dom = open(file); await wait(400);
    const d = dom.window.document;
    const box = d.getElementById('noprofiles');
    chk(!!box, 'zero profiles renders an empty state, not a blank page');
    chk(box && box.textContent.includes('~/nowhere'), 'empty state names the agent home that was searched');
    chk(box && /LLM_TELEMETRY_AGENT_HOME/.test(box.textContent), 'empty state says how to fix it');
    chk(!d.getElementById('boot'), 'loader is not left spinning');
    dom.window.close();
  }

  // ---- explicit [] explains itself ---------------------------------------
  {
    const file = variant(x => { x.profiles = {}; x.resolution = {agent_home: '~/.hermes', mode: 'explicit-empty',
      config_file: '~/.config/llm-telemetry/config.json', discovered: [], configured: [], excluded: [], failed: []}; });
    const dom = open(file); await wait(400);
    const box = dom.window.document.getElementById('noprofiles');
    chk(box && /"profiles": \[\]/.test(box.textContent), 'explicit [] says the config asked for no profiles');
    dom.window.close();
  }

  console.log(`\n${f ? 'FAILED' : 'ALL PASS'}  (${p} passed, ${f} failed)`);
  process.exit(f ? 1 : 0);
})();
