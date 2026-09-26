// Payload contract (#23): schema_version on every payload, a loud error on a
// mismatch instead of a silently empty dashboard.
const fs = require('fs');
const path = require('path');
const {JSDOM} = require('jsdom');
const {execFileSync} = require('child_process');

const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || path.join(require('os').homedir(), '.local/share/llm-telemetry/reports');
const ROOT = path.join(__dirname, '..');
let p = 0, f = 0;
const chk = (ok, l, x) => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${l}${x ? '  ' + x : ''}`); ok ? p++ : f++; };

// Every payload on disk carries the version.
const SV = +((fs.readFileSync(path.join(ROOT, 'src/llm_telemetry/schema.py'), 'utf8')
  .match(/^SCHEMA_VERSION\s*=\s*(\d+)/m) || [])[1]);
chk(SV >= 1, 'schema.py defines SCHEMA_VERSION', `(${SV})`);
for (const n of ['analytics', 'live', 'ollama', 'router', 'logs']) {
  const d = JSON.parse(fs.readFileSync(`${REPORTS}/${n}-data.json`, 'utf8'));
  chk(d.schema_version === SV, `${n}-data.json carries schema_version ${SV}`, `(${d.schema_version})`);
}

// Every collector stamps what it writes (source check: running them would read
// real ~/.hermes data, which the tests must never do).
for (const m of ['collect_analytics', 'collect_live', 'collect_logs', 'collect_router', 'probe_hosts']) {
  const src = fs.readFileSync(path.join(ROOT, `src/llm_telemetry/${m}.py`), 'utf8');
  chk(/from \.schema import stamp/.test(src) && /stamp\(/.test(src.replace(/from \.schema import stamp/, '')),
    `${m}.py stamps its payload`);
}

const html0 = fs.readFileSync(`${REPORTS}/dashboard.html`, 'utf8')
  .replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
chk(new RegExp(`const SCHEMA_VERSION = ${SV};`).test(html0), 'page bakes in the same version');

function boot(mutate, cb) {
  // Rewrite the embedded analytics payload to simulate a stale/mismatched build.
  const m = html0.match(/let DATA = (\{[\s\S]*?\});\n\/\/ Injected from config/);
  const data = JSON.parse(m[1]);
  mutate(data);
  const html = html0.replace(m[1], () => JSON.stringify(data));
  const errs = [];
  const vc = new (require('jsdom').VirtualConsole)();
  vc.on('jsdomError', e => errs.push(String(e.message || e)));
  const dom = new JSDOM(html, {runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    url: 'http://127.0.0.1:8477/dashboard.html',
    beforeParse(w) {
      w.Chart = function () { return {destroy() {}, update() {}}; };
      w.Chart.defaults = {color: '', borderColor: '', font: {}};
      w.Chart.getChart = () => null;
      w.matchMedia = () => ({matches: false, addListener() {}, removeListener() {}, addEventListener() {}});
      const live = JSON.parse(fs.readFileSync(REPORTS + '/live-data.json', 'utf8'));
      w.fetch = () => Promise.resolve({ok: true, status: 200, json: () => Promise.resolve(live)});
    }});
  setTimeout(() => cb(dom.window.document, errs), 300);
}

boot(d => {}, (d) => {
  chk(!d.getElementById('schemaerr'), 'matching version: no error panel');
  chk(d.querySelectorAll('#kpis > *').length > 0, 'matching version: KPIs render');
  boot(d => { d.schema_version = SV + 1; }, (d) => {
    const e = d.getElementById('schemaerr');
    chk(!!e, 'wrong version: error panel shown');
    const t = e ? e.textContent : '';
    chk(new RegExp(`expects ${SV}`).test(t) && new RegExp(String(SV + 1)).test(t),
      'error names expected and found versions', `(${t.slice(0, 90)})`);
    chk(d.querySelectorAll('#kpis > *').length === 0, 'wrong version: nothing rendered behind it');
    chk(!d.getElementById('boot'), 'wrong version: loader is not left spinning');
    boot(d => { delete d.schema_version; }, (d) => {
      const e = d.getElementById('schemaerr');
      chk(!!e && /stale payload/.test(e.textContent), 'missing key: stale-payload message', `(${e ? e.textContent.slice(0, 70) : ''})`);
      // Build side: the Python builder refuses a stale payload too.
      const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sv-'));
      for (const n of ['analytics', 'router']) fs.copyFileSync(`${REPORTS}/${n}-data.json`, `${tmp}/${n}-data.json`);
      const a = JSON.parse(fs.readFileSync(`${tmp}/analytics-data.json`, 'utf8'));
      delete a.schema_version;
      fs.writeFileSync(`${tmp}/analytics-data.json`, JSON.stringify(a));
      let out = '', code = 0;
      try {
        execFileSync(path.join(ROOT, '.venv/bin/python'), ['-m', 'llm_telemetry.build_dashboard', `${tmp}/dashboard.html`],
          {cwd: ROOT, encoding: 'utf8', stdio: 'pipe',
           env: {...process.env, LLM_TELEMETRY_NO_COLLECT: '1', LLM_TELEMETRY_REPORTS_DIR: tmp,
                 LLM_TELEMETRY_CONFIG: writeCfg(tmp)}});
      } catch (e) { code = e.status; out = (e.stderr || '') + (e.stdout || ''); }
      chk(code !== 0 && /schema_version/.test(out), 'builder refuses a stale payload', `(exit ${code}: ${out.trim().split('\n').pop()})`);
      fs.rmSync(tmp, {recursive: true, force: true});
      console.log(`\n${f ? 'FAILED' : 'ALL PASS'}  (${p} passed, ${f} failed)`);
      process.exit(f ? 1 : 0);
    });
  });
});

function writeCfg(tmp) {
  const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/sample-config.json'), 'utf8'));
  c.reports_dir = tmp;
  fs.writeFileSync(`${tmp}/cfg.json`, JSON.stringify(c));
  return `${tmp}/cfg.json`;
}
