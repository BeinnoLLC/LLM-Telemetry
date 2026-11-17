const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const files = ['src/llm_telemetry/web/js/flow.js'];
let pass = 0, fail = 0;
function chk(ok, name){ if(ok){pass++;console.log('  ok  '+name);}else{fail++;console.log('  FAIL '+name);} }
for (const f of files){
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  chk(src.includes('data-flowzoom="out"') && src.includes('aria-label="Zoom out"'), 'flow zoom out has aria-label');
  chk(src.includes('data-flowzoom="in"') && src.includes('aria-label="Zoom in"'), 'flow zoom in has aria-label');
  chk(src.includes('data-flowfit') && src.includes('aria-label="Reset pan/zoom to fit"'), 'flow fit has aria-label');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
