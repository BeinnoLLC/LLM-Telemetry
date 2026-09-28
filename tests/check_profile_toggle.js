// #121: profiles are on/off toggle chips — there is NO "All" tab. When every
// profile is on, the merge the old All tab showed is simply what you see.
// Every profile also carries its unique colour into the tab AND into badges
// showing that profile (the Live-row chip), both from one hash.
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
        // chartjs internals poked at runtime: scales chain and the "size"
        // holder some chart types assign into.
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
      w.Chart = Stub;
      w.getChart = () => null;
      // jsdom declares localStorage as a prototype getter, so a plain
      // `w.localStorage = {...}` assignment is silently ignored (which made a
      // seeded second boot read empty storage). defineProperty actually wins.
      const ls = {
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

const tabNames = d => [...d.querySelectorAll('#tabs > button')].map(b => b.dataset.tab);
const chipOf = (d, n) => d.querySelector(`#tabs > button[data-tab="${n}"]`);
const hueOf = (w, n) => w.eval(`hashHue(${JSON.stringify(n)})`);

// ---- pass 1: real behaviour ------------------------------------------------
const dom = bootDOM(() => null);
setTimeout(() => {
  try {
    const w = dom.window, doc = w.document;

    // ---- no All tab, ever -------------------------------------------------
    const tabs0 = tabNames(doc);
    chk(!tabs0.includes('All'), 'NO All tab exists on the tab strip', tabs0.join(','));
    const anyAllBtn = [...doc.querySelectorAll('#tabs > button')]
      .some(b => /^all$/i.test(b.textContent.trim()));
    chk(!anyAllBtn, 'no button labelled "All" in the strip');
    chk(tabs0.length >= 2, 'every real profile is rendered as a chip', tabs0.join(','));

    const victim = tabs0[tabs0.length - 1];
    const survivor = tabs0.find(n => n !== victim);
    chk(chipOf(doc, victim).dataset.off === '0', 'chip starts in the ON state');
    chk(/turn off/i.test(chipOf(doc, victim).title), 'ON chip tooltip offers turning off');

    // all-on means "all": the merge is the active view and holds every row.
    const rowsAll = (w.eval('DATA.profiles[current]') || {}).rows || [];
    const perProfile = tabs0.reduce((a, n) =>
      a + (((w.eval(`DATA.profiles[${JSON.stringify(n)}]`) || {}).rows || []).length), 0);
    chk(w.eval('current') === 'All', 'default view is the all-profiles merge', String(w.eval('current')));
    chk(rowsAll.length === perProfile && perProfile > 0,
        'all-on merge contains every profile\'s rows', `${rowsAll.length} vs ${perProfile}`);

    // ---- toggling OFF: chip stays visible, dimmed, marked off -------------
    w.eval(`pvToggle(${JSON.stringify(victim)})`);
    const c1 = chipOf(doc, victim);
    chk(!!c1, 'toggled-off chip is STILL rendered (state is visible, not hidden)');
    chk(c1 && c1.dataset.off === '1', 'chip marked off', c1 && c1.dataset.off);
    chk(c1 && /turn on/i.test(c1.title), 'OFF chip tooltip offers turning back on');
    const vkey = `llmtelemetry.profileVisibility.${victim}`;
    chk(w.localStorage.getItem(vkey) === 'off', 'localStorage records off',
        String(w.localStorage.getItem(vkey)));
    const rowsAfter = (w.eval('DATA.profiles[current]') || {}).rows || [];
    chk(rowsAfter.length < rowsAll.length, 'off profile\'s rows left the merge',
        `${rowsAfter.length} < ${rowsAll.length}`);
    const sub = doc.getElementById('tabsub');
    chk(!!sub && /\d+\/\d+ on/.test(sub.textContent),
        'N/M readout states the merge extent', sub && sub.textContent);

    // ---- last-on guard ----------------------------------------------------
    w.eval(`pvToggle(${JSON.stringify(survivor)})`);
    const cs = chipOf(doc, survivor);
    chk(cs && cs.dataset.off === '0', 'last ON profile cannot be switched off', cs && cs.dataset.off);
    const f = doc.getElementById('flash');
    chk(!!f && /at least one/i.test(f.textContent || ''), 'guard explains why', f && f.textContent);
    chk(w.eval('current') === survivor,
        'with one profile on, the view IS that profile', String(w.eval('current')));

    // ---- turning it back on restores the merge ----------------------------
    // Only one was off, so re-enabling it puts every profile back on and the
    // merged view must return with the full row count.
    w.eval(`pvToggle(${JSON.stringify(victim)})`);
    chk(chipOf(doc, victim).dataset.off === '0', 'chip back ON');
    chk(w.eval('current') === 'All', 'merge returns once all profiles are on again',
        String(w.eval('current')));
    chk((w.eval('DATA.profiles[current].rows') || []).length === rowsAll.length,
        'merge row count fully restored',
        `${(w.eval('DATA.profiles[current].rows') || []).length} vs ${rowsAll.length}`);

    // ---- unique colour per profile: tab AND badge -------------------------
    chk(hueOf(w, victim) !== hueOf(w, survivor), 'two profiles get different hues',
        `${hueOf(w, victim)} vs ${hueOf(w, survivor)}`);
    const tabHue = n => {
      const m = (chipOf(doc, n).getAttribute('style') || '').match(/hsl\((\d+)/);
      return m ? Number(m[1]) : null;
    };
    chk(tabHue(victim) === hueOf(w, victim), 'off-then-on tab colour still from the hash',
        `${tabHue(victim)} vs ${hueOf(w, victim)}`);
    chk(tabHue(survivor) === hueOf(w, survivor), 'second tab colour from its own hash',
        `${tabHue(survivor)} vs ${hueOf(w, survivor)}`);

    // The Live-row profile badge must use the SAME hash (it was hardcoded grey).
    // Only rows that carry a profile attribution have one, and only in the
    // merged view — target the exact chip markup, not any hsl() span.
    const badges = [...doc.querySelectorAll('#livelist span[style*="hsl("]')]
      .filter(s => /^(work|home|personal)$/.test(s.textContent.trim()));
    if (badges.length) {
      const okAll = badges.every(b => {
        const m = (b.getAttribute('style') || '').match(/hsl\((\d+)/);
        return m && Number(m[1]) === hueOf(w, b.textContent.trim());
      });
      chk(okAll, `live-row profile badge(s) use the profile hash (${badges.length})`);
    } else {
      chk(html.includes('hashHue(L.profile)'),
          'no attributed live rows in sample: badge wired to hashHue(L.profile)');
    }
    chk(!html.includes('background:${BD};color:${MU}">${L.profile}'),
        'the old grey profile badge is gone');

    // ---- persisted OFF survives a fresh boot ------------------------------
    const dom2 = bootDOM(k => (k === vkey ? 'off' : null));
    setTimeout(() => {
      try {
        const d2 = dom2.window.document, w2 = dom2.window;
        const t2 = tabNames(d2);
        chk(!t2.includes('All'), 'fresh boot: still no All tab');
        chk(t2.includes(victim), 'fresh boot: off profile chip still visible');
        chk(chipOf(d2, victim).dataset.off === '1', 'fresh boot honours stored off state');
        chk(w2.eval('current') !== 'All',
            'fresh boot with 1 on: view is that profile, not a merge', String(w2.eval('current')));
      } catch (e) {
        chk(false, 'second-boot check crashed', e.message);
      }
      console.log(`\ncheck_profile_toggle.js  ${pass} passed, ${fail} failed`);
      process.exit(fail ? 1 : 0);
    }, 1500);
  } catch (e) {
    console.log('FATAL in first-boot checks:', e.message);
    console.log((e.stack || '').split('\n').slice(0, 4).join('\n'));
    process.exit(1);
  }
}, 1500);
