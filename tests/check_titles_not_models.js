// #127: Task queue running/done lanes, and the "In progress now" grid, must
// lead with the session TITLE (the prompt/task the user is actually running)
// rather than the model name. Model stays visible as secondary metadata —
// it's useful, just not what answers "what is this box doing".
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

setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    // ---- give a live session a real title, distinct from its model --------
    w.eval(`DATA.profiles[current].live = [
      {id:'tlive1', model:'claude-opus-5', title:'Refactor the billing parser',
       profile:Object.keys(PV_ALL)[0], idle_s:2, category:'Coding', phase:'writing tests',
       tools:[], up_bytes:0, down_bytes:0},
      {id:'tlive2', model:'deepseek-v4p1-flash', title:'(untitled)',
       profile:Object.keys(PV_ALL)[0], idle_s:5, category:'Chat', phase:'', tools:[],
       up_bytes:0, down_bytes:0}
    ];
    DATA.profiles[current].recent_sessions = [
      {id:'tdone1', title:'Migrate the auth schema', model:'gpt-6', last_model:'gpt-6', last_ts: Date.now()/1000, dur_s:120},
      {id:'tdone2', title:'(untitled)', model:'glm-5.3-flash', last_model:'glm-5.3-flash', last_ts: Date.now()/1000-5, dur_s:60}
    ];
    renderQueue(); renderLive();`);

    // ---- Task queue (railway): running car leads with title, not model ----
    // The lanes were removed (#140 follow-up); the train cars now carry the
    // label, and the hover card carries the model as secondary info.
    const car = k => d.querySelector(`#qtrain .qt-car[data-key="${k}"]`);
    const lbl = c => c.querySelector('.qt-lbl').textContent;
    const runCar = car('s:tlive1');
    chk(!!runCar, 'running car for the titled session exists');
    chk(lbl(runCar) === 'Refactor the billing parser',
        'running car label is the session TITLE, not the model', lbl(runCar));
    const runTip = w.eval('carTip')(runCar._qt);
    chk(runTip.includes('claude-opus-5'), 'running car hover card shows the model as secondary info', runTip);

    // untitled session falls back to model, never shows the literal "(untitled)"
    const runCar2 = car('s:tlive2');
    chk(!!runCar2, 'running car for the untitled session exists');
    chk(lbl(runCar2) === 'deepseek-v4p1-flash',
        'untitled running session falls back to the model name', lbl(runCar2));
    chk(!/\(untitled\)/.test(runCar2.textContent), 'the literal "(untitled)" string is never shown');

    // ---- Task queue (railway): parked yard car leads with title -----------
    const doneCar = car('s:tdone1');
    chk(!!doneCar, 'yard car for the titled session exists');
    chk(lbl(doneCar) === 'Migrate the auth schema',
        'yard car label is the session TITLE, not the model', lbl(doneCar));

    const doneCar2 = car('s:tdone2');
    chk(!!doneCar2, 'yard car for the untitled session exists');
    chk(lbl(doneCar2) === 'glm-5.3-flash',
        'untitled done session falls back to the model name', lbl(doneCar2));

    // ---- In progress now: title is the prominent text, model is secondary --
    const rows = [...d.querySelectorAll('#livelist > div')];
    const row1 = rows.find(r => r.textContent.includes('Refactor the billing parser'));
    chk(!!row1, '"In progress now" row shows the session title');
    const titleEl = [...row1.querySelectorAll('span,button')].find(s => s.textContent === 'Refactor the billing parser');
    chk(!!titleEl, 'the title text is its own element (not buried in a combined string)');
    chk(/text-\[length:var\(--fs-md\)\]/.test(titleEl.className) && /font-semibold/.test(titleEl.className),
        'title is styled as the prominent element', titleEl.className);
    const modelEl = row1.querySelector('.metacol > div:first-child');
    chk(!!modelEl && modelEl.textContent.trim() === 'claude-opus-5',
        'model name is still shown, in the meta column', modelEl && modelEl.textContent);
    chk(/text-\[length:var\(--fs-sm\)\]/.test(modelEl.className) && /muted/.test(modelEl.className),
        'model name is now the smaller, secondary/muted element', modelEl.className);
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 6).join('\n'));
  }
  console.log(`\ncheck_titles_not_models.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
