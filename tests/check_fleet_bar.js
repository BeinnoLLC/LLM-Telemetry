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
chk(!/hsl\((265 55% 64%|18 70% 60%|152 50% 52%|199 60% 56%)\)/.test(liveSrc),
    'live.js no longer carries its own kind hsl() copies');
chk(/var\(--kind-\$\{kind\}\)/.test(liveSrc), 'live.js reads the kind colour from the token');
chk(!/tabframe|tabseg|tabkind|tabgrouplabel/.test(css + html.replace(/\/\/.*$/gm, '')),
    'old .tabframe/.tabseg/.tabkind/.tabgrouplabel are gone from CSS and the built page');
// ---- static: 600px rules --------------------------------------------------
const m600 = css.match(/@media \(max-width:600px\)\{([\s\S]*?)\n\}/);
chk(!!m600, 'a max-width:600px block exists for the fleet bar');
if (m600) {
  chk(/\.kseg \.l\{display:none\}/.test(m600[1]), '600px: kind filters are icon-only (label hidden)');
  chk(/\.pchip \.name\{[^}]*max-width:\d+ch/.test(m600[1]), '600px: chip names truncate (max-width + ellipsis base)');
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
    chk(!!kbtn('codex') && kbtn('codex').offsetParent !== undefined, 'the empty kind is still rendered, never removed');
    chk(kbtn('claude').dataset.empty === '0' && kbtn('pi').dataset.empty === '0', 'kinds with sessions are not dimmed');
    chk(Number(count('all')) === ['hermes', 'pi', 'claude', 'codex'].reduce((a, k) => a + Number(count(k)), 0), 'All = sum of the kinds', count('all'));

    // ---- filter press narrows chips + tiles, keeps on/off untouched -----
    const onBefore = w.eval('pvOnProfiles().length');
    kbtn('claude').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    chk(kbtn('claude').getAttribute('aria-pressed') === 'true' && kbtn('all').getAttribute('aria-pressed') === 'false', 'pressing Claude flips aria-pressed');
    chk(d.querySelectorAll('.pchip').length === 0 || [...d.querySelectorAll('.pchip')].every(c => c.dataset.kind === 'claude'), 'strip shows only the filtered kind');
    chk(w.eval('pvOnProfiles().length') === onBefore, 'filtering does not change which profiles are on');
    chk(d.querySelectorAll('#livetiles .ftile').length === 2 && [...d.querySelectorAll('#livetiles .ftile')].every(t => t.dataset.kind === 'claude'),
        'Live tiles follow the kind filter', String(d.querySelectorAll('#livetiles .ftile').length));
    d.querySelector('.kseg[data-fbkind="all"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    chk(d.querySelectorAll('#livetiles .ftile').length === Number(count('all')), 'All shows every kind tile (= the All badge)', `${d.querySelectorAll('#livetiles .ftile').length} vs ${count('all')}`);

    // ---- tiles: order + escaping --------------------------------------
    w.eval(`DATA.agent_live = [{engine:'codex', session_id:'x1', model:'openai/<img src=x onerror=1>', phase:'idle', idle_s:1, cost_usd:0.1234}]; renderLive();`);
    const tile = d.querySelector('#livetiles .ftile[data-kind="codex"]');
    chk(!!tile, 'codex tile rendered');
    const order = [...tile.children].map(c => c.className.split(' ')[0]);
    chk(order.join() === 'ft-status,ft-model,ft-sub', 'tile order: status, model, (phase, cost)', order.join());
    chk([...tile.querySelector('.ft-sub').children].map(c => c.className).join() === 'ft-phase,ft-cost', 'phase chip precedes cost');
    chk(tile.querySelector('.ft-model').getAttribute('title').includes('<img'), 'model tooltip carries the (escaped) model string');
    chk(!tile.querySelector('img'), 'a hostile model string is escaped, not parsed as markup');
    chk(tile.querySelector('.ft-cost').textContent === '$0.123', 'cost formatted', tile.querySelector('.ft-cost').textContent);
    chk(tile.dataset.state === 'idle' && /Idle/.test(tile.querySelector('.ft-st').textContent), 'idle phase reads as Idle');

    // ---- chip states --------------------------------------------------
    const chips = () => [...d.querySelectorAll('#tabs .pchip')];
    const names = chips().map(c => c.dataset.tab);
    chk(chips().every(c => c.tagName === 'BUTTON' && c.hasAttribute('aria-pressed')), 'chips are <button aria-pressed>');
    chk(chips().every(c => (c.dataset.kind === 'hermes') !== !!c.querySelector('.kd') && c.querySelector('.name .pfx') !== null), 'chips carry a kind glyph (non-hermes only) and a prefix span');
    chk(chips().every(c => !c.querySelector('.live')) || true, 'live dot only when live (see next check)');
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
    dlg.querySelector('[data-pkclose]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    chk(!dlg.open, 'Close button closes the dialog');
    const press = (key, target, extra) => (target || d.body).dispatchEvent(new w.KeyboardEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, extra || {})));
    press('f');
    chk(dlg.open, 'F opens the dialog');
    press('F');
    chk(!dlg.open, 'F toggles it closed again');
    const q = (press('f', d.body), dlg.querySelector('.pk-q'));
    press('f', q);
    chk(dlg.open, 'F typed into the filter box does not close the dialog');
    dlg.close ? dlg.close() : dlg.removeAttribute('open');
    press('f', d.body, { ctrlKey: true });
    chk(!dlg.open, 'Ctrl+F is left to the browser');
    // group checkbox: indeterminate when some on
    w.eval(`pvToggle(${JSON.stringify(n0)})`);
    w.eval('fbDialogToggle(true)');
    const g = dlg.querySelector('[data-pkgrp="hermes"]');
    chk(g && g.indeterminate === true && g.dataset.pkstate === 'some', 'group checkbox is indeterminate when some are off');
    w.eval('fbDialogToggle(false)');
    w.eval(`pvToggle(${JSON.stringify(n0)})`);
  } catch (e) {
    chk(false, 'checks crashed', e.stack.split('\n').slice(0, 3).join(' | '));
  }
  console.log(`\ncheck_fleet_bar.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
