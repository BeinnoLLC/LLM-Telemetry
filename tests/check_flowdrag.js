// Flow graph: work-proportional glow + drag-to-reposition.
const fs=require('fs'), path=require('path'), {JSDOM}=require('jsdom');
const DIR=process.env.LLM_TELEMETRY_REPORTS
  || path.join(require('os').homedir(), '.local/share/llm-telemetry/reports');
let html=fs.readFileSync(path.join(DIR,'dashboard.html'),'utf8');
html=html.replace(/<script src="https?:\/\/[^"]+"><\/script>/g,'');

const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,
  url:'http://localhost:8477/dashboard.html',
  beforeParse(w){
    w.Chart=function(){return{destroy(){},update(){},resize(){}};};
    w.Chart.overrides={doughnut:{plugins:{legend:{labels:{generateLabels:()=>[]}}}}};
    w.Chart.defaults={color:'',borderColor:'',font:{},plugins:{legend:{labels:{generateLabels:()=>[]}}}};
    w.Chart.register=()=>{};
    w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
    const live=JSON.parse(fs.readFileSync(path.join(DIR,'live-data.json'),'utf8'));
    w.fetch=()=>Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(live)});
    // jsdom has no layout engine: without a real size the force sim divides by
    // zero and every node lands at NaN, so nothing renders.
    Object.defineProperty(w.HTMLElement.prototype,'clientWidth',{get(){return 1000}});
    Object.defineProperty(w.HTMLElement.prototype,'clientHeight',{get(){return 600}});
    w.HTMLElement.prototype.getBoundingClientRect=function(){
      return {width:1000,height:600,top:0,left:0,right:1000,bottom:600};
    };
  }});
const w=dom.window, d=w.document;
let p=0,f=0;
const ok=(c,m,x='')=>{c?(p++,console.log('  ok   '+m+(x?'  '+x:''))):(f++,console.log('  FAIL '+m+(x?'  '+x:'')));};

setTimeout(()=>{
  // Open the Flow tab so renderFlow() runs. The attribute is data-vtab.
  const btn=[...d.querySelectorAll('[data-vtab]')].find(b=>b.dataset.vtab==='Flow');
  if(btn) btn.click();

  setTimeout(()=>{
    const svg=d.getElementById('flow');
    ok(!!svg,'flow svg present');
    const nds=[...d.querySelectorAll('#flow .nd')];
    ok(nds.length>3,'nodes rendered',`(${nds.length})`);

    // ---- glow is proportional to work -------------------------------------
    const heats=nds.map(n=>parseFloat(n.style.getPropertyValue('--heat')))
                   .filter(v=>!isNaN(v));
    ok(heats.length===nds.length,'every node carries --heat',
       `(${heats.length}/${nds.length})`);
    ok(heats.every(v=>v>=0&&v<=1),'--heat is normalised 0..1',
       `(min ${Math.min(...heats).toFixed(3)}, max ${Math.max(...heats).toFixed(3)})`);
    ok(Math.abs(Math.max(...heats)-1)<0.001,'busiest node is at full heat');
    ok(new Set(heats.map(v=>v.toFixed(3))).size>2,
       'heat varies across nodes (not a constant)',
       `(${new Set(heats.map(v=>v.toFixed(2))).size} distinct)`);
    ok(nds.every(n=>!!n.style.getPropertyValue('--glow')),
       'every node carries a --glow colour');

    // Radius is clamped (Math.max(4, ...)) and scaled per node KIND, so radius
    // and heat only track each other within a kind — comparing across kinds
    // produces false failures. Check the relationship where it must hold.
    const byKind={};
    nds.forEach(n=>{
      const h=parseFloat(n.style.getPropertyValue('--heat'));
      const c=n.querySelector('circle');
      if(!c||isNaN(h)) return;
      const r=parseFloat(c.getAttribute('r'));
      const k=[...n.classList].find(x=>x!=='nd')||'?';
      (byKind[k] ||= []).push({h,r});
    });
    let mono=true, detail='';
    Object.entries(byKind).forEach(([k,arr])=>{
      if(arr.length<3) return;                 // too few to be meaningful
      const s=[...arr].sort((a,b)=>a.h-b.h);
      for(let i=1;i<s.length;i++){
        // Allow the clamp floor: below it, radius is constant by design.
        if(s[i].r+0.01<s[i-1].r && s[i-1].r>4.01){ mono=false; detail=`${k}: heat ${s[i].h.toFixed(3)} r=${s[i].r} after heat ${s[i-1].h.toFixed(3)} r=${s[i-1].r}`; }
      }
    });
    ok(mono,'within a node kind, glow rises with size (same work scale)',detail);

    // ---- drag ---------------------------------------------------------------
    const target=nds.find(n=>!n.classList.contains('root'))||nds[1];
    const before=target.getAttribute('transform');
    svg.setPointerCapture=()=>{}; svg.releasePointerCapture=()=>{};
    const PE=(t,x,y)=>{const e=new w.Event(t,{bubbles:true,cancelable:true});
      e.clientX=x;e.clientY=y;e.pointerId=1;return e;};
    svg.getBoundingClientRect=()=>({left:0,top:0,width:1000,height:600});

    target.dispatchEvent(PE('pointerdown',100,100));
    ok(svg.classList.contains('drag'),'pointerdown starts a drag');
    ok(target.classList.contains('dragging'),'dragged node marked .dragging');

    svg.dispatchEvent(PE('pointermove',400,300));
    const after=target.getAttribute('transform');
    ok(before!==after,'node moves with the pointer',`${before} -> ${after}`);

    svg.dispatchEvent(PE('pointerup',400,300));
    ok(!svg.classList.contains('drag'),'pointerup ends the drag');
    ok(!target.classList.contains('dragging'),'.dragging cleared on release');
    ok(target.classList.contains('pinned'),'moved node marked .pinned');

    // Links must follow the node, else edges detach visually.
    const tr=/translate\(([-\d.]+),([-\d.]+)\)/.exec(after);
    const nx=parseFloat(tr[1]), ny=parseFloat(tr[2]);
    const touching=[...d.querySelectorAll('#flow .lnk')].filter(l=>{
      const dd=l.getAttribute('d')||'';
      return dd.includes(nx.toFixed(1)+','+ny.toFixed(1));
    });
    ok(touching.length>0,'links re-drawn to the new position',
       `(${touching.length} edge(s))`);

    // Clamped inside the canvas: drag far outside and it must stay visible.
    target.dispatchEvent(PE('pointerdown',400,300));
    svg.dispatchEvent(PE('pointermove',-5000,-5000));
    svg.dispatchEvent(PE('pointerup',-5000,-5000));
    const t2=/translate\(([-\d.]+),([-\d.]+)\)/.exec(target.getAttribute('transform'));
    ok(parseFloat(t2[1])>=0&&parseFloat(t2[2])>=0,
       'node clamped inside the canvas',`(${t2[1]},${t2[2]})`);

    console.log(`\n${p} passed, ${f} failed`);
    process.exit(f?1:0);
  },700);
},900);
