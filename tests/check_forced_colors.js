const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass=0,fail=0;
function chk(ok,name){ if(ok){pass++;console.log('  ok  '+name);}else{fail++;console.log('  FAIL '+name);} }
const hive = fs.readFileSync(path.join(ROOT,'src','llm_telemetry','web','css','hive.css'),'utf8');
const dash = fs.readFileSync(path.join(ROOT,'src','llm_telemetry','web','css','dashboard.css'),'utf8');
const hiveBlocks = (hive.match(/@media\s*\(\s*forced-colors\s*:\s*active\s*\)/g)||[]).length;
const dashBlocks = (dash.match(/@media\s*\(\s*forced-colors\s*:\s*active\s*\)/g)||[]).length;
chk(hiveBlocks===1,'hive.css exactly one forced-colors block (got '+hiveBlocks+')');
chk(dashBlocks===1,'dashboard.css exactly one forced-colors block (got '+dashBlocks+')');
// extract the hive block
const hb = hive.match(/@media\s*\(\s*forced-colors\s*:\s*active\s*\)\{.*\}/s)[0];
chk(/\.hv-hex/.test(hb),'hive block covers .hv-hex');
chk(/\.hv-crown/.test(hb),'hive block covers .hv-crown');
chk(/Canvas/.test(hb),'hive block uses Canvas');
chk(/CanvasText/.test(hb),'hive block uses CanvasText');
chk(/Highlight/.test(hb),'hive block uses Highlight');
const db = dash.match(/@media\s*\(\s*forced-colors\s*:\s*active\s*\)\{.*\}/s)[0];
chk(/\.qt-ball/.test(db),'dashboard block covers .qt-ball');
chk(/CanvasText/.test(db),'dashboard block uses CanvasText border');
chk(/forced-color-adjust\s*:\s*none/.test(db) && /\.qt-ball\s*svg/.test(db),'svg forced-color-adjust none');
console.log(`\ncheck_forced_colors.js  ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
