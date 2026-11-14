// Ratchet guard: design-token colour ownership (DESIGN.md hard rule).
// New raw colour literals are forbidden; existing ones are tracked in
// tests/fixtures/design-token-baseline.json and must be cleaned up over time.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web');
const BASELINE = path.join(__dirname, 'fixtures', 'design-token-baseline.json');

const HEX = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const FN = /\b(?:rgb|rgba|hsl|hsla)\s*\(/gi;

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
                                  .replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length));

const entries = [];
const add = (rel, i, bits) => entries.push({ path: rel, line: i + 1, matched: bits });

const jsTargets = ['views.js', 'flow.js', 'hive.js'];
for (const name of jsTargets) {
  const f = path.join(ROOT, 'js', name);
  if (!fs.existsSync(f)) continue;
  const rel = path.relative(path.join(__dirname, '..'), f);
  const lines = stripComments(fs.readFileSync(f, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    const hexM = line.match(HEX);
    const fnM = line.match(FN);
    if (hexM || fnM) add(rel, i, [...(hexM || []), ...(fnM || [])].join(', '));
  });
}

const hiveCss = path.join(ROOT, 'css', 'hive.css');
if (fs.existsSync(hiveCss)) {
  const rel = path.relative(path.join(__dirname, '..'), hiveCss);
  const lines = stripComments(fs.readFileSync(hiveCss, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    const hexM = line.match(HEX);
    const fnM = line.match(FN);
    if (hexM || fnM) {
      const trimmed = line.trim();
      const isHvToken = /--hv-[a-z0-9-]+\s*:/.test(trimmed);
      if (!isHvToken) add(rel, i, [...(hexM || []), ...(fnM || [])].join(', '));
    }
  });
}

const cssDir = path.join(ROOT, 'css');
for (const f of fs.readdirSync(cssDir)) {
  if (!f.endsWith('.css')) continue;
  if (f === 'tokens.css') continue;
  if (f === 'hive.css') continue;
  const full = path.join(cssDir, f);
  const rel = path.relative(path.join(__dirname, '..'), full);
  const lines = stripComments(fs.readFileSync(full, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    const hexM = line.match(HEX);
    const fnM = line.match(FN);
    if (hexM || fnM) add(rel, i, [...(hexM || []), ...(fnM || [])].join(', '));
  });
}

entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line || (a.matched < b.matched ? -1 : 1));

let baseline = [];
if (fs.existsSync(BASELINE)) {
  baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
}
const key = (e) => `${e.path}\u0000${e.line}\u0000${e.matched}`;
const baseSet = new Set(baseline.map(key));
const nowSet = new Set(entries.map(key));

const newViolations = entries.filter(e => !baseSet.has(key(e)));
const stale = baseline.filter(e => !nowSet.has(key(e)));

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? ' — ' + got : ''}`);
  ok ? pass++ : fail++;
};

console.log('design-token colour guard (ratchet; tokens.css is the only owner)');
console.log(`current violations: ${entries.length}; baseline: ${baseline.length}; remaining to clean: ${entries.length}`);

if (newViolations.length) {
  console.log(`NEW VIOLATIONS (${newViolations.length}) not in baseline:`);
  for (const v of newViolations) console.log(`  ${v.path}:${v.line}: ${v.matched}`);
}
if (stale.length) {
  console.log(`BASELINE ENTRIES NOW GONE (${stale.length}) — shrink the baseline:`);
  for (const v of stale) console.log(`  ${v.path}:${v.line}: ${v.matched}`);
}

chk(newViolations.length === 0, `no new colour literals beyond baseline (${newViolations.length} new)`, newViolations.length);
console.log(`\n${pass} passed, ${fail} failed`);
if (require.main === module) process.exit(fail ? 1 : 0);

module.exports = { entries };
