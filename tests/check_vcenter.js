// Reports dir: env override so the suite runs on any machine.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(require('os').homedir(), '.local/share/llm-telemetry/reports');
const fs=require('fs'), {JSDOM}=require('jsdom');
let html=fs.readFileSync(REPORTS+'/dashboard.html','utf8')
  .replace(/<script src="https:\/\/[^"]+"><\/script>/g,'');
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,
 url:'http://127.0.0.1:8477/dashboard.html',
 beforeParse(w){
  w.Chart=function(){return{destroy(){},update(){}}};
  w.Chart.defaults={color:'',borderColor:'',font:{}};
  w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
  const live=JSON.parse(fs.readFileSync(REPORTS+'/live-data.json','utf8'));
  w.fetch=()=>Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(live)});
 }});
const w=dom.window,d=w.document;
let p=0,f=0; const chk=(ok,l,x)=>{console.log(`  ${ok?'OK  ':'FAIL'} ${l}${x?'  '+x:''}`);ok?p++:f++;};
setTimeout(()=>{
 const cards=[...d.querySelectorAll('#livelist > div')];
 chk(cards.length>0,'cards rendered',`(${cards.length})`);
 const meta=cards.map(c=>c.querySelector('.metacol'));
 const loe =cards.map(c=>c.querySelector('.loecol'));
 const body=cards.map(c=>c.querySelector('.flex-1'));
 chk(meta.every(Boolean)&&loe.every(Boolean),'every card has meta + gauge columns');
 const ms=meta.map(m=>w.getComputedStyle(m));
 chk(ms.every(s=>s.alignSelf==='stretch'),'meta column stretches full row height');
 chk(ms.every(s=>s.justifyContent==='center'),'meta content centred on the cross axis');
 chk(ms.every(s=>s.flexDirection==='column'),'meta is a column flexbox');
 const ls=loe.map(e=>w.getComputedStyle(e));
 chk(ls.every(s=>s.alignSelf==='stretch'),'gauge column stretches full row height');
 chk(ls.every(s=>s.alignItems==='center'),'gauge centred vertically in its column');
 chk(body.every(b=>b.className.includes('self-center')),'left body block is self-centred');
 chk(cards.every(c=>c.className.includes('items-center')),'row itself is items-center');
 console.log(`\n${f===0?'ALL PASS':'FAILED'}  (${p} passed, ${f} failed)`);
 process.exit(f===0?0:1);
},1400);
