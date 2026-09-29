// #25/P1-03: golden fixture drift detection — a collector change that
// removes or retypes a key must fail; a new key must not; --bless must
// re-sync and print the diff it accepted before overwriting.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REPORTS = path.join(ROOT, 'examples', 'reports');
const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const BLESS = path.join(__dirname, 'bless.js');
const TARGET = 'router-data.json'; // small, cheap file to mutate for the test

let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
}

function run(args) {
  try {
    const out = execFileSync('node', [BLESS, ...args], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

chk(fs.existsSync(BLESS), 'tests/bless.js exists');
chk(fs.existsSync(path.join(GOLDEN, 'analytics-data.json')) &&
    fs.existsSync(path.join(GOLDEN, 'live-data.json')) &&
    fs.existsSync(path.join(GOLDEN, 'ollama-data.json')) &&
    fs.existsSync(path.join(GOLDEN, 'router-data.json')),
    'all four golden fixture files are committed');

// Baseline: repo state should already be blessed and clean.
const baseline = run(['--check']);
chk(baseline.code === 0, 'the committed golden fixtures currently match examples/reports (baseline is clean)', baseline.out);

const targetPath = path.join(REPORTS, TARGET);
const originalBytes = fs.readFileSync(targetPath, 'utf8');

try {
  // 1) A key REMOVAL (simulating a collector rename) must fail --check.
  const data = JSON.parse(originalBytes);
  const firstProfile = Object.values(data.profiles || {})[0];
  let mutated = false;
  if (firstProfile && typeof firstProfile === 'object') {
    // router-data.json profiles are keyed objects with model->stats; rename
    // one nested key to simulate a real shape change.
    for (const modelStats of Object.values(firstProfile)) {
      if (modelStats && typeof modelStats === 'object') {
        const keys = Object.keys(modelStats);
        if (keys.length) {
          modelStats['__renamed_' + keys[0]] = modelStats[keys[0]];
          delete modelStats[keys[0]];
          mutated = true;
          break;
        }
      }
    }
  }
  if (!mutated) {
    // Fallback: mutate the top-level object directly if the profile shape
    // didn't match what was expected above — still a real key removal.
    const keys = Object.keys(data).filter(k => k !== 'sample' && k !== 'schema_version');
    if (keys.length) { data['__renamed_' + keys[0]] = data[keys[0]]; delete data[keys[0]]; mutated = true; }
  }
  fs.writeFileSync(targetPath, JSON.stringify(data));

  const afterRemoval = run(['--check']);
  chk(afterRemoval.code === 1, 'removing/renaming a key makes --check fail (exit 1)', afterRemoval.out);
  chk(/DRIFT DETECTED/.test(afterRemoval.out), '--check reports DRIFT DETECTED for the mutated file');
  chk(/missing:/.test(afterRemoval.out), '--check names the specific missing path');

  // Restore before the next sub-test.
  fs.writeFileSync(targetPath, originalBytes);
  const afterRestore = run(['--check']);
  chk(afterRestore.code === 0, 'restoring the original file makes --check pass again');

  // 2) A pure ADDITION must NOT fail --check (optional fields are not a
  // breaking change — explicit ticket requirement).
  const data2 = JSON.parse(originalBytes);
  data2.__brand_new_field_for_test = 'hello';
  fs.writeFileSync(targetPath, JSON.stringify(data2));
  const afterAddition = run(['--check']);
  chk(afterAddition.code === 0, 'adding a brand-new field does NOT fail --check (additive change is not breaking)', afterAddition.out);
  chk(/added:/.test(afterAddition.out), '--check still reports the addition informationally');

  // 3) --bless re-syncs AND prints the diff before overwriting.
  const blessResult = run(['--bless']);
  chk(blessResult.code === 0, '--bless exits 0');
  chk(/added:.*__brand_new_field_for_test/.test(blessResult.out), '--bless prints the diff it is about to accept, naming the specific field');
  chk(/blessed:/.test(blessResult.out), '--bless confirms it wrote the golden fixtures');

  const goldenAfterBless = JSON.parse(fs.readFileSync(path.join(GOLDEN, TARGET), 'utf8'));
  chk(goldenAfterBless.__brand_new_field_for_test === 'hello', 'the golden fixture file itself now contains the newly blessed field');

  const afterBlessCheck = run(['--check']);
  chk(afterBlessCheck.code === 0, 're-running --check after --bless is clean again');

} finally {
  // Always restore both sides to the real committed state, regardless of
  // which assertion above failed.
  fs.writeFileSync(targetPath, originalBytes);
  fs.writeFileSync(path.join(GOLDEN, TARGET), originalBytes);
}

const finalCheck = run(['--check']);
chk(finalCheck.code === 0, 'repo is left in a clean, blessed state after the test run', finalCheck.out);

console.log(`\ncheck_golden_fixtures.js  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
