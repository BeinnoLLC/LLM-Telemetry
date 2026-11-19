// LLMTELEMET-318 guard: UI transition durations in the web css must route through
// var(--motion-fast|normal|slow). Raw durations are only allowed in the explicit
// allowlist below (liquid-fill transitions); looping/one-shot keyframe animations
// are not transitions and are listed as exceptions in DESIGN.md Motion.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'css');
const RAW = /(?<![\w.-])(?:\d*\.\d+|\d+)m?s\b/g;
const ALLOW = [{ file: 'dashboard.css', prop: 'height', dur: '.8s' }, { file: 'dashboard.css', prop: 'bottom', dur: '.8s' }];
const ZERO = /^0m?s$/;

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
};

function scan(file, text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  const bad = [];
  for (const m of src.matchAll(/transition(?:-duration|-delay)?\s*:([^;}]*)/g)) {
    const line = src.slice(0, m.index).split('\n').length;
    for (const part of m[1].split(/,(?![^(]*\))/)) {
      const prop = part.trim().split(/\s+/)[0];
      for (const d of part.replace(/var\([^)]*\)/g, '').match(RAW) || []) {
        if (ZERO.test(d)) continue;
        if (ALLOW.some(a => a.file === file && a.prop === prop && a.dur === d)) continue;
        bad.push(`${file}:${line} ${prop} ${d}`);
      }
    }
  }
  return bad;
}

let used = 0;
for (const f of fs.readdirSync(DIR).filter(n => n.endsWith('.css'))) {
  const text = fs.readFileSync(path.join(DIR, f), 'utf8');
  const bad = scan(f, text);
  chk(bad.length === 0, `${f}: no raw transition durations (${bad.length} found)`, bad.join('; '));
  used += (text.match(/var\(--motion-(?:fast|normal|slow)\)/g) || []).length;
}
chk(used > 0, `motion tokens are used (${used} refs)`);
const tok = fs.readFileSync(path.join(DIR, 'tokens.css'), 'utf8');
chk(/--motion-fast:\s*120ms/.test(tok) && /--motion-normal:\s*200ms/.test(tok) && /--motion-slow:\s*300ms/.test(tok), 'tokens.css defines fast/normal/slow = 120/200/300ms');
// Negative controls: the scanner must catch raw durations and accept tokens.
chk(scan('x.css', 'a{transition:opacity .2s ease}').length === 1, 'catches raw .2s');
chk(scan('x.css', 'a{transition:opacity var(--motion-fast) ease,color 120ms}').length === 1, 'catches raw 120ms after a token');
chk(scan('x.css', 'a{transition:opacity var(--motion-fast) ease;visibility:0s}/* transition:a .3s */').length === 0, 'accepts tokens, 0s and comments');

console.log(`${pass} passed, ${fail} failed`);
if (require.main === module) process.exit(fail ? 1 : 0);
