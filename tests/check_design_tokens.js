// Guard: design-token colour ownership (DESIGN.md hard rule).
// - Colour literals (hex, rgb, rgba, hsl, hsla) are forbidden in
//   src/llm_telemetry/web/js/views.js, flow.js and hive.js.
// - Any colour in hive.js or hive.css must be a --hv-* token (no raw literals).
// - Colour literals are forbidden in every css file under src/.../web/css except
//   tokens.css, which is the sole owner.
// tokens.css itself is the only allowed exception.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web');
const HEX = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const FN = /\b(?:rgb|rgba|hsl|hsla)\s*\(/gi;

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
                                  .replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length));

let violations = [];
const add = (rel, i, bits) => violations.push(`${rel}:${i + 1}: ${bits}`);

// JS targets
const jsTargets = ['views.js', 'flow.js', 'hive.js'];
for (const name of jsTargets) {
  const f = path.join(ROOT, 'js', name);
  if (!fs.existsSync(f)) continue;
  const rel = path.relative(path.join(__dirname, '..'), f);
  const lines = stripComments(fs.readFileSync(f, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    const hexM = line.match(HEX);
    const fnM = line.match(FN);
    if (hexM || fnM) {
      add(rel, i, [...(hexM || []), ...(fnM || [])].join(', '));
    }
  });
}

// hive.css: any colour literal not a --hv-* token
const hiveCss = path.join(ROOT, 'css', 'hive.css');
if (fs.existsSync(hiveCss)) {
  const rel = path.relative(path.join(__dirname, '..'), hiveCss);
  const lines = stripComments(fs.readFileSync(hiveCss, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    const hexM = line.match(HEX);
    const fnM = line.match(FN);
    if (hexM || fnM) {
      // allowed only if the literal appears inside a --hv-* token definition
      const trimmed = line.trim();
      const isHvToken = /--hv-[a-z0-9-]+\s*:/.test(trimmed);
      if (!isHvToken) {
        add(rel, i, [...(hexM || []), ...(fnM || [])].join(', '));
      }
    }
  });
}

// Other css files (except tokens.css): no colour literals
const cssDir = path.join(ROOT, 'css');
for (const f of fs.readdirSync(cssDir)) {
  if (!f.endsWith('.css')) continue;
  if (f === 'tokens.css') continue;
  if (f === 'hive.css') continue; // handled above
  const full = path.join(cssDir, f);
  const rel = path.relative(path.join(__dirname, '..'), full);
  const lines = stripComments(fs.readFileSync(full, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    const hexM = line.match(HEX);
    const fnM = line.match(FN);
    if (hexM || fnM) {
      add(rel, i, [...(hexM || []), ...(fnM || [])].join(', '));
    }
  });
}

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? ' — ' + got : ''}`);
  ok ? pass++ : fail++;
};

console.log('design-token colour guard (tokens.css is the only owner)');
if (violations.length) {
  console.log(`VIOLATIONS (${violations.length})`);
  for (const v of violations.slice(0, 50)) console.log('  ' + v);
  if (violations.length > 50) console.log(`  ... and ${violations.length - 50} more`);
}
chk(violations.length === 0, `no colour literals in guarded files (${violations.length} found)`, violations.length);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
