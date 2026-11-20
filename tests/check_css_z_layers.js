// LLMTELEMET-319 guard: every stacking layer in the web css/js must route
// through the --layer-* scale declared in tokens.css. Raw numeric z-index (and
// js zIndex) values of 10 or more are forbidden; values 0-9 and
// calc(2 + var(--zr,0)) stay raw because they stack elements inside a single
// component shell (jar interiors). The prefix is --layer- (not --z-) because
// --z-ok/--z-warn/--z-bad are colour tokens. See DESIGN.md Z-index.
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web');
const DIR = path.join(WEB, 'css');
const JSDIR = path.join(WEB, 'js');
const CSS_FILES = ['dashboard.css', 'hive.css', 'utilities.css'];

// The scale: each value equals the raw z-index it replaced, so stacking order
// is unchanged by construction.
const EXPECTED = {
  '--layer-appbar': 30,
  '--layer-pop': 40,
  '--layer-pop-raised': 41,
  '--layer-boot': 50,
  '--layer-hive-tip': 50,
  '--layer-notice': 60,
  '--layer-nav-scrim': 63,
  '--layer-nav': 64,
  '--layer-scrim': 65,
  '--layer-drawer': 70,
  '--layer-modal-scrim': 75,
  '--layer-modal': 80,
  '--layer-drop-scrim': 85,
  '--layer-modal-drop': 90,
  '--layer-tip': 90,
  '--layer-alert': 100,
  '--layer-skip': 200,
  '--layer-ball-hover': 900,
  '--layer-ghost': 950,
  '--layer-overflow': 1000,
};

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
};

const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1);

// Raw numeric z-index >= 10 is a violation; var(--layer-*) and calc(...) pass.
// Returns violation strings for one file's text (css or js).
function scan(file, text) {
  const src = stripComments(text);
  const bad = [];
  const at = (idx) => src.slice(0, idx).split('\n').length;
  for (const m of src.matchAll(/z-?[iI]ndex\s*[:=]\s*['"]?(-?\d+(?:\.\d+)?)['"]?/g)) {
    if (Number(m[1]) >= 10) bad.push(`${file}:${at(m.index)} raw z-index ${m[1]}`);
  }
  for (const m of src.matchAll(/var\((--layer-[\w-]+)\)/g)) {
    if (!(m[1] in EXPECTED)) bad.push(`${file}:${at(m.index)} undefined token var(${m[1]})`);
  }
  return bad;
}

let bad = [];
for (const f of CSS_FILES) {
  const text = fs.readFileSync(path.join(DIR, f), 'utf8');
  const b = scan(f, text);
  chk(b.length === 0, `${f}: no raw z-index >= 10, no undefined --layer-* (${b.length} found)`, b.join('; '));
  bad = bad.concat(b);
}
const jsFiles = fs.readdirSync(JSDIR).filter(n => n.endsWith('.js')).sort();
let jsHits = 0;
for (const f of jsFiles) {
  const text = fs.readFileSync(path.join(JSDIR, f), 'utf8');
  const b = scan(`js/${f}`, text);
  bad = bad.concat(b);
  jsHits += (text.match(/var\(--layer-[\w-]+\)/g) || []).length;
}
chk(bad.length === 0, `web/js/*.js: no raw zIndex >= 10, no undefined --layer-* (${jsFiles.length} files scanned)`, bad.join('; '));
chk(jsHits > 0, `--layer-* tokens are used in js (${jsHits} refs)`);

// tokens.css declares the full scale with the exact values.
const tok = fs.readFileSync(path.join(DIR, 'tokens.css'), 'utf8');
const defined = {};
for (const m of tok.matchAll(/(--layer-[\w-]+)\s*:\s*([^;]+);/g)) defined[m[1]] = m[2].trim();
for (const [name, want] of Object.entries(EXPECTED)) {
  chk(defined[name] === String(want), `tokens.css ${name}:${want}`, `got ${defined[name]}`);
}
const extras = Object.keys(defined).filter(n => !(n in EXPECTED));
chk(extras.length === 0, `tokens.css declares no extra --layer-* (${extras.length} found)`, extras.join(', '));

// Negative controls: the scanner must catch raw values and accept the scale.
chk(scan('x.css', 'a{z-index:500}').length === 1, 'catches raw z-index:500');
chk(scan('x.css', 'a{z-index:9;z-index:calc(2 + var(--zr,0))}').length === 0, 'accepts 0-9 and calc(2 + var(--zr,0))');
chk(scan('x.css', 'a{z-index:var(--layer-modal)}').length === 0, 'accepts var(--layer-modal)');
chk(scan('x.css', 'a{z-index:var(--layer-nope)}').length === 1, 'catches undefined var(--layer-nope)');
chk(scan('x.js', "el.style.cssText='z-index:100'").length === 1, 'catches raw js z-index:100');
chk(scan('x.js', "el.style.zIndex = 950").length === 1, 'catches raw js zIndex = 950');
chk(scan('x.js', "el.style.cssText='z-index:var(--layer-alert)'").length === 0, 'accepts js var(--layer-alert)');

console.log(`${pass} passed, ${fail} failed`);
if (require.main === module) process.exit(fail ? 1 : 0);
