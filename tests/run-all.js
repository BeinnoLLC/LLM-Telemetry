#!/usr/bin/env node
// Run every check_*.js / drive_*.js suite and summarise.
//
// Each suite is a standalone script that exits non-zero on failure and prints
// "N passed, M failed". Running them in-process would let one suite's jsdom
// globals leak into the next, so each gets its own child process.
const {execFileSync} = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const suites = fs.readdirSync(dir)
  .filter(f => /^(check_|drive_).*\.js$/.test(f))
  .sort();

let total = 0, failed = [];
for (const s of suites) {
  let out = '';
  try {
    out = execFileSync('node', [path.join(dir, s)], {encoding: 'utf8', timeout: 200000});
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
    failed.push(s);
  }
  const m = out.match(/(\d+) passed, (\d+) failed/);
  if (m) {
    total += Number(m[1]);
    if (Number(m[2]) > 0 && !failed.includes(s)) failed.push(s);
    console.log(`${s.padEnd(22)} ${m[1]} passed, ${m[2]} failed`);
  } else {
    console.log(`${s.padEnd(22)} NO RESULT`);
    if (!failed.includes(s)) failed.push(s);
  }
}
console.log(`\nTOTAL: ${total} checks | suites failing: ${failed.length ? failed.join(', ') : 'none'}`);
process.exit(failed.length ? 1 : 0);
