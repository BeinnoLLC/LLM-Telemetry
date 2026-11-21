const fs = require('fs');
const path = require('path');
const CSS_DIR = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'css');
const DASH = path.join(CSS_DIR, 'dashboard.css');
let pass=0, fail=0;
const chk=(ok,name,got)=>{ if(ok){pass++;console.log(`  ok  ${name}`);} else {fail++;console.log(`  FAIL ${name}${got!==undefined?' — '+got:''}`);} };

const src = fs.readFileSync(DASH,'utf8');
// check 7 selectors use elev token
const checks = [
  ['.fb-pop','--elev-2'],
  ['.respop','--elev-2'],
  ['.combo-pop','--elev-2'],
  ['.fbdlg','--elev-3'],
  ['#helppanel','--elev-3'],
  ['.flowtip','--elev-3'],
  ['.qtip','--elev-3'],
];
for (const [sel,tok] of checks){
  // find rule block
  const idx = src.indexOf(sel);
  const block = src.slice(idx, src.indexOf('}', idx)+1);
  chk(block.includes('box-shadow:var('+tok+')') || block.includes('box-shadow: var('+tok+')'), `${sel} uses ${tok}`, block.match(/box-shadow:[^}]+/)?.[0]);
}

// count box-shadow declarations across 3 files
let totalBS = 0;
for (const f of ['dashboard.css','hive.css','utilities.css']){
  const s = fs.readFileSync(path.join(CSS_DIR,f),'utf8');
  totalBS += (s.match(/box-shadow:/g)||[]).length;
}
chk(totalBS > 0, `found box-shadow declarations (${totalBS})`);

console.log(`${pass} passed, ${fail} failed`);
if(fail>0) process.exitCode=1;
