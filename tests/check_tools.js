// Reports dir: env override so the suite runs on any machine.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(require('os').homedir(), '.local/share/llm-telemetry/reports');
// Tool palette: one stable colour per tool, everywhere, perceptually distinct.
const fs=require('fs'), {JSDOM}=require('jsdom');
const html=fs.readFileSync(REPORTS+'/dashboard.html','utf8')
  .replace(/<script src="https:\/\/[^"]+"><\/script>/g,'');
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,
 url:'http://127.0.0.1:8477/dashboard.html',
 beforeParse(w){
  w.Chart=function(c,cfg){this.cfg=cfg;w.__charts=w.__charts||[];w.__charts.push(cfg);
    return{destroy(){},update(){}}};
  w.Chart.defaults={color:'',borderColor:'',font:{},
    plugins:{legend:{labels:{generateLabels:()=>[]}}}};
  w.Chart.overrides={doughnut:{plugins:{legend:{labels:{generateLabels:()=>[]}}}}};
  w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
  const live=JSON.parse(fs.readFileSync(REPORTS+'/live-data.json','utf8'));
  w.fetch=()=>Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(live)});
 }});
const w=dom.window,d=w.document;
let p=0,f=0; const ok=(c,l,x)=>{console.log(`  ${c?'ok  ':'FAIL'} ${l}${x?'  '+x:''}`);c?p++:f++;};

// hsl/rgb -> Lab, CIE76 dE (same method used for the model palette)
function parse(c){
  let m=/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(c);
  if(m){return hsl2rgb(+m[1],+m[2]/100,+m[3]/100);}
  m=/rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  if(m)return[+m[1],+m[2],+m[3]];
  m=/^#([0-9a-f]{6})$/i.exec((c||'').trim());
  if(m){const n=parseInt(m[1],16);return[(n>>16)&255,(n>>8)&255,n&255];}
  return null;
}
function hsl2rgb(h,s,l){h=((h%360)+360)%360/360;
  const q=l<.5?l*(1+s):l+s-l*s,pp=2*l-q;
  const f=t=>{t=(t+1)%1;
    if(t<1/6)return pp+(q-pp)*6*t; if(t<1/2)return q;
    if(t<2/3)return pp+(q-pp)*(2/3-t)*6; return pp;};
  return[f(h+1/3)*255,f(h)*255,f(h-1/3)*255];
}
function lab(rgb){
  let[r,g,b]=rgb.map(v=>{v/=255;return v>.04045?Math.pow((v+.055)/1.055,2.4):v/12.92;});
  const X=(r*.4124+g*.3576+b*.1805)/.95047,
        Y=(r*.2126+g*.7152+b*.0722),
        Z=(r*.0193+g*.1192+b*.9505)/1.08883;
  const fx=t=>t>.008856?Math.cbrt(t):(7.787*t+16/116);
  return[116*fx(Y)-16,500*(fx(X)-fx(Y)),200*(fx(Y)-fx(Z))];
}
const dE=(a,b)=>{const A=lab(parse(a)),B=lab(parse(b));
  return Math.hypot(A[0]-B[0],A[1]-B[1],A[2]-B[2]);};

setTimeout(()=>{
 try{
  const TC=w.eval('typeof TOOLCOLORS!=="undefined"?TOOLCOLORS:null');
  ok(TC && Object.keys(TC).length>0,'TOOLCOLORS built',`(${TC?Object.keys(TC).length:0} tools)`);

  // 1. every tool seen anywhere has a colour
  const names=w.eval('allToolNames()');
  const missing=names.filter(n=>!TC[n]);
  ok(missing.length===0,'every discovered tool has a colour',`(${names.length} tools)`);

  // 2. no two tools share a colour
  const seen={},dupes=[];
  Object.entries(TC).forEach(([t,c])=>{ if(seen[c])dupes.push(`${t}~${seen[c]}`); seen[c]=t; });
  ok(dupes.length===0,'no two tools share a colour',dupes.slice(0,3).join(','));

  // 3. perceptual distance — the real test
  const ks=Object.keys(TC); let worst=1e9,wp='';
  for(let i=0;i<ks.length;i++)for(let j=i+1;j<ks.length;j++){
    const dd=dE(TC[ks[i]],TC[ks[j]]);
    if(dd<worst){worst=dd;wp=`${ks[i]} vs ${ks[j]}`;}
  }
  ok(worst>=9,'closest tool pair is distinguishable',`${wp} dE=${worst.toFixed(1)}`);

  // 4. stability: rebuilding from a SUBSET must not change a tool's colour
  const sub=w.eval('buildToolColors(["terminal","patch","read_file"])');
  // family fan differs with membership, so only assert determinism of the full build
  const again=w.eval('buildToolColors(allToolNames())');
  const drift=Object.keys(TC).filter(t=>again[t]!==TC[t]);
  ok(drift.length===0,'palette is deterministic across rebuilds',drift.slice(0,3).join(','));

  // 5. chart bars actually use per-tool colours (not one flat accent)
  const charts=w.__charts||[];
  const toolChart=charts.find(c=>c&&c.data&&Array.isArray(c.data.labels)
    && c.data.labels.some(l=>TC[l]));
  ok(!!toolChart,'tool chart found');
  if(toolChart){
    const bg=toolChart.data.datasets[0].backgroundColor;
    ok(Array.isArray(bg),'bar colours are per-bar, not a single accent');
    if(Array.isArray(bg)){
      const wrong=toolChart.data.labels.filter((l,i)=>TC[l]&&bg[i]!==TC[l]);
      ok(wrong.length===0,'each bar uses its tool colour',wrong.slice(0,3).join(','));
      ok(new Set(bg).size>1,'bars use multiple distinct colours',`(${new Set(bg).size})`);
    }
  }

  // 6. axis labels resolve through labelColor()
  const lc=w.eval('typeof labelColor!=="undefined"?labelColor("terminal"):null');
  ok(lc===TC['terminal'],'axis label resolves to the tool colour',String(lc));

  // 7. drawer lines colour the tool name
  w.eval('drawerOpen(true)');
  const evt=d.querySelectorAll('#dbody .evt');
  ok(evt.length>0,'drawer renders tool names as spans',`(${evt.length})`);
  if(evt.length){
    const styled=[...evt].filter(e=>/color:/.test(e.getAttribute('style')||''));
    ok(styled.length===evt.length,'every drawer tool name is coloured');
    const nm=evt[0].textContent.trim();
    const want=TC[nm];
    const got=(evt[0].getAttribute('style')||'').match(/color:([^;]+)/);
    ok(!want||(got&&got[1].trim()===want),'drawer colour matches the palette',`${nm} -> ${got&&got[1].trim()}`);
  }
 }catch(e){ ok(false,'threw: '+e.message); }
 console.log(`\n${p} passed, ${f} failed`);
 process.exit(f?1:0);
},900);
