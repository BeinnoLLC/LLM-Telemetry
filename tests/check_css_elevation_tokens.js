const fs = require('fs');
const path = require('path');
const CSS_DIR = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'css');
const DASH = path.join(CSS_DIR, 'dashboard.css');
let pass=0, fail=0;
const chk=(ok,name,got)=>{ if(ok){pass++;console.log(`  ok  ${name}`);} else {fail++;console.log(`  FAIL ${name}${got!==undefined?' — '+got:''}`);} };

function stripKeyframes(src){
  let out=''; let i=0;
  while(i<src.length){
    const idx=src.indexOf('@keyframes',i);
    if(idx===-1){ out+=src.slice(i); break; }
    out+=src.slice(i,idx);
    // find matching brace
    let j=src.indexOf('{',idx);
    if(j===-1){ out+=src.slice(idx); break; }
    let depth=0;
    for(let k=j;k<src.length;k++){
      if(src[k]==='{')depth++;
      else if(src[k]==='}'){depth--; if(depth===0){ i=k+1; break; }}
    }
  }
  return out;
}
function parseRules(src){
  const text = stripKeyframes(src).replace(/\/\*[\s\S]*?\*\//g,'');
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while((m=re.exec(text))!==null){
    rules.push({selector:m[1].trim(), decls:m[2]});
  }
  return rules;
}

function splitTopCommas(s){
  const parts=[]; let depth=0, cur='';
  for(const ch of s){ if(ch==='(')depth++; else if(ch===')')depth--; if(ch===','&&depth===0){ parts.push(cur); cur=''; } else cur+=ch; }
  if(cur.trim()) parts.push(cur);
  return parts;
}

const offenders=[];
for(const f of ['dashboard.css','hive.css','utilities.css']){
  const src = fs.readFileSync(path.join(CSS_DIR,f),'utf8');
  for(const r of parseRules(src)){
    const bsMatch = r.decls.match(/box-shadow\s*:\s*[^;]+/g);
    if(!bsMatch) continue;
    for(const m of bsMatch){
      const val = m.replace(/box-shadow\s*:\s*/,'');
      for(const p of splitTopCommas(val)){
        const part=p.trim();
        if(part.includes('inset')) continue;
        if(part.startsWith('var(')) continue;
        const nums = part.match(/(-?[\d.]+)px/g);
        if(!nums || nums.length < 2) continue;
        const y = parseFloat(nums[1]);
        const blur = nums.length>=3 ? parseFloat(nums[2]) : 0;
        if((y >= 6 || blur >= 12) && !r.selector.includes('.toast') && !r.selector.includes('.fb-sheet')){
          offenders.push({file:f, selector:r.selector, value:part});
        }
      }
    }
  }
}
for(const o of offenders){
  console.log(`  FAIL ${o.file} ${o.selector} ${o.value}`);
  fail++;
}

const dashSrc = fs.readFileSync(DASH,'utf8');
const dashRules = parseRules(dashSrc);
const checks = [
  ['.fb-pop','--elev-2'],
  ['.respop','--elev-2'],
  ['.combo-pop','--elev-2'],
  ['.fbdlg','--elev-3'],
  ['#helppanel','--elev-3'],
  ['.flowtip','--elev-3'],
  ['.qtip','--elev-3'],
];
for(const [sel,tok] of checks){
  const rule = dashRules.find(r => r.selector.split(',').map(s=>s.trim()).includes(sel));
  const bs = rule ? (rule.decls.match(/box-shadow\s*:\s*[^;]+/)||[])[0] : null;
  const ok = !!rule && !!bs && bs.includes('var('+tok+')');
  chk(ok, `${sel} uses ${tok}`, bs||'no rule');
}

let totalBS = 0;
for(const f of ['dashboard.css','hive.css','utilities.css']){
  const s = fs.readFileSync(path.join(CSS_DIR,f),'utf8');
  totalBS += (s.match(/box-shadow:/g)||[]).length;
}
chk(totalBS > 0, `found box-shadow declarations (${totalBS})`);

console.log(`${pass} passed, ${fail} failed`);
if(fail>0) process.exitCode=1;
