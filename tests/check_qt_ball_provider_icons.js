// HARD UI RULE (permanent, user-mandated): the Life-view task-queue jar balls (depot, on the
// line, yard) and the jar legend show PROVIDER ICON SVGs, never letters. Commit b62a823
// regressed the balls to family letters (H, pi, C, X, O); this guard fails if any .qt-ball
// lacks a provider SVG or carries a single-letter text glyph, if QT_GLYPH is back in flow.js,
// or if a no-model depot ball stops showing the Ollama logo.
//
// Loads the BUILT dashboard from examples/reports/dashboard.html (the same artifact the
// browser runs) and reads the flow.js source for the QT_GLYPH absence check.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || path.join(ROOT, 'examples', 'reports');
const html = fs.readFileSync(path.join(REPORTS, 'dashboard.html'), 'utf8');
const flowSrc = fs.readFileSync(
  path.join(ROOT, 'src', 'llm_telemetry', 'web', 'js', 'flow.js'), 'utf8');

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
  const cars = box => [...box.querySelectorAll('.qt-ball[data-key]')].filter(c => !c.classList.contains('qt-leaving'));
  try {
    // ---- 1. QT_GLYPH is gone from the source and the built page -------------------------
    chk(!/\bQT_GLYPH\b/.test(flowSrc), 'flow.js has no QT_GLYPH letter table');
    chk(!/\bqtGlyphKey\b/.test(flowSrc), 'flow.js has no qtGlyphKey family mapper');
    chk(!/\bQT_GLYPH\b/.test(html), 'the built page has no QT_GLYPH letter table');

    // ---- 2. drive depot (no models), running and yard balls ------------------------------
    w.eval(`DATA.ollama = {hosts: [{label:'box-a', up:true, queue:3, loaded:[], urls:[]}]};
      DATA.profiles[current].live = [
        {id:'t1', model:'claude-opus-5', title:'one', idle_s:1},
        {id:'t2', model:'totally-unknown-model', title:'two', idle_s:2},
        {id:'t3', title:'three', idle_s:3}];
      DATA.profiles[current].recent_sessions = [
        {id:'d1', title:'done one', model:'qwen3-coder:30b', last_ts: Date.now()/1000, dur_s: 42, tokens: 100},
        {id:'d2', title:'done two', model:'mystery-model', last_ts: Date.now()/1000, dur_s: 7, tokens: 10}];
      renderQueue();`);
    const qb = d.getElementById('qt-queued'), rb = d.getElementById('qt-running'), db = d.getElementById('qt-done');
    const balls = [...cars(qb), ...cars(rb), ...cars(db)];
    chk(balls.length === 8, 'balls rendered across all three jars', balls.length);

    // ---- 3. every .qt-ball contains an svg and no single-letter text glyph ---------------
    chk(balls.every(c => !!c.querySelector('.qt-gl svg')), 'every .qt-ball contains an svg');
    chk(balls.every(c => c.textContent.trim().length !== 1), 'no .qt-ball shows a single-letter text glyph');

    // ---- 4. no-model depot balls get the Ollama logo --------------------------------------
    const ollamaPath = w.eval('RT_SVG.ollama');
    const depot = cars(qb);
    chk(depot.length === 3 && depot.every(c => {
      const p = c.querySelector('.qt-gl svg path');
      return p && p.getAttribute('d') === ollamaPath;
    }), 'no-model depot balls get the Ollama logo');

    // ---- 5. unknown providers show a neutral generic SVG icon, never a letter -------------
    const unknown = [...cars(rb), ...cars(db)].find(c => c._qt && c._qt.model === 'mystery-model');
    chk(!!unknown, 'the unknown-provider ball exists');
    chk(!!unknown && !!unknown.querySelector('.qt-gl svg') && unknown.textContent.trim().length !== 1,
        'unknown provider shows a neutral generic SVG icon, never a letter');
    const brand = cars(rb).find(c => c._qt && c._qt.model === 'claude-opus-5');
    const claudePath = w.eval("RT_SVG[RT_LOGO['anthropic'].svg]");
    const brandPath = brand && brand.querySelector('.qt-gl svg path');
    chk(!!brandPath && brandPath.getAttribute('d') === claudePath,
        'a model ball shows its provider brand mark (claude -> Anthropic)');

    // ---- 6. the legend uses the same icons ------------------------------------------------
    const leg = d.querySelector('.qt-legend .qt-gl');
    const legPath = leg && leg.querySelector('svg path');
    chk(!!leg && !!leg.querySelector('svg'), 'the jar legend shows an icon svg');
    chk(!!legPath && legPath.getAttribute('d') === ollamaPath,
        'the legend uses the same Ollama icon as the balls');
    chk(!!leg && leg.textContent.trim().length !== 1, 'the legend shows no letter glyph');
  } catch (e) {
    chk(false, 'provider-icon checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 4).join('\n'));
  }
  console.log(`\ncheck_qt_ball_provider_icons.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
