// #17: logs drawer becomes a mobile bottom sheet — drag handle, scroll
// lock, back-gesture close, and a non-wrapping scrollable filter strip.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'examples', 'reports', 'dashboard.html'), 'utf8');

let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
}

// ---- source-level CSS assertions -----------------------------------------
chk(/@media\(min-width:641px\) and \(max-width:1024px\)\{\s*\n\s*#drawer\{width:60vw\}/.test(html),
    'tablet (641-1024px) drawer widens to 60vw');
const drawerBlockIdx = html.indexOf('@media(max-width:640px){\n   #drawer{top:auto');
const drawerBlockEnd = html.indexOf("\n }\n #draghandle{display:none}", drawerBlockIdx);
const foundDrawerBlock = drawerBlockIdx !== -1 && drawerBlockEnd !== -1;
chk(foundDrawerBlock, 'mobile (<=640px) drawer override block found');
if (foundDrawerBlock) {
  const b = html.slice(drawerBlockIdx, drawerBlockEnd);
  chk(/height:92dvh/.test(b), 'mobile drawer becomes a bottom sheet at ~92dvh');
  chk(/#drawer\{top:auto;right:0;left:0/.test(b), 'mobile drawer is anchored to the bottom edge, not the side');
  chk(/transform:translateY\(100%\)/.test(b) && /#drawer\.open\{transform:translateY\(0\)\}/.test(b),
      'mobile drawer slides up from the bottom (translateY), not in from the side');
  chk(/#draghandle\{display:block/.test(b), 'the drag handle is shown at mobile width');
  chk(/\.dtabs\{flex-wrap:nowrap;overflow-x:auto;scroll-snap-type:x mandatory/.test(b),
      'filter tabs become a horizontally scrollable non-wrapping strip with scroll-snap');
}
chk(/#draghandle\{display:none\}/.test(html), 'the drag handle is hidden by default (desktop never shows it)');
chk(/<div id="draghandle"><\/div>/.test(html), 'the drag handle element exists in markup');

// ---- behavioural checks via jsdom -----------------------------------------
function boot() {
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://127.0.0.1:8477/dashboard.html',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
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
      const backing = new Map();
      Object.defineProperty(w, 'localStorage', {
        value: { getItem: k => backing.get(k) ?? null, setItem: (k, v) => backing.set(k, String(v)),
                 removeItem: k => backing.delete(k), clear: () => backing.clear(),
                 key: i => [...backing.keys()][i] ?? null, get length(){ return backing.size; } },
        configurable: true, writable: true });
    },
  });
}

const dom = boot();
setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    const drawer = d.getElementById('drawer');
    const logbtn = d.getElementById('logbtn');
    chk(!!drawer, '#drawer exists');
    chk(!!logbtn, '#logbtn entry point exists (floating tab, reachable from every view since it sits outside per-view content)');

    // Opening pushes a history state (for Android/gesture back to close it).
    const beforeLen = w.history.length;
    logbtn.click();
    chk(drawer.classList.contains('open'), 'clicking #logbtn opens the drawer');
    chk(w.history.length > beforeLen, 'opening the drawer pushes a history entry (so back closes it, #17)');

    // Body scroll gets locked while open.
    chk(d.body.style.position === 'fixed', 'body scroll is locked (position:fixed) while the drawer is open');

    // Simulate back/popstate closing it.
    w.dispatchEvent(new w.PopStateEvent('popstate', { state: null }));
    chk(!drawer.classList.contains('open'), 'a popstate (back gesture) closes the drawer');
    chk(d.body.style.position !== 'fixed', 'body scroll lock is released when the drawer closes');

    // Escape still closes it too (pre-existing behaviour, must not regress).
    logbtn.click();
    chk(drawer.classList.contains('open'), 'drawer reopens for the Escape check');
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
    chk(!drawer.classList.contains('open'), 'Escape still closes the drawer (no regression)');
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 6).join('\n'));
  }
  console.log(`\ncheck_logs_sheet.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
