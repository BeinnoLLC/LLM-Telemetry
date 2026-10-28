// G4 + roomy pass: the Home live board is a comfortable table panel (48px+ rows, two-line cells). N live sessions in -> N
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
  { engine: 'claude', session_id: 'c-1', title: 'alpha', model: 'claude-opus-4-5', idle_s: 12, uptime_s: 2400, phase: 'running Bash', cost_usd: 1.5, in_tok: 100, out_tok: 50 },
  { engine: 'claude', session_id: 'c-2', title: 'gamma', model: 'claude-sonnet-4-5', idle_s: 300, uptime_s: 7200, phase: 'idle' },
  { engine: 'codex', session_id: 'x-1', title: 'beta', model: 'gpt-5-codex', idle_s: 30, uptime_s: 300, phase: 'waiting for approval' },
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

    // (a) one row per session, eight cells (Elapsed on the State cell's second line), the right content in each
    chk(rows().length === 5, 'N live sessions in -> N table rows', rows().length);
    chk(rows().every(r => r.children.length === 8 && r.getAttribute('role') === 'row'), 'every row has eight cells and role=row');
    const head = d.getElementById('livehead');
    const heads = [...head.querySelectorAll('[role=columnheader]')];
    chk(heads.length === 9 && !head.hidden, 'sticky header has nine sortable column headers', heads.length);
    chk(head.children.length === 8 && head.querySelector('.lvhgrp [data-sort=state]') && head.querySelector('.lvhgrp [data-sort=elapsed]'), 'header has eight grid tracks; Elapsed sits under State in the same track', head.children.length);
    chk(heads.map(h => h.dataset.sort).join() === 'kind,session,model,state,elapsed,tokens,cost,activity,load', 'header columns in spec order');
    chk(heads.every(h => h.getAttribute('aria-sort') === 'none' && h.tabIndex === 0), 'headers start unsorted and are focusable');
    const byId = id => rows().find(r => key(r) === id);
    const c1 = byId('c-1'), cx = byId('x-1'), cidle = byId('c-2'), pi = byId('pi-1'), hm = byId('h');
    chk(c1 && cell(c1, 1).textContent.includes('alpha') && cell(c1, 2).textContent.includes('opus-4-5'), 'claude row: session + model cells');
    const elTxt = r => { const e = r && r.querySelector('.lvc-state .lvel'); return e ? e.textContent.trim() : null; };
    const pill = r => r.querySelector('.lvst').textContent.trim();
    chk(c1 && pill(c1) === 'Running' && cx && pill(cx) === 'Waiting'
      && cidle && pill(cidle) === 'Idle', 'state pill reads Running / Waiting / Idle');
    chk(c1 && cell(c1, 3).querySelector('.lvst[data-state=running]') && cx.querySelector('.lvst[data-state=waiting]')
      && cidle.querySelector('.lvst[data-state=idle]'), 'state pills carry data-state for the semantic colours');
    chk(c1 && cell(c1, 4).textContent.trim() === '150' && cell(c1, 5).textContent.trim() === '$1.50', 'claude row: tokens and cost cells', cell(c1, 4).textContent + '|' + cell(c1, 5).textContent);
    chk(pi && elTxt(pi) === ago(600) && cell(pi, 4).textContent.trim() === '5.0K' && cell(pi, 5).textContent.trim() === '$0.0123',
      'pi row: elapsed (State cell line two), tokens, cost cells', [3, 4, 5].map(i => cell(pi, i).textContent.trim()).join('|'));
    chk(c1 && cell(c1, 3).querySelector('.lvst') && elTxt(c1) === ago(2400) && elTxt(hm) === '—', 'Elapsed shows on the second line of the State cell (muted .lvel); an em dash when unknown');
    chk(cx && cell(cx, 4).textContent.trim() === '—' && cell(cx, 5).textContent.trim() === '—', 'missing tokens/cost render as an em dash');
    chk(hm && cell(hm, 6).textContent.includes('editing') && cell(hm, 6).textContent.includes('20s ago') && hm.querySelectorAll('.lvtool').length === 2,
      'hermes row: last-activity cell has idle time, phase and tool chips', cell(hm, 6).textContent);
    chk(hm && cell(hm, 4).textContent.trim() === '1.0K', 'hermes row: tokens from its model breakdown', cell(hm, 4).textContent);
    chk(hm && cell(hm, 7).querySelector('[role=meter]') && /%/.test(cell(hm, 7).textContent), 'hermes row: load cell keeps the gauge and a visible percent');
    chk(!/NaN|undefined|null/.test(d.getElementById('livelist').textContent), 'no NaN/undefined/null anywhere in the table');
    const num = [...rows()[0].querySelectorAll('.lvnum')];
    chk(num.length === 2 && num.every(c => w.getComputedStyle(c).textAlign === 'right'), 'number cells are right-aligned', num.length);
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
      && pill(rows()[0]) === 'Running' && pill(rows()[4]) === 'Idle', 'sorting another column moves the sort; Running before Idle', order());
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
    // fit: no forced min-width on the table at desktop widths; only below 1024px the rows share one min-width and scroll together
    const bare = html.replace(/@media\(max-width:1023px\)\{[^@]*?\}\}/g, '');
    const mwAll = [...bare.matchAll(/(?:^|\})\s*(\.lvhead,\.lvrow|\.lvrow \+ \.lmpanel)\{(?:[^}]*?[;\s])?min-width:(\d+)px/gm)].map(m => m[1] + '=' + m[2]);
    chk(mwAll.length === 0, 'no min-width on the table rows/header/panel at >= 1024px (no sideways scroll at 1280/1440)', mwAll.join());
    const mob = /@media\(max-width:1023px\)\{\.lvhead,\.lvrow\{min-width:(\d+)px\}/.exec(html);
    chk(mob && +mob[1] >= 600 && +mob[1] <= 900, 'below 1024px the rows and header share one min-width (<= 900px) so they scroll together inside the panel', mob && mob[1]);
    const anyMin = [...html.matchAll(/\.lv(?:head|row|scroll|c|h)[^{}]*\{(?:[^}]*?[;\s])?min-width:(\d+)px/gm)].map(m => +m[1]);
    chk(anyMin.every(n => n <= 900), 'no .lv* rule sets a min-width above 900px', anyMin.join());
    chk(/\.lvhead\{position:sticky;top:0/.test(html), 'the header is sticky');
    const r0s = w.getComputedStyle(rows()[0]);
    chk(parseFloat(r0s.minHeight) >= 48, 'row min-height is >= 48px', r0s.minHeight);
    chk(parseFloat(r0s.maxHeight) <= 64 && parseFloat(r0s.maxHeight) >= parseFloat(r0s.minHeight), 'row height stays capped (<= 64px) so rows are uniform', r0s.maxHeight);
    chk(parseFloat(r0s.paddingTop) >= 8 && parseFloat(r0s.paddingBottom) >= 8 && parseFloat(r0s.paddingLeft) >= 10 && parseFloat(r0s.paddingRight) >= 10,
      'cell padding >= 8px vertical, >= 10px horizontal', [r0s.paddingTop, r0s.paddingRight, r0s.paddingLeft].join(' '));
    chk(/\.lvrow\{[^}]*border-bottom:1px solid var\(--border\)/.test(html) && /\.lvrow:hover\{background:/.test(html), 'rows have a clear separator and a hover state');
    const fsOf = (sel) => { const m = new RegExp('(?:^|\\})\\s*' + sel + '\\{[^}]*?font-size:([\\d.]+)px').exec(html); return m ? +m[1] : 0; };
    chk(fsOf('\\.lvc:not\\(\\.metacol\\)') >= 14 && fsOf('\\.lvrow \\.lvmodel') >= 14, 'body text (cells, model id) is >= 14px', fsOf('\\.lvc:not\\(\\.metacol\\)') + '/' + fsOf('\\.lvrow \\.lvmodel'));
    chk(fsOf('\\.lvrow \\.lvtitle') >= 14 && fsOf('\\.lvrow \\.lvtitle') <= 15 && /\.lvrow \.lvtitle\{[^}]*font-weight:600/.test(html), 'session title is 14-15px semibold', fsOf('\\.lvrow \\.lvtitle'));
    chk([fsOf('\\.lvphase'), fsOf('\\.lvcatl,\\.lvsub,\\.lvswitch,\\.lvago'), fsOf('\\.lvtool'), fsOf('\\.lvtag')].every(n => n >= 12.5), 'secondary text (phase, time, chips, tags) is >= 12.5px', [fsOf('\\.lvphase'), fsOf('\\.lvtool'), fsOf('\\.lvtag')].join('/'));
    const hdCss = /(?:^|\})\s*\.lvh\{([^}]*)\}/m.exec(html)[1];
    chk(/font-size:(12|12\.5|13)px/.test(hdCss) && /text-transform:uppercase/.test(hdCss) && /color:var\(--muted\)/.test(hdCss), 'header is 12-13px uppercase muted', hdCss.slice(0, 120));
    chk(parseFloat(w.getComputedStyle(head).height) >= 32 || /\.lvhead\{[^}]*height:(3[2-9]|4\d)px/.test(html), 'header row is >= 32px tall');
    chk(/@media\(prefers-reduced-motion:reduce\)\{\.lvrow\{transition:none\}\}/.test(html), 'row hover transition is switched off for prefers-reduced-motion');
    // two-line cells: primary on line one, muted detail on line two
    const sess2 = hm.querySelector('.lvc-sess');
    chk(sess2.querySelector('.lvs1 .lvtitle') && sess2.querySelector('.lvs2 .lntimelinebtn') && sess2.querySelector('.lvs2 .lvtag'), 'hermes session cell: title on line one; Timeline pill and profile tag on line two');
    chk(pi && pi.querySelector('.lvc-sess .lvs1 .lvtitle') && pi.querySelector('.lvc-sess .lvs2 .lvtag'), 'pi session cell: title on line one; agent tag on line two');
    chk([c1, cidle, cx].every(r => r.querySelector('.lvc-sess .lvs1 .lvtitle')), 'claude/codex session cells keep the title on line one');
    chk(cell(c1, 2).querySelector('.lvmodel') && cell(hm, 2).querySelector('.lvmodel') && cell(hm, 2).querySelectorAll('.lvmx').length === 1, 'model cell: id on line one, detail (provider / switch / models used) on line two');
    const aA = hm.querySelector('.lvc-act');
    chk(aA.querySelector('.lva1 .lvago') && aA.querySelector('.lva1 .lvphase') && aA.querySelectorAll('.lva2 > .lvtool').length === 2, 'last activity: time + phase on line one, tool chips on line two');

    // (f) names stay whole: the narrow columns shrink to their content width and
    // Last activity is the one that gives way; the model cell has no small cap
    const rule = sel => { const r = new RegExp('(?:^|\\})\\s*' + sel + '\\{([^}]*)\\}', 'g'); let m, o = ''; while ((m = r.exec(html))) o += m[1] + ';'; return o; };
    const cols = (/--lvcols:([^}]+)\}/.exec(html) || [, ''])[1].trim().split(/\s+(?![^(]*\))/);
    const minPx = t => { const m = /^(?:minmax\()?(\d+)px/.exec(t); return m ? +m[1] : NaN; };
    chk(cols.length === 8, '--lvcols defines eight tracks (Elapsed rides on the State cell)', cols.join(' '));
    chk([0, 3, 4, 5, 7].every(i => /^\d+px$/.test(cols[i])), 'Kind/State/Tokens/Cost/Load are fixed to their content width', cols.join(' '));
    chk(/fr\)$/.test(cols[1]) && /fr\)$/.test(cols[2]) && /fr\)$/.test(cols[6]), 'Session, Model and Last activity are the flexible tracks (they wrap, the table does not widen)', cols.join(' '));
    const minSum = cols.reduce((a, t) => a + minPx(t), 0) + 7 * 8 + 24;
    chk(minSum <= 800, 'the track minimums + gaps + padding fit beside the agents panel at 1280 (<= 800px)', minSum);
    chk(minPx(cols[2]) >= 80 && minPx(cols[1]) >= 88 && minPx(cols[6]) >= 80, 'flexible tracks keep at least 80-88px so wrapped text stays readable', cols[1] + ' ' + cols[2] + ' ' + cols[6]);
    // wrapping instead of truncating: line-clamp 2 on the long cells, full text in title=
    const clamp2 = sel => /-webkit-line-clamp:2/.test(rule(sel)) && /(?:^|;)line-clamp:2/.test(rule(sel)) && /overflow:hidden/.test(rule(sel));
    chk(clamp2('\\.lvrow \\.lvtitle') && clamp2('\\.lvrow \\.lvmodel') && clamp2('\\.lvphase'), 'session title, model id and activity phase wrap to two lines (line-clamp:2) instead of one-line ellipsis');
    chk(/-webkit-line-clamp:2/.test(rule('\\.lvmx \\.lmbtn,\\.lvmx \\.lvswitch,\\.lvmx>div')), 'the model detail line ("N models used") wraps to two lines too');
    chk(!/white-space:nowrap/.test(rule('\\.lvrow \\.lvtitle')) && /white-space:normal/.test(rule('\\.lvphase')) && /white-space:normal/.test(rule('\\.lvrow \\.lvmodel')), 'the clamped cells opt out of the row nowrap so they can wrap');
    chk(c1.querySelector('.lvphase').getAttribute('title') === 'running Bash' && cell(hm, 2).querySelector('.lvmodel').getAttribute('title'), 'a wrapped phase and model keep their full text in title=');
    // Elapsed: shown on the State cell, and still sortable via its own header
    const elHq = () => head.querySelector('[data-sort=elapsed]'), elH = elHq();
    chk(elH && elH.getAttribute('role') === 'columnheader' && elH.tabIndex === 0 && elH.getAttribute('aria-sort') === 'none', 'Elapsed keeps its own focusable, aria-sort header');
    elHq().dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    const elOf = elTxt;
    chk(elHq().getAttribute('aria-sort') === 'ascending' && order() === 'x-1,pi-1,c-1,c-2,h', 'sorting by Elapsed ascending: 5m, 10m, 40m, 2h, then the row with no value', order());
    elHq().dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    chk(elHq().getAttribute('aria-sort') === 'descending' && order() === 'c-2,c-1,pi-1,x-1,h' && elOf(rows()[0]) === ago(7200), 'Elapsed descending puts the longest session (2h) first; no-value row stays last', order());
    elHq().dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    chk(elHq().getAttribute('aria-sort') === 'none' && order() === base, 'third click clears the Elapsed sort');
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

    // (h) no meaningless fragments: chips/tags keep >= 6ch visible or drop out whole
    const chOf = (body, prop) => { const m = new RegExp('(?:^|[;{])' + prop + ':\\s*([\\d.]+)ch').exec(body); return m ? +m[1] : 0; };
    chk(chOf(rule('\\.lva2>\\.lvtool'), 'min-width') >= 6, 'activity tool chip has min-width >= 6ch', rule('\\.lva2>\\.lvtool'));
    chk(/flex:1 1 6ch;min-width:6ch/.test(rule('\\.lva1>\\.lvphase')), 'activity phase has min-width 6ch');
    chk(/flex:none/.test(rule('\\.lvc-act>\\.lvago,\\.lva1>\\.lvago')), 'the relative time never shrinks');
    const hideOn = sel => { const b = rule(sel); return /flex-wrap:wrap/.test(b) && /overflow:hidden/.test(b); };
    chk(hideOn('\\.lva2') && hideOn('\\.lvs2') && /height:20px/.test(rule('\\.lva2')) && /height:20px/.test(rule('\\.lvs2')), 'activity-chip and tag lines wrap in a fixed-height overflow:hidden box so a chip that does not fit drops out whole');
    chk(chOf(rule('\\.lvrow \\.lvs2>\\.lvtag,\\.lvrow \\.lvs2>\\.lvcatl'), 'min-width') >= 6 && chOf(rule('\\.lvrow \\.lvc-sess>\\.lvtag'), 'min-width') >= 6, 'agent tag and Hermes category label keep min-width >= 6ch');
    chk(/max-width:calc\(100% - \d+px\)/.test(rule('\\.lvrow \\.lvc-sess>\\.lvtitle')), 'the session title yields to the agent tag, not the other way round');

    // nothing lost: five tools -> all five stay in the DOM, CSS shows the first three that fit, full list in title; no chip is a clipped fragment
    feed([], [{ session_id: 'pi-9', agent: 'scout', title: 'Many tools', model: 'glm-5', idle_s: 5, uptime_s: 60, switched: true, init_model: 'gpt-5',
      phase: 'reading', tools: ['read_file', 'terminal', 'grep', 'edit', 'web'], in_tok: 10, out_tok: 5 }], []);
    const many = rows()[0], chips = [...many.querySelectorAll('.lva2 > .lvtool')];
    chk(chips.length === 5 && chips.map(c => c.textContent).join() === 'read_file,terminal,grep,edit,web', 'tool chips: all five keep their whole name in the DOM', chips.map(c => c.textContent).join('|'));
    chk(many.querySelector('.lva2').title === 'read_file, terminal, grep, edit, web', 'the full tool list stays in title=');
    chk(/\.lva2>\.lvtool:nth-child\(n\+4\)\{display:none\}/.test(html) && chOf(rule('\\.lva2>\\.lvtool'), 'min-width') >= 6, 'at most three chips show (rest hidden whole) and each is at least 6ch wide');
    const mx = cell(many, 2).querySelector('.lvmx'), mm = cell(many, 2).querySelector('.lvmodel');
    chk(!!mx && !!mm && /↯ from gpt-5/.test(mx.textContent) && mm.textContent === 'glm-5', 'switched model: id on line one, "↯ from X" on line two');

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
