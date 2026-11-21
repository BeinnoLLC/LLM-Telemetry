const fs = require('fs');
const path = require('path');
const SCALE = new Set([360,480,640,900,1024,1280,1600]);
const root = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web');
function walk(d){let out=[];for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())out=out.concat(walk(p));else if(/\.(css|js)$/.test(e.name))out.push(p);}return out;}
let passed=0, failed=0;
for(const f of walk(root)){
  if(f.endsWith('hive.css')||f.endsWith('hive.js')) continue;
  let src=fs.readFileSync(f,'utf8');
  // strip comments
  src=src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'');
  // css @media conditions
  const mediaRe=/@media[^{]*/g;
  let m;
  while((m=mediaRe.exec(src))!==null){
    const cond=m[0];
    const re=/(max|min)-width:\s*(\d+)px/g;
    let mm; while((mm=re.exec(cond))!==null){ const kind=mm[1]; const n=+mm[2]; const ok=(kind==='max')?(SCALE.has(n)||SCALE.has(n+1)):(SCALE.has(n)||SCALE.has(n-1)); if(ok)passed++; else {failed++; console.log('FAIL '+f+': '+cond.trim());} }
  }
  // innerWidth comparisons
  const iwRe=/innerWidth\s*(<=|>=|<|>)\s*(\d+)/g;
  let im; while((im=iwRe.exec(src))!==null){ const n=+im[2]; const ok=SCALE.has(n)||SCALE.has(n-1)||SCALE.has(n+1); if(ok)passed++; else {failed++; console.log('FAIL '+f+': innerWidth '+im[1]+' '+n);} }
  // matchMedia width strings
  const mmRe=/matchMedia\(\s*['"][^'"]*['"]\s*\)/g;
  let mmm; while((mmm=mmRe.exec(src))!==null){ const s=mmm[0]; const wRe=/(max|min)-width:\s*(\d+)px/g; let w; while((w=wRe.exec(s))!==null){ const kind=w[1]; const n=+w[2]; const ok=(kind==='max')?(SCALE.has(n)||SCALE.has(n+1)):(SCALE.has(n)||SCALE.has(n-1)); if(ok)passed++; else {failed++; console.log('FAIL '+f+': '+s);} } }
}
console.log(passed+' passed, '+failed+' failed');
process.exit(failed?1:0);
