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
 const body=cards.map(c=>c.querySelector('.lvc-sess'));
 chk(meta.every(Boolean)&&loe.every(Boolean),'every card has meta + gauge columns');
 const ms=meta.map(m=>w.getComputedStyle(m));
 const rs=cards.map(c=>w.getComputedStyle(c));
 chk(rs.every(s=>s.display==='grid'&&s.alignItems==='center'),'G4: every row is a grid whose cells are centred on the cross axis');
 chk(ms.every(s=>s.alignSelf==='auto'||s.alignSelf==='center'),'meta cell follows the row centring (no override)');
 chk(ms.every(s=>s.display==='flex'&&s.flexDirection==='row'&&s.alignItems==='center'),'meta cell is a centred flex line');
 const ls=loe.map(e=>w.getComputedStyle(e));
 chk(ls.every(s=>s.alignSelf==='auto'||s.alignSelf==='center'),'gauge cell follows the row centring (no override)');
 chk(ls.every(s=>s.alignItems==='center'),'gauge centred vertically in its column');
 chk(body.every(b=>b&&w.getComputedStyle(b).alignItems==='center'),'session cell is a centred flex line');
 chk(cards.every(c=>c.className.includes('items-center')),'row itself is items-center');
 console.log(`\n${f===0?'ALL PASS':'FAILED'}  (${p} passed, ${f} failed)`);
 process.exit(f===0?0:1);
},1400);
