// Chart.js entrance animations must play once, on first paint — never
// replayed on the 60s auto-refresh or the 5s live poll (the user explicitly
// asked: "update data... smoothly, even charts like pie one without
// animations. animations should be initially only").
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

function boot() {
  const created = [];
  const dom = new JSDOM(html, {
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
        created.push(cfg);
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
  return { dom, created };
}

const { dom, created } = boot();
setTimeout(() => {
  const w = dom.window;
  try {
    // Charts built during the initial render (before bootDone) must NOT have
    // animation forced off — that would kill the first-paint entrance effect
    // the user wants to KEEP. (CHART_ANIM_DONE itself is not asserted here:
    // the page's own boot sequence races its rAF-driven bootDone() against
    // this test's setTimeout, and by design it should already have fired —
    // that's correct real-page behaviour, not something to pin down here.)
    const beforeBoot = created.filter(c => c && c.options && 'animation' in c.options);
    chk(beforeBoot.length === 0,
        'no chart built before the first paint has animation explicitly disabled', beforeBoot.length);

    created.length = 0;
    w.eval('bootDone()');
    chk(w.eval('CHART_ANIM_DONE') === true, 'bootDone() flips CHART_ANIM_DONE to true');

    // Simulate what doRefresh()/pollLive() do every cycle: render() destroys
    // and rebuilds every chart via mk(). Call render() directly (it reads
    // module-scope DATA/current, already seeded by the page's own boot).
    w.eval('render()');
    const afterBoot = created.filter(c => c && c.options);
    chk(afterBoot.length > 0, 'render() after bootDone() actually (re)builds charts', afterBoot.length);
    chk(afterBoot.every(c => c.options.animation === false),
        'every chart rebuilt after the first paint has animation:false — a refresh must not replay the entrance animation');

    // A caller that explicitly wants its own animation setting is still
    // respected (mk() must not blindly stomp opts.animation forever).
    w.eval(`mk('cModels', 'bar', ['x'], [{data:[1]}], {animation: {duration: 300}})`);
    const explicit = created[created.length - 1];
    chk(explicit.options.animation && explicit.options.animation.duration === 300,
        'an explicit opts.animation from a caller is never overridden by the post-boot animation:false default');
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 8).join('\n'));
  }
  console.log(`\ncheck_chart_no_reanimate.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
