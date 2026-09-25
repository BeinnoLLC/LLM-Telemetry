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
const click=e=>e.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
setTimeout(()=>{
 // Health tab
 [...d.querySelectorAll('#views button')].find(b=>b.textContent.trim()==='Health')
   .dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
 const list=d.getElementById('faillist');
 const rows=()=>list.querySelectorAll('div.flex.items-start').length;
 const all=rows();
 chk(all>0,'failure rows rendered',`(${all})`);
 chk(all>11,'more than the old 11-row cap',`(${all} rows)`);
 const chips=[...d.querySelectorAll('#failfilters .fchip')];
 chk(chips.length>1,'filter chips built',`(${chips.length})`);
 console.log('  chips: '+chips.map(c=>c.textContent.trim().replace(/\s+/g,':')).join('  '));
 // kind filter
 const kindChips=[...d.querySelectorAll('#failfilters [data-fk]')].filter(c=>c.dataset.fk!=='all');
 chk(kindChips.length>0,'per-kind chips present',`(${kindChips.length})`);
 const k=kindChips[0].dataset.fk;
 click(kindChips[0]);
 const nk=rows();
 chk(nk>0&&nk<=all,`kind filter "${k}" narrows`,`${all} -> ${nk}`);
 const tags=[...list.querySelectorAll('span:first-child')].map(s=>s.textContent.trim());
 chk(new Set(tags).size===1,'filtered rows are all one kind',`(${[...new Set(tags)]})`);
 chk(/of \d+ failures/.test(d.getElementById('failcount').textContent),'count reflects filter',
     `"${d.getElementById('failcount').textContent}"`);
 // back to all
 click([...d.querySelectorAll('#failfilters [data-fk]')].find(c=>c.dataset.fk==='all'));
 chk(rows()===all,'"all" restores every row');
 // model filter
 const mChips=[...d.querySelectorAll('#failfilters [data-fm]')].filter(c=>c.dataset.fm!=='all models');
 if(mChips.length){
   const m=mChips[0].dataset.fm;
   click(mChips[0]);
   const nm=rows();
   chk(nm>0&&nm<=all,`model filter "${m}" narrows`,`${all} -> ${nm}`);
   click([...d.querySelectorAll('#failfilters [data-fm]')].find(c=>c.dataset.fm==='all models'));
   chk(rows()===all,'"all models" restores');
 }
 chk(/overflow-y:auto/.test(list.getAttribute('style')||''),'list scrolls instead of stretching');
 console.log(`\n${f===0?'ALL PASS':'FAILED'}  (${p} passed, ${f} failed)`);
 process.exit(f===0?0:1);
},1500);
