// #18: flow graph touch pan/zoom/drag and a responsive viewBox.
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

// ---- source-level checks --------------------------------------------------
chk(/#flow\{width:100%;height:100%;display:block;cursor:grab;touch-action:none\}/.test(html),
    'the SVG has touch-action:none so a touch drag/pinch never scrolls the page underneath it');
chk(/#flow\.zoomedout \.nd\.task text\{display:none\}/.test(html),
    'below the fitted zoom level, small/task labels are hidden (tangle-of-labels fix)');
chk(/#flow\.zoomedout \.lnk\{stroke-opacity:.22\}/.test(html),
    'below the fitted zoom level, link opacity is reduced to cut visual noise');
chk(/hit\.setAttribute\('r', Math\.max\(R\(n\), 12\)\.toFixed\(1\)\)/.test(html),
    'every node gets an invisible hit-area circle of at least 12px radius (24px diameter, the ticket\'s finger-target floor)');
chk(/svg\._flowFit = fitView/.test(html),
    'fitView is exposed on the svg element so the Fit control and double-tap can both call the SAME reset logic');
chk(/data-flowfit title="Reset pan\/zoom to fit">Fit</.test(html),
    '#flowctl gets a "Fit" button (the ticket\'s explicit requirement)');
chk(/svg\.addEventListener\('dblclick', \(\) => fitView\(\)\)/.test(html),
    'double-click/double-tap resets to the fitted view');
chk(/new ResizeObserver\(\(\) => \{/.test(html) && /typeof ResizeObserver !== 'undefined'/.test(html),
    'a responsive viewBox recompute is wired via ResizeObserver, feature-detected so it degrades gracefully without it');
chk(/if \(active\.size === 2\)\{[\s\S]{0,300}?pinchStart = \{/.test(html),
    'two simultaneous pointers are treated as a pinch gesture');
chk(/const factor = d \/ \(pinchStart\.d \|\| 1\)/.test(html),
    'pinch scale is derived from the ratio of finger distance to the distance when the pinch started');

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
    // Navigate to the Flow tab so renderFlow actually runs.
    const flowTab = [...d.querySelectorAll('[data-vtab]')].find(b => b.dataset.vtab === 'Flow');
    chk(!!flowTab, 'Flow tab button exists');
    flowTab.click();
    const svg = d.getElementById('flow');
    chk(!!svg, '#flow svg exists after switching to the Flow tab');
    chk(typeof svg._flowFit === 'function', 'fitView is actually attached to the live svg element');

    const before = svg.getAttribute('viewBox');
    // Simulate a wheel-zoom (desktop trackpad pinch / scroll-zoom).
    svg.dispatchEvent(new w.WheelEvent('wheel', { clientX: 100, clientY: 100, deltaY: -100, bubbles: true, cancelable: true }));
    const afterZoom = svg.getAttribute('viewBox');
    chk(afterZoom !== before, 'a wheel event changes the viewBox (zoom actually happens)');

    // Reset via the Fit control.
    const fitBtn = d.querySelector('[data-flowfit]');
    chk(!!fitBtn, 'the Fit button exists in the rendered #flowctl');
    fitBtn.click();
    const afterFit = svg.getAttribute('viewBox');
    const parseVB = s => s.split(/\s+/).map(Number);
    chk(JSON.stringify(parseVB(afterFit)) === JSON.stringify(parseVB(before)),
        'clicking Fit restores the original viewBox (same numeric rect, formatting aside)');

    // A hit-area circle exists per node, distinct from the visible circle.
    const hitAreas = svg.querySelectorAll('.hitarea');
    chk(hitAreas.length > 0, 'hit-area circles are actually present in the rendered graph', hitAreas.length);
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 6).join('\n'));
  }
  console.log(`\ncheck_flow_touch.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
