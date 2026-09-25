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
 const drawer=d.getElementById('drawer');
 const hdr=d.getElementById('logbtn2'), edge=d.getElementById('logbtn');
 chk(!!hdr,'header Logs button exists');
 chk(!!edge,'edge Logs tab exists');
 // header button must be inside the visible header, not floating
 chk(hdr && hdr.closest('.page')!==null,'header button sits in the header bar');
 console.log(`  header button text: ${JSON.stringify(hdr.textContent.trim())}`);
 // each opens the drawer independently
 hdr.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
 chk(drawer.classList.contains('open'),'header button OPENS drawer');
 hdr.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
 chk(!drawer.classList.contains('open'),'header button toggles closed');
 edge.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
 chk(drawer.classList.contains('open'),'edge tab OPENS drawer');
 chk(d.querySelectorAll('#dbody .ev').length>0,'drawer has events',
     `(${d.querySelectorAll('#dbody .ev').length})`);
 console.log(`\n${f===0?'ALL PASS':'FAILED'}  (${p} passed, ${f} failed)`);
 process.exit(f===0?0:1);
},1400);
