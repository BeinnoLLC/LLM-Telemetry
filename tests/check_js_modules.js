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
                 'drawer.js', 'live.js', 'routerview.js', 'router.js', 'main.js'];

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
// A declaration can bind SEVERAL names at once — `export let AC, MU, BD, FG;`
// and `export let charts = [], current = null;` are both idiomatic here, and the
// palette/charts/drawer modules use them heavily. Capturing only the first
// identifier made every later name look unexported, so importing them reported
// false failures on correct code (MU, BD, FG, bwPrevAt, current, logsLoading,
// …). Split the declarator list on top-level commas and take the identifier
// that starts each one.
//
// Line-based on purpose: a `[^;]*` character class also matches newlines, so it
// runs straight past the end of a declaration and swallows the following ones.
const topLevelNames = (decl) => {
  let depth = 0, part = '';
  const parts = [];
  for (const ch of decl) {
    if (ch === '[' || ch === '{' || ch === '(') depth++;
    else if (ch === ']' || ch === '}' || ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(part); part = ''; } else part += ch;
  }
  parts.push(part);
  return parts.map(p => /^\s*([A-Za-z_$][\w$]*)/.exec(p))
              .filter(Boolean).map(m => m[1]);
};

const scanDecls = (source, optionalExport) => {
  const names = new Set();
  const re = optionalExport
    ? /^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(.+)$/
    : /^(?:export\s+)?(?:function|const|let|var|class)\s+(.+)$/;
  for (const line of source.split('\n')) {
    const g = re.exec(line);
    if (g) topLevelNames(g[1]).forEach(n => names.add(n));
  }
  return names;
};

const exported = {};
for (const m of MODULES) {
  const names = scanDecls(src[m], true);
  // `export { a, b };` form
  const re2 = /^export\s*\{([^}]*)\}/gm;
  let g;
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
// Same multi-declarator caveat as the export scan above: `export let AC, MU,
// BD, FG;` declares FOUR top-level names, and reading only the first would let a
// real collision slip through unnoticed in every module after the first.
const seen = new Map(), dupes = [];
for (const m of MODULES) {
  for (const name of scanDecls(src[m], false)) {
    if (seen.has(name)) dupes.push(`${name} (${seen.get(name)} + ${m})`);
    else seen.set(name, m);
  }
}
chk(dupes.length === 0, 'no top-level name is declared in two modules', dupes.join(', '));

chk(MODULES.length >= 7, `the JS is split across at least seven modules`, MODULES.length);

console.log(`\ncheck_js_modules.js  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
