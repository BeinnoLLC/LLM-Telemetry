// Live grid layout contract.
// jsdom does no real layout, so this asserts the CSS CONTRACT rather than
// measured boxes: explicit tracks, a stacking breakpoint, and crucially that
// no `grid-column:span N` survives on a child of an auto-fit/explicit grid --
// that mismatch is what left ~465px dead at 900px and a 0px track at 640px.
// Real pixel verification is done with headless chrome (scratch/audit_one.py).
const fs=require('fs'), path=require('path');
const DIR=process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(__dirname, '..', 'examples', 'reports');
const html=fs.readFileSync(path.join(DIR,'dashboard.html'),'utf8');
let p=0,f=0;
const ok=(c,m,x='')=>{c?(p++,console.log('  ok   '+m+(x?'  '+x:''))):(f++,console.log('  FAIL '+m+(x?'  '+x:'')));};

const grid=/\.livegrid\{([^}]*)\}/.exec(html);
ok(!!grid,'.livegrid rule present');
if(grid){
  ok(/display:grid/.test(grid[1]),'.livegrid is a grid');
  ok(/grid-template-columns:minmax\(0,3fr\) minmax\(280px,1fr\)/.test(grid[1].replace(/\s+/g,' ')),
     'explicit two-column tracks (not auto-fit)');
}
ok(/\.livegrid > \*\{min-width:0\}/.test(html),'children get min-width:0 (prevents overflow)');

// the element must actually use the class
ok(/<div class="livegrid" id="live-grid">/.test(html),'live grid uses .livegrid class');

// stacking breakpoint — #14 lowered this from 1000px to 834px; #183 raised it to
// 1023px so the agents panel (the right column) sits beside the table only at
// >=1024px and reflows under it below that.
const mq=/@media\(max-width:1023px\)\{([\s\S]{0,400}?)\}\s*\n/.exec(html);
ok(!!mq,'1023px stacking breakpoint present (#183: agents panel beside the table at >=1024px)');
ok(!/@media\(max-width:834px\)\{\s*\n\s*\.livegrid\{/.test(html),'the old 834px livegrid breakpoint is gone');
if(mq) ok(/grid-template-columns:minmax\(0,1fr\)/.test(mq[1]),'stacks to one column when narrow');

// the original bug: a fixed span against a variable column count
const liveBlock=/<div class="livegrid"[\s\S]*?<!-- Local inference|<div class="livegrid"[\s\S]{0,4000}/.exec(html);
ok(liveBlock && !/grid-column:span/.test(liveBlock[0]),
   'no fixed grid-column:span inside the live grid (the dead-space bug)');

console.log('\n'+p+' passed, '+f+' failed');
process.exit(f?1:0);
