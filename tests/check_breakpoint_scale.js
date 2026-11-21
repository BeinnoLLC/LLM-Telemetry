const fs = require('fs');
const path = require('path');
const SCALE = new Set([360,480,640,900,1024,1280,1600]);
const root = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web');
function walk(d){let out=[];for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())out=out.concat(walk(p));else if(/\.(css|js)$/.test(e.name))out.push(p);}return out;}
let passed=0, failed=0, total=0;
for(const f of walk(root)){
  if(f.includes('/hive.')) continue; // skip hive.css/js
  if(f.endsWith('hive.css')||f.endsWith('hive.js')) continue;
  const lines=fs.readFileSync(f,'utf8').split('\n');
  for(const line of lines){
    if(!/@media/.test(line)) continue;
    const code=line.replace(/\/\*.*?\*\//g,'').replace(/\/\/.*$/,'');
    const cond = (code.match(/@media[^{]*/) || [''])[0];
    // only test the condition portion
    const teststr = cond;
    // max-width/min-width px values
    const re=/(max|min)-width:\s*(\d+)px/g;
    let m; while((m=re.exec(teststr))!==null){ total++; const n=+m[2]; const kind=m[1]; const ok = (kind==='max') ? SCALE.has(n) : (SCALE.has(n)||SCALE.has(n-1)); if(ok)passed++; else {failed++; console.log('FAIL '+f+': '+line.trim());} }
    // innerWidth comparisons
    const re2=/innerWidth\s*(<=|>=|<|>)\s*(\d+)/g;
    let m2; while((m2=re2.exec(teststr))!==null){ total++; const n=+m2[2]; const ok=SCALE.has(n); if(ok)passed++; else {failed++; console.log('FAIL '+f+': '+line.trim());} }
  }
}
console.log(passed+' passed, '+failed+' failed');
process.exit(failed?1:0);
PY