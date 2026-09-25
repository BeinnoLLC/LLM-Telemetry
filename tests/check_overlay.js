// Reports dir: env override so the suite runs on any machine.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(require('os').homedir(), '.local/share/llm-telemetry/reports');
const fs=require('fs'), {JSDOM}=require('jsdom');
let html=fs.readFileSync(REPORTS+'/dashboard.html','utf8')
  .replace(/<script src="https:\/\/[^"]+"><\/script>/g,'');
let cfg=null;
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,
 url:'http://127.0.0.1:8477/dashboard.html',
 beforeParse(w){
  w.Chart=function(el,c){ if(el&&el.id==='cTaskCost') cfg=c; return {destroy(){},update(){}}; };
  w.Chart.defaults={color:'',borderColor:'',font:{}};
  w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
  const live=JSON.parse(fs.readFileSync(REPORTS+'/live-data.json','utf8'));
  w.fetch=()=>Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(live)});
 }});
setTimeout(()=>{
 let p=0,f=0; const chk=(ok,l,x)=>{console.log(`  ${ok?'OK  ':'FAIL'} ${l}${x?'  '+x:''}`);ok?p++:f++;};
 if(!cfg){console.log('  FAIL cTaskCost never built');process.exit(1);}
 const bar=cfg.data.datasets.find(d=>d.label==='Est. cost');
 const line=cfg.data.datasets.find(d=>d.label==='Calls');
 chk(!!bar&&!!line,'both series present');
 console.log(`  bar  bg=${bar.backgroundColor} order=${bar.order}`);
 console.log(`  line col=${line.borderColor} order=${line.order} width=${line.borderWidth}`);
 chk(/^rgba\(/.test(bar.backgroundColor),'bars use translucent rgba');
 const a=parseFloat(bar.backgroundColor.split(',')[3]);
 chk(a>0.25&&a<0.6,'bar alpha is faded but readable',`(${a})`);
 chk(line.order<bar.order,'line draws ON TOP of bars',`(line ${line.order} < bar ${bar.order})`);
 chk(line.borderWidth>=2.5,'line is thick enough to read');
 chk(line.pointRadius>=3,'line points visible');
 console.log(`\n${f===0?'ALL PASS':'FAILED'}  (${p} passed, ${f} failed)`);
 process.exit(f===0?0:1);
},1400);
