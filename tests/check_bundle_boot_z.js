// LLMTELEMET-308: the build flattens the modules into ONE classic script in
// order.json order, so a `const` declared after the boot block is still in its
// temporal dead zone when the first render runs. Z (status tokens) once lived in
// state.js, landed after main.js's boot, and a boot render that reached
// flow.js renderAgents or charts.js ctxSpark threw "Cannot access 'Z' before
// initialization". This loads the BUILT bundle with a profile selected and a
// context session that has a compaction, and asserts nothing threw.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'examples', 'reports', 'dashboard.html'), 'utf8');

let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
}

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push(String((e.detail && e.detail.stack) || e.message || e)));
vc.on('error', (...a) => errors.push(a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'http://127.0.0.1:8477/dashboard.html' + (process.env.BOOT_HASH || '#/detail'),
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(w) {
    w.addEventListener('error', e => errors.push(String(e.message || e.error)));
    w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
    w.HTMLCanvasElement.prototype.getContext = () => null;
    function Stub(ctx, cfg) { this.config = cfg; this.destroy = () => {}; this.update = () => {}; this.canvas = ctx; }
    Stub.register = () => {}; Stub.overrides = {}; Stub.instances = {}; Stub.getChart = () => null;
    Stub.registerables = []; Stub.version = 'stub'; Stub.controllers = {}; Stub.elements = {}; Stub.plugins = {}; Stub.scales = {};
    Stub.defaults = { font: { size: 10, family: '', weight: '' }, color: '' };
    w.Chart = Stub;
    // One profile on at boot, so the boot render is the single profile 'work'
    // (the merged All view has no context sessions) and lands on Detail.
    const backing = new Map([['llmtelemetry.profileVisibility.personal', 'off']]);
    Object.defineProperty(w, 'localStorage', {
      value: { getItem: k => backing.get(k) ?? null, setItem: (k, v) => backing.set(k, String(v)),
               removeItem: k => backing.delete(k), clear: () => backing.clear(),
               key: i => [...backing.keys()][i] ?? null, get length(){ return backing.size; } },
      configurable: true, writable: true });
  },
});

setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    chk(errors.filter(e => /ReferenceError|before initialization/.test(e)).length === 0,
        'boot threw no ReferenceError / TDZ error', errors.join(' | ').slice(0, 300));
    w.eval("current = 'work'; view = 'Detail'; render();");
    chk(!!(d.getElementById('ctxsessions') || {}).innerHTML.includes('sess_ctxdemo1'),
        'a profile is selected and the compacting context session renders');
    chk(d.querySelectorAll('#ctxsessions svg line').length >= 1,
        'the compaction sparkline (ctxSpark, reads Z) rendered a marker');
    chk(typeof w.eval('Z.ok') === 'string', 'Z is initialised in the bundle');
    chk(errors.filter(e => /ReferenceError|before initialization/.test(e)).length === 0,
        'rendering added no ReferenceError', errors.join(' | ').slice(0, 300));
  } catch (e) { chk(false, 'bundle boot/render', e.message); }
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
