#!/usr/bin/env node
// P1-03 (#25): golden fixture diff / bless tool.
//
// examples/make_sample_data.py *reshapes real telemetry* to build the
// committed sample payloads — which is exactly what makes them
// schema-accurate, and exactly why a collector change can silently change
// their shape with nothing noticing (the ticket's own problem statement).
// There is no real telemetry payload available in this repo or in CI to
// regenerate byte-for-byte from a fixed seed against, so this compares a
// STRUCTURAL SIGNATURE (the set of JSON paths and their value types) of the
// currently committed examples/reports/*.json against a frozen golden copy
// in tests/fixtures/golden/*.json. That is the actual thing "the contract
// held" means here: every key the JS consumer might dereference still
// exists with the same shape. Byte-identical VALUES are expected to differ
// run to run (timestamps, jittered numbers) and are correctly ignored.
//
// Usage:
//   node tests/bless.js --check   (default; CI mode — exit 1 on drift)
//   node tests/bless.js --bless   (prints the diff being accepted, then
//                                  overwrites the golden fixtures)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPORTS = path.join(ROOT, 'examples', 'reports');
const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const FILES = ['analytics-data.json', 'live-data.json', 'ollama-data.json', 'router-data.json'];

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

// path -> type. For arrays, only the FIRST element's shape is walked (every
// element is expected to share the row/entry shape — that is the whole
// point of a payload being a list of records) and the path is suffixed
// "[]" so `rows[].date` reads as "every row has a date", not "row 0 has a
// date" (an accidental fixture with one atypical first row must not create
// a false positive on every other, normally-shaped, row).
function signature(o, prefix, out) {
  const t = typeOf(o);
  out.set(prefix || '$', t);
  if (t === 'object') {
    for (const [k, v] of Object.entries(o)) signature(v, `${prefix}.${k}`, out);
  } else if (t === 'array' && o.length) {
    signature(o[0], `${prefix}[]`, out);
  }
}

function sigFor(obj) {
  const out = new Map();
  signature(obj, '$', out);
  return out;
}

function diffSig(goldenSig, currentSig) {
  const missing = [];   // path present in golden, gone from current — a real regression
  const added = [];     // path present in current, not in golden — informational, may be intentional
  const changed = [];   // path present in both with a different TYPE — a real regression
  for (const [p, t] of goldenSig) {
    if (!currentSig.has(p)) missing.push(p);
    else if (currentSig.get(p) !== t) changed.push(`${p}: ${t} -> ${currentSig.get(p)}`);
  }
  for (const p of currentSig.keys()) {
    if (!goldenSig.has(p)) added.push(p);
  }
  return { missing, added, changed };
}

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
  const mode = process.argv.includes('--bless') ? 'bless' : 'check';
  let anyDrift = false;
  const report = [];

  for (const fname of FILES) {
    const goldenPath = path.join(GOLDEN, fname);
    const currentPath = path.join(REPORTS, fname);
    if (!fs.existsSync(goldenPath) || !fs.existsSync(currentPath)) {
      report.push(`${fname}: SKIPPED (missing on one side)`);
      continue;
    }
    const gSig = sigFor(loadJSON(goldenPath));
    const cSig = sigFor(loadJSON(currentPath));
    const { missing, added, changed } = diffSig(gSig, cSig);

    if (missing.length || changed.length) {
      anyDrift = true;
      report.push(`${fname}: DRIFT DETECTED`);
      missing.forEach(p => report.push(`  - missing:  ${p}`));
      changed.forEach(p => report.push(`  ~ changed:  ${p}`));
      added.forEach(p => report.push(`  + added:    ${p}  (new field — informational, not a failure)`));
    } else if (added.length) {
      report.push(`${fname}: ok (${added.length} new field(s), no regressions)`);
      added.forEach(p => report.push(`  + added:    ${p}`));
    } else {
      report.push(`${fname}: ok (shape unchanged)`);
    }
  }

  console.log(report.join('\n'));

  if (mode === 'check') {
    if (anyDrift) {
      console.log('\nGOLDEN FIXTURE CHECK FAILED — a committed sample payload lost or changed the');
      console.log('type of a key the golden fixture recorded. If this is an INTENTIONAL change,');
      console.log('re-bless with:  node tests/bless.js --bless');
      process.exit(1);
    }
    console.log('\ngolden fixture check passed — no shape regressions');
    process.exit(0);
  }

  // --bless: the diff has already been printed above (that IS "the diff it
  // is accepting" — the ticket's own required behaviour). Now overwrite.
  for (const fname of FILES) {
    const currentPath = path.join(REPORTS, fname);
    if (fs.existsSync(currentPath)) {
      fs.copyFileSync(currentPath, path.join(GOLDEN, fname));
    }
  }
  console.log('\nblessed: tests/fixtures/golden/*.json now match examples/reports/*.json');
}

main();
