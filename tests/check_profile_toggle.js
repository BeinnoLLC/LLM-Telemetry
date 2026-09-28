// #119: per-profile tab visibility (on/off toggles persisted to localStorage)
// and the All-merge behaviour: All hides at exactly 1 visible profile.
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

// jsdom has no canvas and no chart libs; stub them BEFORE scripts run so the
// analytics block boots cleanly in both passes.
function bootDOM(storageGet) {
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
        // chartjs internals poked at runtime: scales chain, plugin registry,
        // and the "size" holder some chart types assign into.
        this.scales = {}; this._metasets = []; this.chartArea = {left:0, top:0, right:0, bottom:0};
        this.width = 300; this.height = 150; this.aspectRatio = 2; this.attached = false;
        this.getDatasetMeta = () => ({ data: [], controller: null });
      }
      Stub.register = () => {}; Stub.overrides = {}; Stub.instances = {};
      Stub.getChart = () => null; Stub.registerables = []; Stub.version = 'stub';
      Stub.controllers = {}; Stub.elements = {}; Stub.plugins = {}; Stub.scales = {};
      // Chart.defaults.font.size (and friends) are assigned at boot: pre-shape
      // the defaults tree so the assignment lands instead of throwing.
      Stub.defaults = { font: { size: 10, family: '', weight: '' }, color: '' };
      Stub.overrides = {};
      w.Chart = Stub;
      w.getChart = () => null;
      // jsdom declares localStorage as a prototype getter, so a plain
      // `w.localStorage = {...}` assignment is silently ignored (which made a
      // seeded second boot read empty storage). defineProperty actually wins.
      const ls = {
        _b: backing,
        getItem: k => (backing.has(k) ? backing.get(k) : storageGet(k)),
        setItem: (k, v) => { backing.set(k, String(v)); },
        removeItem: k => backing.delete(k),
        clear: () => backing.clear(),
        key: i => [...backing.keys()][i] ?? null,
        get length(){ return backing.size; },
      };
      Object.defineProperty(w, 'localStorage', { value: ls, configurable: true, writable: true });
    },
  });
}

// ---- pass 1: real behaviour ------------------------------------------------
const dom = bootDOM(() => null);
setTimeout(() => {
  try {
    const w = dom.window, doc = w.document;

    const tabs0 = [...doc.querySelectorAll('#tabs > button')].map(b => b.dataset.tab);
    chk(tabs0.length >= 3, 'boot: 2 plus profiles + All', tabs0.join(','));
    chk(tabs0.includes('All'), 'All tab present with 2+ profiles');

    const targets = tabs0.filter(n => n !== 'All');
    if (targets.length < 2) {
      console.log('FATAL: sample dashboard has <2 profiles');
      process.exit(1);
    }
    const victim = targets[targets.length - 1];
    const survivor = targets.find(n => n !== victim);

    w.eval(`pvToggle(${JSON.stringify(victim)})`);

    const tabs1 = [...doc.querySelectorAll('#tabs > button')].map(b => b.dataset.tab);
    chk(!tabs1.includes(victim), 'toggled-off tab removed', tabs1.join(','));
    chk(!tabs1.includes('All'), 'All HIDDEN at exactly 1 visible profile', tabs1.join(','));
    const profs1 = Object.keys(w.eval('DATA.profiles'));
    chk(!profs1.includes(victim), 'profile removed from DATA.profiles');

    const key = `llmtelemetry.profileVisibility.${victim}`;
    chk(w.localStorage.getItem(key) === 'off', 'localStorage records off', String(w.localStorage.getItem(key)));

    // last-on protection
    w.eval(`pvToggle(${JSON.stringify(survivor)})`);
    const tabs2 = [...doc.querySelectorAll('#tabs > button')].map(b => b.dataset.tab);
    chk(tabs2.includes(survivor), 'last-on profile stays on', tabs2.join(','));
    const f = doc.getElementById('flash');
    chk(!!f, 'flash element created for guard message');
    chk(/at least one/i.test((f && f.textContent) || ''), 'guard message shown', f && f.textContent);

    // re-enable
    w.eval(`pvToggle(${JSON.stringify(victim)})`);
    const tabs3 = [...doc.querySelectorAll('#tabs > button')].map(b => b.dataset.tab);
    chk(tabs3.includes(victim), 're-enabled tab comes back');
    const profs3 = Object.keys(w.eval('DATA.profiles'));
    chk(profs3.includes('All') && profs3.includes(victim), 'All returns at 2+ profiles', profs3.join(','));

    // ---- pass 2: persisted off-profile on a fresh boot ---------------------
    const dom2 = bootDOM(k => (k === key ? 'off' : null));
    setTimeout(() => {
      try {
        const tabs4 = [...dom2.window.document.querySelectorAll('#tabs > button')].map(b => b.dataset.tab);
        chk(!tabs4.includes(victim), 'fresh boot honours stored off-profile', tabs4.join(','));
        // All shows only when 2+ profiles are visible — derive, never assume.
        const remaining = tabs4.filter(n => n !== 'All').length;
        chk(tabs4.includes('All') === (remaining >= 2),
            `All visibility matches ${remaining} visible profile(s)`, tabs4.join(','));
        const p4 = Object.keys(dom2.window.eval('DATA.profiles'));
        chk(!p4.includes(victim), 'fresh boot excludes profile from DATA.profiles');
      } catch (e) {
        chk(false, 'second-boot check crashed', e.message);
      }
      console.log(`\ncheck_profile_toggle.js  ${pass} passed, ${fail} failed`);
      process.exit(fail ? 1 : 0);
    }, 1500);
  } catch (e) {
    console.log('FATAL in first-boot checks:', e.message);
    console.log(e.stack.split('\n').slice(0, 4).join('\n'));
    process.exit(1);
  }
}, 1500);
