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
  w.Chart.defaults={color:'',borderColor:'',font:{},
    plugins:{legend:{labels:{generateLabels:()=>[]}}}};
  w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
  const live=JSON.parse(fs.readFileSync(REPORTS+'/live-data.json','utf8'));
  w.fetch=()=>Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(live)});
 }});
const w=dom.window,d=w.document;
let p=0,f=0; const chk=(ok,l,x)=>{console.log(`  ${ok?'OK  ':'FAIL'} ${l}${x?'  '+x:''}`);ok?p++:f++;};
setTimeout(()=>{
 const card=d.getElementById('heatcard');
 chk(!!card,'heatmap card exists');
 chk(!card.hidden,'heatmap card is visible (data present)');
 const weeks=d.querySelectorAll('#heatmap .hm-w');
 chk(weeks.length>20,'weeks rendered as columns',`(${weeks.length})`);
 const cells=d.querySelectorAll('#heatmap .hm-grid .hm-d:not(.hm-pad)');
 chk(cells.length>150,'day cells rendered',`(${cells.length})`);
 chk([...weeks].every(x=>x.children.length===7),'every week column has 7 days');
 const lit=[...cells].filter(c=>!/l0/.test(c.className));
 chk(lit.length>0,'active days are highlighted',`(${lit.length})`);
 const lv=new Set([...cells].map(c=>(c.className.match(/l\d/)||[''])[0]));
 chk(lv.size>1,'multiple intensity levels used',`(${[...lv].sort().join(',')})`);
 const titled=[...cells].filter(c=>/\d{4}-\d{2}-\d{2} · [\d,]+ calls/.test(c.getAttribute('title')||''));
 chk(titled.length===cells.length,'every cell has a date+count tooltip');
 const sub=d.getElementById('heatsub').textContent;
 chk(/active days · [\d,]+ calls/.test(sub),'summary line rendered',`"${sub}"`);
 chk(d.querySelectorAll('#heatmap .hm-key .hm-d').length===6,'legend key has 6 steps');
 const mons=[...d.querySelectorAll('#heatmap .hm-mon')].filter(m=>m.textContent.trim());
 chk(mons.length>=4,'month labels present',`(${mons.map(m=>m.textContent).join(' ')})`);
 // switching profile must redraw
 const tabs=[...d.querySelectorAll('#tabs button')];
 if(tabs.length>1){
   const before=d.getElementById('heatsub').textContent;
   tabs[1].dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
   chk(d.getElementById('heatsub').textContent!==before,'profile switch redraws heatmap');
 }
 console.log(`\n${f===0?'ALL PASS':'FAILED'}  (${p} passed, ${f} failed)`);
 process.exit(f===0?0:1);
},1500);
