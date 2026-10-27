// G4: the Home live board is a compact table panel. N live sessions in -> N
// rows with the right cells, brand logos kept, header sorting (click AND
// Enter/Space) with aria-sort, the drawer action still wired, and the table
// scrolls inside its own panel so the page never overflows sideways.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || path.join(__dirname, '..', 'examples', 'reports');
const html = fs.readFileSync(path.join(REPORTS, 'dashboard.html'), 'utf8');
const live = JSON.parse(fs.readFileSync(path.join(REPORTS, 'live-data.json'), 'utf8'));
const analytics = JSON.parse(fs.readFileSync(path.join(REPORTS, 'analytics-data.json'), 'utf8'));

let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
}

const HERMES = [{ id: 'h-1', title: 'Hermes job', model: 'openai/gpt-5', category: 'Coding', profile: 'p1', idle_s: 20,
  phase: 'editing', tools: ['read_file', 'terminal'], models: [{ model: 'openai/gpt-5', in_tok: 900, out_tok: 100, calls: 3 }] }];
const PI = [{ session_id: 'pi-1', agent: 'scout', title: 'Pi task', model: 'glm-5', idle_s: 45, uptime_s: 600,
  phase: 'reading', in_tok: 4000, out_tok: 1000, cost_usd: 0.0123 }];
const AGENTS = [
  { engine: 'claude', session_id: 'c-1', title: 'alpha', model: 'claude-opus-4-5', idle_s: 12, phase: 'running Bash', cost_usd: 1.5, in_tok: 100, out_tok: 50 },
  { engine: 'claude', session_id: 'c-2', title: 'gamma', model: 'claude-sonnet-4-5', idle_s: 300, phase: 'idle' },
  { engine: 'codex', session_id: 'x-1', title: 'beta', model: 'gpt-5-codex', idle_s: 30, phase: 'waiting for approval' },
];

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://127.0.0.1:8477/dashboard.html',
  beforeParse(w) {
    w.Chart = function () { return { destroy() {}, update() {} }; };
    w.Chart.defaults = { color: '', borderColor: '', font: {} };
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.fetch = (u) => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve(String(u).includes('live-data') ? live : analytics),
    });
  },
});

setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    const feed = (h, p, a) => w.eval(`DATA.profiles[current].live = ${JSON.stringify(h)}; DATA.pi_live = ${JSON.stringify(p)};`
      + ` DATA.agent_live = ${JSON.stringify(a)}; renderLive();`);
    feed(HERMES, PI, AGENTS);
    const rows = () => [...d.querySelectorAll('#livelist > .liverow')];
    const key = r => r.dataset.agentsession || r.dataset.pisession || 'h';
    const cell = (r, i) => r.children[i];

    // (a) one row per session, nine cells, the right content in each
    chk(rows().length === 5, 'N live sessions in -> N table rows', rows().length);
    chk(rows().every(r => r.children.length === 9 && r.getAttribute('role') === 'row'), 'every row has nine cells and role=row');
    const head = d.getElementById('livehead');
    const heads = [...head.querySelectorAll('[role=columnheader]')];
    chk(heads.length === 9 && !head.hidden, 'sticky header has nine column headers', heads.length);
    chk(heads.map(h => h.dataset.sort).join() === 'kind,session,model,state,elapsed,tokens,cost,activity,load', 'header columns in spec order');
    chk(heads.every(h => h.getAttribute('aria-sort') === 'none' && h.tabIndex === 0), 'headers start unsorted and are focusable');
    const byId = id => rows().find(r => key(r) === id);
    const c1 = byId('c-1'), cx = byId('x-1'), cidle = byId('c-2'), pi = byId('pi-1'), hm = byId('h');
    chk(c1 && cell(c1, 1).textContent.includes('alpha') && cell(c1, 2).textContent.includes('opus-4-5'), 'claude row: session + model cells');
    chk(c1 && cell(c1, 3).textContent.trim() === 'Running' && cx && cell(cx, 3).textContent.trim() === 'Waiting'
      && cidle && cell(cidle, 3).textContent.trim() === 'Idle', 'state pill reads Running / Waiting / Idle');
    chk(c1 && cell(c1, 3).querySelector('.lvst[data-state=running]') && cx.querySelector('.lvst[data-state=waiting]')
      && cidle.querySelector('.lvst[data-state=idle]'), 'state pills carry data-state for the semantic colours');
    chk(c1 && cell(c1, 5).textContent.trim() === '150' && cell(c1, 6).textContent.trim() === '$1.50', 'claude row: tokens and cost cells', cell(c1, 5).textContent + '|' + cell(c1, 6).textContent);
    chk(pi && cell(pi, 4).textContent.trim() === ago(600) && cell(pi, 5).textContent.trim() === '5.0K' && cell(pi, 6).textContent.trim() === '$0.0123',
      'pi row: elapsed, tokens, cost cells', [4, 5, 6].map(i => cell(pi, i).textContent.trim()).join('|'));
    chk(cx && cell(cx, 5).textContent.trim() === '—' && cell(cx, 6).textContent.trim() === '—', 'missing tokens/cost render as an em dash');
    chk(hm && cell(hm, 7).textContent.includes('editing') && cell(hm, 7).textContent.includes('20s ago') && hm.querySelectorAll('.lvtool').length === 2,
      'hermes row: last-activity cell has idle time, phase and tool chips', cell(hm, 7).textContent);
    chk(hm && cell(hm, 5).textContent.trim() === '1.0K', 'hermes row: tokens from its model breakdown', cell(hm, 5).textContent);
    chk(hm && cell(hm, 8).querySelector('[role=meter]') && /%$/.test(cell(hm, 8).textContent.trim()), 'hermes row: load cell keeps the gauge and a visible percent');
    chk(!/NaN|undefined|null/.test(d.getElementById('livelist').textContent), 'no NaN/undefined/null anywhere in the table');
    const num = [...rows()[0].querySelectorAll('.lvnum')];
    chk(num.length === 3 && num.every(c => w.getComputedStyle(c).textAlign === 'right'), 'number cells are right-aligned', num.length);
    chk(rows().every(r => w.getComputedStyle(r).display === 'grid'), 'rows are grid rows (single line, not stacked cards)');

    // (b) brand logos kept at >= 15px
    const logo = r => r && r.querySelector('[data-kindbadge] svg[data-kindlogo]');
    const px = s => parseFloat(w.getComputedStyle(s).width);
    chk(logo(c1) && logo(cx) && logo(c1).dataset.kindlogo === 'claude' && logo(cx).dataset.kindlogo === 'codex', 'claude and codex rows carry their data-kindlogo svgs');
    chk([c1, cidle, cx].every(r => logo(r) && px(logo(r)) >= 15 && parseFloat(w.getComputedStyle(logo(r)).height) >= 15), 'row logos render >= 15px', px(logo(c1)));
    chk(!logo(pi) && !logo(hm), 'pi and hermes rows keep their glyph badges (no brand logo)');
    chk(c1.querySelector('[data-kindbadge]').getAttribute('style').includes('var(--kind-claude)') && cx.querySelector('[data-kindbadge]').getAttribute('style').includes('var(--kind-codex)'),
      'kind colours still come from the --kind-* tokens');

    // (c) header sorting: click and Enter, aria-sort, order
    const hd = k => head.querySelector(`[data-sort="${k}"]`);
    const order = () => rows().map(key).join();
    const base = order();
    hd('session').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    chk(hd('session').getAttribute('aria-sort') === 'ascending', 'click sets aria-sort=ascending');
    const titles = () => rows().map(r => r.querySelector('.lvtitle').textContent.trim().split(/\s/)[0].toLowerCase());
    chk(titles().join() === ['alpha', 'beta', 'gamma', 'hermes', 'pi'].join(), 'ascending by session title', titles().join());
    hd('session').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    chk(hd('session').getAttribute('aria-sort') === 'descending' && titles().join() === ['pi', 'hermes', 'gamma', 'beta', 'alpha'].join(), 'second click: descending', titles().join());
    hd('session').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    chk(hd('session').getAttribute('aria-sort') === 'none' && order() === base, 'third click clears the sort and restores the feed order');
    hd('tokens').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    chk(hd('tokens').getAttribute('aria-sort') === 'ascending', 'Enter on a focused header sorts it (aria-sort=ascending)');
    chk(key(rows()[rows().length - 1]) === 'c-2' || key(rows()[rows().length - 1]) === 'x-1', 'rows with no value sink to the bottom', order());
    hd('tokens').dispatchEvent(new w.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    chk(hd('tokens').getAttribute('aria-sort') === 'descending' && key(rows()[0]) === 'pi-1', 'Space also sorts; largest tokens first when descending', order());
    chk([...head.querySelectorAll('[aria-sort]')].filter(h => h.getAttribute('aria-sort') !== 'none').length === 1, 'only one header carries a sort at a time');
    hd('state').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    chk(hd('tokens').getAttribute('aria-sort') === 'none' && hd('state').getAttribute('aria-sort') === 'ascending'
      && cell(rows()[0], 3).textContent.trim() === 'Running' && cell(rows()[4], 3).textContent.trim() === 'Idle', 'sorting another column moves the sort; Running before Idle', order());
    const sortedOrder = order();
    feed(HERMES, PI, AGENTS);
    chk(order() === sortedOrder && hd('state').getAttribute('aria-sort') === 'ascending', 'a refresh keeps the active sort');
    hd('state').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    hd('state').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

    // (d) the row actions still work: transcript button opens the drawer, timeline chip is present
    const tb = hm.querySelector('button.ttitlebtn[data-tsession="h-1"]');
    chk(!!tb && tb.dataset.tprofile === 'p1' && !!hm.querySelector('button.lntimelinebtn[data-tsession="h-1"]'), 'hermes row keeps its transcript button and Timeline chip');
    tb.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    const modal = d.getElementById('tmodal');
    chk(w.eval('tOpen') === true && !!modal && modal.classList.contains('open')
      && d.getElementById('ttitle').textContent === 'Hermes job', 'clicking the session title still opens the transcript drawer for that session', modal && modal.className);
    d.getElementById('tclose').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    chk(w.eval('tOpen') === false, 'the drawer closes again');
    hm.querySelector('button.lntimelinebtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    chk(d.getElementById('lnmodal').classList.contains('open') && d.getElementById('lntitle').textContent === 'Hermes job', 'the Timeline chip still opens the timeline for that session');

    // (e) no page-level overflow: the panel scrolls itself, the rows keep their width
    const sc = d.querySelector('.lvscroll');
    const scs = w.getComputedStyle(sc);
    chk((scs.overflow === 'auto' || scs.overflowX === 'auto') && scs.minWidth === '0px', 'the table scrolls inside .lvscroll (overflow:auto, min-width:0)', `${scs.overflow}/${scs.overflowX}/${scs.minWidth}`);
    chk(sc.closest('.card') && w.getComputedStyle(sc.closest('.card')).minWidth === '0px', 'the card around it can shrink (min-width:0)');
    chk(/\.lvhead,\.lvrow\{[^}]*min-width:816px/.test(html), 'rows and header share one min-width so they scroll together');
    chk(/\.lvhead\{position:sticky;top:0/.test(html), 'the header is sticky');
    chk(parseFloat(w.getComputedStyle(rows()[0]).maxHeight) <= 32, 'row height is capped at 32px', w.getComputedStyle(rows()[0]).maxHeight);

    // (f) names stay whole: the narrow columns shrink to their content width and
    // Last activity is the one that gives way; the model cell has no small cap
    const cols = (/--lvcols:([^}]+)\}/.exec(html) || [, ''])[1].trim().split(/\s+(?![^(]*\))/);
    const minPx = t => { const m = /^(?:minmax\()?(\d+)px/.exec(t); return m ? +m[1] : NaN; };
    chk(cols.length === 9, '--lvcols defines nine tracks', cols.join(' '));
    chk([0, 3, 4, 5, 6, 8].every(i => /^\d+px$/.test(cols[i])), 'Kind/State/Elapsed/Tokens/Cost/Load are fixed to their content width', cols.join(' '));
    chk(minPx(cols[2]) >= 132 && minPx(cols[1]) >= 164, 'Model track >= 132px (18ch) and Session track >= 164px', cols[1] + ' ' + cols[2]);
    chk(/fr\)$/.test(cols[7]) && minPx(cols[7]) <= 80 && minPx(cols[7]) < minPx(cols[2]) && minPx(cols[7]) < minPx(cols[1]), 'Last activity is the flexible, smallest-min column (truncates first)', cols[7]);
    const capOf = sel => { const r = new RegExp('(?:^|\\})\\s*' + sel + '\\{([^}]*)\\}', 'g'); const out = []; let m; while ((m = r.exec(html))) { const c = /max-width:\s*([\d.]+)(ch|px|em|rem)?/.exec(m[1]); if (c) out.push(c[0]); } return out; };
    const capTooSmall = v => { const m = /([\d.]+)(ch|px|em|rem)?/.exec(v.replace('max-width:', '')); const n = +m[1], u = m[2]; return u === 'ch' ? n < 18 : u === 'px' ? n < 132 : (u === 'em' || u === 'rem') ? n < 9 : false; };
    chk(!capOf('\\.lvmodel').some(capTooSmall) && !capOf('\\.lvc\\.metacol').some(capTooSmall), 'the model cell has no max-width below 18ch', capOf('\\.lvmodel').concat(capOf('\\.lvc\\.metacol')).join(';'));
    chk(c1 && cell(c1, 2).querySelector('.lvmodel').getAttribute('title') === 'claude-opus-4-5', 'a truncatable model cell keeps its full text in title=');
    chk(c1 && c1.querySelector('.lvtitle').getAttribute('title') === 'alpha', 'a truncatable session cell keeps its full text in title=');

    // (g) the idle row is muted by colour, never by opacity, and the colours meet AA
    chk(cidle && cidle.dataset.lvstate === 'idle' && c1.dataset.lvstate === 'running', 'rows carry data-lvstate for the idle styling');
    const idleRules = [...html.matchAll(/([^{}]*data-lvstate=idle[^{}]*)\{([^}]*)\}/g)].filter(m => !/:not\(/.test(m[1]));
    chk(idleRules.length > 0 && idleRules.every(m => !/opacity/.test(m[2]) && /color:var\(--muted\)/.test(m[2])), 'idle row rules mute with var(--muted) and use no opacity', idleRules.map(m => m[0]).join(' | '));
    chk(!/\.liverow[^{}]*\{[^}]*opacity:\s*0?\.\d/.test(html.replace(/\.live-fade[^{}]*\{[^}]*\}/g, '')), 'no .liverow rule fades text with opacity');
    const lumOf = hex => { const h = hex.replace('#', ''); const v = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(x => x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4)); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
    const ratio = (a, b) => { const A = lumOf(a), B = lumOf(b); return (Math.max(A, B) + .05) / (Math.min(A, B) + .05); };
    const tok = (block, n) => { const m = new RegExp(n + ':(#[0-9a-fA-F]{6})').exec(block); return m && m[1]; };
    const lightBlock = html.slice(html.indexOf(':root,\n[data-theme="light"]{')), darkBlock = html.slice(html.indexOf('[data-theme="dark"]{'));
    const rl = ratio(tok(lightBlock, '--muted'), tok(lightBlock, '--card')), rd = ratio(tok(darkBlock, '--muted'), tok(darkBlock, '--card'));
    chk(rl >= 4.5 && rd >= 4.5, 'idle (--muted on --card) contrast is >= 4.5:1 in light and dark', rl.toFixed(2) + ' / ' + rd.toFixed(2));
    chk(/:root:not\(\[data-theme="dark"\]\) \.lvrow:not\(\[data-lvstate=idle\]\) \.lvmodel\{filter:brightness\(\.[1-6]\d*\)\}/.test(html) && /class="lvmodel[^"]*" style="color:[^"]*"/.test(cell(c1, 2).innerHTML),
      'model text is darkened for light only; dark keeps the palette colour (inline colour)');

    // empty state hides the header and shows the empty block
    feed([], [], []);
    chk(d.getElementById('livehead').hidden === true, 'header hidden when nothing is running');
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 6).join('\n'));
  }
  console.log(`\ncheck_live_table.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);

  function ago(s) { return w.eval(`ago(${s})`); }
}, 1500);
