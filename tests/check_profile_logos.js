// #128: per-profile logos — upload, tab strip, nav drawer/profile selector.
// The dashboard's only profile-selector UI is the tab strip (tabs()); this
// exercises the same real-handler pattern check_profile_tabs_stable.js uses
// for the sibling #126 colour feature.
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

const dom = bootDOM();
setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    const chips = () => [...d.querySelectorAll('#tabs > button')];
    const names = chips().map(c => c.dataset.tab);
    chk(names.length >= 2, 'sample dashboard has 2+ profiles', names.join(','));
    const n = names[0];

    chk(typeof w.eval('profileLogo') === 'function', 'profileLogo() exists');
    chk(typeof w.eval('profileLogoSet') === 'function', 'profileLogoSet() exists');
    chk(typeof w.eval('profileIconHtml') === 'function', 'profileIconHtml() exists');

    // ---- default: no logo set → falls back to the initial, not a broken/
    // empty icon (the ticket's own acceptance line) --------------------------
    chk(w.eval(`profileLogo(${JSON.stringify(n)})`) === null,
        'a fresh profile has no logo override');
    const chipBefore = chips().find(c => c.dataset.tab === n);
    chk(!chipBefore.querySelector('img'),
        'with no logo set, the tab chip renders NO <img> (falls back to the initial)');
    chk(!!chipBefore.querySelector('span[aria-hidden="true"]'),
        'the tab chip renders the initial-letter fallback icon instead');

    // ---- Settings page: the logo uploader ----------------------------------
    w.eval(`pickView('Settings');`);
    const grid = d.getElementById('setlogogrid');
    chk(!!grid, 'Settings page has the profile-logo grid');
    const rows = [...grid.querySelectorAll('[data-slname]')];
    chk(rows.length === names.length, 'one row per profile', String(rows.length));
    const row = rows.find(r => r.dataset.slname === n);
    chk(!!row, `a row exists for profile "${n}"`);
    const fileInput = row.querySelector(`[data-slfile="${n}"]`);
    chk(!!fileInput && fileInput.type === 'file', 'the row has a file picker input');
    chk(fileInput.getAttribute('accept') === 'image/*', 'the file picker only accepts images');
    chk(!row.querySelector('[data-slclear]'), 'no Clear button shown until a logo is actually set');

    // ---- setting a logo (drive profileLogoSet directly — jsdom's FileReader
    // is a real async API tied to a real File object the harness can't
    // easily construct headlessly; this exercises the exact same storage +
    // render path the file-picker's change handler calls into, which is the
    // part actually worth testing without a browser) ------------------------
    const FAKE_LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'; // 1x1 px, tiny
    w.eval(`profileLogoSet(${JSON.stringify(n)}, ${JSON.stringify(FAKE_LOGO)}); renderSetLogos(); tabs();`);

    chk(w.eval(`profileLogo(${JSON.stringify(n)})`) === FAKE_LOGO,
        'profileLogo() returns the stored data URI after profileLogoSet()');

    // Tab strip must pick it up immediately (#128's own acceptance line
    // "Tabs ... show it"), same pattern check_profile_tabs_stable.js proved
    // for hue overrides — no reload, no waiting for the next poll.
    const chipAfter = chips().find(c => c.dataset.tab === n);
    const img = chipAfter.querySelector('img');
    chk(!!img, 'after setting a logo, the tab chip now renders an <img>');
    chk(!!img && img.getAttribute('src') === FAKE_LOGO,
        'the <img> src is exactly the stored data URI (not re-encoded/mangled)', img && img.getAttribute('src'));
    chk(!chipAfter.querySelector('span[aria-hidden="true"]'),
        'the initial-letter fallback is gone once a real logo is set');

    // Settings row itself repaints with a Clear button + live preview once set.
    const gridAfter = d.getElementById('setlogogrid');
    const rowAfter = [...gridAfter.querySelectorAll('[data-slname]')].find(r => r.dataset.slname === n);
    chk(!!rowAfter.querySelector('[data-slclear]'), 'a Clear button appears once a logo is set');
    chk(!!rowAfter.querySelector('img'), 'the settings row preview also shows the new logo');

    // ---- Clear restores the fallback (acceptance: "falls back to the
    // default icon when unset") ----------------------------------------------
    const clearBtn = rowAfter.querySelector('[data-slclear]');
    clearBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
    chk(w.eval(`profileLogo(${JSON.stringify(n)})`) === null,
        'Clear removes the stored override');
    const chipCleared = chips().find(c => c.dataset.tab === n);
    chk(!chipCleared.querySelector('img'), 'after Clear, the tab chip has no <img> again');
    chk(!!chipCleared.querySelector('span[aria-hidden="true"]'),
        'after Clear, the initial-letter fallback is back on the chip');

    // ---- persistence across a session (acceptance: "setting persists
    // across sessions (read from config on load)") — this dashboard's
    // per-profile display prefs live in localStorage (same pattern #126 uses,
    // and documented as such: "Stored in this browser only"), so persistence
    // means surviving a fresh boot of the SAME page against the SAME backing
    // store, not a server round-trip. ----------------------------------------
    w.eval(`profileLogoSet(${JSON.stringify(n)}, ${JSON.stringify(FAKE_LOGO)});`);
    const persisted = w.eval(`localStorage.getItem(${JSON.stringify('llmtelemetry.profileLogo.' + n)})`);
    chk(persisted === FAKE_LOGO, 'the logo is persisted under a stable localStorage key, not just an in-memory var');

    // ---- size cap (acceptance: "size/format limits for an uploaded image") -
    chk(typeof w.eval('PROFILE_LOGO_MAX_BYTES') === 'number' && w.eval('PROFILE_LOGO_MAX_BYTES') > 0,
        'a concrete max-size limit constant exists (not left as an open question)');

    // ---- a second, untouched profile is unaffected --------------------------
    if (names[1]) {
      chk(w.eval(`profileLogo(${JSON.stringify(names[1])})`) === null,
          'a different, untouched profile still has no logo override (no cross-profile leakage)');
    }
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 8).join('\n'));
  }
  console.log(`\ncheck_profile_logos.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
