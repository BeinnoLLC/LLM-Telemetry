// #126: (1) profile tab chips must not change size/style on click — a stale
// render() call used to re-style [data-tab] with a totally different class
// (12px generic tabon/taboff) on every pick(), stomping the 16px hue chips
// tabs() had just drawn. (2) profile colours are adjustable from Settings,
// and the override reaches every place that draws that profile's colour.
// Loads the BUILT dashboard from examples/reports/dashboard.html.
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

    // ---- bug: clicking a tab must not change chip size/class -------------
    const before = chips().map(c => ({ tab: c.dataset.tab, cls: c.className, style: c.getAttribute('style') }));
    chk(before.every(b => /text-\[length:var\(--fs-lg\)\]/.test(b.cls) && /px-5/.test(b.cls)),
        'chips start at the real large/px-5 size', before.map(b => b.cls).join(' | '));

    // Click a real profile chip via the same handler the page wires up.
    const target = names[0];
    w.eval(`pvToggle(${JSON.stringify(target)}); pvToggle(${JSON.stringify(target)});`); // off then on: exercises pick()/render() without leaving a profile permanently off
    // A plain view switch (which calls render() via pick()) is the actual
    // repro path reported by the user; simulate the click that gets there.
    w.eval(`pick(current);`);

    const after = chips().map(c => ({ tab: c.dataset.tab, cls: c.className, style: c.getAttribute('style') }));
    chk(after.length === before.length, 'chip count unchanged after interacting');
    after.forEach((a) => {
      chk(/text-\[length:var\(--fs-lg\)\]/.test(a.cls) && /px-5/.test(a.cls),
          `chip "${a.tab}" keeps its real large/px-5 size after render()`, a.cls);
      // "taboff" is the chip's REAL base class name (legacy naming from before
      // #121's hue-chip redesign); the actual bug was a full className swap to
      // the flat, differently-sized "px-3 py-1 ... 12px" class — assert that
      // exact regression signature is gone, not the base-class token itself.
      chk(!/px-3 py-1 rounded-md border text-\[12px\]/.test(a.cls),
          `chip "${a.tab}" was not swapped to the flat 12px on/off class`, a.cls);
    });

    // The render() stomp specifically wrote a flat 12px class on [data-tab]
    // elements; assert the emitted JS no longer contains that statement.
    chk(!/document\.querySelectorAll\('\[data-tab\]'\)\.forEach\(b =>\s*\n\s*b\.className='px-3 py-1/.test(html),
        'render() no longer re-styles [data-tab] with the flat 12px class');

    // ---- #126: profile colours are adjustable from Settings ---------------
    chk(typeof w.eval('profileHue') === 'function', 'profileHue() exists');
    chk(typeof w.eval('pvHueSet') === 'function', 'pvHueSet() exists');
    const n = names[0];
    const defaultHue = w.eval(`hashHue(${JSON.stringify(n)})`);
    const effectiveBefore = w.eval(`profileHue(${JSON.stringify(n)})`);
    chk(effectiveBefore === defaultHue, 'with no override, profileHue() matches the deterministic default');

    // Settings view exists with the colour card
    w.eval(`pickView('Settings');`);
    const grid = d.getElementById('setcolorgrid');
    chk(!!grid, 'Settings page has the profile-colour grid');
    const rows = [...grid.querySelectorAll('[data-scname]')];
    chk(rows.length === names.length, 'one row per profile', String(rows.length));
    const row = rows.find(r => r.dataset.scname === n);
    chk(!!row, `a row exists for profile "${n}"`);
    const slider = row.querySelector(`[data-schue="${n}"]`);
    chk(!!slider, 'the row has a hue slider');
    chk(Number(slider.value) === defaultHue, 'slider starts at the current effective hue', slider.value);

    // Drag the slider: fire the real input event through the real handler.
    const NEW_HUE = (defaultHue + 90) % 360;
    slider.value = String(NEW_HUE);
    slider.dispatchEvent(new w.Event('input', { bubbles: true }));

    chk(w.eval(`pvHueOverride(${JSON.stringify(n)})`) === NEW_HUE,
        'the override is stored after dragging the slider');
    chk(w.eval(`profileHue(${JSON.stringify(n)})`) === NEW_HUE,
        'profileHue() now returns the override');

    // The override must reach the tab chip immediately (no page reload,
    // no waiting for the next poll) — a settings change with no visible
    // effect elsewhere reads as broken.
    w.eval(`pickView('Live');`); // tabs() lives in the header, visible on every view
    const chip = d.querySelector(`#tabs > button[data-tab="${n}"]`);
    const style = chip.getAttribute('style') || '';
    chk(new RegExp(`hsl\\(${NEW_HUE} `).test(style),
        'the profile tab chip repaints with the new hue immediately', style);

    // And it reaches the live-session profile badge / queue lane dot too —
    // the whole point is "share one colour" across every place that draws it.
    w.eval(`DATA.profiles[current].live = [{id:'sx', model:'claude-opus-5', profile:${JSON.stringify(n)}, idle_s:1}];
            renderLive();`);
    const badge = [...d.querySelectorAll('#livelist span')].find(s => s.textContent === n);
    chk(!!badge, 'the live-session profile badge exists');
    chk(new RegExp(`hsl\\(${NEW_HUE} `).test(badge.getAttribute('style') || ''),
        'the live-session badge also picks up the overridden hue', badge.getAttribute('style'));
    w.eval('renderQueue()');
    const qcar = d.querySelector(`#qt-running .qt-car[data-key="s:sx"]`);
    chk(!!qcar, 'the running train car for that session exists');
    chk(qcar.style.getPropertyValue('--h') === String(NEW_HUE),
        'the train car also picks up the overridden hue', qcar.getAttribute('style'));

    // ---- reset restores the deterministic default --------------------------
    w.eval(`pickView('Settings');`);
    const resetBtn = d.getElementById('setcolorreset');
    chk(!!resetBtn, 'reset-to-defaults button exists');
    resetBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
    chk(w.eval(`pvHueOverride(${JSON.stringify(n)})`) === null,
        'reset clears the override');
    chk(w.eval(`profileHue(${JSON.stringify(n)})`) === defaultHue,
        'profileHue() is back to the deterministic default after reset');
    const sliderAfterReset = d.querySelector(`#setcolorgrid [data-schue="${n}"]`);
    chk(!!sliderAfterReset && Number(sliderAfterReset.value) === defaultHue,
        'the slider itself reflects the reset value', sliderAfterReset && sliderAfterReset.value);
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 5).join('\n'));
  }
  console.log(`\ncheck_profile_tabs_stable.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
