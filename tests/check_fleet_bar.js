// Fleet bar (replaces .tabframe/.tabseg): kind filter counts + empty-dim,
// chip states, Manage <dialog> open/close + the F shortcut, the --kind-* token
// single source of truth, tile field order, and the 600px rules.
// Loads the BUILT dashboard from examples/reports/dashboard.html. jsdom does
// not evaluate @media or layout, so the 600px behaviour is asserted on the
// shipped CSS text (no Playwright in this repo: node_modules has none and the
// Python env has no playwright module); real-browser screenshots are taken
// separately with headless Chrome.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const WEB = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web');
const html = fs.readFileSync(
  path.join(__dirname, '..', 'examples', 'reports', 'dashboard.html'), 'utf8');
const tokens = fs.readFileSync(path.join(WEB, 'css', 'tokens.css'), 'utf8');
const css = fs.readFileSync(path.join(WEB, 'css', 'dashboard.css'), 'utf8');
const liveSrc = fs.readFileSync(path.join(WEB, 'js', 'live.js'), 'utf8');

let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
}

function bootDOM() {
  const backing = new Map();
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://127.0.0.1:8477/dashboard.html',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => null;
      // jsdom's <dialog> lacks showModal/close; the page relies on them (no fallback shipped).
      const DP = w.HTMLDialogElement.prototype;
      if (!DP.showModal) DP.showModal = function () { this.setAttribute('open', ''); };
      if (!DP.close) DP.close = function () { if (this.hasAttribute('open')) { this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); } };
      function Stub(ctx, cfg) {
        this.config = cfg; this.data = (cfg && cfg.data) || {}; this.destroy = () => {};
        this.update = () => {}; this.options = (cfg && cfg.options) || {};
        this.scales = {}; this._metasets = []; this.chartArea = {left:0,top:0,right:0,bottom:0};
        this.width = 300; this.height = 150; this.aspectRatio = 2; this.attached = false;
        this.getDatasetMeta = () => ({ data: [], controller: null });
      }
      Stub.register = () => {}; Stub.overrides = {}; Stub.instances = {};
      Stub.getChart = () => null; Stub.registerables = []; Stub.version = 'stub';
      Stub.controllers = {}; Stub.elements = {}; Stub.plugins = {}; Stub.scales = {};
      Stub.defaults = { font: { size: 10, family: '', weight: '' }, color: '' };
      w.Chart = Stub; w.getChart = () => null;
      Object.defineProperty(w, 'localStorage', {
        value: { getItem: k => backing.get(k) ?? null,
                 setItem: (k, v) => backing.set(k, String(v)),
                 removeItem: k => backing.delete(k), clear: () => backing.clear(),
                 key: i => [...backing.keys()][i] ?? null,
                 get length(){ return backing.size; } },
        configurable: true, writable: true });
    },
  });
}


// ---- static: tokens are the single source of truth -----------------------
const KINDS = { hermes: 'hsl(199 60% 56%)', pi: 'hsl(265 55% 64%)', claude: 'hsl(18 70% 60%)', codex: 'hsl(152 50% 52%)' };
for (const [k, v] of Object.entries(KINDS)) {
  chk(tokens.includes(`--kind-${k}:${v}`), `tokens.css declares --kind-${k}: ${v}`);
}
['--fb-surface', '--fb-raise', '--fb-h', '--fb-r'].forEach(t =>
  chk(new RegExp(t + ':').test(tokens), `tokens.css declares ${t}`));
chk(!/hsl\(\s*(265|18|152|199)\b/.test(liveSrc) && !/hsl\(\s*265\b/.test(liveSrc),
    'live.js carries no hsl() literal for a kind colour (PI 265, Claude 18, Codex 152, Hermes 199)');
// the PI row hands var(--kind-pi) to ownerBadge, which tints it with color-mix
const piRow = liveSrc.slice(liveSrc.indexOf('data-piagent'));
const ownerFn = liveSrc.slice(liveSrc.indexOf('export function ownerBadge'), liveSrc.indexOf('export function sidChip'));
chk(/ownerBadge\([^)]*'var\(--kind-pi\)'\)/.test(piRow) && /color-mix/.test(ownerFn) && /kindColor/.test(ownerFn),
    'the PI agent pill uses var(--kind-pi) / color-mix');
chk(/var\(--kind-\$\{kind\}\)/.test(liveSrc), 'live.js reads the kind colour from the token');
chk(!/tabframe|tabseg|tabkind|tabgrouplabel/.test(css + html.replace(/\/\/.*$/gm, '')),
    'old .tabframe/.tabseg/.tabkind/.tabgrouplabel are gone from CSS and the built page');
// ---- static: 600px rules --------------------------------------------------
const m960 = css.match(/@media \(max-width:960px\)\{([\s\S]*?)\n\}/);
const m600 = css.match(/@media \(max-width:600px\)\{([\s\S]*?)\n\}/);
chk(!!m960, 'a max-width:960px block collapses the fleet bar before it can overflow the page');
chk(!!m600, 'a max-width:600px block exists for the fleet bar');
if (m960) {
  chk(/\.kseg \.l\{display:none\}/.test(m960[1]), '<=960px: kind filters are icon-only (label hidden)');
  chk(/\.fb-count\{[^}]*clip:rect/.test(m960[1]) && !/\.fb-count\{display:none/.test(m960[1]), '<=960px: the count is visually hidden, not display:none (aria-live stays)');
}
if (m600) {
  chk(/\.pchip \.name\{display:none\}/.test(m600[1]), '600px: chips shrink to avatar + glyph (name hidden, kept in aria-label/title)');
  chk(/\.pk-tiles\{grid-template-columns:1fr\}/.test(m600[1]), '600px: tiles are a single column');
}
chk(/\.pchip \.name\{[^}]*text-overflow:ellipsis/.test(css), 'chip name has text-overflow:ellipsis');
chk(/\.fbdlg::backdrop\{[^}]*background/.test(css), 'Manage dialog has a ::backdrop scrim');
chk(/input\.pk-on:indeterminate/.test(css), 'indeterminate checkbox state is styled');
chk(/@container \(max-width:240px\)\{[^}]*\.ft-sub\{[^}]*flex-direction:row/.test(css),
    'tiles under 240px put phase and cost on one line');
chk(/\.ft-cost\{[^}]*tabular-nums/.test(css), 'tile cost uses tabular-nums');
chk(/height:calc\(var\(--fb-h\) \+ 10px\)/.test(css) && /--fb-h:32px/.test(tokens), 'fleet bar is 42px (32 + 10)');

const dom = bootDOM();
setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    const bar = d.getElementById('tabs');
    chk(bar.classList.contains('fleetbar'), '#tabs is the .fleetbar');
    const strip = bar.querySelector('.fb-strip');
    chk(!!strip && strip.getAttribute('role') === 'toolbar', '.fb-strip is a role=toolbar');
    const kb = [...bar.querySelectorAll('.kseg')];
    chk(kb.map(b => b.dataset.fbkind).join() === 'all,hermes,pi,claude,codex', 'kind filter: All, Hermes, PI, Claude, Codex', kb.map(b => b.dataset.fbkind).join());
    chk(kb.every(b => b.hasAttribute('aria-pressed')), 'every kind button has aria-pressed');
    chk(kb.find(b => b.dataset.fbkind === 'all').getAttribute('aria-pressed') === 'true', 'All is pressed by default');

    // ---- counts + empty dim -------------------------------------------
    w.eval(`DATA.pi_live = [{session_id:'p1', model:'m', phase:'bash', idle_s:1}];
            DATA.agent_live = [
              {engine:'claude', session_id:'c1', model:'anthropic/claude-opus-5', phase:'tool', idle_s:2},
              {engine:'claude', session_id:'c1', model:'anthropic/claude-opus-5', phase:'tool', idle_s:9},
              {engine:'claude', session_id:'c2', model:'x', phase:'idle', idle_s:3}];
            tabs();`);
    const count = k => d.querySelector(`.kseg[data-fbkind="${k}"] .n`).textContent;
    const kbtn = k => d.querySelector(`.kseg[data-fbkind="${k}"]`);
    chk(count('pi') === '1', 'PI count = pi_live length', count('pi'));
    chk(count('claude') === '2', 'Claude count de-duplicates by session id', count('claude'));
    chk(count('codex') === '0', 'Codex count is 0 with no sessions', count('codex'));
    chk(kbtn('codex').dataset.empty === '1', 'a kind with no sessions is dimmed (data-empty=1)');
    chk(!!kbtn('codex') && d.querySelectorAll('.kseg').length === 5, 'the empty kind is still rendered, never removed');
    chk(kbtn('claude').dataset.empty === '0' && kbtn('pi').dataset.empty === '0', 'kinds with sessions are not dimmed');
    chk(Number(count('all')) === ['hermes', 'pi', 'claude', 'codex'].reduce((a, k) => a + Number(count(k)), 0), 'All = sum of the kinds', count('all'));

    // ---- filter press narrows the TILES only ----------------------------
    const onBefore = w.eval('pvOnProfiles().length');
    const chipsBefore = d.querySelectorAll('.pchip').length;
    kbtn('claude').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    chk(kbtn('claude').getAttribute('aria-pressed') === 'true' && kbtn('all').getAttribute('aria-pressed') === 'false', 'pressing Claude flips aria-pressed');
    chk(d.querySelectorAll('.pchip').length === chipsBefore && chipsBefore > 0, 'PI/Claude/Codex filters hide no profile chips', `${d.querySelectorAll('.pchip').length} vs ${chipsBefore}`);
    chk(w.eval('pvOnProfiles().length') === onBefore, 'filtering does not change which profiles are on');
    chk(d.querySelectorAll('#livetiles .ftile').length === 2 && [...d.querySelectorAll('#livetiles .ftile')].every(t => t.dataset.kind === 'claude'),
        'Live tiles follow the kind filter', String(d.querySelectorAll('#livetiles .ftile').length));
    d.querySelector('.kseg[data-fbkind="all"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    chk(d.querySelectorAll('#livetiles .ftile').length === Number(count('all')), 'All shows every kind tile (= the All badge)', `${d.querySelectorAll('#livetiles .ftile').length} vs ${count('all')}`);
    for (const k of ['hermes', 'pi', 'claude', 'codex']) {
      kbtn(k).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      chk(d.querySelectorAll('#livetiles .ftile').length === Number(count(k)), `kind ${k}: tile count = its badge`, `${d.querySelectorAll('#livetiles .ftile').length} vs ${count(k)}`);
    }
    kbtn('all').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

    // ---- hidden profiles are not counted ------------------------------
    const allNames = w.eval('Object.keys(PV_ALL)');
    const [h0, h1] = allNames;
    w.eval(`DATA.pi_live = []; DATA.agent_live = [];
      PV_ALL[${JSON.stringify(h0)}].live = [{id:'ha', title:'a', model:'m', category:'coding', phase:'Reading a file', idle_s:5}];
      PV_ALL[${JSON.stringify(h1)}].live = [{id:'hb', title:'b', model:'m', category:'coding', phase:'x', idle_s:5}];
      DATA.profiles = pvFilter(); tabs(); renderLive();`);
    chk(count('hermes') === '2' && count('all') === '2', 'both profiles on: Hermes 2, All 2', count('hermes') + '/' + count('all'));
    w.eval(`pvToggle(${JSON.stringify(h1)})`);
    chk(count('hermes') === '1' && count('all') === '1', 'a hidden profile is not counted (Hermes 1, All 1)', count('hermes') + '/' + count('all'));
    chk(d.querySelectorAll('#livetiles .ftile').length === 1, 'tiles agree with the count after hiding a profile');
    w.eval(`pvToggle(${JSON.stringify(h1)})`);
    chk(count('hermes') === '2' && d.querySelectorAll('#livetiles .ftile').length === 2, 'profile back on: count and tiles back to 2');

    // ---- Hermes tiles: category chip, idle threshold, cost omitted ----
    const hl = d.querySelector('#livetiles .ftile[data-kind="hermes"]');
    chk(hl.querySelector('.ft-phase').textContent === 'coding', 'Hermes phase chip is the short category token', hl.querySelector('.ft-phase').textContent);
    chk(!/Reading/.test(hl.textContent) && /Reading a file/.test(hl.querySelector('.ft-phase').getAttribute('title')), 'last_activity_description is only a tooltip, never chip text');
    chk(hl.dataset.state === 'run' && /Running/.test(hl.querySelector('.ft-st').textContent), 'Hermes session quiet for 5s is Running');
    chk(!hl.querySelector('.ft-cost'), 'no cost_usd: the cost cell is omitted entirely (no dash)');
    chk(w.eval(`fleetTileHtml('hermes', {id:'q', model:'m', category:'coding', phase:'p', idle_s:121})`).includes('data-state="idle"'), 'Hermes idle_s > 120 reads Idle');
    chk(w.eval(`fleetTileHtml('hermes', {id:'q', model:'m', category:'coding', phase:'p', idle_s:120})`).includes('data-state="run"'), 'Hermes idle_s = 120 is still Running');
    const longTip = w.eval(`fleetTileHtml('hermes', {id:'q', model:'m', category:'c', phase:'<b>"${'z'.repeat(200)}', idle_s:1})`);
    chk(!/z{81}/.test(longTip) && !longTip.includes('<b>') && longTip.includes('&lt;b&gt;'), 'tooltip is truncated to 80 chars and escaped');
    chk(w.eval(`fleetTileHtml('hermes', {id:'q', model:'m', category:'c', cost_usd:0.5, idle_s:1})`).includes('ft-cost">$0.500'), 'finite cost_usd renders the cost cell');
    chk(!w.eval(`fleetTileHtml('pi', {model:'m', phase:'bash', cost_usd:NaN})`).includes('ft-cost'), 'non-finite cost_usd omits the cell');

    // ---- Claude/Codex rows, order + escaping ---------------------------
    w.eval(`DATA.agent_live = [{engine:'codex', session_id:'x1', model:'openai/<img src=x onerror=1>', phase:'idle', idle_s:1, cost_usd:0.1234},
                               {engine:'claude', session_id:'c9', model:'anthropic/claude-opus-5', phase:'tool', idle_s:1}]; tabs(); renderLive();`);
    chk(count('codex') === '1' && count('claude') === '1', 'Claude and Codex rows from the fixture are counted');
    const tile = d.querySelector('#livetiles .ftile[data-kind="codex"]');
    chk(!!tile, 'codex tile rendered');
    const order = [...tile.children].map(c => c.className.split(' ')[0]);
    chk(order.join() === 'ft-status,ft-model,ft-sub', 'tile order: status, model, (phase, cost)', order.join());
    chk([...tile.querySelector('.ft-sub').children].map(c => c.className).join() === 'ft-phase,ft-cost', 'phase chip precedes cost');
    chk(tile.querySelector('.ft-model').getAttribute('title').includes('<img'), 'model tooltip carries the (escaped) model string');
    chk(!tile.querySelector('img'), 'a hostile model string is escaped, not parsed as markup');
    chk(tile.querySelector('.ft-cost').textContent === '$0.123', 'cost formatted', tile.querySelector('.ft-cost').textContent);
    chk(tile.dataset.state === 'idle' && /Idle/.test(tile.querySelector('.ft-st').textContent), 'idle phase reads as Idle');
    chk(!d.querySelector('#livetiles .ftile[data-kind="claude"] .ft-cost'), 'a claude tile without cost_usd has no cost cell');

    // ---- chip states --------------------------------------------------
    const chips = () => [...d.querySelectorAll('#tabs .pchip')];
    const names = chips().map(c => c.dataset.tab);
    chk(chips().every(c => c.tagName === 'BUTTON' && c.hasAttribute('aria-pressed')), 'chips are <button aria-pressed>');
    chk(chips().every(c => c.querySelector('.name .pfx') !== null && c.getAttribute('aria-label') === c.dataset.tab + (c.querySelector('.live') ? ', live' : '')), 'chips carry a prefix span and the full name (+ ", live") as aria-label');
    chk(chips().every(c => (c.dataset.kind === 'bot') === !!c.querySelector('.kd')), 'only server-kind bot chips carry a glyph');
    chk(chips().every(c => !/^(pi|claude|codex)$/.test(c.dataset.kind)), 'no chip is classified from its name (no pi/claude/codex kind)');
    const n0 = names[0];
    const live0 = () => !!d.querySelector(`.pchip[data-tab="${n0}"] .live`);
    chk(live0() === ((w.eval(`PV_ALL[${JSON.stringify(n0)}].live`) || []).length > 0), 'live dot appears iff the profile has a live session');
    w.eval(`PV_ALL[${JSON.stringify(n0)}].live = [{id:'zz', title:'t'}]; tabs();`);
    chk(live0(), 'live dot shown when the profile has a live session');
    w.eval(`PV_ALL[${JSON.stringify(n0)}].live = []; tabs();`);
    chk(!live0(), 'live dot removed when it stops');
    w.eval(`pvToggle(${JSON.stringify(n0)})`);
    const c0 = d.querySelector(`.pchip[data-tab="${n0}"]`);
    chk(c0.dataset.off === '1' && c0.getAttribute('aria-pressed') === 'false', 'off chip: data-off=1 and aria-pressed=false');
    w.eval(`pvToggle(${JSON.stringify(n0)})`);
    chk(d.querySelector(`.pchip[data-tab="${n0}"]`).dataset.off === '0', 'chip back on');
    chk(/\.pchip\[data-off="1"\]/.test(css) && /\.pchip\[aria-current="true"\]/.test(css) && /\.pchip:focus-visible/.test(css), 'CSS styles off, current and focus-visible states');
    chk(/\.pchip \.live\{/.test(css), 'live dot has a style rule');

    // ---- Manage dialog + F shortcut -----------------------------------
    const dlg = d.getElementById('fbdialog');
    chk(!!dlg && dlg.tagName === 'DIALOG', 'Manage picker is a native <dialog>');
    const more = d.querySelector('.fb-more');
    chk(more.getAttribute('aria-haspopup') === 'dialog' && more.getAttribute('aria-expanded') === 'false', 'Manage button: aria-haspopup=dialog, collapsed');
    more.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    chk(dlg.open, 'clicking Manage opens the dialog');
    chk(d.querySelector('.fb-more').getAttribute('aria-expanded') === 'true', 'aria-expanded=true while open');
    chk(dlg.querySelectorAll('[data-pkon]').length === names.length, 'dialog lists one on/off checkbox per profile', String(dlg.querySelectorAll('[data-pkon]').length));
    chk(dlg.querySelector('[data-pkhue]') && dlg.querySelector('[data-pklogo]'), 'dialog offers colour and logo per profile');
    chk(!!dlg.querySelector('[data-pkgrp]'), 'dialog has group checkboxes');
    w.eval('fbDialogToggle(false)');
    const press = (key, target, extra) => (target || d.body).dispatchEvent(new w.KeyboardEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, extra || {})));
    const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    const focusedIsManage = () => d.activeElement === d.querySelector('.fb-more');
    // jsdom's <dialog> has no Esc handling: emulate the browser (cancel -> close).
    const esc = () => { dlg.dispatchEvent(new w.Event('cancel', { cancelable: true })); w.eval('fbDialogToggle(false)'); };

    // close paths: × / Esc / backdrop each return focus to Manage
    for (const [label, closer] of [
      ['× button', () => click(dlg.querySelector('[data-pkclose]'))],
      ['Esc', esc],
      ['backdrop click', () => click(dlg)],
      ['F', () => press('f')],
    ]) {
      d.querySelector('.fb-kinds .kseg').focus();
      click(d.querySelector('.fb-more'));
      chk(dlg.open, `${label}: dialog opened`);
      dlg.querySelector(label === 'F' ? '[data-pkall="1"]' : '.pk-q').focus();
      closer();
      chk(!dlg.open, `${label} closes the dialog`);
      chk(focusedIsManage(), `${label}: focus returns to the Manage button`, d.activeElement && d.activeElement.outerHTML.slice(0, 60));
      chk(d.querySelector('.fb-more').getAttribute('aria-expanded') === 'false', `${label}: aria-expanded back to false`);
    }
    press('f');
    chk(dlg.open, 'F opens the dialog');
    press('F');
    chk(!dlg.open, 'F toggles it closed again');
    press('f', d.body, { repeat: true });
    chk(!dlg.open, 'a held F (e.repeat) is ignored');
    const q = (press('f', d.body), dlg.querySelector('.pk-q'));
    press('f', q);
    chk(dlg.open, 'F typed into the filter box does not close the dialog');
    w.eval('fbDialogToggle(false)');
    press('f', d.body, { ctrlKey: true });
    chk(!dlg.open, 'Ctrl+F is left to the browser');
    const sf = d.getElementById('sfmodal'); sf.setAttribute('aria-hidden', 'false');
    press('f');
    chk(!dlg.open, 'F does nothing while another dialog/overlay is open');
    sf.setAttribute('aria-hidden', 'true');

    // ---- focus restored after a re-render -------------------------------
    const c1 = () => d.querySelector(`.pchip[data-key="${n0}"]`);
    c1().focus();
    click(c1());
    chk(d.activeElement === c1() && c1().isConnected, 'focus returns to the same chip after a toggle re-renders the bar', d.activeElement && d.activeElement.className);
    click(c1());
    kbtn('pi').focus(); click(kbtn('pi'));
    chk(d.activeElement === kbtn('pi'), 'focus returns to the kind button after the filter re-renders');
    kbtn('all').focus(); click(kbtn('all'));

    // ---- roving tabindex + arrow keys -----------------------------------
    const stops = box => [...d.querySelectorAll(box + ' button')].filter(b => b.tabIndex === 0);
    chk(stops('.fb-strip').length === 1, 'chip strip is exactly one Tab stop', String(stops('.fb-strip').length));
    chk(stops('.fb-kinds').length === 1, 'kind filter is exactly one Tab stop', String(stops('.fb-kinds').length));
    const all = [...d.querySelectorAll('.fb-strip .pchip')];
    all[0].focus();
    press('ArrowRight', all[0]);
    chk(d.activeElement === d.querySelectorAll('.fb-strip .pchip')[1], 'ArrowRight moves to the next chip');
    chk(d.activeElement.tabIndex === 0 && stops('.fb-strip').length === 1, 'the Tab stop travels with focus');
    press('ArrowLeft', d.activeElement);
    chk(d.activeElement === d.querySelectorAll('.fb-strip .pchip')[0], 'ArrowLeft moves back');
    press('End', d.activeElement);
    chk(d.activeElement === [...d.querySelectorAll('.fb-strip .pchip')].pop(), 'End goes to the last chip');
    press('Home', d.activeElement);
    chk(d.activeElement === d.querySelectorAll('.fb-strip .pchip')[0], 'Home goes to the first chip');
    press('ArrowLeft', d.activeElement);
    chk(d.activeElement === [...d.querySelectorAll('.fb-strip .pchip')].pop(), 'ArrowLeft wraps from first to last');
    const ks = [...d.querySelectorAll('.fb-kinds .kseg')];
    ks[0].focus(); press('ArrowRight', ks[0]);
    chk(d.activeElement === d.querySelectorAll('.fb-kinds .kseg')[1], 'ArrowRight works on the kind filter too');
    chk([...d.querySelectorAll('.kseg')].every(b => /^.+, \d+ live$/.test(b.getAttribute('aria-label'))), 'kind buttons carry an accessible name "<label>, <n> live"');

    // ---- focus: poll-driven tabs() never steals it; a removed chip falls back to the strip
    const outside = d.createElement('input'); d.body.appendChild(outside); outside.focus();
    w.eval('tabs()');
    chk(d.activeElement === outside, 'a poll-driven tabs() leaves focus in an outside <input>');
    outside.remove();
    const lastChip = chips()[chips().length - 1];
    lastChip.focus();
    w.eval(`delete PV_ALL[${JSON.stringify(lastChip.dataset.tab)}]; tabs();`);
    chk(d.activeElement && d.activeElement.closest('.fb-strip') && d.activeElement.getAttribute('tabindex') === '0', 'focused chip removed by a re-render: focus lands on the strip tabindex=0 item, not <body>');
    w.eval(`PV_ALL[${JSON.stringify(lastChip.dataset.tab)}] = JSON.parse(JSON.stringify(PV_ALL[${JSON.stringify(n0)}])); tabs();`);

    // ---- hostile profile name: chip + dialog ----------------------------
    const bad = `x"><img src=x onerror="window.__pwn=1"> 'q'`;
    w.eval(`PV_ALL[${JSON.stringify(bad)}] = JSON.parse(JSON.stringify(PV_ALL[${JSON.stringify(n0)}])); tabs();`);
    const hc = [...d.querySelectorAll('.pchip')].find(c => c.dataset.tab === bad);
    chk(!!hc && !d.querySelector('#tabs img[src="x"]'), 'hostile name: chip exists and no <img> was injected');
    chk(hc.getAttribute('aria-label').startsWith(bad) && hc.querySelector('.name').textContent.includes('<img'), 'hostile name is shown as text and round-trips through the attribute');
    w.eval('fbDialogToggle(true)');
    chk(!dlg.querySelector('img[src="x"]') && !!dlg.querySelector('.nm') && [...dlg.querySelectorAll('.nm')].some(e => e.textContent === bad), 'hostile name in the dialog is text, not markup');
    chk(w.__pwn === undefined, 'no handler from the hostile name executed');
    w.eval('fbDialogToggle(false)');
    w.eval(`delete PV_ALL[${JSON.stringify(bad)}]; tabs();`);

    // ---- Manage dialog: grouped by the server kind (bot | profile) ------
    w.eval(`PV_ALL[${JSON.stringify(h0)}].kind = 'bot'; PV_ALL[${JSON.stringify(h1)}].kind = 'profile'; fbDialogToggle(true)`);
    const grp = k => dlg.querySelector(`[data-pkgrp="${k}"]`);
    chk(!!grp('bot') && !!grp('profile'), 'dialog groups rows by bot vs profile');
    chk(!!dlg.querySelector(`[data-pkgroup="bot"] [data-pkon="${h0}"]`) && !!dlg.querySelector(`[data-pkgroup="profile"] [data-pkon="${h1}"]`), 'rows land in the group of their server kind');
    const offBefore = w.eval('pvOnProfiles().length');
    grp('bot').checked = false; grp('bot').dispatchEvent(new w.Event('change', { bubbles: true }));
    chk(w.eval(`pvOff(${JSON.stringify(h0)})`) === true, 'group checkbox switches every bot off in one click');
    chk(d.activeElement === dlg.querySelector('[data-pkgrp="bot"]'), 'focus stays on the group checkbox after the dialog re-renders');
    // regression: Chrome throws on setSelectionRange for checkboxes/buttons
    let ssr = 0;
    const cb = dlg.querySelector('[data-pkgrp="bot"]') || dlg.querySelector('[data-pkon]');
    const ssrOrig = w.HTMLInputElement.prototype.setSelectionRange;
    w.HTMLInputElement.prototype.setSelectionRange = function () { if (this.type !== 'search' && this.type !== 'text') ssr++; throw new w.Error('InvalidStateError'); };
    let thrown = null;
    try { cb.checked = !cb.checked; cb.dispatchEvent(new w.Event('change', { bubbles: true })); } catch (e) { thrown = e; }
    chk(ssr === 0 && !thrown, 'toggling a checkbox never calls setSelectionRange on it', thrown && thrown.message);
    w.HTMLInputElement.prototype.setSelectionRange = ssrOrig;
    // group checkbox acts on the search-filtered rows only
    w.eval(`pvSet(${JSON.stringify(h0)}, true); pvSet(${JSON.stringify(h1)}, true); DATA.profiles = pvFilter(); pvSyncCurrent(); tabs()`);
    w.eval('fbDialogToggle(false)');
    w.eval(`PV_ALL[${JSON.stringify(h0)}].kind = 'profile'; PV_ALL[${JSON.stringify(h1)}].kind = 'profile'; fbDialogToggle(true)`);
    const qi = dlg.querySelector('.pk-q'); qi.value = h0; w.eval("fbDialogRender('.pk-q')");
    const pg = dlg.querySelector('[data-pkgrp="profile"]');
    pg.checked = true; pg.dispatchEvent(new w.Event('change', { bubbles: true }));
    chk(w.eval(`pvOff(${JSON.stringify(h0)})`) === false && w.eval(`pvOff(${JSON.stringify(h1)})`) === true, 'group checkbox only switches the search-filtered rows');
    dlg.querySelector('.pk-q').value = '';
    w.eval('fbDialogToggle(false)');
    w.eval(`PV_ALL[${JSON.stringify(h0)}].kind = 'profile'; fbDialogToggle(true)`);
    const g = dlg.querySelector('[data-pkgrp="profile"]');
    chk(g && g.indeterminate === true && g.dataset.pkstate === 'some', 'group checkbox is indeterminate when some are off');
    w.eval('fbDialogToggle(false)');
    w.eval(`pvSet(${JSON.stringify(h0)}, false); DATA.profiles = pvFilter(); pvSyncCurrent(); tabs();`);

    // keyboard-reachable logo upload
    w.eval('fbDialogToggle(true)');
    const file = dlg.querySelector('[data-pklogo]');
    chk(file && !file.hidden && !file.hasAttribute('hidden') && file.type === 'file', 'logo file input is not [hidden], so it can take focus');
    chk(/\.pk-file\{[^}]*opacity:0/.test(css) && !/\.pk-file\{[^}]*display:none/.test(css), 'logo input is visually hidden, not display:none');
    w.eval('fbDialogToggle(false)');
  } catch (e) {
    chk(false, 'checks crashed', e.stack.split('\n').slice(0, 3).join(' | '));
  }
  console.log(`\ncheck_fleet_bar.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
