// #27: the dashboard JS is a set of real ES modules.
//
// What is actually guaranteed, and therefore what this checks:
//   1. every file parses as an ES module (not a classic script accidentally);
//   2. every relative import resolves to a file that exists;
//   3. every imported NAME is really exported by the module it comes from —
//      the check that catches the typo class ESM would only hit at runtime;
//   4. no top-level name is declared twice, because the build flattens these
//      modules into one classic-script scope for the single-file page.
//
// Deliberately NOT checked: importing a module for its side effects. These
// modules run the page's boot sequence at load (that is how the page has always
// worked); the build replays them in the original statement order — see
// src/llm_telemetry/webassets.py — so "import it standalone" is not a property
// the page relies on and not one it can honestly claim.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'js');
const MODULES = ['palette.js', 'charts.js', 'views.js', 'flow.js',
                 'drawer.js', 'live.js', 'router.js', 'main.js'];

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
};

const src = {};
for (const m of MODULES) src[m] = fs.readFileSync(path.join(DIR, m), 'utf8');

// ---- 1. every file is a parseable ES module -------------------------------
for (const m of MODULES) {
  const tmp = path.join(require('os').tmpdir(), `modchk_${m.replace('.js', '')}.mjs`);
  fs.writeFileSync(tmp, src[m]);
  const r = require('child_process').spawnSync(process.execPath, ['--check', tmp],
    { encoding: 'utf8' });
  chk(r.status === 0, `${m} parses as an ES module`,
      (r.stderr || '').split('\n').slice(0, 2).join(' ').trim());
  fs.unlinkSync(tmp);
}

// ---- exports per module ----------------------------------------------------
const exported = {};
for (const m of MODULES) {
  const names = new Set();
  const re = /^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
  let g;
  while ((g = re.exec(src[m]))) names.add(g[1]);
  // `export { a, b };` form
  const re2 = /^export\s*\{([^}]*)\}/gm;
  while ((g = re2.exec(src[m]))) {
    g[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop()).filter(Boolean)
        .forEach(n => names.add(n));
  }
  exported[m] = names;
}
chk(MODULES.every(m => exported[m].size > 0), 'every module exports something',
    MODULES.map(m => `${m}:${exported[m].size}`).join(' '));

// ---- 2 + 3. imports resolve, and the names exist ---------------------------
for (const m of MODULES) {
  const re = /^import\s*\{([\s\S]*?)\}\s*from\s*'([^']+)'/gm;
  let g, bad = [], missing = [];
  while ((g = re.exec(src[m]))) {
    const names = g[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    const target = path.join(DIR, g[2]);
    if (!fs.existsSync(target)) { bad.push(g[2]); continue; }
    const targetFile = path.basename(g[2]);
    for (const n of names) {
      if (!exported[targetFile] || !exported[targetFile].has(n)) {
        missing.push(`${n} (from ${targetFile})`);
      }
    }
  }
  chk(bad.length === 0, `${m}: every import path resolves`, bad.join(','));
  chk(missing.length === 0, `${m}: every imported name is exported`, missing.join(', '));
}

// ---- 4. no duplicate top-level declarations across modules -----------------
const seen = new Map(), dupes = [];
for (const m of MODULES) {
  const re = /^(?:export\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
  let g;
  while ((g = re.exec(src[m]))) {
    if (seen.has(g[1])) dupes.push(`${g[1]} (${seen.get(g[1])} + ${m})`);
    else seen.set(g[1], m);
  }
}
chk(dupes.length === 0, 'no top-level name is declared in two modules', dupes.join(', '));

chk(MODULES.length >= 7, `the JS is split across at least seven modules`, MODULES.length);

console.log(`\ncheck_js_modules.js  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
