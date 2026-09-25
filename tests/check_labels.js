// Reports dir: env override so the suite runs on any machine.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(require('os').homedir(), '.local/share/llm-telemetry/reports');
const fs=require('fs'), {JSDOM}=require('jsdom');
let html=fs.readFileSync(REPORTS+'/dashboard.html','utf8')
  .replace(/<script src="https:\/\/[^"]+"><\/script>/g,'');
const charts={};
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,
 url:'http://127.0.0.1:8477/dashboard.html',
 beforeParse(w){
  function C(el,cfg){ if(el&&el.id) charts[el.id]=cfg; this.destroy=()=>{}; this.update=()=>{}; }
  C.defaults={color:'',borderColor:'',font:{},
    plugins:{legend:{labels:{generateLabels:ch=>
      (ch.data.labels||[]).map(l=>({text:String(l)}))}}}};
  w.Chart=C;
  w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
  const live=JSON.parse(fs.readFileSync(REPORTS+'/live-data.json','utf8'));
  w.fetch=()=>Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(live)});
 }});
const w=dom.window,d=w.document;
let p=0,f=0; const chk=(ok,l,x)=>{console.log(`  ${ok?'OK  ':'FAIL'} ${l}${x?'  '+x:''}`);ok?p++:f++;};
setTimeout(()=>{
 for(const v of ['Live','Usage','Cost','Health','Detail'])
   [...d.querySelectorAll('#views button')].find(b=>b.textContent.trim()===v)
     .dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
 const ids=Object.keys(charts);
 chk(ids.length>0,'charts built',`(${ids.length}: ${ids.join(', ')})`);

 // every chart with a category axis must have the enlarged tinted ticks
 let sized=0, tinted=0, checked=0;
 for(const [id,cfg] of Object.entries(charts)){
   const ax=(cfg.options.indexAxis==='y')?'y':'x';
   const t=cfg.options.scales&&cfg.options.scales[ax]&&cfg.options.scales[ax].ticks;
   if(!t) continue;
   checked++;
   if(t.font&&t.font.size>=13) sized++;
   if(typeof t.color==='function') tinted++;
 }
 chk(checked>0,'charts with category axes',`(${checked})`);
 chk(sized===checked,'ALL axis labels enlarged to 13px',`(${sized}/${checked})`);
 chk(tinted===checked,'ALL axis labels use a colour function',`(${tinted}/${checked})`);

 // the colour function must actually return the model's colour
 const cm=charts['cModels'];
 if(cm){
   const fn=cm.options.scales.y.ticks.color;
   const labels=cm.data.labels;
   const out=labels.map(l=>fn({tick:{label:l}}));
   const gray=out.filter(c=>c===w.MU||!/hsl|rgb|#/.test(String(c))).length;
   console.log('  cModels label colours:');
   labels.slice(0,5).forEach((l,i)=>console.log(`     ${String(l).padEnd(34)} ${out[i]}`));
   chk(out.every(c=>c&&/^hsl/.test(c)),'every model label resolves to its colour');
   chk(new Set(out).size>1,'labels are not all one colour',`(${new Set(out).size} distinct)`);
 }
 // provider chart labels tint from PROV
 const pd=charts['cProvDist'];
 if(pd){
   const fn=pd.options.scales.y.ticks.color;
   const out=pd.data.labels.map(l=>fn({tick:{label:l}}));
   console.log('  cProvDist label colours:');
   pd.data.labels.forEach((l,i)=>console.log(`     ${String(l).padEnd(20)} ${out[i]}`));
   chk(out.every(c=>c&&c!=='undefined'),'provider labels resolve to provider colours');
 }
 // legends enlarged + tinted
 let legs=0, legOk=0;
 for(const [id,cfg] of Object.entries(charts)){
   const L=cfg.options.plugins&&cfg.options.plugins.legend;
   if(!L||L.display===false) continue;
   legs++;
   if(L.labels&&L.labels.font&&L.labels.font.size>=13&&typeof L.labels.generateLabels==='function') legOk++;
 }
 chk(legs===0||legOk===legs,'every visible legend enlarged + tinted',`(${legOk}/${legs})`);
 console.log(`\n${f===0?'ALL PASS':'FAILED'}  (${p} passed, ${f} failed)`);
 process.exit(f===0?0:1);
},1500);
