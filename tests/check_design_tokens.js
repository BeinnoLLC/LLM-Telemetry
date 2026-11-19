// Ratchet guard: colour-literal ownership (DESIGN.md hard rule).
// tokens.css is the only file allowed to hold hex/rgb/hsl literals. Everything
// else reads var(--token) / color-mix(); hive.js + hive.css read --hv-* tokens.
// Existing literals are tracked in tests/fixtures/design-token-baseline.json, so
// the run fails only when a NEW literal appears — the debt can shrink safely.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const ROOT = path.join(REPO, 'src', 'llm_telemetry', 'web');
const BASELINE = path.join(__dirname, 'fixtures', 'design-token-baseline.json');

const HEX = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const FN = /\b(?:rgb|rgba|hsl|hsla)\s*\(/gi;

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
                                  .replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length));

const entries = [];
const add = (rel, i, bits) => entries.push({ path: rel, line: i + 1, matched: bits });

// skip(line) lets a file exempt its own token declarations from the scan.
const scan = (full, skip) => {
  const rel = path.relative(REPO, full);
  stripComments(fs.readFileSync(full, 'utf8')).split('\n').forEach((line, i) => {
    if (skip && skip(line)) return;
    const hexM = line.match(HEX);
    const fnM = line.match(FN);
    if (hexM || fnM) add(rel, i, [...(hexM || []), ...(fnM || [])].join(', '));
  });
};

// js: every module in web/js (hive.js included — its colours must be --hv-*).
for (const f of fs.readdirSync(path.join(ROOT, 'js')).sort()) {
  if (!f.endsWith('.js')) continue;
  scan(path.join(ROOT, 'js', f), null);
}

// css: every stylesheet except tokens.css (the sole owner). hive.css may declare
// its own --hv-* tokens; any other colour literal there is a violation.
for (const f of fs.readdirSync(path.join(ROOT, 'css')).sort()) {
  if (!f.endsWith('.css') || f === 'tokens.css') continue;
  const isHive = f === 'hive.css';
  scan(path.join(ROOT, 'css', f), isHive ? (line) => /--hv-[a-z0-9-]+\s*:/.test(line.trim()) : null);
}

entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line || (a.matched < b.matched ? -1 : 1));

let baseline = [];
if (fs.existsSync(BASELINE)) baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
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
console.log(`KNOWN VIOLATIONS (${entries.length}) — baseline ${baseline.length}, clean-up target 0`);

if (newViolations.length) {
  console.log(`NEW VIOLATIONS (${newViolations.length}) not in baseline — move them into tokens.css:`);
  for (const v of newViolations) console.log(`  ${v.path}:${v.line}: ${v.matched}`);
}
if (stale.length) {
  console.log(`BASELINE ENTRIES NOW GONE (${stale.length}) — shrink tests/fixtures/design-token-baseline.json:`);
  for (const v of stale) console.log(`  ${v.path}:${v.line}: ${v.matched}`);
}

chk(newViolations.length === 0, `no new colour literals outside tokens.css (${newViolations.length} new of ${entries.length} known)`, newViolations.length);
console.log(`\n${pass} passed, ${fail} failed`);
if (require.main === module) process.exit(fail ? 1 : 0);

module.exports = { entries };
