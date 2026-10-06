// Unit tests for drawer.js — session finder, transcript rendering, log timeline.
// Expected values derived by hand from the source, not captured from output.
import { isolate } from './lib/isolate.mjs';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const eq = (actual, expected, msg) => {
  try { assert.deepEqual(actual, expected); pass++; }
  catch { fail++; console.error(`FAIL: ${msg}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`); }
};
const ok = (cond, msg) => eq(!!cond, true, msg);

// ── sfParseQuery ──────────────────────────────────────────────────────────────
{
  const D = await isolate('drawer.js', {
    'palette.js': { COLORS:{}, TOOLCOLORS:{}, hashHue:()=>0, esc:s=>s, $:()=>null, emptyHTML:()=>'', fmt:()=>'', short:()=>'', colorOf:()=>'', toolColor:()=>'' },
    'charts.js': { current:'p1' },
    'views.js': { schemaProblem:()=>null },
    'router.js': { pickView:()=>{} },
    'main.js': { DATA:{ profiles:{ p1:{ session_index:[] } } } },
  }, { window:{ addEventListener(){}, innerWidth:1280, scrollY:0, scrollTo(){} } });

  const q1 = D.sfParseQuery('model:opus tool:patch cost>1 dur>1h free text');
  eq(q1.filters, { model:'opus', tools:'patch' }, 'parse: filters');
  eq(q1.numeric, [ {key:'cost',op:'>',val:1}, {key:'dur',op:'>',val:3600} ], 'parse: numeric with dur unit');
  eq(q1.text, 'free text', 'parse: free text');

  const q2 = D.sfParseQuery('source:cli');
  eq(q2.filters, { source:'cli' }, 'parse: source filter');
  eq(q2.numeric, [], 'parse: no numeric');
  eq(q2.text, '', 'parse: no text');

  const q3 = D.sfParseQuery('');
  eq(q3.filters, {}, 'parse: empty filters');
  eq(q3.numeric, [], 'parse: empty numeric');
  eq(q3.text, '', 'parse: empty text');

  const q4 = D.sfParseQuery('end:completed cost<0.5');
  eq(q4.filters, { end:'completed' }, 'parse: end filter');
  eq(q4.numeric, [ {key:'cost',op:'<',val:0.5} ], 'parse: cost less-than');
  eq(q4.text, '', 'parse: no free text');

  const q5 = D.sfParseQuery('unknownkey:val model:gpt-5');
  eq(q5.filters, { model:'gpt-5' }, 'parse: unknown key ignored from filters');
  eq(q5.text, 'unknownkey:val', 'parse: unknown key falls through to text');
}

// ── sfMatch ──────────────────────────────────────────────────────────────────
{
  const D = await isolate('drawer.js', {
    'palette.js': { COLORS:{}, TOOLCOLORS:{}, hashHue:()=>0, esc:s=>s, $:()=>null, emptyHTML:()=>'', fmt:()=>'', short:()=>'', colorOf:()=>'', toolColor:()=>'' },
    'charts.js': { current:'p1' },
    'views.js': { schemaProblem:()=>null },
    'router.js': { pickView:()=>{} },
    'main.js': { DATA:{ profiles:{ p1:{ session_index:[] } } } },
  }, { window:{ addEventListener(){}, innerWidth:1280, scrollY:0, scrollTo(){} } });

  const S = { id:'s1', title:'Fix the parser', model:'gpt-5', source:'cli', tools:['patch','read'], cost:1.25, dur:7200, branch:'main', cwd_tail:'/repo', end:'completed' };

  ok(D.sfMatch(S, { filters:{model:'gpt'}, numeric:[], text:'' }), 'match: model substring');
  ok(!D.sfMatch(S, { filters:{model:'claude'}, numeric:[], text:'' }), 'match: model miss');
  ok(D.sfMatch(S, { filters:{tools:'patch'}, numeric:[], text:'' }), 'match: tool in list');
  ok(!D.sfMatch(S, { filters:{tools:'delete'}, numeric:[], text:'' }), 'match: tool miss');
  ok(D.sfMatch(S, { filters:{}, numeric:[{key:'cost',op:'>',val:1}], text:'' }), 'match: cost gt');
  ok(!D.sfMatch(S, { filters:{}, numeric:[{key:'cost',op:'<',val:1}], text:'' }), 'match: cost lt miss');
  ok(D.sfMatch(S, { filters:{}, numeric:[{key:'dur',op:'>',val:3600}], text:'' }), 'match: dur gt');
  ok(D.sfMatch(S, { filters:{}, numeric:[], text:'fix' }), 'match: text in title');
  ok(D.sfMatch(S, { filters:{}, numeric:[], text:'repo' }), 'match: text in cwd_tail');
  ok(!D.sfMatch(S, { filters:{}, numeric:[], text:'nonexistent' }), 'match: text miss');
  ok(D.sfMatch(S, { filters:{end:'completed'}, numeric:[], text:'' }), 'match: end filter');
  ok(!D.sfMatch(S, { filters:{end:'running'}, numeric:[], text:'' }), 'match: end miss');
  ok(D.sfMatch(S, { filters:{}, numeric:[{key:'unknown',op:'>',val:0}], text:'' }), 'match: unknown numeric key skipped');
  ok(!D.sfMatch({ id:'x', title:'no cost' }, { filters:{}, numeric:[{key:'cost',op:'>',val:0}], text:'' }), 'match: missing cost field fails');
}

// ── sfRowsHtml ───────────────────────────────────────────────────────────────
{
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const D = await isolate('drawer.js', {
    'palette.js': { COLORS:{}, TOOLCOLORS:{}, hashHue:()=>0, esc, $:()=>null, emptyHTML:(icon,title,hint)=>`<div class="empty">${title}</div>`, fmt:()=>'', short:()=>'', colorOf:()=>'', toolColor:()=>'' },
    'charts.js': { current:'p1' },
    'views.js': { schemaProblem:()=>null },
    'router.js': { pickView:()=>{} },
    'main.js': { DATA:{ profiles:{ p1:{ session_index:[] } } } },
  }, { window:{ addEventListener(){}, innerWidth:1280, scrollY:0, scrollTo(){} } });

  const S = { id:'s1', title:'Fix the <parser>', model:'gpt-5', source:'cli', tools:['patch','read'], cost:1.25, dur:7200, branch:'main', cwd_tail:'/repo' };
  const S2 = { id:'s2', title:'second', model:'m', cost:0.5 };

  // Default: no active row (sfActiveIdx starts at -1)
  const html = D.sfRowsHtml([S, S2], 'fix');
  ok(!html.includes('sfactive'), 'rows: no active row before sfRender');
  ok(!html.includes('aria-selected="true"'), 'rows: nothing aria-selected before sfRender');
  ok(html.includes('data-idx="0"'), 'rows: data-idx 0');
  ok(html.includes('data-idx="1"'), 'rows: data-idx 1');
  ok(html.includes('<mark>Fix</mark>'), 'rows: free-text highlight');
  ok(html.includes('&lt;parser&gt;'), 'rows: HTML escaped in title');
  ok(html.includes('$1.25'), 'rows: cost to 2dp');
  ok(html.includes('patch, read'), 'rows: tool list');
  ok(html.includes('$0.50'), 'rows: second row cost');

  // No cost → no $ span
  const html2 = D.sfRowsHtml([{ id:'s3', title:'free', model:'m' }], '');
  ok(!html2.includes('$'), 'rows: no cost → no dollar sign');

  // Cap at 60
  const many = Array.from({ length: 70 }, (_, i) => ({ id:'x'+i, title:'t'+i }));
  const html3 = D.sfRowsHtml(many, '');
  const rowCount = html3.split('class="sfrow"').length - 1;
  eq(rowCount, 60, 'rows: capped at 60');

  // Empty results with non-empty session_index → "No sessions match."
  const D2 = await isolate('drawer.js', {
    'palette.js': { COLORS:{}, TOOLCOLORS:{}, hashHue:()=>0, esc, $:()=>null, emptyHTML:(icon,title,hint)=>`<div class="empty">${title}</div>`, fmt:()=>'', short:()=>'', colorOf:()=>'', toolColor:()=>'' },
    'charts.js': { current:'p1' },
    'views.js': { schemaProblem:()=>null },
    'router.js': { pickView:()=>{} },
    'main.js': { DATA:{ profiles:{ p1:{ session_index:[{id:'x'}] } } } },
  }, { window:{ addEventListener(){}, innerWidth:1280, scrollY:0, scrollTo(){} } });
  const html4 = D2.sfRowsHtml([], '');
  ok(html4.includes('No sessions match.'), 'rows: empty with sessions → No sessions match.');

  // Empty results with empty session_index → "No sessions in range."
  const html5 = D.sfRowsHtml([], '');
  ok(html5.includes('No sessions in range.'), 'rows: empty with no sessions → No sessions in range.');

  // sfRender: index -1 clamps to 0 when results exist → first row active
  const attrs = {};
  const relems = {
    sfinput: { value:'', setAttribute(k, v){ attrs[k] = v; } },
    sflist: { innerHTML:'' },
  };
  const D3 = await isolate('drawer.js', {
    'palette.js': { COLORS:{}, TOOLCOLORS:{}, hashHue:()=>0, esc, $:(id)=>relems[id] || null, emptyHTML:(icon,title)=>`<div class="empty">${title}</div>`, fmt:()=>'', short:()=>'', colorOf:()=>'', toolColor:()=>'' },
    'charts.js': { current:'p1' },
    'views.js': { schemaProblem:()=>null },
    'router.js': { pickView:()=>{} },
    'main.js': { DATA:{ profiles:{ p1:{ session_index:[S, S2] } } } },
  }, { window:{ addEventListener(){}, innerWidth:1280, scrollY:0, scrollTo(){} } });
  D3.sfRender();
  ok(relems.sflist.innerHTML.includes('sfrow sfactive" id="sfrow-0"'), 'render: first row active after sfRender');
  ok(!relems.sflist.innerHTML.includes('sfactive" id="sfrow-1"'), 'render: second row not active');
  eq(attrs['aria-activedescendant'], 'sfrow-0', 'render: aria-activedescendant points at row 0');
  // Query with no hits → index -1, empty activedescendant
  relems.sfinput.value = 'zzzz-nohit';
  D3.sfRender();
  eq(attrs['aria-activedescendant'], '', 'render: no results → no activedescendant');
  ok(relems.sflist.innerHTML.includes('No sessions match.'), 'render: no-hit query → No sessions match.');
}

// ── tRenderContent / tRenderMsg ──────────────────────────────────────────────
{
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const D = await isolate('drawer.js', {
    'palette.js': { COLORS:{}, TOOLCOLORS:{}, hashHue:()=>0, esc, $:()=>null, emptyHTML:()=>'', fmt:()=>'', short:()=>'', colorOf:()=>'', toolColor:()=>'' },
    'charts.js': { current:'p1' },
    'views.js': { schemaProblem:()=>null },
    'router.js': { pickView:()=>{} },
    'main.js': { DATA:{ profiles:{ p1:{ session_index:[] } } } },
  }, { window:{ addEventListener(){}, innerWidth:1280, scrollY:0, scrollTo(){} } });

  // tRenderContent: escape → links → code blocks
  const c1 = D.tRenderContent('hello <b>world</b>');
  ok(c1.includes('&lt;b&gt;'), 'content: HTML escaped');

  const c2 = D.tRenderContent('see https://example.com/docs');
  ok(c2.includes('<a href="https://example.com/docs"'), 'content: link');
  ok(c2.includes('target="_blank"'), 'content: link target blank');
  const c2b = D.tRenderContent('plain http://example.org/x here');
  ok(c2b.includes('<a href="http://example.org/x"'), 'content: http (non-TLS) link too');
  ok(c2b.includes('rel="noopener noreferrer"'), 'content: link rel noopener');

  const c3 = D.tRenderContent('```\ncode here\n```');
  ok(c3.includes('<pre>'), 'content: code block');
  ok(c3.includes('code here'), 'content: code content');

  // tRenderMsg
  const m1 = D.tRenderMsg({ role:'user', content:'hi', ts:1700000000 });
  ok(m1.includes('role-user'), 'msg: role class');
  ok(m1.includes('user'), 'msg: role label');

  const m2 = D.tRenderMsg({ role:'assistant', content:'', tool_calls:[{name:'patch'}] });
  ok(m2.includes('ttoolcall'), 'msg: tool_calls div');
  ok(m2.includes('patch'), 'msg: tool name');

  const m3 = D.tRenderMsg({ role:'tool', content:'', tool_name:'read' });
  ok(m3.includes('ttoolcall'), 'msg: tool_name div');
  ok(m3.includes('read result'), 'msg: tool result label');
}

// ── lnRenderTimeline ─────────────────────────────────────────────────────────
{
  const elems = {
    lnbody:{ innerHTML:'' },
    lntitle:{ textContent:'' },
    lnsub:{ textContent:'' },
    lnmeta:{ textContent:'' },
  };
  const D = await isolate('drawer.js', {
    'palette.js': { COLORS:{'gpt-5':'#111'}, TOOLCOLORS:{patch:'#222'}, hashHue:()=>0, esc:s=>s, $:(id)=>elems[id] || null, emptyHTML:()=>'', fmt:()=>'', short:()=>'', colorOf:()=>'', toolColor:()=>'' },
    'charts.js': { current:'p1' },
    'views.js': { schemaProblem:()=>null },
    'router.js': { pickView:()=>{} },
    'main.js': { DATA:{ profiles:{ p1:{ session_index:[] } } } },
  }, {
    window:{ addEventListener(){}, innerWidth:1280, scrollY:0, scrollTo(){} },
    document:{
      getElementById:(id)=>elems[id] || null,
      querySelector:()=>null,
      addEventListener(){},
    },
  });

  const tl = {
    id:'ln1', title:'Test Run', end_reason:'completed',
    axis_start:0, axis_end:100,
    models:['gpt-5','claude'],
    input_tokens:1000, output_tokens:500,
    actual_cost_usd:0.0123,
    spans:[
      { lane:'model', start:10, end:30, label:'gpt-5', color_key:'gpt-5', failed:false },
      { lane:'tool', start:40, end:40, label:'patch', color_key:'patch', failed:true },
      { lane:'user', start:50, end:60, label:'user', color_key:'user', failed:false },
    ],
  };

  D.lnRenderTimeline(tl);

  // Check the body innerHTML was set
  const body = elems.lnbody;
  ok(body.innerHTML.includes('lnlane'), 'timeline: lanes rendered');
  ok(body.innerHTML.includes('Model'), 'timeline: Model lane label');
  ok(body.innerHTML.includes('Tool'), 'timeline: Tool lane label');
  ok(body.innerHTML.includes('lnspan'), 'timeline: spans rendered');
  ok(body.innerHTML.includes('lnfail'), 'timeline: failed span class');
  ok(body.innerHTML.includes('lntick'), 'timeline: tick span class');
  ok(body.innerHTML.includes('data-lnidx="0"'), 'timeline: data-lnidx');
  ok(body.innerHTML.includes('data-lnlabel="gpt-5"'), 'timeline: data-lnlabel');
  ok(body.innerHTML.includes('data-lnmeta'), 'timeline: data-lnmeta');

  // Title and subtitle
  eq(elems.lntitle.textContent, 'Test Run', 'timeline: title');
  eq(elems.lnsub.textContent, 'completed', 'timeline: end_reason subtitle');

  // Meta line
  const meta = elems.lnmeta.textContent;
  ok(meta.includes('gpt-5, claude'), 'timeline: models in meta');
  ok(meta.includes('1,000 in / 500 out'), 'timeline: token counts');
  ok(meta.includes('$0.0123'), 'timeline: cost');
  ok(!meta.includes('still running'), 'timeline: no still-running when finished');

  // Span positioning: left:10%;width:20% for first span
  ok(body.innerHTML.includes('left:10%'), 'timeline: span left');
  ok(body.innerHTML.includes('width:20%'), 'timeline: span width');

  // Zero-width span floored at 0.3%
  ok(body.innerHTML.includes('width:0.3%'), 'timeline: zero-width span floored');

  // Running timeline
  const tl2 = { ...tl, running:true, end_reason:'' };
  D.lnRenderTimeline(tl2);
  ok(elems.lnmeta.textContent.includes('still running'), 'timeline: still running when running');
  eq(elems.lnsub.textContent, 'running', 'timeline: running subtitle');
}

console.log(`unit_drawer: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
