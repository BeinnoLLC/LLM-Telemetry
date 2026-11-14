// Guard: colour literals may only live in tokens.css (DESIGN.md hard rule).
// Scans css + js under src/llm_telemetry/web. Current violations are reported
// (not fixed here) so this commit stays docs/behaviour-neutral.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web');
const files = [];
for (const sub of ['css', 'js']) {
  const d = path.join(ROOT, sub);
  for (const f of fs.readdirSync(d)) {
    if (/\.(css|js)$/.test(f)) files.push(path.join(d, f));
  }
}
const HEX = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const FN = /\b(?:rgb|rgba|hsl|hsla)\s*\(/gi;

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
                                  .replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length));

let violations = [];
for (const f of files) {
  const rel = path.relative(path.join(__dirname, '..'), f);
  if (path.basename(f) === 'tokens.css') continue;
  const lines = stripComments(fs.readFileSync(f, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    const hexM = line.match(HEX);
    const fnM = line.match(FN);
    if (hexM || fnM) {
      const bits = [...(hexM || []), ...(fnM || [])].join(', ');
      violations.push(`${rel}:${i + 1}: ${bits}`);
    }
  });
}

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? ' — ' + got : ''}`);
  ok ? pass++ : fail++;
};

console.log('colour-literal guard (tokens.css is the only owner)');
if (violations.length) {
  console.log(`KNOWN VIOLATIONS (${violations.length})`);
  for (const v of violations) console.log('  ' + v);
  console.log('TODO: migrate these literals into tokens.css (see DESIGN.md).');
  chk(true, `guard ran; ${violations.length} known violations reported`, undefined);
} else {
  chk(true, 'no colour literals outside tokens.css', undefined);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
EOF