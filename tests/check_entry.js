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
 // #116 removed the header Logs chip and the header Rates link on purpose: the
 // edge tab (and the nav drawer button) are the log entry points now, and the
 // price sheet is reachable from the Cost view. Assert the NEW contract, and
 // assert the removal explicitly so the chips cannot creep back.
 // Scope to the header row only: nav-rail and home-card Rates links are
 // legitimate navigation, not the header chip #116 removed.
 const headerRow = d.querySelector('.page .flex.gap-2.items-center');
 const drawer=d.getElementById('drawer');
 const hdr=d.getElementById('logbtn2'), edge=d.getElementById('logbtn');
 chk(!!headerRow,'header row located for scoping');
 chk(!!edge,'edge Logs tab exists');
 chk(!hdr,'header Logs chip REMOVED (#116)');
 chk(headerRow && !headerRow.querySelector('a[href="costs.html"]'),
     'header Rates link REMOVED (#116)');
 chk(headerRow && [...headerRow.querySelectorAll('a')].every(
     a => !/^\$?\s*Rates/.test(a.textContent.trim())),
     'no Rates control anywhere in the header');
 chk(!edge.closest('#tabs'),'edge tab is not part of the tab strip');
 // the edge tab opens and closes the drawer
 edge.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
 chk(drawer.classList.contains('open'),'edge tab OPENS drawer');
 edge.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
 chk(!drawer.classList.contains('open'),'edge tab toggles closed');
 edge.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
 chk(d.querySelectorAll('#dbody .ev').length>0,'drawer has events',
     `(${d.querySelectorAll('#dbody .ev').length})`);
 console.log(`\n${f===0?'ALL PASS':'FAILED'}  (${p} passed, ${f} failed)`);
 process.exit(f===0?0:1);
 },1400);
