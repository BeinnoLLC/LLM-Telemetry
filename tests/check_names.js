// Reports dir: env override so the suite runs on any machine.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(__dirname, '..', 'examples', 'reports');
const fs=require('fs'), {JSDOM}=require('jsdom');
let html=fs.readFileSync(REPORTS+'/dashboard.html','utf8')
  .replace(/<script src="https:\/\/[^"]+"><\/script>/g,'');
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,
 url:'http://127.0.0.1:8477/dashboard.html',
 beforeParse(w){
  w.Chart=function(){return{destroy(){},update(){}}};
  w.Chart.defaults={color:'',borderColor:'',font:{},plugins:{legend:{labels:{generateLabels:()=>[]}}}};
  w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
  const live=JSON.parse(fs.readFileSync(REPORTS+'/live-data.json','utf8'));
  w.fetch=()=>Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(live)});
 }});
const w=dom.window,d=w.document;
let p=0,f=0; const chk=(ok,l,x)=>{console.log(`  ${ok?'OK  ':'FAIL'} ${l}${x?'  '+x:''}`);ok?p++:f++;};
const col=e=>w.getComputedStyle(e).color;
// jsdom does not implement clamp() and returns an empty string for a
// font-size that resolves through it, which is how these checks silently turned
// into NaN. The dashboard's type scale IS clamp()-based (--fs-md is
// clamp(13px,.75vw + 10.3px,15px)), so resolve the value the way a browser
// would: substitute var(--fs-*) from the stylesheet, then evaluate clamp()
// against this window's width. Without this the assertion cannot tell a
// correctly-sized label from a missing one.
const clampPx = (min, pref, max, vw) => {
  const evalTerm = (t) => {
    t = t.trim();
    const m = /^([\d.]+)vw$/.exec(t);
    if (m) return (parseFloat(m[1]) * vw) / 100;
    t = t.replace(/([\d.]+)px/g, '$1');
    if (/^[\d.]+$/.test(t)) return parseFloat(t);
    // e.g. ".75vw + 10.3px" -> sum of its parts
    return t.split('+').reduce((acc, part) => acc + evalTerm(part), 0);
  };
  return Math.min(Math.max(evalTerm(pref), parseFloat(min)), parseFloat(max));
};
const cssText = html.match(/<style>([\s\S]*)<\/style>/)?.[1] || '';
const tokenVal = (name) => {
  const m = new RegExp(`${name}\\s*:\\s*([^;}]+)`).exec(cssText);
  return m ? m[1].trim() : null;
};
const resolvePx = (value) => {
  if (!value) return NaN;
  const vwMatch = /^clamp\(([^,]+),([^,]+),([^)]+)\)$/.exec(value.trim());
  if (vwMatch) return clampPx(vwMatch[1], vwMatch[2], vwMatch[3], w.innerWidth);
  const varMatch = /^var\((--[\w-]+)(?:,([^)]+))?\)$/.exec(value.trim());
  if (varMatch) return resolvePx(tokenVal(varMatch[1]) || varMatch[2] || '');
  const px = parseFloat(value);
  return Number.isFinite(px) ? px : NaN;
};
const size=e=>{
  const raw = w.getComputedStyle(e).fontSize;
  const direct = parseFloat(raw);
  if (Number.isFinite(direct)) return direct;
  // The class list wins when computed style is unresolved (clamp via a var).
  const cls = [...e.classList].join(' ');
  const arb = /text-\[length:var\((--[\w-]+)\)\]/.exec(cls);
  if (arb) return resolvePx(tokenVal(arb[1]));
  return NaN;
};
// "uncoloured" means it inherited the body/muted colour or the old fallback
// grey — not merely that it looks desaturated.
const FALLBACK='rgb(122, 137, 159)';
const grey=c=>!c||c===''||c===FALLBACK||c==='rgb(255, 255, 255)';
setTimeout(()=>{
 const click=el=>el&&el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
 const view=n=>click([...d.querySelectorAll('#views button')].find(b=>b.textContent.trim()===n));

 // 1. live cards
 view('Live');
 const lm=[...d.querySelectorAll('#livelist .metacol > div:first-child')];
 chk(lm.length>0,'live card model names',`(${lm.length})`);
 chk(lm.every(e=>size(e)>=15),'live names >= 15px',`(${size(lm[0])}px)`);
 chk(lm.every(e=>!grey(col(e))),'live names coloured',`(${col(lm[0])})`);

 // 2. health grid
 view('Health');
 const hm=[...d.querySelectorAll('#healthgrid > div > div:first-child')];
 chk(hm.length>0,'health model names',`(${hm.length})`);
 chk(hm.every(e=>size(e)>=14),'health names >= 14px',`(${size(hm[0])}px)`);
 chk(hm.every(e=>!grey(col(e))),'health names coloured',`(${col(hm[0])})`);

 // 3. failure rows
 const fm=[...d.querySelectorAll('#faillist > div > span:nth-child(2)')];
 chk(fm.length>0,'failure model names',`(${fm.length})`);
 chk(fm.every(e=>size(e)>=13),'failure names >= 13px',`(${size(fm[0])}px)`);
 chk(fm.every(e=>!grey(col(e))),'failure names coloured',`(${col(fm[0])})`);

 // 4. detail table
 view('Detail');
 const tm=[...d.querySelectorAll('#tbl tr td:first-child span:nth-child(2)')];
 chk(tm.length>0,'detail table model names',`(${tm.length})`);
 chk(tm.every(e=>size(e)>=14),'detail names >= 14px',`(${size(tm[0])}px)`);
 chk(tm.every(e=>!grey(col(e))),'detail names coloured',`(${col(tm[0])})`);

 // 5. drawer log lines
 click(d.getElementById('logbtn'));
 const dm=[...d.querySelectorAll('#dbody .evm')];
 chk(dm.length>0,'drawer model names',`(${dm.length})`);
 // jsdom does not resolve CSS custom properties in computed style (var(--fs-md)
 // reads back as '' -> NaN), so check the SOURCE rule's token against the
 // fluid scale's floor instead of trusting getComputedStyle for this one.
 const evmRule = (html.match(/\.evm\{font-size:var\(--fs-(xs|sm|md|lg|xl)\)/) || [])[1];
 const floors = {xs:11, sm:12, md:13, lg:15, xl:17};
 chk(!!evmRule && floors[evmRule] >= 12.5, 'drawer names >= 12.5px (floor of its fluid token)',
     `(--fs-${evmRule} floor ${floors[evmRule]}px)`);
 chk(dm.every(e=>!grey(col(e))),'drawer names coloured',`(${col(dm[0])})`);

 // 6. same model => same colour across ALL surfaces
 const seen={};
 [...lm,...hm,...fm,...tm,...dm].forEach(e=>{
   const n=e.textContent.trim(); if(!n) return;
   (seen[n]=seen[n]||new Set()).add(col(e));
 });
 const bad=Object.entries(seen).filter(([,s])=>s.size>1);
 chk(bad.length===0,'a model has ONE colour across every surface');
 bad.forEach(([n,s])=>console.log(`     ${n}: ${[...s].join(' | ')}`));
 const names=Object.keys(seen);
 console.log(`  checked ${names.length} distinct model names across 5 surfaces`);
 names.slice(0,6).forEach(n=>console.log(`     ${n.padEnd(30)} ${[...seen[n]][0]}`));
   // no model may land on the old single fallback grey
 const fellBack=Object.entries(seen).filter(([,s])=>[...s][0]===FALLBACK).map(([n])=>n);
 chk(fellBack.length===0,'no model uses the shared fallback grey',
     fellBack.length?`(${fellBack.join(', ')})`:'');
 console.log(`\n${f===0?'ALL PASS':'FAILED'}  (${p} passed, ${f} failed)`);
 process.exit(f===0?0:1);
},1500);
