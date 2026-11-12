// LLMTELEMET-279: mouse-wheel zoom on every graph (shared web/js/zoom.js).
//
// Runs against the BUILT page (examples/reports/dashboard.html), like the rest
// of the DOM suites, with real WheelEvent dispatches. The four rules the zoom
// must hold on BOTH graphs (Flow/Life #flow and Orchestration .orch-svg):
//   1. the point under the cursor stays fixed while the wheel zooms;
//   2. the zoom survives a live re-render (state kept, listeners not stacked);
//   3. double-click resets to the fitted view;
//   4. the page does not scroll while the wheel is over the graph.
// Plus the visible +/−/Fit controls on the Orchestration graph (Flow keeps its
// own #flowctl buttons) and the flow control hooks the buttons rely on.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || path.join(__dirname, '..', 'examples', 'reports');
const html = fs.readFileSync(path.join(REPORTS, 'dashboard.html'), 'utf8')
  .replace(/<script src="https?:\/\/[^"]+"><\/script>/g, '');

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
};

// A fixed layout rect for every SVG so the cursor->user-unit maths below is
// deterministic (jsdom has no layout engine of its own).
const RECT = { left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600 };

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://127.0.0.1:8477/dashboard.html',
  beforeParse(w) {
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeListener() {}, removeEventListener() {} });
    w.HTMLCanvasElement.prototype.getContext = () => null;
    function Stub(ctx, cfg) {
      this.config = cfg; this.data = (cfg && cfg.data) || {}; this.destroy = () => {};
      this.update = () => {}; this.options = (cfg && cfg.options) || {};
      this.scales = {}; this._metasets = []; this.chartArea = { left: 0, top: 0, right: 0, bottom: 0 };
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
      value: {
        getItem: k => backing.get(k) ?? null, setItem: (k, v) => backing.set(k, String(v)),
        removeItem: k => backing.delete(k), clear: () => backing.clear(),
        key: i => [...backing.keys()][i] ?? null, get length() { return backing.size; },
      },
      configurable: true, writable: true,
    });
    Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', { get() { return 1000; } });
    Object.defineProperty(w.HTMLElement.prototype, 'clientHeight', { get() { return 600; } });
    w.HTMLElement.prototype.getBoundingClientRect = () => RECT;
    w.SVGSVGElement.prototype.getBoundingClientRect = () => RECT;
  },
});

const w = dom.window, d = w.document;

const parseVB = svg => (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
// The same rect-linear client->user mapping the zoom code uses, spelled out so
// the assertion does not depend on the implementation's internals.
const userAt = (svg, cx, cy) => {
  const [x, y, vw, vh] = parseVB(svg);
  return [x + cx / RECT.width * vw, y + cy / RECT.height * vh];
};

function wheel(svg, cx, cy, deltaY) {
  const ev = new w.WheelEvent('wheel', { clientX: cx, clientY: cy, deltaY, bubbles: true, cancelable: true });
  svg.dispatchEvent(ev);
  return ev;
}
function dblclick(svg) {
  svg.dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
}
function click(el) {
  el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
}

// The four rules, checked identically on both graphs.
function checkGraph(label, svg, base, rerender) {
  chk(!!svg, `${label}: graph rendered`);
  if (!svg) return;

  // 1. wheel zooms, and the point under the cursor stays fixed.
  const cx = 300, cy = 150;
  const u0 = userAt(svg, cx, cy);
  const vb0 = parseVB(svg);
  const ev = wheel(svg, cx, cy, -120);
  const vb1 = parseVB(svg);
  chk(vb1.join() !== vb0.join(), `${label}: a wheel event zooms the graph`);
  const u1 = userAt(svg, cx, cy);
  const err = Math.hypot(u1[0] - u0[0], u1[1] - u0[1]);
  chk(err < 0.5, `${label}: the point under the cursor stays fixed while zooming`,
    `drifted ${err.toFixed(3)} user units`);

  // 4. the wheel never scrolls the page: the handler cancels it (non-passive).
  chk(ev.defaultPrevented === true,
    `${label}: the wheel event is cancelled, so the page does not scroll while zooming`);

  // 2. the zoom survives a live re-render (fresh data, possibly fresh <svg>).
  rerender();
  const after = svg.isConnected ? svg : d.querySelector(svg === d.getElementById('flow') ? '#flow' : '.orch-svg');
  const vb2 = parseVB(after);
  chk(vb2.join() === vb1.join(), `${label}: zoom survives a live re-render`,
    `before ${vb1.join(' ')} / after ${vb2.join(' ')}`);

  // ...and zooming still works after the re-render (no stacked/dead listeners).
  const vb3 = parseVB(after);
  wheel(after, cx, cy, -120);
  chk(parseVB(after).join() !== vb3.join(), `${label}: wheel zoom still works after the re-render`);

  // 3. double-click resets to the fitted view.
  dblclick(after);
  const r = parseVB(after);
  chk(Math.abs(r[0] - base[0]) < 0.6 && Math.abs(r[1] - base[1]) < 0.6 &&
      Math.abs(r[2] - base[2]) < 0.6 && Math.abs(r[3] - base[3]) < 0.6,
    `${label}: double-click resets to the fitted view`,
    `got ${r.join(' ')} want ${base.join(' ')}`);
}

setTimeout(() => {
  try {
    // ---- Flow/Life --------------------------------------------------------
    w.eval("pickView('Flow')");
    const flowSvg = d.getElementById('flow');
    chk(typeof flowSvg._flowFit === 'function', 'Flow/Life: _flowFit hook is exposed (Fit button wiring)');
    chk(typeof flowSvg._flowZoom === 'function', 'Flow/Life: _flowZoom hook is exposed (+/- button wiring)');
    checkGraph('Flow/Life', flowSvg, [0, 0, 1000, 600], () => w.eval('renderFlow(FLOWROWS)'));
    chk(!d.querySelector('#flow ~ .zoomctl, #flowwrap .zoomctl'),
      'Flow/Life: no duplicate zoom controls (its own #flowctl box owns the buttons)');

    // ---- Orchestration ----------------------------------------------------
    w.eval("pickView('Orchestration')");
    const orchSvg = () => d.querySelector('.orch-svg');
    const baseOrch = parseVB(orchSvg());
    checkGraph('Orchestration', orchSvg(), baseOrch, () => w.eval('renderOrchestration()'));

    // Visible +/−/Fit controls (Orchestration has no controls of its own).
    const box = d.querySelector('.orch-card .zoomctl');
    chk(!!box, 'Orchestration: visible zoom controls are rendered');
    if (box) {
      const btns = [...box.querySelectorAll('button')];
      chk(btns.length === 3, 'Orchestration: exactly +, − and Fit buttons', `got ${btns.length}`);
      const out = btns.find(b => /zoom out/i.test(b.title || b.textContent));
      const inn = btns.find(b => /zoom in/i.test(b.title || b.textContent));
      const fit = btns.find(b => /fit/i.test(b.title || b.textContent));
      chk(!!out && !!inn && !!fit, 'Orchestration: the three buttons are labelled');
      const svg = orchSvg();
      const before = parseVB(svg).join();
      click(inn);
      const zoomedIn = parseVB(svg).join();
      chk(zoomedIn !== before, 'Orchestration: the + button zooms in');
      click(out);
      click(out);
      const zoomedOut = parseVB(svg).join();
      chk(zoomedOut !== zoomedIn, 'Orchestration: the − button zooms out');
      click(fit);
      const r = parseVB(svg);
      chk(Math.abs(r[0] - baseOrch[0]) < 0.6 && Math.abs(r[2] - baseOrch[2]) < 0.6,
        'Orchestration: the Fit button resets to the fitted view', `got ${r.join(' ')}`);
    }

    // The shipped page registers the wheel listener non-passively (source
    // check: jsdom does not enforce passive listeners). The helper routes
    // registration through its own on() binder, so match the wheel handler
    // block carrying { passive: false }, not the bare call spelling.
    chk(/on\('wheel',[\s\S]{0,300}?\{ passive: false \}/.test(html),
      'the shipped wheel listener is passive:false (can cancel the scroll)');
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 6).join('\n'));
  }
  console.log(`\ncheck_graph_wheel_zoom.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
