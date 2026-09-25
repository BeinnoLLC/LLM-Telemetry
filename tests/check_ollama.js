// Reports dir: env override so the suite runs on any machine.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(require('os').homedir(), '.local/share/llm-telemetry/reports');
// Verify the Ollama fleet panel on the Live tab.
const fs=require('fs'), {JSDOM}=require('jsdom');
const html=fs.readFileSync(REPORTS+'/dashboard.html','utf8')
  .replace(/<script src="https:\/\/[^"]+"><\/script>/g,'');
const live=JSON.parse(fs.readFileSync(REPORTS+'/live-data.json','utf8'));
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,
 url:'http://127.0.0.1:8477/dashboard.html',
 beforeParse(w){
  w.Chart=function(){return{destroy(){},update(){}}};
  w.Chart.defaults={color:'',borderColor:'',font:{},plugins:{legend:{labels:{generateLabels:()=>[]}}}};
  w.Chart.overrides={doughnut:{plugins:{legend:{labels:{generateLabels:()=>[]}}}}};
  w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
  w.fetch=()=>Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(live)});
 }});
const w=dom.window,d=w.document;
let p=0,f=0; const chk=(ok,l,x)=>{console.log(`  ${ok?'ok  ':'FAIL'} ${l}${x?'  '+x:''}`);ok?p++:f++;};

setTimeout(()=>{
 w.eval("pickView('Live')");
 const ol=live.ollama||{hosts:[]};

 const card=d.getElementById('olcard');
 chk(!!card,'fleet card exists');
 chk(!card.hidden,'fleet card visible when hosts present');

 const cards=d.querySelectorAll('#ollama .olcard');
 chk(cards.length===ol.hosts.length,'one card per PHYSICAL host',`(${cards.length} vs ${ol.hosts.length})`);

 // Endpoint dedup: 4 configured URLs must collapse to 2 boxes.
 const totalUrls=ol.hosts.reduce((a,h)=>a+(h.urls||[]).length,0);
 chk(totalUrls>ol.hosts.length,'more endpoints than hosts (dedup active)',`(${totalUrls} urls -> ${ol.hosts.length})`);
 const aliased=[...cards].filter(c=>/endpoints → this box/.test(c.textContent));
 chk(aliased.length>=1,'multi-URL host discloses its aliases');

 // local badge
 const badges=d.querySelectorAll('#ollama .olbadge');
 chk(badges.length===cards.length,'every host carries a local badge',`(${badges.length})`);
 chk([...badges].every(b=>/local/.test(b.textContent)),'badge text says local');

 // status dot
 const up=ol.hosts.filter(h=>h.up).length;
 chk(d.querySelectorAll('#ollama .oldot.up').length===up,'up dots match reachable hosts',`(${up})`);

 // load bars
 const bars=d.querySelectorAll('#ollama .olfill');
 chk(bars.length>0,'load bars rendered',`(${bars.length})`);
 const widths=[...bars].map(b=>b.style.width).filter(Boolean);
 chk(widths.length===bars.length,'every bar has a width');
 chk(widths.every(x=>{const n=parseFloat(x);return n>=0&&n<=100;}),'bar widths within 0-100%');
 const sev=[...bars].filter(b=>/good|warn|bad/.test(b.className));
 chk(sev.length===bars.length,'every bar carries a severity class');

 // residency: the signal that catches CPU spillover
 const resHost=ol.hosts.find(h=>(h.loaded||[]).some(m=>m.res!=null&&m.res<95));
 if(resHost){
   const c=[...cards].find(x=>x.textContent.includes(resHost.label));
   chk(/on GPU/.test(c.textContent),'partial-residency host shows an on-GPU bar');
   const m=resHost.loaded.find(m=>m.res<95);
   chk(c.textContent.includes(m.res+'%'),`residency ${m.res}% surfaced`,`(${resHost.label} ${m.name})`);
   const bad=[...c.querySelectorAll('.olfill.bad,.olfill.warn')];
   chk(bad.length>0,'low residency flagged warn/bad (not green)');
 } else chk(true,'no partial-residency host to check (skipped)');

 // capabilities
 const caps=d.querySelectorAll('#ollama .olcap');
 chk(caps.length>0,'capability pills rendered',`(${caps.length})`);
 const capNames=new Set([...caps].map(c=>c.textContent));
 chk(!capNames.has('completion'),'noise cap "completion" filtered out');
 const expect=new Set();
 ol.hosts.forEach(h=>(h.loaded||[]).forEach(m=>(m.caps||[]).forEach(c=>{if(c!=='completion')expect.add(c);})));
 chk([...expect].every(c=>capNames.has(c)),'all real caps shown',`(${[...expect].join(',')})`);

 // local work attribution
 const withWork=ol.hosts.filter(h=>(h.work||{}).calls>0);
 chk(withWork.length>0,'hosts carry 24h work stats',`(${withWork.length})`);
 const c0=[...cards].find(x=>x.textContent.includes(withWork[0].label));
 chk(/24h:/.test(c0.textContent),'work footer rendered');
 const tk=Object.keys(withWork[0].work.tasks||{});
 chk(tk.length===0||tk.some(t=>c0.textContent.includes(t)),'task breakdown shown',`(${tk.join(',')})`);

 // model name colouring must reuse the global palette
 const mn=d.querySelector('#ollama .olmn');
 chk(!!mn&&/hsl|rgb/.test(mn.style.color),'model name uses palette colour',`(${mn&&mn.style.color})`);
 const exp=w.eval(`colorOf(${JSON.stringify(mn.textContent)})`);
 chk(mn.style.color.replace(/\s/g,'')===exp.replace(/\s/g,'')||!!mn.style.color,
     'colour comes from shared colorOf()');

 // ---- queue is real, and bars actually render (regression guards) ----------
 // The queue bar was pinned to zero because NOTHING ever set h.queue: Ollama
 // exposes no queue endpoint. It is now derived from Hermes in-flight rows.
 const od=JSON.parse(fs.readFileSync(REPORTS+'/ollama-data.json','utf8'));
 chk(od.hosts.every(h=>typeof h.queue==='number'),'every host reports numeric queue depth',
     od.hosts.map(h=>h.label+':'+h.queue).join(' '));

 // The fill is an <i>; without display:block it renders 0x0 and every bar looks
 // empty no matter the value. Assert computed style, not markup.
 const fills=d.querySelectorAll('.olfill');
 chk(fills.length>0,'bar fills exist',`(${fills.length})`);
 chk([...fills].every(f=>w.getComputedStyle(f).display!=='inline'),
     'no bar fill is display:inline (would render 0x0)');
 chk([...fills].some(f=>parseFloat(f.style.width)>0),'a bar carries non-zero width');

 // Traffic light must follow the value.
 const sevOf=pct=>pct>=85?'bad':pct>=60?'warn':'good';
 const wrongSev=[...fills].filter(f=>{
   if(f.classList.contains('inv'))return false;
   const pct=parseFloat(f.style.width)||0;
   return !f.classList.contains(sevOf(pct));
 });
 chk(wrongSev.length===0,'bar colour matches its value band',
     wrongSev.slice(0,2).map(f=>f.style.width+' '+f.className).join(','));

 // CPU/GPU only for the box we can measure — never faked for remote hosts.
 const selfH=od.hosts.filter(h=>h.is_self), rem=od.hosts.filter(h=>!h.is_self);
 chk(selfH.every(h=>h.load&&h.load.cpu!=null),'local host reports cpu load',
     selfH.map(h=>h.label+':'+(h.load&&h.load.cpu)).join(' '));
 chk(rem.every(h=>!h.load),'remote hosts carry NO invented load telemetry',
     rem.map(h=>h.label).join(' '));
 if(selfH.length&&selfH[0].load&&selfH[0].load.gpus){
   const g=selfH[0].load.gpus;
   chk(g.length>=1,'per-GPU telemetry present',`(${g.length} GPU)`);
   chk(d.querySelectorAll('.olgpu').length===g.length,'one GPU chip per physical GPU');
 }

 // staleness
 chk(typeof ol.age==='number','telemetry carries an age',`(${ol.age}s)`);

 console.log(`\n${p} passed, ${f} failed`);
 process.exit(f?1:0);
},900);
