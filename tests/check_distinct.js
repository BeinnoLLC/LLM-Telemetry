// Reports dir: env override so the suite runs on any machine.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(require('os').homedir(), '.local/share/llm-telemetry/reports');
// Measure PERCEPTUAL distance between model colours (CIE76 in Lab).
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
const w=dom.window;
let p=0,f=0; const chk=(ok,l,x)=>{console.log(`  ${ok?'OK  ':'FAIL'} ${l}${x?'  '+x:''}`);ok?p++:f++;};
function hsl2rgb(h,s,l){h/=360;s/=100;l/=100;
 const q=l<.5?l*(1+s):l+s-l*s, pp=2*l-q;
 const f2=t=>{t=(t+1)%1;
  if(t<1/6)return pp+(q-pp)*6*t; if(t<1/2)return q;
  if(t<2/3)return pp+(q-pp)*(2/3-t)*6; return pp;};
 return [f2(h+1/3)*255,f2(h)*255,f2(h-1/3)*255];}
function lab(r,g,b){
 const f3=v=>{v/=255; return v>.04045?Math.pow((v+.055)/1.055,2.4):v/12.92;};
 r=f3(r);g=f3(g);b=f3(b);
 let x=(r*.4124+g*.3576+b*.1805)/.95047,
     y=(r*.2126+g*.7152+b*.0722),
     z=(r*.0193+g*.1192+b*.9505)/1.08883;
 const f4=v=>v>.008856?Math.cbrt(v):(7.787*v+16/116);
 x=f4(x);y=f4(y);z=f4(z);
 return [116*y-16, 500*(x-y), 200*(y-z)];}
const dE=(c1,c2)=>{const a=lab(...c1),b=lab(...c2);
 return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);};
setTimeout(()=>{
 const COLORS=w.eval('typeof COLORS!=="undefined"?COLORS:{}');
 const names=Object.keys(COLORS);
 chk(names.length>0,'palette built',`(${names.length} models)`);
 const rgb={}; names.forEach(n=>{
  const m=COLORS[n].match(/hsl\((\d+)\s+(\d+)%\s+(\d+)%\)/);
  if(m) rgb[n]=hsl2rgb(+m[1],+m[2],+m[3]);});
 // pairwise within the whole palette
 let worst=[1e9,'',''];
 const ns=Object.keys(rgb);
 for(let i=0;i<ns.length;i++)for(let j=i+1;j<ns.length;j++){
  const d=dE(rgb[ns[i]],rgb[ns[j]]);
  if(d<worst[0]) worst=[d,ns[i],ns[j]];}
 console.log(`  closest pair: ${worst[1]} vs ${worst[2]}  dE=${worst[0].toFixed(1)}`);
 // dE < 10 is "hard to tell apart at a glance" for small swatches
 chk(worst[0]>=10,'every model pair is perceptually distinct (dE>=10)',
     `(worst ${worst[0].toFixed(1)})`);
 // report per family
 const famOf=n=>/claude|opus|sonnet|haiku/i.test(n)?'claude':
   /glm|kimi|minimax/i.test(n)?'opencode':/deepseek/i.test(n)?'deepseek':
   /qwen|gpt-oss|llama|mistral|phi|gemma|nemotron/i.test(n)?'local':
   /gpt-|astra|luna|codex/i.test(n)?'codex':'other';
 const byF={}; ns.forEach(n=>(byF[famOf(n)]=byF[famOf(n)]||[]).push(n));
 for(const [fam,ms] of Object.entries(byF)){
  if(ms.length<2) continue;
  let wf=[1e9,'',''];
  for(let i=0;i<ms.length;i++)for(let j=i+1;j<ms.length;j++){
   const d=dE(rgb[ms[i]],rgb[ms[j]]); if(d<wf[0]) wf=[d,ms[i],ms[j]];}
  console.log(`  ${fam.padEnd(9)} ${String(ms.length).padStart(2)} models, closest dE=${wf[0].toFixed(1)}  (${wf[1]} / ${wf[2]})`);
 }
 console.log(`\n${f===0?'ALL PASS':'FAILED'}  (${p} passed, ${f} failed)`);
 process.exit(f===0?0:1);
},1500);
