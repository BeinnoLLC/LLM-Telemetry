// Reports dir: env override so the suite runs on any machine.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(require('os').homedir(), '.local/share/llm-telemetry/reports');
// Verify the Flow graph (provider -> model -> task).
const fs=require('fs'), {JSDOM}=require('jsdom');
const html=fs.readFileSync(REPORTS+'/dashboard.html','utf8')
  .replace(/<script src="https:\/\/[^"]+"><\/script>/g,'');
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,
 url:'http://127.0.0.1:8477/dashboard.html',
 beforeParse(w){
  w.Chart=function(){return{destroy(){},update(){}}};
  w.Chart.defaults={color:'',borderColor:'',font:{},plugins:{legend:{labels:{generateLabels:()=>[]}}}};
  w.Chart.overrides={doughnut:{plugins:{legend:{labels:{generateLabels:()=>[]}}}}};
  w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
  const live=JSON.parse(fs.readFileSync(REPORTS+'/live-data.json','utf8'));
  w.fetch=()=>Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(live)});
  // jsdom has no layout: give the wrapper a real size or the sim divides by zero.
  Object.defineProperty(w.HTMLElement.prototype,'clientWidth',{get(){return 1000}});
  Object.defineProperty(w.HTMLElement.prototype,'clientHeight',{get(){return 600}});
  w.HTMLElement.prototype.getBoundingClientRect=function(){
    return {width:1000,height:600,top:0,left:0,right:1000,bottom:600};
  };
 }});
const w=dom.window,d=w.document;
let p=0,f=0; const chk=(ok,l,x)=>{console.log(`  ${ok?'ok  ':'FAIL'} ${l}${x?'  '+x:''}`);ok?p++:f++;};

setTimeout(()=>{
 try{
  // Switch to the Flow tab the way a user would.
  const btn=[...d.querySelectorAll('[data-vtab]')].find(b=>b.dataset.vtab==='Flow');
  chk(!!btn,'Flow tab button exists');
  btn.click();

  const view=d.querySelector('.view[data-view="Flow"]');
  chk(view && !view.hidden,'Flow view is visible after click');

  const svg=d.getElementById('flow');
  const nodes=[...svg.querySelectorAll('.nd')];
  const links=[...svg.querySelectorAll('.lnk')];
  chk(nodes.length>20,'nodes rendered',`(${nodes.length})`);
  chk(links.length===nodes.length-1,'tree has n-1 links (no cycles)',`(${links.length} vs ${nodes.length-1})`);

  // Depth classes: root, provider, model, task must all appear.
  ['root','prov','model','task'].forEach(k=>{
    chk(svg.querySelectorAll('.nd.'+k).length>0,`has ${k} nodes`,
        `(${svg.querySelectorAll('.nd.'+k).length})`);
  });
  chk(svg.querySelectorAll('.nd.root').length===1,'exactly one root');

  // Totals must reconcile with the payload, not be invented by the layout.
  const DATA=w.eval('typeof DATA!=="undefined"?DATA:null');
  const cur=w.eval('current');
  const rows=DATA.profiles[cur].rows;
  const totalCalls=rows.reduce((s,r)=>s+r.calls,0);
  const sub=d.getElementById('flowsub').textContent;
  const shown=+(sub.match(/([\d,]+) calls/)||[])[1].replace(/,/g,'');
  chk(shown===totalCalls,'root total matches payload',`(${shown} vs ${totalCalls})`);

  const nProv=new Set(rows.map(r=>w.eval(
    `provOf(${JSON.stringify(r.provider||'')},${JSON.stringify(r.model||'')},${JSON.stringify(r.base_url||'')})`))).size;
  const provNodes=svg.querySelectorAll('.nd.prov').length;
  chk(provNodes===nProv,'one node per resolved provider',`(${provNodes} vs ${nProv})`);

  // Colours must come from the SHARED palette, not a private one.
  const modelNode=[...svg.querySelectorAll('.nd.model')][0];
  const nm=modelNode.querySelector('text').textContent.replace('…','');
  const fill=modelNode.querySelector('circle').getAttribute('fill');
  const expect=w.eval(`colorOf(${JSON.stringify(nm)})`);
  chk(fill===expect,'model colour comes from shared colorOf()',`(${fill})`);

  const provNode=[...svg.querySelectorAll('.nd.prov')][0];
  const pn=provNode.querySelector('text').textContent;
  const pfill=provNode.querySelector('circle').getAttribute('fill');
  const pexp=w.eval(`(PROV[${JSON.stringify(pn)}]||{}).fg||css('--accent')`);
  chk(pfill===pexp,'provider colour matches PROV badge',`(${pn} ${pfill})`);

  // No node may sit outside the viewport.
  const bad=nodes.filter(n=>{
    const m=(n.getAttribute('transform')||'').match(/translate\(([-\d.]+),([-\d.]+)\)/);
    if(!m) return true;
    const x=+m[1],y=+m[2];
    return x<0||y<0||x>1000||y>600||!isFinite(x)||!isFinite(y);
  });
  chk(bad.length===0,'all nodes inside the viewport',`(${bad.length} outside)`);

  // Radius must encode volume: the root should be among the largest.
  const radii=nodes.map(n=>+n.querySelector('circle').getAttribute('r'));
  chk(radii.every(r=>isFinite(r)&&r>0),'every node has a positive radius');

  // Hover focus dims the rest.
  const ev=new w.MouseEvent('mouseenter');
  provNode.dispatchEvent(ev);
  chk(svg.classList.contains('focus'),'hover enters focus mode');
  chk(svg.querySelectorAll('.nd.on').length>0,'hovered subtree is highlighted',
      `(${svg.querySelectorAll('.nd.on').length} lit)`);
  chk(d.getElementById('flowtip').classList.contains('on'),'tooltip shown on hover');
  provNode.dispatchEvent(new w.MouseEvent('mouseleave'));
  chk(!svg.classList.contains('focus'),'focus clears on mouseleave');

  // Depth toggle: 2 levels must drop every task node.
  const b2=d.querySelector('[data-fd="2"]');
  chk(!!b2,'depth control rendered');
  b2.click();
  chk(d.getElementById('flow').querySelectorAll('.nd.task').length===0,
      'depth=2 removes task nodes');
  chk(d.getElementById('flow').querySelectorAll('.nd.model').length>0,
      'depth=2 keeps model nodes');
  d.querySelector('[data-fd="3"]').click();
  chk(d.getElementById('flow').querySelectorAll('.nd.task').length>0,
      'depth=3 restores task nodes');

  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f?1:0);
 }catch(e){ console.log('THREW', e.message); process.exit(1); }
}, 900);
